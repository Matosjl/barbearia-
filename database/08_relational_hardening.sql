-- ============================================================================
--  BARBER SAAS — MIGRAÇÃO 08: ENDURECIMENTO RELACIONAL / COBERTURA RLS
--    Traz as tabelas-filhas sem barbershop_id para dentro do multi-tenant:
--      - appointment_status_history
--      - customer_favorites
--    Assim TODA tabela operacional carrega barbershop_id e fica sob RLS.
--  Depende de: 01..07.  Ordem: 01 → 02 → 05 → 06 → 07 → 08 → 03 → 04
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. appointment_status_history ganha barbershop_id (tenant via pai)
-- ----------------------------------------------------------------------------
ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES barbershops(id);
UPDATE appointment_status_history h
   SET barbershop_id = a.barbershop_id
  FROM appointments a
 WHERE a.id = h.appointment_id AND h.barbershop_id IS NULL;
ALTER TABLE appointment_status_history ALTER COLUMN barbershop_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appt_status_hist_shop ON appointment_status_history(barbershop_id);

-- ----------------------------------------------------------------------------
-- 2. customer_favorites ganha barbershop_id
-- ----------------------------------------------------------------------------
ALTER TABLE customer_favorites ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES barbershops(id);
UPDATE customer_favorites f
   SET barbershop_id = c.barbershop_id
  FROM customers c
 WHERE c.id = f.customer_id AND f.barbershop_id IS NULL;
ALTER TABLE customer_favorites ALTER COLUMN barbershop_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_favorites_shop ON customer_favorites(barbershop_id);

-- ----------------------------------------------------------------------------
-- 3. As funções que inserem histórico passam a gravar barbershop_id
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_appointment_status_init()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO appointment_status_history(barbershop_id, appointment_id, from_status, to_status, changed_by)
  VALUES (NEW.barbershop_id, NEW.id, NULL, NEW.status, NEW.created_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
    WHEN 'completed'    THEN FALSE
    WHEN 'canceled'     THEN FALSE
    WHEN 'no_show'      THEN FALSE
    ELSE FALSE
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transição de status inválida: % -> %.', OLD.status, NEW.status;
  END IF;

  IF OLD.status = 'pending_hold' AND NEW.status IN ('scheduled','confirmed') THEN
    NEW.hold_expires_at := NULL;
  END IF;

  IF NEW.status = 'confirmed'   THEN NEW.confirmed_at := COALESCE(NEW.confirmed_at, now()); END IF;
  IF NEW.status = 'in_progress' THEN NEW.started_at   := COALESCE(NEW.started_at, now());   END IF;
  IF NEW.status = 'completed'   THEN NEW.completed_at := COALESCE(NEW.completed_at, now());  END IF;
  IF NEW.status IN ('canceled','no_show') THEN NEW.canceled_at := COALESCE(NEW.canceled_at, now()); END IF;

  BEGIN v_user := nullif(current_setting('app.current_user_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_user := NULL; END;

  INSERT INTO appointment_status_history(barbershop_id, appointment_id, from_status, to_status, reason, changed_by)
  VALUES (NEW.barbershop_id, NEW.id, OLD.status, NEW.status, NEW.cancel_reason, v_user);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 4. RLS: tenant isolation + grant nas novas colunas (loop genérico) e escopo por papel
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

-- 4.1 Histórico de status segue o escopo do agendamento (barbeiro só os dele)
ALTER TABLE appointment_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON appointment_status_history;
CREATE POLICY row_scope_by_role ON appointment_status_history AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager','receptionist')
    OR EXISTS (SELECT 1 FROM appointments a
                WHERE a.id = appointment_status_history.appointment_id
                  AND ( (app_role()='barber'   AND a.barber_id   = app_barber_id())
                     OR (app_role()='customer' AND a.customer_id = app_customer_id()) ))
  );

-- 4.2 Favoritos: cliente só os próprios; staff gerencia
ALTER TABLE customer_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_scope_by_role ON customer_favorites;
CREATE POLICY row_scope_by_role ON customer_favorites AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager','receptionist')
    OR (app_role() = 'customer' AND customer_id = app_customer_id())
  )
  WITH CHECK (
    app_role() IN ('owner','manager','receptionist')
    OR (app_role() = 'customer' AND customer_id = app_customer_id())
  );

-- ============================================================================
--  Após esta migração, as ÚNICAS tabelas sem barbershop_id são, por desenho:
--    plans (catálogo global do SaaS), accounts (raiz da conta/franquia),
--    barbershops (a própria unidade), users (identidade global multi-shop),
--    subscriptions / subscription_payments (escopo da conta, não da unidade),
--    auth_sessions / push_subscriptions (escopo do usuário),
--    audit_logs (trilha imutável, polimórfica e cross-entidade).
--  Todas justificadas no RELATORIO-RELACIONAL.md.
-- ============================================================================
