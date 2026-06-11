-- ============================================================================
--  BARBER SAAS — MIGRAÇÃO 05: melhorias aprovadas
--    (1) Idempotência em orders/payments/appointments
--    (2) Reserva temporária de horário (slot hold) anti-corrida
--    (3) Row-Level Security multi-tenant
--  Depende de: 01_schema.sql, 02_triggers.sql
--  Executar ANTES de 03_views.sql e 04_seed.sql, OU em qualquer ordem após 02
--  (não depende de views/seed). Recomendado: 01 → 02 → 05 → 03 → 04.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) IDEMPOTÊNCIA
--     Retries de rede (mobile) não podem gerar pedido/pagamento/agendamento
--     duplicado. A app envia um idempotency_key (UUID/string) por operação;
--     o índice único parcial rejeita a segunda gravação com a mesma chave.
-- ----------------------------------------------------------------------------
ALTER TABLE orders        ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE payments      ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE appointments  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_idem
    ON orders (barbershop_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_idem
    ON payments (barbershop_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointments_idem
    ON appointments (barbershop_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- (2) RESERVA TEMPORÁRIA DE HORÁRIO (slot hold)
--     Estratégia: reutilizar a MESMA constraint anti-overbooking. Um "hold" é
--     um appointment em status 'pending_hold' com hold_expires_at. Por estar
--     incluído na cláusula WHERE do EXCLUDE, ele JÁ reserva o horário no banco
--     — sem criar um segundo mecanismo de overlap. Holds expirados são
--     removidos por fn_expire_slot_holds() (job a cada minuto).
-- ----------------------------------------------------------------------------

-- 2.1 Nova coluna de expiração do hold
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

-- 2.2 Permitir o novo status 'pending_hold' no CHECK de status
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
    CHECK (status IN ('pending_hold','scheduled','confirmed','in_progress','completed','canceled','no_show'));

-- 2.3 Hold exige data de expiração; estados finais não a usam
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_hold_requires_expiry;
ALTER TABLE appointments ADD CONSTRAINT chk_hold_requires_expiry
    CHECK (status <> 'pending_hold' OR hold_expires_at IS NOT NULL);

-- 2.4 Recriar a constraint anti-overbooking incluindo 'pending_hold'
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS excl_no_overlap_per_barber;
ALTER TABLE appointments
    ADD CONSTRAINT excl_no_overlap_per_barber
    EXCLUDE USING gist (
        barber_id WITH =,
        time_range WITH &&
    ) WHERE (status IN ('pending_hold','scheduled','confirmed','in_progress','completed')
             AND deleted_at IS NULL);

-- 2.5 Índice para varrer/expurgar holds vencidos
CREATE INDEX IF NOT EXISTS idx_appointments_hold_expiry
    ON appointments (hold_expires_at)
    WHERE status = 'pending_hold';

-- 2.6 Atualizar o guardião de transição de status para contemplar holds.
--     pending_hold -> scheduled/confirmed (cliente confirmou) ou canceled (desistiu).
--     Ao sair de pending_hold, a app deve limpar hold_expires_at.
CREATE OR REPLACE FUNCTION fn_appointment_status_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID;
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  v_allowed := CASE OLD.status
    WHEN 'pending_hold' THEN NEW.status IN ('scheduled','confirmed','canceled')
    WHEN 'scheduled'    THEN NEW.status IN ('confirmed','in_progress','canceled','no_show')
    WHEN 'confirmed'    THEN NEW.status IN ('in_progress','canceled','no_show')
    WHEN 'in_progress'  THEN NEW.status IN ('completed','canceled')
    WHEN 'completed'    THEN FALSE   -- terminal
    WHEN 'canceled'     THEN FALSE
    WHEN 'no_show'      THEN FALSE
    ELSE FALSE
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transição de status inválida: % -> %.', OLD.status, NEW.status;
  END IF;

  -- ao confirmar o hold como agendamento, zera a expiração
  IF OLD.status = 'pending_hold' AND NEW.status IN ('scheduled','confirmed') THEN
    NEW.hold_expires_at := NULL;
  END IF;

  IF NEW.status = 'confirmed'   THEN NEW.confirmed_at := COALESCE(NEW.confirmed_at, now()); END IF;
  IF NEW.status = 'in_progress' THEN NEW.started_at   := COALESCE(NEW.started_at, now());   END IF;
  IF NEW.status = 'completed'   THEN NEW.completed_at := COALESCE(NEW.completed_at, now());  END IF;
  IF NEW.status IN ('canceled','no_show') THEN NEW.canceled_at := COALESCE(NEW.canceled_at, now()); END IF;

  BEGIN v_user := nullif(current_setting('app.current_user_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_user := NULL; END;

  INSERT INTO appointment_status_history(appointment_id, from_status, to_status, reason, changed_by)
  VALUES (NEW.id, OLD.status, NEW.status, NEW.cancel_reason, v_user);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2.7 Não contar cancelamento de cliente quando um HOLD vira 'canceled'
--     (o hold expirando/desistindo não é falta nem cancelamento de agenda real).
CREATE OR REPLACE FUNCTION fn_customer_counters()
RETURNS TRIGGER AS $$
DECLARE
  v_threshold INTEGER;
BEGIN
  IF NEW.status = 'no_show' AND OLD.status <> 'no_show' THEN
    UPDATE customers SET no_show_count = no_show_count + 1 WHERE id = NEW.customer_id;

    SELECT (value->>'value')::int INTO v_threshold
      FROM settings
     WHERE barbershop_id = NEW.barbershop_id AND key = 'no_show_block_threshold';

    IF v_threshold IS NOT NULL THEN
      UPDATE customers
         SET is_blocked = TRUE,
             blocked_reason = format('Bloqueio automático após %s faltas', v_threshold)
       WHERE id = NEW.customer_id AND no_show_count >= v_threshold;
    END IF;

  ELSIF NEW.status = 'canceled' AND OLD.status NOT IN ('canceled','pending_hold') THEN
    -- só conta como cancelamento se NÃO veio de um hold
    UPDATE customers SET cancel_count = cancel_count + 1 WHERE id = NEW.customer_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2.8 Expurgo de holds vencidos (DELETE evita poluir contadores/histórico).
--     Agendar via job/cron do backend a cada 1 min: SELECT fn_expire_slot_holds();
CREATE OR REPLACE FUNCTION fn_expire_slot_holds()
RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH del AS (
    DELETE FROM appointments
     WHERE status = 'pending_hold'
       AND hold_expires_at IS NOT NULL
       AND hold_expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- (3) ROW-LEVEL SECURITY (isolamento multi-tenant no próprio banco)
--     A aplicação deve, no início de cada conexão/requisição, executar:
--         SET app.barbershop_id = '<uuid-da-barbearia-do-token>';
--         SET app.current_user_id = '<uuid-do-usuario>';
--     Conexões como superuser/owner das tabelas IGNORAM RLS (migrações/seed ok).
--     O backend deve conectar como o role 'barber_app' (sujeito às policies).
-- ----------------------------------------------------------------------------

-- 3.1 Role de aplicação (sem login aqui; o backend define a senha/credencial)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barber_app') THEN
    CREATE ROLE barber_app NOLOGIN;
  END IF;
END $$;

-- 3.2 Helper: barbershop atual do contexto (NULL se não setado)
CREATE OR REPLACE FUNCTION app_current_barbershop()
RETURNS UUID AS $$
  SELECT nullif(current_setting('app.barbershop_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- 3.3 Habilita RLS + policy de isolamento em toda tabela com barbershop_id.
--     Policy: a linha só é visível/gravável se barbershop_id = contexto atual.
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
    -- FORCE garante que até o owner respeite (defesa em profundidade).
    -- Mantemos sem FORCE para que migrações/seed via owner funcionem;
    -- o backend usa barber_app, que NÃO é owner, então a policy se aplica.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (barbershop_id = app_current_barbershop())
        WITH CHECK (barbershop_id = app_current_barbershop());
    $f$, t);
    -- Concede privilégios operacionais ao role da aplicação
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO barber_app;', t);
  END LOOP;
END $$;

-- 3.4 Privilégios de schema/sequências para o role da aplicação
GRANT USAGE ON SCHEMA public TO barber_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO barber_app;
-- Tabelas globais (sem tenant) com acesso de leitura controlado:
GRANT SELECT ON plans TO barber_app;

-- Default privileges para objetos futuros criados pelo owner
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO barber_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO barber_app;

-- ----------------------------------------------------------------------------
-- NOTAS DE USO (backend):
--   * Tabelas GLOBAIS (sem barbershop_id) — plans, accounts, users, audit_logs,
--     auth_sessions, subscriptions, subscription_payments, push_subscriptions —
--     NÃO recebem RLS por tenant. O acesso a elas é mediado pela aplicação via
--     memberships (um user pode pertencer a várias barbearias). Caso queira
--     isolamento por conta/franquia nessas tabelas, criar policies por account_id.
--   * Sempre rode dentro de transação:
--       BEGIN;
--       SET LOCAL app.barbershop_id = '...';
--       SET LOCAL app.current_user_id = '...';
--       -- queries...
--       COMMIT;
--     Use SET LOCAL para o contexto morrer junto com a transação (pool seguro).
-- ----------------------------------------------------------------------------
