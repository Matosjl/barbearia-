-- ============================================================================
--  BARBER SAAS — MIGRAÇÃO 07: CENTRAL DE WHATSAPP (CRM) + ETIQUETAS
--    - Etiquetas/selo de cliente (manuais + automáticas por regra)
--    - Central WhatsApp: conversas + mensagens (modelo UNIFICADO)
--    - Substitui message_outbox/message_inbox (06) por whatsapp_messages
--    - Segmentação de campanha, opt-out + histórico de consentimento
--    - Fila de envio com limite (anti-bloqueio do WhatsApp)
--    - Reforço relacional: timeline ligada a cliente/agendamento/venda/etc.
--  Depende de: 01..06.  Ordem: 01 → 02 → 05 → 06 → 07 → 03 → 04
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Refatoração: o WhatsApp da migração 06 vira um modelo de chat unificado.
--    (Sem dados em produção; substituímos para não duplicar informação.)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS message_outbox CASCADE;
DROP TABLE IF EXISTS message_inbox  CASCADE;

-- ----------------------------------------------------------------------------
-- 1. CLIENTE: campos de verificação e opt-out (base do CRM/WhatsApp)
-- ----------------------------------------------------------------------------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS opt_out_at TIMESTAMPTZ;

-- Histórico de consentimento (LGPD): toda mudança de opt-in/opt-out fica registrada
CREATE TABLE IF NOT EXISTS customer_consent_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id UUID NOT NULL REFERENCES barbershops(id),
    customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel       TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms','email','push')),
    action        TEXT NOT NULL CHECK (action IN ('opt_in','opt_out')),
    source        TEXT,                       -- 'client_reply','owner','signup','admin'
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_customer ON customer_consent_history(customer_id, created_at);

-- ----------------------------------------------------------------------------
-- 2. ETIQUETAS / SELO DE CLIENTE
-- ----------------------------------------------------------------------------

-- Catálogo de etiquetas por barbearia (sistema + personalizadas)
CREATE TABLE IF NOT EXISTS customer_tags (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id UUID NOT NULL REFERENCES barbershops(id),
    key           TEXT NOT NULL,              -- 'cliente_fiel','cliente_vip','cliente_verificado'...
    label         TEXT NOT NULL,
    color         TEXT DEFAULT '#888888',
    is_system     BOOLEAN NOT NULL DEFAULT FALSE,   -- etiqueta padrão do sistema
    is_auto       BOOLEAN NOT NULL DEFAULT FALSE,   -- aplicada automaticamente por regra
    auto_rule     JSONB,                            -- definição da regra (ex.: {"metric":"visits","op":">=","value":10})
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE (barbershop_id, key)
);
CREATE INDEX IF NOT EXISTS idx_customer_tags_shop ON customer_tags(barbershop_id) WHERE deleted_at IS NULL;

-- Atribuição N:N cliente <-> etiqueta (reaproveitada em CRM, WhatsApp, campanhas, relatórios)
CREATE TABLE IF NOT EXISTS customer_tag_assignments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id UUID NOT NULL REFERENCES barbershops(id),
    customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    tag_id        UUID NOT NULL REFERENCES customer_tags(id) ON DELETE CASCADE,
    source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto')),
    assigned_by   UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_tag_assign_tag ON customer_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_assign_customer ON customer_tag_assignments(customer_id);

-- ----------------------------------------------------------------------------
-- 3. CENTRAL DE WHATSAPP — conversas + mensagens (chat unificado + fila)
-- ----------------------------------------------------------------------------

-- Uma conversa por cliente+instância (mesma filosofia de "1 chat por contato")
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id UUID NOT NULL REFERENCES barbershops(id),
    customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    instance_id   UUID REFERENCES whatsapp_instances(id),
    last_message_at TIMESTAMPTZ,
    last_inbound_at TIMESTAMPTZ,
    unread_count  INTEGER NOT NULL DEFAULT 0,
    is_open       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (barbershop_id, customer_id, instance_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_shop ON whatsapp_conversations(barbershop_id, last_message_at DESC);

-- Mensagem unificada: serve como HISTÓRICO (in/out) E como FILA (status='pendente').
-- status pedido: pendente, enviada, entregue, lida, falhou (+ recebida p/ inbound).
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    conversation_id  UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    customer_id      UUID NOT NULL REFERENCES customers(id),
    campaign_id      UUID REFERENCES marketing_campaigns(id),   -- NULL = mensagem avulsa
    appointment_id   UUID REFERENCES appointments(id),          -- NULL = não ligada a agendamento
    template_key     TEXT,                                      -- NULL = mensagem livre
    direction        TEXT NOT NULL CHECK (direction IN ('in','out')),
    body             TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pendente'
                       CHECK (status IN ('pendente','enviada','entregue','lida','falhou','recebida','cancelada')),
    intent           TEXT CHECK (intent IN ('confirm','reschedule','cancel','stop','other')),  -- p/ inbound
    provider_message_id TEXT,
    error            TEXT,
    scheduled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),        -- quando deve sair (fila)
    sent_at          TIMESTAMPTZ,
    delivered_at     TIMESTAMPTZ,
    read_at          TIMESTAMPTZ,
    idempotency_key  TEXT,
    created_by       UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- fila de saída: pega pendentes vencidas
CREATE INDEX IF NOT EXISTS idx_wa_msg_queue ON whatsapp_messages(scheduled_at)
    WHERE direction = 'out' AND status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_wa_msg_conv ON whatsapp_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_msg_campaign ON whatsapp_messages(campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wa_msg_idem
    ON whatsapp_messages(barbershop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. CAMPANHAS — segmentação rica, fila com limite, aprovação, histórico
-- ----------------------------------------------------------------------------
-- Estende marketing_campaigns (criada em 01)
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS segment_filter JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER NOT NULL DEFAULT 20;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS daily_cap INTEGER;          -- NULL = sem teto diário
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS total_recipients INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS sent_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','ai'));
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS ai_suggestion_id UUID REFERENCES ai_suggestions(id);
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Estende campaign_recipients (criada em 01): liga à mensagem real e refina status
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES whatsapp_messages(id);
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;
ALTER TABLE campaign_recipients ADD CONSTRAINT campaign_recipients_status_check
    CHECK (status IN ('pendente','enviada','entregue','lida','falhou','optout','skipped'));
ALTER TABLE campaign_recipients ALTER COLUMN status SET DEFAULT 'pendente';
-- não duplica o mesmo cliente na mesma campanha
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_recipient ON campaign_recipients(campaign_id, customer_id);
-- barbershop_id em campaign_recipients (para multi-tenant/RLS) — preenchido pela app
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES barbershops(id);

-- ----------------------------------------------------------------------------
-- 5. REFORÇO RELACIONAL: timeline ligada a TODAS as entidades de negócio
--    (atende a regra 11: timeline relaciona cliente/barbeiro/agendamento/venda/
--     pagamento/estoque/campanha/usuário responsável)
-- ----------------------------------------------------------------------------
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
-- ON DELETE SET NULL: se um hold expirado for purgado, a timeline não quebra.
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id);
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id);
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES marketing_campaigns(id);
CREATE INDEX IF NOT EXISTS idx_timeline_customer ON timeline_events(customer_id);

-- ----------------------------------------------------------------------------
-- 6. AUTO-TAGS: função que (re)calcula etiquetas automáticas por regra
--    Chamada por job diário e após eventos (finalizar atendimento, venda...).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ensure_system_tags(p_shop UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO customer_tags(barbershop_id, key, label, color, is_system, is_auto) VALUES
    (p_shop,'cliente_novo','Cliente novo','#3b82f6',TRUE,TRUE),
    (p_shop,'cliente_recorrente','Cliente recorrente','#22c55e',TRUE,TRUE),
    (p_shop,'cliente_fiel','Cliente fiel','#16a34a',TRUE,TRUE),
    (p_shop,'cliente_vip','Cliente VIP','#a855f7',TRUE,TRUE),
    (p_shop,'cliente_alto_valor','Cliente alto valor','#9333ea',TRUE,TRUE),
    (p_shop,'cliente_verificado','Cliente verificado','#0ea5e9',TRUE,TRUE),
    (p_shop,'cliente_inativo','Cliente inativo','#f59e0b',TRUE,TRUE),
    (p_shop,'cliente_sumido','Cliente sumido','#ef4444',TRUE,TRUE),
    (p_shop,'cliente_comprador','Cliente comprador','#14b8a6',TRUE,TRUE),
    (p_shop,'cliente_aniversario','Aniversariante','#ec4899',TRUE,TRUE)
  ON CONFLICT (barbershop_id, key) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_recompute_customer_tags(p_shop UUID)
RETURNS VOID AS $$
DECLARE r RECORD;
  v_tag UUID;
BEGIN
  PERFORM fn_ensure_system_tags(p_shop);

  FOR r IN SELECT * FROM customers WHERE barbershop_id = p_shop AND deleted_at IS NULL LOOP
    -- helper interno: aplica/remove etiqueta conforme condição
    -- FIEL: >10 visitas
    SELECT id INTO v_tag FROM customer_tags WHERE barbershop_id=p_shop AND key='cliente_fiel';
    IF r.visits_count > 10 THEN
      INSERT INTO customer_tag_assignments(barbershop_id,customer_id,tag_id,source)
        VALUES (p_shop,r.id,v_tag,'auto') ON CONFLICT (customer_id,tag_id) DO NOTHING;
    END IF;
    -- VIP / ALTO VALOR: gastou >= 500
    SELECT id INTO v_tag FROM customer_tags WHERE barbershop_id=p_shop AND key='cliente_vip';
    IF r.total_spent >= 500 THEN
      INSERT INTO customer_tag_assignments(barbershop_id,customer_id,tag_id,source)
        VALUES (p_shop,r.id,v_tag,'auto') ON CONFLICT (customer_id,tag_id) DO NOTHING;
    END IF;
    -- VERIFICADO: telefone validado
    SELECT id INTO v_tag FROM customer_tags WHERE barbershop_id=p_shop AND key='cliente_verificado';
    IF r.phone_verified_at IS NOT NULL OR r.is_verified THEN
      INSERT INTO customer_tag_assignments(barbershop_id,customer_id,tag_id,source)
        VALUES (p_shop,r.id,v_tag,'auto') ON CONFLICT (customer_id,tag_id) DO NOTHING;
    END IF;
    -- INATIVO: sem voltar há 60 dias / SUMIDO: 90 dias
    SELECT id INTO v_tag FROM customer_tags WHERE barbershop_id=p_shop AND key='cliente_inativo';
    IF r.last_visit_at IS NOT NULL AND r.last_visit_at < now() - INTERVAL '60 days' THEN
      INSERT INTO customer_tag_assignments(barbershop_id,customer_id,tag_id,source)
        VALUES (p_shop,r.id,v_tag,'auto') ON CONFLICT (customer_id,tag_id) DO NOTHING;
    END IF;
    SELECT id INTO v_tag FROM customer_tags WHERE barbershop_id=p_shop AND key='cliente_sumido';
    IF r.last_visit_at IS NOT NULL AND r.last_visit_at < now() - INTERVAL '90 days' THEN
      INSERT INTO customer_tag_assignments(barbershop_id,customer_id,tag_id,source)
        VALUES (p_shop,r.id,v_tag,'auto') ON CONFLICT (customer_id,tag_id) DO NOTHING;
    END IF;
    -- COMPRADOR: tem pedido pago
    SELECT id INTO v_tag FROM customer_tags WHERE barbershop_id=p_shop AND key='cliente_comprador';
    IF EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=r.id AND o.status IN ('paid','fulfilled')) THEN
      INSERT INTO customer_tag_assignments(barbershop_id,customer_id,tag_id,source)
        VALUES (p_shop,r.id,v_tag,'auto') ON CONFLICT (customer_id,tag_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 7. VIEW: público elegível para campanha (respeita opt-out)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_campaign_audience AS
SELECT
    c.barbershop_id,
    c.id AS customer_id,
    c.name, c.phone, c.segment, c.total_spent, c.visits_count,
    c.last_visit_at, c.birth_date, c.is_verified,
    (now()::date - c.last_visit_at::date) AS days_since_last_visit,
    ARRAY(SELECT t.key FROM customer_tag_assignments ta
            JOIN customer_tags t ON t.id = ta.tag_id
           WHERE ta.customer_id = c.id) AS tags
FROM customers c
WHERE c.deleted_at IS NULL
  AND c.marketing_opt_out = FALSE          -- nunca inclui quem deu opt-out
  AND c.phone IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 8. TRIGGERS: updated_at + auditoria nas novas tabelas
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
  upd TEXT[] := ARRAY['whatsapp_conversations'];
  aud TEXT[] := ARRAY['customer_tags','customer_tag_assignments','whatsapp_conversations',
                      'whatsapp_messages','customer_consent_history'];
BEGIN
  FOREACH t IN ARRAY upd LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I;', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();', t);
  END LOOP;
  FOREACH t IN ARRAY aud LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON %1$I;', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_audit();', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 9. RLS / PERMISSÕES
-- ----------------------------------------------------------------------------

-- 9.1 Tenant isolation + grant nas novas tabelas com barbershop_id
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
     WHERE c.table_schema = 'public'
       AND c.column_name = 'barbershop_id'
       AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (barbershop_id = app_current_barbershop())
        WITH CHECK (barbershop_id = app_current_barbershop());
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO barber_app;', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO barber_app;

-- 9.2 Campanhas: barbeiro comissionado NÃO dispara campanha em massa.
--     (marketing_campaigns/campaign_recipients já negam barber/customer na 06;
--      reforçamos campaign_recipients aqui pois ganhou barbershop_id agora.)
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_barber_customer ON campaign_recipients;
CREATE POLICY deny_barber_customer ON campaign_recipients AS RESTRICTIVE
  USING (app_role() NOT IN ('barber','customer'))
  WITH CHECK (app_role() NOT IN ('barber','customer'));

-- 9.3 Etiquetas: catálogo gerenciado por dono/gerente; cliente não acessa.
--     Barbeiro pode LER (para contexto), mas não altera o catálogo (app controla writes).
ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_customer ON customer_tags;
CREATE POLICY deny_customer ON customer_tags AS RESTRICTIVE
  USING (app_role() <> 'customer');

-- 9.4 Atribuições de etiqueta: barbeiro só vê as dos clientes que atendeu; cliente nenhuma.
ALTER TABLE customer_tag_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON customer_tag_assignments;
CREATE POLICY row_scope_by_role ON customer_tag_assignments AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager','receptionist')
    OR (app_role() = 'barber' AND EXISTS (
          SELECT 1 FROM appointments a
           WHERE a.customer_id = customer_tag_assignments.customer_id
             AND a.barber_id = app_barber_id()
             AND a.status IN ('in_progress','completed')))
  );

-- 9.5 Conversas/mensagens: dono/gerente total; barbeiro só se o dono permitir
--     (setting allow_barber_whatsapp) E somente clientes que ele atendeu; cliente nenhuma.
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON whatsapp_conversations;
CREATE POLICY row_scope_by_role ON whatsapp_conversations AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager')
    OR (app_role() = 'barber'
        AND EXISTS (SELECT 1 FROM settings s
                     WHERE s.barbershop_id = whatsapp_conversations.barbershop_id
                       AND s.key = 'allow_barber_whatsapp'
                       AND COALESCE((s.value->>'value')::boolean,false) = TRUE)
        AND EXISTS (SELECT 1 FROM appointments a
                     WHERE a.customer_id = whatsapp_conversations.customer_id
                       AND a.barber_id = app_barber_id()
                       AND a.status IN ('in_progress','completed')))
  );

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON whatsapp_messages;
CREATE POLICY row_scope_by_role ON whatsapp_messages AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager')
    OR (app_role() = 'barber'
        AND EXISTS (SELECT 1 FROM settings s
                     WHERE s.barbershop_id = whatsapp_messages.barbershop_id
                       AND s.key = 'allow_barber_whatsapp'
                       AND COALESCE((s.value->>'value')::boolean,false) = TRUE)
        AND EXISTS (SELECT 1 FROM appointments a
                     WHERE a.customer_id = whatsapp_messages.customer_id
                       AND a.barber_id = app_barber_id()
                       AND a.status IN ('in_progress','completed')))
  )
  WITH CHECK (
    app_role() IN ('owner','manager')
    OR (app_role() = 'barber'
        AND EXISTS (SELECT 1 FROM settings s
                     WHERE s.barbershop_id = whatsapp_messages.barbershop_id
                       AND s.key = 'allow_barber_whatsapp'
                       AND COALESCE((s.value->>'value')::boolean,false) = TRUE)
        AND EXISTS (SELECT 1 FROM appointments a
                     WHERE a.customer_id = whatsapp_messages.customer_id
                       AND a.barber_id = app_barber_id()
                       AND a.status IN ('in_progress','completed')))
  );

-- 9.6 Consentimento: staff gerencia; cliente vê só o próprio
ALTER TABLE customer_consent_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON customer_consent_history;
CREATE POLICY row_scope_by_role ON customer_consent_history AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager','receptionist')
    OR (app_role() = 'customer' AND customer_id = app_customer_id())
  );

-- ============================================================================
--  NOTAS DE NEGÓCIO (implementadas na camada de aplicação):
--   * FILA + LIMITE: o worker envia whatsapp_messages status='pendente' respeitando
--     marketing_campaigns.rate_limit_per_min e daily_cap (anti-bloqueio do WhatsApp).
--   * OPT-OUT: vw_campaign_audience já exclui marketing_opt_out=TRUE; um inbound com
--     intent='stop' seta customers.marketing_opt_out e grava customer_consent_history.
--   * IA SÓ SUGERE: campanha nasce em ai_suggestions; vira marketing_campaigns só após
--     approved_by/approved_at do dono (source='ai').
--   * HISTÓRICO: marketing_campaigns + campaign_recipients + whatsapp_messages guardam
--     todo o histórico e status (pendente/enviada/entregue/lida/falhou).
-- ============================================================================
