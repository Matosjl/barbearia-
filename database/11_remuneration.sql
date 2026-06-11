-- ============================================================================
--  11_remuneration.sql
--  Tipos de remuneração configuráveis por barbeiro.
--  Regra crítica: cada atendimento congela a regra vigente (snapshot).
-- ============================================================================

-- ── Campos de remuneração no cadastro do barbeiro ────────────────────────────
ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS remuneration_type TEXT NOT NULL DEFAULT 'comissionado'
    CHECK (remuneration_type IN ('dono', 'comissionado', 'fixo', 'misto')),
  ADD COLUMN IF NOT EXISTS fixed_salary NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS commission_on_courtesy BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS card_fee_deducted_from TEXT NOT NULL DEFAULT 'barbershop'
    CHECK (card_fee_deducted_from IN ('barber', 'barbershop')),
  ADD COLUMN IF NOT EXISTS supplies_deducted_from TEXT NOT NULL DEFAULT 'barbershop'
    CHECK (supplies_deducted_from IN ('barber', 'barbershop'));

-- ── Snapshot da regra vigente no momento do atendimento ──────────────────────
-- Garante que alterar o cadastro não muda atendimentos passados (regra #7).
ALTER TABLE appointment_items
  ADD COLUMN IF NOT EXISTS remuneration_type TEXT DEFAULT 'comissionado',
  ADD COLUMN IF NOT EXISTS card_fee_deducted_from TEXT DEFAULT 'barbershop',
  ADD COLUMN IF NOT EXISTS supplies_deducted_from TEXT DEFAULT 'barbershop';

-- ── Auto-promover donos (barbeiros vinculados a um user com role=owner) ──────
UPDATE barbers b
SET remuneration_type = 'dono',
    default_service_commission_pct = 100
FROM memberships m
WHERE b.user_id = m.user_id
  AND b.barbershop_id = m.barbershop_id
  AND m.role = 'owner'
  AND b.remuneration_type = 'comissionado';

COMMENT ON COLUMN barbers.remuneration_type IS
  'dono=100% da receita; comissionado=% do serviço; fixo=salário fixo; misto=fixo+comissão';
COMMENT ON COLUMN barbers.card_fee_deducted_from IS
  'Quem absorve a taxa do cartão: barbershop=barbearia, barber=desconta da comissão';
COMMENT ON COLUMN barbers.supplies_deducted_from IS
  'Quem absorve o custo de insumos: barbershop=barbearia, barber=desconta da comissão';
COMMENT ON COLUMN appointment_items.remuneration_type IS
  'Snapshot da regra de remuneração no momento do atendimento (imutável após conclusão)';
