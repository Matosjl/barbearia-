-- ============================================================================
--  BARBER SAAS — TRIGGERS, REGRAS DE NEGÓCIO E AUTOMAÇÕES
--  Depende de: 01_schema.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. updated_at automático nas tabelas com a coluna
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
       FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- B. Auditoria em tabelas sensíveis (negócio + financeiro)
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
  audited TEXT[] := ARRAY[
    'barbershops','users','memberships','barbers','services','barber_services',
    'products','stock_movements','customers','appointments','appointment_items',
    'orders','order_items','payments','cash_registers','cash_movements',
    'financial_transactions','commission_rules','commissions','loyalty_programs',
    'goals','settings','payment_methods'
  ];
BEGIN
  FOREACH t IN ARRAY audited LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON %1$I
       FOR EACH ROW EXECUTE FUNCTION fn_audit();', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- C. IMUTABILIDADE: caixa fechado e transações financeiras
--    Regra: "O caixa nunca pode ser alterado após fechado."
--           "Nunca apagar movimentações financeiras."
-- ----------------------------------------------------------------------------

-- C.1 Bloqueia alteração de cash_register já fechado
CREATE OR REPLACE FUNCTION fn_protect_closed_register()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'Caixa não pode ser excluído (histórico imutável).';
  END IF;
  IF (OLD.status = 'closed') THEN
    RAISE EXCEPTION 'Caixa % já fechado em %: alterações proibidas. Use lançamento corretivo.',
      OLD.id, OLD.closed_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_closed_register
  BEFORE UPDATE OR DELETE ON cash_registers
  FOR EACH ROW EXECUTE FUNCTION fn_protect_closed_register();

-- C.2 Transações financeiras são append-only: sem UPDATE de valor, sem DELETE.
--     Correções entram como nova transação com category='correction'/'refund'.
CREATE OR REPLACE FUNCTION fn_protect_financial_tx()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'Transação financeira não pode ser excluída. Lance um estorno (reverses_id).';
  END IF;
  -- permite apenas marcar vínculo de estorno/competência, nunca alterar valor/direção
  IF (NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.direction IS DISTINCT FROM OLD.direction
      OR NEW.category IS DISTINCT FROM OLD.category) THEN
    RAISE EXCEPTION 'Valores de transação financeira são imutáveis. Crie um estorno.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_financial_tx
  BEFORE UPDATE OR DELETE ON financial_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_protect_financial_tx();

-- C.3 Movimentações de estoque e caixa: sem DELETE (append-only)
CREATE TRIGGER trg_protect_stock_movements
  BEFORE DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

CREATE TRIGGER trg_protect_cash_movements
  BEFORE UPDATE OR DELETE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

-- ----------------------------------------------------------------------------
-- D. ESTOQUE: saldo mantido automaticamente a partir do KARDEX
--    Regra: "Cada movimentação deve gerar registro" + baixa automática.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_apply_stock_movement()
RETURNS TRIGGER AS $$
DECLARE
  v_delta NUMERIC(12,3);
  v_new_qty NUMERIC(12,3);
BEGIN
  v_delta := CASE WHEN NEW.movement_type = 'in' THEN NEW.quantity ELSE -NEW.quantity END;

  UPDATE products
     SET stock_qty = stock_qty + v_delta
   WHERE id = NEW.product_id
  RETURNING stock_qty INTO v_new_qty;

  -- Regra: não permitir estoque negativo (venda só com saldo)
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente para o produto % (saldo ficaria %).',
      NEW.product_id, v_new_qty;
  END IF;

  -- Alerta de estoque baixo via notificação (consumido pelo WebSocket layer)
  IF v_new_qty <= (SELECT min_stock_qty FROM products WHERE id = NEW.product_id) THEN
    INSERT INTO notifications(barbershop_id, type, title, body, payload, channel)
    VALUES (NEW.barbershop_id, 'low_stock', 'Estoque baixo',
            'Produto atingiu o estoque mínimo.',
            jsonb_build_object('product_id', NEW.product_id, 'stock_qty', v_new_qty), 'in_app');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apply_stock_movement
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_apply_stock_movement();

-- ----------------------------------------------------------------------------
-- E. CÓDIGO SEQUENCIAL legível por barbearia (appointments / orders)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_assign_code()
RETURNS TRIGGER AS $$
DECLARE v_next BIGINT;
BEGIN
  IF NEW.code IS NOT NULL THEN RETURN NEW; END IF;
  EXECUTE format(
    'SELECT COALESCE(MAX(code),0)+1 FROM %I WHERE barbershop_id = $1', TG_TABLE_NAME)
    INTO v_next USING NEW.barbershop_id;
  NEW.code := v_next;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_appointments_code
  BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_assign_code();

CREATE TRIGGER trg_orders_code
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_assign_code();

-- ----------------------------------------------------------------------------
-- F. HISTÓRICO DE STATUS do agendamento + validação de transições
--    Estados: scheduled -> confirmed -> in_progress -> completed
--             qualquer -> canceled | no_show
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_appointment_status_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_user UUID;
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  v_allowed := CASE OLD.status
    WHEN 'scheduled'  THEN NEW.status IN ('confirmed','in_progress','canceled','no_show')
    WHEN 'confirmed'  THEN NEW.status IN ('in_progress','canceled','no_show')
    WHEN 'in_progress'THEN NEW.status IN ('completed','canceled')
    WHEN 'completed'  THEN FALSE   -- finalizado é terminal
    WHEN 'canceled'   THEN FALSE
    WHEN 'no_show'    THEN FALSE
    ELSE FALSE
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transição de status inválida: % -> %.', OLD.status, NEW.status;
  END IF;

  -- carimba timestamps do ciclo de vida
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

CREATE TRIGGER trg_appointment_status_guard
  BEFORE UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_appointment_status_guard();

-- registra o status inicial no histórico ao criar
CREATE OR REPLACE FUNCTION fn_appointment_status_init()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO appointment_status_history(appointment_id, from_status, to_status, changed_by)
  VALUES (NEW.id, NULL, NEW.status, NEW.created_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_appointment_status_init
  AFTER INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_appointment_status_init();

-- ----------------------------------------------------------------------------
-- G. CONTADORES DE NO-SHOW / CANCELAMENTO + bloqueio automático do cliente
--    Regra: "Permitir bloqueio automático após X faltas" (config por barbearia)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_customer_counters()
RETURNS TRIGGER AS $$
DECLARE
  v_threshold INTEGER;
BEGIN
  IF NEW.status = 'no_show' AND OLD.status <> 'no_show' THEN
    UPDATE customers
       SET no_show_count = no_show_count + 1
     WHERE id = NEW.customer_id;

    SELECT (value->>'value')::int INTO v_threshold
      FROM settings
     WHERE barbershop_id = NEW.barbershop_id AND key = 'no_show_block_threshold';

    IF v_threshold IS NOT NULL THEN
      UPDATE customers
         SET is_blocked = TRUE,
             blocked_reason = format('Bloqueio automático após %s faltas', v_threshold)
       WHERE id = NEW.customer_id
         AND no_show_count >= v_threshold;
    END IF;

  ELSIF NEW.status = 'canceled' AND OLD.status <> 'canceled' THEN
    UPDATE customers SET cancel_count = cancel_count + 1 WHERE id = NEW.customer_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_counters
  AFTER UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_customer_counters();

-- ----------------------------------------------------------------------------
-- H. GUARD: cliente bloqueado não agenda (a menos que pré-pago — checado na app)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_block_appointment_for_blocked_customer()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM customers c WHERE c.id = NEW.customer_id AND c.is_blocked) THEN
    -- a aplicação pode liberar via SET LOCAL app.bypass_block = 'on' (pré-pagamento)
    IF current_setting('app.bypass_block', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Cliente bloqueado por excesso de faltas. Exigir pré-pagamento.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_appointment_for_blocked_customer
  BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_block_appointment_for_blocked_customer();

-- ============================================================================
--  Observação: a baixa de insumos por serviço, o cálculo de comissão, a
--  geração de financial_transactions e os carimbos de fidelidade são
--  executados na CAMADA DE APLICAÇÃO dentro de UMA transação (use cases),
--  porque dependem de regras configuráveis e de orquestração com pagamentos.
--  O banco garante as invariantes duras (overbooking, estoque<0, imutabilidade).
-- ============================================================================
