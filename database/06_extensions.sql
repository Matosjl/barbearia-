-- ============================================================================
--  BARBER SAAS — MIGRAÇÃO 06: RBAC barbeiro comissionado + WhatsApp/Evolution
--                              + IA/Ollama + Timeline + A Receber
--  Depende de: 01..05. Idempotente onde possível.
--  Ordem recomendada: 01 → 02 → 05 → 06 → 03 → 04.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. WHATSAPP / EVOLUTION API
-- ----------------------------------------------------------------------------

-- A.1 Instância da Evolution por barbearia (um número conectado por barbearia)
CREATE TABLE IF NOT EXISTS whatsapp_instances (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    instance_name    TEXT NOT NULL,
    api_url          TEXT NOT NULL,                       -- ex.: http://localhost:8080
    api_key_enc      TEXT NOT NULL,                       -- API key criptografada (app cuida)
    connected_number TEXT,
    status           TEXT NOT NULL DEFAULT 'disconnected'
                       CHECK (status IN ('disconnected','connecting','connected','error')),
    last_sync_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (barbershop_id, instance_name)
);

-- A.2 Templates de mensagem (versionáveis, com variáveis {{cliente}}, {{hora}}...)
--     key cobre os tipos pedidos: confirmação, lembrete, remarcação, cancelamento,
--     pós-atendimento, inativo 30/45/60/90, aniversário, fidelidade, promoção.
CREATE TABLE IF NOT EXISTS message_templates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    key              TEXT NOT NULL,                       -- 'appt_confirm','appt_reminder','appt_reschedule',
                                                          -- 'appt_cancel','post_service','inactive_30',
                                                          -- 'inactive_45','inactive_60','inactive_90',
                                                          -- 'birthday','loyalty_reward','promo'
    channel          TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms','push','email')),
    body             TEXT NOT NULL,
    variables        TEXT[] NOT NULL DEFAULT '{}',
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (barbershop_id, key, channel)
);

-- A.3 OUTBOX — fila de envio (worker consome e chama a Evolution API).
--     idempotency_key evita reenvio duplicado em retry.
CREATE TABLE IF NOT EXISTS message_outbox (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    instance_id      UUID REFERENCES whatsapp_instances(id),
    customer_id      UUID REFERENCES customers(id),
    appointment_id   UUID REFERENCES appointments(id),
    campaign_id      UUID REFERENCES marketing_campaigns(id),
    template_key     TEXT,
    to_number        TEXT NOT NULL,
    body             TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','sending','sent','delivered','read','failed','canceled')),
    provider_message_id TEXT,
    error            TEXT,
    scheduled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),  -- para agendar (lembrete 24h/2h)
    sent_at          TIMESTAMPTZ,
    idempotency_key  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbox_due
    ON message_outbox (scheduled_at) WHERE status = 'queued';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outbox_idem
    ON message_outbox (barbershop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- A.4 INBOX — mensagens/eventos recebidos via webhook (respostas + botões)
CREATE TABLE IF NOT EXISTS message_inbox (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    instance_id      UUID REFERENCES whatsapp_instances(id),
    from_number      TEXT NOT NULL,
    customer_id      UUID REFERENCES customers(id),
    appointment_id   UUID REFERENCES appointments(id),
    body             TEXT,
    intent           TEXT CHECK (intent IN ('confirm','reschedule','cancel','other')),
    provider_message_id TEXT,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbox_shop ON message_inbox(barbershop_id, received_at);

-- ----------------------------------------------------------------------------
-- B. IA / OLLAMA
-- ----------------------------------------------------------------------------

-- B.1 Fila de jobs de IA (worker chama Ollama e grava saída)
CREATE TABLE IF NOT EXISTS ai_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    job_type         TEXT NOT NULL CHECK (job_type IN
                       ('revenue_forecast','churn_scan','weak_hours','top_barber',
                        'movement_drop','campaign_suggestion','message_suggestion','frequency_analysis')),
    model            TEXT NOT NULL DEFAULT 'llama3.1',
    status           TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','running','done','failed')),
    input            JSONB NOT NULL DEFAULT '{}'::jsonb,
    output           JSONB,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_queue ON ai_jobs(status, created_at);

-- B.2 Insights/alertas gerados pela IA (consumidos pelo dashboard/WebSocket)
CREATE TABLE IF NOT EXISTS ai_insights (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    insight_type     TEXT NOT NULL CHECK (insight_type IN
                       ('revenue_forecast','weak_hours','top_barber','churn_risk',
                        'movement_drop','promo_idea','general')),
    severity         TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
    title            TEXT NOT NULL,
    body             TEXT,
    data             JSONB NOT NULL DEFAULT '{}'::jsonb,
    period_start     DATE,
    period_end       DATE,
    dismissed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_insights_shop ON ai_insights(barbershop_id, created_at)
    WHERE dismissed_at IS NULL;

-- B.3 Sugestões de mensagem/campanha/promoção (humano aprova antes de enviar)
CREATE TABLE IF NOT EXISTS ai_suggestions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    suggestion_type  TEXT NOT NULL CHECK (suggestion_type IN ('message','campaign','promo')),
    target_segment   TEXT CHECK (target_segment IN ('inactive','birthday','vip','frequent','all','custom')),
    customer_id      UUID REFERENCES customers(id),
    title            TEXT,
    content          TEXT NOT NULL,
    data             JSONB NOT NULL DEFAULT '{}'::jsonb,
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','accepted','rejected','sent')),
    reviewed_by      UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_shop ON ai_suggestions(barbershop_id, status);

-- ----------------------------------------------------------------------------
-- C. TIMELINE OPERACIONAL (feed em tempo real do que acontece na barbearia)
--    Diferente de audit_logs (técnico): timeline é business-facing.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timeline_events (
    id               BIGSERIAL PRIMARY KEY,
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    actor_user_id    UUID REFERENCES users(id),
    barber_id        UUID REFERENCES barbers(id),         -- p/ filtrar timeline do barbeiro
    event_type       TEXT NOT NULL,                       -- 'appointment_created','appointment_confirmed',
                                                          -- 'checked_in','service_completed','sale_paid',
                                                          -- 'cash_opened','cash_closed','low_stock',
                                                          -- 'no_show','canceled','commission_accrued'...
    entity_type      TEXT,                                -- 'appointment','order','cash_register','product'
    entity_id        UUID,
    summary          TEXT NOT NULL,
    payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_timeline_shop ON timeline_events(barbershop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_barber ON timeline_events(barber_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- D. A RECEBER / REPASSE DE COMISSÃO
-- ----------------------------------------------------------------------------

-- D.1 Lote de repasse (fechamento de comissões de um período por barbeiro)
CREATE TABLE IF NOT EXISTS commission_payouts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    barber_id        UUID NOT NULL REFERENCES barbers(id),
    period_start     DATE NOT NULL,
    period_end       DATE NOT NULL,
    total_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid')),
    paid_at          TIMESTAMPTZ,
    paid_by          UUID REFERENCES users(id),
    method           TEXT CHECK (method IN ('cash','pix','transfer','other')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_payouts_barber ON commission_payouts(barber_id, period_start);

-- liga uma comissão a um payout (quando paga)
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES commission_payouts(id);

-- D.2 View: quanto cada barbeiro tem A RECEBER (comissões apuradas e não pagas)
CREATE OR REPLACE VIEW vw_barber_receivables AS
SELECT
    c.barbershop_id,
    c.barber_id,
    b.display_name,
    COUNT(*)               AS items,
    SUM(c.amount)          AS total_to_receive
FROM commissions c
JOIN barbers b ON b.id = c.barber_id
WHERE c.status = 'accrued' AND c.payout_id IS NULL
GROUP BY c.barbershop_id, c.barber_id, b.display_name;

-- D.3 View: agenda/atendimentos do próprio barbeiro (já filtrável por RLS)
CREATE OR REPLACE VIEW vw_barber_appointments AS
SELECT a.barbershop_id, a.barber_id, a.id AS appointment_id, a.code, a.customer_id,
       a.starts_at, a.ends_at, a.status, a.final_total
FROM appointments a
WHERE a.deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- E. RBAC — perfil "barbeiro comissionado" com ISOLAMENTO POR LINHA (RLS restritiva)
--
--    Contexto setado pela app por requisição (SET LOCAL):
--      app.barbershop_id, app.current_user_id, app.role, app.barber_id, app.customer_id
--
--    Políticas RESTRICTIVE = combinam com AND às permissivas (tenant_isolation).
--    Estratégia:
--      - Tabelas SENSÍVEIS (lucro/financeiro/estoque/config/outros barbeiros):
--        negar para role 'barber' e 'customer'.
--      - Tabelas do próprio barbeiro (appointments, commissions): só as linhas dele.
--      - customers: barbeiro só vê quem ELE atendeu.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_role() RETURNS TEXT AS $$
  SELECT COALESCE(nullif(current_setting('app.role', true), ''), 'owner');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_barber_id() RETURNS UUID AS $$
  SELECT nullif(current_setting('app.barber_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_customer_id() RETURNS UUID AS $$
  SELECT nullif(current_setting('app.customer_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- E.1 Tabelas TOTALMENTE OCULTAS para barbeiro comissionado e cliente
--     (lucro do dono, financeiro, estoque, config, regras, metas, despesas, caixa,
--      instâncias whatsapp, jobs/insights de IA, payouts de outros).
DO $$
DECLARE t TEXT;
  sensitive TEXT[] := ARRAY[
    'financial_transactions','expense_categories','cash_registers','cash_movements',
    'products','product_categories','stock_movements','service_supplies',
    'commission_rules','goals','settings','payment_methods',
    'whatsapp_instances','message_templates','message_outbox','message_inbox',
    'ai_jobs','ai_insights','ai_suggestions','marketing_campaigns','campaign_recipients'
  ];
BEGIN
  FOREACH t IN ARRAY sensitive LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS deny_barber_customer ON %I;', t);
    EXECUTE format($p$
      CREATE POLICY deny_barber_customer ON %I AS RESTRICTIVE
        USING (app_role() NOT IN ('barber','customer'))
        WITH CHECK (app_role() NOT IN ('barber','customer'));
    $p$, t);
  END LOOP;
END $$;

-- E.2 appointments: barbeiro só enxerga os DELE; cliente só os DELE.
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON appointments;
CREATE POLICY row_scope_by_role ON appointments AS RESTRICTIVE
  USING (
    app_role() NOT IN ('barber','customer')
    OR (app_role() = 'barber'   AND barber_id   = app_barber_id())
    OR (app_role() = 'customer' AND customer_id = app_customer_id())
  )
  WITH CHECK (
    app_role() NOT IN ('barber','customer')
    OR (app_role() = 'barber'   AND barber_id   = app_barber_id())
    OR (app_role() = 'customer' AND customer_id = app_customer_id())
  );

-- E.3 appointment_items / status_history: seguem o agendamento pai do barbeiro
ALTER TABLE appointment_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON appointment_items;
CREATE POLICY row_scope_by_role ON appointment_items AS RESTRICTIVE
  USING (
    app_role() NOT IN ('barber','customer')
    OR EXISTS (SELECT 1 FROM appointments a WHERE a.id = appointment_items.appointment_id
                 AND ( (app_role()='barber'   AND a.barber_id   = app_barber_id())
                    OR (app_role()='customer' AND a.customer_id = app_customer_id()) ))
  );

-- E.4 commissions: barbeiro só as próprias; cliente nenhuma
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON commissions;
CREATE POLICY row_scope_by_role ON commissions AS RESTRICTIVE
  USING (
    app_role() = 'owner' OR app_role() = 'manager'
    OR (app_role() = 'barber' AND barber_id = app_barber_id())
  );

-- E.5 commission_payouts: barbeiro só os próprios
ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON commission_payouts;
CREATE POLICY row_scope_by_role ON commission_payouts AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager')
    OR (app_role() = 'barber' AND barber_id = app_barber_id())
  );

-- E.6 customers: barbeiro só vê quem ELE atendeu; cliente só a si mesmo
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON customers;
CREATE POLICY row_scope_by_role ON customers AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager','receptionist')
    OR (app_role() = 'customer' AND id = app_customer_id())
    -- barbeiro vê os clientes de QUALQUER agendamento dele (inclui agenda futura),
    -- não só os já atendidos — necessário para listar a própria agenda.
    OR (app_role() = 'barber' AND EXISTS (
          SELECT 1 FROM appointments a
           WHERE a.customer_id = customers.id
             AND a.barber_id = app_barber_id()))
  );

-- E.7 barbers: barbeiro vê só o próprio cadastro (não dos colegas); cliente vê ativos (p/ escolher)
ALTER TABLE barbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON barbers;
CREATE POLICY row_scope_by_role ON barbers AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager','receptionist')
    OR (app_role() = 'barber'   AND id = app_barber_id())
    OR (app_role() = 'customer' AND is_active = TRUE AND deleted_at IS NULL)
  );

-- E.8 timeline_events: barbeiro só o próprio feed
ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON timeline_events;
CREATE POLICY row_scope_by_role ON timeline_events AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager')
    OR (app_role() = 'barber' AND barber_id = app_barber_id())
  );

-- ----------------------------------------------------------------------------
-- F. Garante RLS + isolamento de TENANT nas novas tabelas com barbershop_id
--    (mesma policy permissiva tenant_isolation usada na migração 05).
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- G. updated_at nas novas tabelas que têm a coluna
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
  newtabs TEXT[] := ARRAY['whatsapp_instances','message_templates','message_outbox'];
BEGIN
  FOREACH t IN ARRAY newtabs LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I;', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();', t);
  END LOOP;
END $$;

-- ============================================================================
--  NOTA RBAC: o barbeiro comissionado, ao "lançar cliente na hora", cria um
--  appointment com origin='walk_in'. A APLICAÇÃO força barber_id = app.barber_id
--  (não confia em input), e o cálculo de comissão usa as regras do dono
--  (commission_rules / barber_services). A RLS garante que ele só vê o que é dele.
-- ============================================================================
