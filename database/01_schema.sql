-- ============================================================================
--  BARBER SAAS — SCHEMA POSTGRESQL (production-ready, multi-tenant)
--  Versão: 1.0
--  Banco-alvo: PostgreSQL 15+
--
--  Princípios de arquitetura aplicados:
--    1. MULTI-TENANT desde o dia 1: toda tabela de negócio carrega barbershop_id.
--    2. SOFT DELETE universal (deleted_at) — nada financeiro é apagado fisicamente.
--    3. IMUTABILIDADE financeira: caixa fechado e transações são append-only,
--       corrigidos por lançamentos de estorno, nunca por UPDATE/DELETE.
--    4. ANTI-OVERBOOKING garantido por constraint do banco (EXCLUDE/gist),
--       não só por lógica de aplicação.
--    5. AUDITORIA completa (audit_logs) com valor antigo/novo via trigger.
--    6. DINHEIRO em NUMERIC(12,2) — nunca float.
--    7. TIMESTAMPTZ em tudo — agendamentos são timezone-aware.
--    8. ENUMS para estados de domínio, com CHECKs onde fizer sentido.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSÕES
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- EXCLUDE com igualdade + range (anti-overbooking)
CREATE EXTENSION IF NOT EXISTS citext;       -- e-mail case-insensitive
CREATE EXTENSION IF NOT EXISTS unaccent;     -- busca de clientes sem acento

-- ----------------------------------------------------------------------------
-- 1. FUNÇÕES E TRIGGERS GENÉRICAS
-- ----------------------------------------------------------------------------

-- 1.1 Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1.2 Bloqueia UPDATE/DELETE em registros imutáveis (financeiro/caixa fechado)
CREATE OR REPLACE FUNCTION fn_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Registro imutável: % em % não é permitido. Use lançamento de estorno/correção.',
        TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- 1.3 Auditoria genérica (preenchida no bloco final, após existir audit_logs)

-- ============================================================================
-- 2. NÚCLEO MULTI-TENANT + SAAS
-- ============================================================================

-- 2.1 Planos do SaaS (Básico / Profissional / Premium)
CREATE TABLE plans (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code             TEXT NOT NULL UNIQUE,                 -- 'basic' | 'pro' | 'premium'
    name             TEXT NOT NULL,
    max_barbers      INTEGER,                              -- NULL = ilimitado
    max_units        INTEGER NOT NULL DEFAULT 1,           -- nº de unidades/filiais
    monthly_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
    features         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- flags de módulos liberados
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2 Conta/tenant. Em modelo de franquia, um "account" agrupa várias barbershops.
CREATE TABLE accounts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name       TEXT NOT NULL,
    document         TEXT,                                 -- CNPJ/CPF
    plan_id          UUID NOT NULL REFERENCES plans(id),
    status           TEXT NOT NULL DEFAULT 'trial'
                       CHECK (status IN ('trial','active','past_due','suspended','canceled')),
    trial_ends_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);

-- 2.3 Assinatura SaaS da conta
CREATE TABLE subscriptions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(id),
    plan_id          UUID NOT NULL REFERENCES plans(id),
    status           TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','past_due','canceled','paused')),
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end   TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    gateway          TEXT,                                 -- 'stripe' | 'asaas' | 'mercadopago'
    gateway_ref      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4 Pagamentos da assinatura SaaS (controle de inadimplência)
CREATE TABLE subscription_payments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id  UUID NOT NULL REFERENCES subscriptions(id),
    amount           NUMERIC(12,2) NOT NULL,
    due_date         DATE NOT NULL,
    paid_at          TIMESTAMPTZ,
    status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','paid','failed','refunded')),
    gateway_ref      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.5 Barbearia / unidade física (RAIZ DO MULTI-TENANT operacional)
CREATE TABLE barbershops (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(id),
    name             TEXT NOT NULL,
    slug             TEXT NOT NULL UNIQUE,                 -- usado na URL pública do cliente
    logo_url         TEXT,
    welcome_message  TEXT,
    phone            TEXT,
    email            CITEXT,
    -- Endereço
    address_line     TEXT,
    address_number   TEXT,
    district         TEXT,
    city             TEXT,
    state            TEXT,
    zip_code         TEXT,
    latitude         NUMERIC(10,7),
    longitude        NUMERIC(10,7),
    -- Operação
    timezone         TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    currency         TEXT NOT NULL DEFAULT 'BRL',
    slot_interval_minutes INTEGER NOT NULL DEFAULT 30,     -- intervalo da grade de horários
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_barbershops_account ON barbershops(account_id) WHERE deleted_at IS NULL;

-- 2.6 Horário de funcionamento da barbearia (por dia da semana)
--     weekday: 0=domingo ... 6=sábado. Permite múltiplas faixas/dia (manhã+tarde).
CREATE TABLE business_hours (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id) ON DELETE CASCADE,
    weekday          SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    opens_at         TIME NOT NULL,
    closes_at        TIME NOT NULL,
    is_closed        BOOLEAN NOT NULL DEFAULT FALSE,       -- dia fechado
    CHECK (closes_at > opens_at)
);
CREATE INDEX idx_business_hours_shop ON business_hours(barbershop_id);

-- 2.7 Feriados / fechamentos pontuais
CREATE TABLE business_closures (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id) ON DELETE CASCADE,
    closed_on        DATE NOT NULL,
    reason           TEXT,
    UNIQUE (barbershop_id, closed_on)
);

-- ============================================================================
-- 3. USUÁRIOS, PAPÉIS E PERMISSÕES (RBAC multi-tenant)
-- ============================================================================

-- 3.1 Usuário global (login). Um usuário pode atuar em várias barbearias.
CREATE TABLE users (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    email            CITEXT UNIQUE,
    phone            TEXT UNIQUE,                          -- login por telefone (clientes)
    password_hash    TEXT,                                 -- bcrypt/argon2; NULL p/ login social
    avatar_url       TEXT,
    birth_date       DATE,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified_at TIMESTAMPTZ,
    phone_verified_at TIMESTAMPTZ,
    last_login_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- 3.2 Vínculo usuário <-> barbearia com papel (RBAC). Permite multi-unidade.
--     role: owner | manager | barber | receptionist | customer
CREATE TABLE memberships (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id) ON DELETE CASCADE,
    role             TEXT NOT NULL
                       CHECK (role IN ('owner','manager','barber','receptionist','customer')),
    permissions      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- overrides finos por usuário
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    UNIQUE (user_id, barbershop_id, role)
);
CREATE INDEX idx_memberships_shop ON memberships(barbershop_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_memberships_user ON memberships(user_id) WHERE deleted_at IS NULL;

-- 3.3 Sessões / refresh tokens (login seguro)
CREATE TABLE auth_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    user_agent       TEXT,
    ip_address       INET,
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

-- ============================================================================
-- 4. BARBEIROS / PROFISSIONAIS
-- ============================================================================

CREATE TABLE barbers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    user_id          UUID REFERENCES users(id),           -- NULL se barbeiro sem login
    display_name     TEXT NOT NULL,
    phone            TEXT,
    photo_url        TEXT,
    bio              TEXT,
    -- comissão padrão (fallback); regras finas em commission_rules / barber_services
    default_service_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (default_service_commission_pct BETWEEN 0 AND 100),
    default_product_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (default_product_commission_pct BETWEEN 0 AND 100),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_barbers_shop ON barbers(barbershop_id) WHERE deleted_at IS NULL;

-- 4.1 Jornada de trabalho do barbeiro (dias/horários que atende)
CREATE TABLE barber_schedules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    barber_id        UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    weekday          SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    starts_at        TIME NOT NULL,
    ends_at          TIME NOT NULL,
    CHECK (ends_at > starts_at)
);
CREATE INDEX idx_barber_schedules_barber ON barber_schedules(barber_id);

-- 4.2 Pausas / folgas / bloqueios pontuais do barbeiro (intervalo datetime)
CREATE TABLE barber_time_off (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    barber_id        UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    starts_at        TIMESTAMPTZ NOT NULL,
    ends_at          TIMESTAMPTZ NOT NULL,
    reason           TEXT,                                 -- 'almoço','folga','férias'...
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX idx_barber_time_off_barber ON barber_time_off(barber_id, starts_at);

-- ============================================================================
-- 5. SERVIÇOS E INSUMOS
-- ============================================================================

CREATE TABLE service_categories (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    name             TEXT NOT NULL,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    deleted_at       TIMESTAMPTZ
);

CREATE TABLE services (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    category_id      UUID REFERENCES service_categories(id),
    name             TEXT NOT NULL,
    description      TEXT,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    price            NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_services_shop ON services(barbershop_id) WHERE deleted_at IS NULL;

-- 5.1 Quais serviços cada barbeiro realiza (+ override de preço/comissão)
CREATE TABLE barber_services (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    barber_id        UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    service_id       UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    commission_pct   NUMERIC(5,2) CHECK (commission_pct BETWEEN 0 AND 100), -- NULL = usa default
    price_override   NUMERIC(12,2),
    UNIQUE (barber_id, service_id)
);
CREATE INDEX idx_barber_services_service ON barber_services(service_id);

-- 5.2 Insumos consumidos por serviço (baixa automática ao finalizar)
--     product_id aponta para products (gel, pomada, etc.).
CREATE TABLE service_supplies (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    service_id       UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    product_id       UUID NOT NULL,                        -- FK adicionada após products
    quantity         NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    UNIQUE (service_id, product_id)
);

-- ============================================================================
-- 6. PRODUTOS E ESTOQUE
-- ============================================================================

CREATE TABLE product_categories (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    name             TEXT NOT NULL,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    deleted_at       TIMESTAMPTZ
);

CREATE TABLE products (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    category_id      UUID REFERENCES product_categories(id),
    name             TEXT NOT NULL,
    description      TEXT,
    photo_url        TEXT,
    sku              TEXT,
    unit             TEXT NOT NULL DEFAULT 'un',           -- un, ml, g (p/ insumos fracionados)
    cost_price       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    sale_price       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
    stock_qty        NUMERIC(12,3) NOT NULL DEFAULT 0,     -- saldo atual (mantido por trigger)
    min_stock_qty    NUMERIC(12,3) NOT NULL DEFAULT 0,
    is_sellable      BOOLEAN NOT NULL DEFAULT TRUE,        -- aparece no Shop?
    is_supply        BOOLEAN NOT NULL DEFAULT FALSE,       -- é insumo de serviço?
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_products_shop ON products(barbershop_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_low_stock ON products(barbershop_id)
    WHERE deleted_at IS NULL AND stock_qty <= min_stock_qty;

-- FK pendente de service_supplies -> products
ALTER TABLE service_supplies
    ADD CONSTRAINT fk_service_supplies_product
    FOREIGN KEY (product_id) REFERENCES products(id);

-- 6.1 Movimentações de estoque (KARDEX append-only; saldo deriva daqui)
--     reason cobre: compra, venda, ajuste, perda, quebra, vencimento, devolução, consumo (insumo)
CREATE TABLE stock_movements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    product_id       UUID NOT NULL REFERENCES products(id),
    movement_type    TEXT NOT NULL CHECK (movement_type IN ('in','out')),
    reason           TEXT NOT NULL CHECK (reason IN
                       ('purchase','sale','adjustment','loss','breakage','expiry','return','service_consumption','initial')),
    quantity         NUMERIC(12,3) NOT NULL CHECK (quantity > 0), -- sempre positivo; o tipo define sinal
    unit_cost        NUMERIC(12,2),                        -- custo na entrada (p/ CMV)
    -- rastreabilidade da origem
    order_id         UUID,
    appointment_id   UUID,
    performed_by      UUID REFERENCES users(id),
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, created_at);

-- ============================================================================
-- 7. CLIENTES (CRM)
-- ============================================================================

CREATE TABLE customers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    user_id          UUID REFERENCES users(id),            -- NULL p/ cliente lançado na hora
    name             TEXT NOT NULL,
    phone            TEXT,
    email            CITEXT,
    photo_url        TEXT,
    birth_date       DATE,
    notes            TEXT,
    -- CRM / segmentação (mantidos por jobs e triggers)
    segment          TEXT NOT NULL DEFAULT 'new'
                       CHECK (segment IN ('new','frequent','vip','inactive')),
    total_spent      NUMERIC(12,2) NOT NULL DEFAULT 0,
    visits_count     INTEGER NOT NULL DEFAULT 0,
    no_show_count    INTEGER NOT NULL DEFAULT 0,
    cancel_count     INTEGER NOT NULL DEFAULT 0,
    last_visit_at    TIMESTAMPTZ,
    credits_balance  NUMERIC(12,2) NOT NULL DEFAULT 0,     -- carteira de créditos
    is_blocked       BOOLEAN NOT NULL DEFAULT FALSE,       -- bloqueio por faltas
    blocked_reason   TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    -- mesmo telefone não duplica dentro da mesma barbearia
    UNIQUE (barbershop_id, phone)
);
CREATE INDEX idx_customers_shop ON customers(barbershop_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_segment ON customers(barbershop_id, segment) WHERE deleted_at IS NULL;

-- 7.1 Favoritos do cliente (barbeiro/serviço) — diferencial do app cliente
CREATE TABLE customer_favorites (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id      UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    barber_id        UUID REFERENCES barbers(id) ON DELETE CASCADE,
    service_id       UUID REFERENCES services(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 8. AGENDAMENTOS (núcleo da agenda inteligente + anti-overbooking)
-- ============================================================================

-- status: scheduled, confirmed, in_progress, completed, canceled, no_show
-- origin: client_app (cliente marcou), walk_in (lançado na hora), staff (recepção)
CREATE TABLE appointments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    -- número sequencial legível por barbearia (preenchido por trigger)
    code             BIGINT,
    customer_id      UUID NOT NULL REFERENCES customers(id),
    barber_id        UUID NOT NULL REFERENCES barbers(id),
    starts_at        TIMESTAMPTZ NOT NULL,
    ends_at          TIMESTAMPTZ NOT NULL,
    -- range gerado para o EXCLUDE constraint (anti-overbooking)
    time_range       TSTZRANGE GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
    status           TEXT NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled','confirmed','in_progress','completed','canceled','no_show')),
    origin           TEXT NOT NULL DEFAULT 'client_app'
                       CHECK (origin IN ('client_app','walk_in','staff')),
    is_courtesy      BOOLEAN NOT NULL DEFAULT FALSE,       -- corte grátis (fidelidade) — NÃO entra no faturamento
    -- valores consolidados (somatório dos itens; mantidos por trigger)
    services_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
    final_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_method   TEXT CHECK (payment_method IN ('cash','pix','debit','credit','credits','free')),
    notes            TEXT,
    -- cancelamento / no-show
    cancel_reason    TEXT CHECK (cancel_reason IN
                       ('customer_gave_up','customer_no_show','scheduling_error','internal_problem','other')),
    canceled_by      UUID REFERENCES users(id),
    canceled_at      TIMESTAMPTZ,
    -- confirmação automática (WhatsApp)
    reminder_24h_sent_at TIMESTAMPTZ,
    reminder_2h_sent_at  TIMESTAMPTZ,
    confirmed_at     TIMESTAMPTZ,
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    created_by       UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    CHECK (ends_at > starts_at),
    UNIQUE (barbershop_id, code)
);

-- *** ANTI-OVERBOOKING garantido pelo BANCO ***
-- Um barbeiro não pode ter dois agendamentos ativos com horários que se sobreponham.
-- Cancelados e no_show liberam o horário (WHERE).
ALTER TABLE appointments
    ADD CONSTRAINT excl_no_overlap_per_barber
    EXCLUDE USING gist (
        barber_id WITH =,
        time_range WITH &&
    ) WHERE (status IN ('scheduled','confirmed','in_progress','completed') AND deleted_at IS NULL);

CREATE INDEX idx_appointments_shop_start ON appointments(barbershop_id, starts_at);
CREATE INDEX idx_appointments_barber_start ON appointments(barber_id, starts_at);
CREATE INDEX idx_appointments_customer ON appointments(customer_id);
CREATE INDEX idx_appointments_status ON appointments(barbershop_id, status);

-- 8.1 Itens do agendamento (combo = vários serviços). Congela preço/comissão no ato.
CREATE TABLE appointment_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    appointment_id   UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    service_id       UUID NOT NULL REFERENCES services(id),
    service_name     TEXT NOT NULL,                        -- snapshot
    duration_minutes INTEGER NOT NULL,
    unit_price       NUMERIC(12,2) NOT NULL,
    commission_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
    commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_appointment_items_appt ON appointment_items(appointment_id);

-- 8.2 Histórico de status do agendamento (auditoria fina do ciclo de vida)
CREATE TABLE appointment_status_history (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id   UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    from_status      TEXT,
    to_status        TEXT NOT NULL,
    reason           TEXT,
    changed_by       UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_appt_status_hist_appt ON appointment_status_history(appointment_id, created_at);

-- FK pendente: stock_movements.appointment_id
ALTER TABLE stock_movements
    ADD CONSTRAINT fk_stock_movements_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments(id);

-- ============================================================================
-- 9. SHOP / PEDIDOS DE PRODUTOS
-- ============================================================================

-- status: cart, pending_payment, paid, fulfilled, canceled, refunded
CREATE TABLE orders (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    code             BIGINT,
    customer_id      UUID REFERENCES customers(id),        -- NULL = venda balcão anônima
    barber_id        UUID REFERENCES barbers(id),          -- vendedor (p/ comissão de produto)
    channel          TEXT NOT NULL DEFAULT 'shop'
                       CHECK (channel IN ('shop','counter')), -- Shop (app) ou balcão
    status           TEXT NOT NULL DEFAULT 'pending_payment'
                       CHECK (status IN ('cart','pending_payment','paid','fulfilled','canceled','refunded')),
    items_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
    final_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
    cost_total       NUMERIC(12,2) NOT NULL DEFAULT 0,     -- CMV (p/ lucro)
    payment_method   TEXT CHECK (payment_method IN ('cash','pix','debit','credit','credits')),
    paid_at          TIMESTAMPTZ,
    fulfilled_at     TIMESTAMPTZ,
    created_by       UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    UNIQUE (barbershop_id, code)
);
CREATE INDEX idx_orders_shop ON orders(barbershop_id, created_at);
CREATE INDEX idx_orders_status ON orders(barbershop_id, status);

CREATE TABLE order_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id       UUID NOT NULL REFERENCES products(id),
    product_name     TEXT NOT NULL,                        -- snapshot
    quantity         NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    unit_price       NUMERIC(12,2) NOT NULL,               -- snapshot preço venda
    unit_cost        NUMERIC(12,2) NOT NULL DEFAULT 0,     -- snapshot custo (p/ CMV)
    line_total       NUMERIC(12,2) NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- FK pendente: stock_movements.order_id
ALTER TABLE stock_movements
    ADD CONSTRAINT fk_stock_movements_order
    FOREIGN KEY (order_id) REFERENCES orders(id);

-- ============================================================================
-- 10. PAGAMENTOS
-- ============================================================================
-- Pagamento liga-se a um agendamento OU a um pedido (origem polimórfica controlada).
CREATE TABLE payments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    appointment_id   UUID REFERENCES appointments(id),
    order_id         UUID REFERENCES orders(id),
    method           TEXT NOT NULL CHECK (method IN ('cash','pix','debit','credit','credits','free')),
    amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    fee_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,     -- taxa de cartão/gateway
    net_amount       NUMERIC(12,2) GENERATED ALWAYS AS (amount - fee_amount) STORED,
    status           TEXT NOT NULL DEFAULT 'confirmed'
                       CHECK (status IN ('pending','confirmed','refunded','failed')),
    cash_register_id UUID,                                 -- vínculo com o caixa do dia
    paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- garante que o pagamento tem exatamente uma origem
    CHECK ( (appointment_id IS NOT NULL)::int + (order_id IS NOT NULL)::int = 1 )
);
CREATE INDEX idx_payments_shop ON payments(barbershop_id, paid_at);
CREATE INDEX idx_payments_appt ON payments(appointment_id);
CREATE INDEX idx_payments_order ON payments(order_id);

-- ============================================================================
-- 11. CAIXA (imutável após fechamento)
-- ============================================================================
CREATE TABLE cash_registers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    opened_by        UUID NOT NULL REFERENCES users(id),
    opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,     -- fundo de troco
    -- fechamento
    closed_by        UUID REFERENCES users(id),
    closed_at        TIMESTAMPTZ,
    status           TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','closed')),
    -- valores conferidos no fechamento (informados pelo operador)
    counted_cash     NUMERIC(12,2),
    counted_pix      NUMERIC(12,2),
    counted_debit    NUMERIC(12,2),
    counted_credit   NUMERIC(12,2),
    -- valores esperados (calculados pelo sistema no fechamento)
    expected_cash    NUMERIC(12,2),
    expected_pix     NUMERIC(12,2),
    expected_debit   NUMERIC(12,2),
    expected_credit  NUMERIC(12,2),
    difference       NUMERIC(12,2),                        -- contado - esperado (sobra/falta)
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cash_registers_shop ON cash_registers(barbershop_id, opened_at);
-- Garante no máximo 1 caixa aberto por barbearia
CREATE UNIQUE INDEX uniq_one_open_register_per_shop
    ON cash_registers(barbershop_id) WHERE status = 'open';

-- FK pendente: payments.cash_register_id
ALTER TABLE payments
    ADD CONSTRAINT fk_payments_cash_register
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id);

-- 11.1 Movimentações de caixa (sangria, suprimento, entradas/saídas avulsas)
CREATE TABLE cash_movements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
    movement_type    TEXT NOT NULL CHECK (movement_type IN ('withdrawal','supply','extra_in','extra_out','correction')),
    amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method           TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','pix','debit','credit')),
    description      TEXT,
    performed_by     UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cash_movements_register ON cash_movements(cash_register_id);

-- ============================================================================
-- 12. FINANCEIRO (DRE / fluxo de caixa) — append-only
-- ============================================================================
CREATE TABLE expense_categories (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    name             TEXT NOT NULL,                        -- aluguel, luz, água, internet...
    kind             TEXT NOT NULL DEFAULT 'variable' CHECK (kind IN ('fixed','variable')),
    deleted_at       TIMESTAMPTZ
);

-- direction: in (entrada) | out (saída)
-- category: service | product | commission | rent | utilities | supplies | card_fee | marketing | maintenance | other | refund | correction
CREATE TABLE financial_transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    direction        TEXT NOT NULL CHECK (direction IN ('in','out')),
    category         TEXT NOT NULL CHECK (category IN
                       ('service','product','commission','rent','utilities','supplies',
                        'card_fee','marketing','maintenance','salary','tax','other','refund','correction')),
    expense_category_id UUID REFERENCES expense_categories(id),
    amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    method           TEXT CHECK (method IN ('cash','pix','debit','credit','credits','transfer','other')),
    -- vínculos de origem (rastreabilidade)
    appointment_id   UUID REFERENCES appointments(id),
    order_id         UUID REFERENCES orders(id),
    payment_id       UUID REFERENCES payments(id),
    commission_id    UUID,
    cash_register_id UUID REFERENCES cash_registers(id),
    -- estorno: aponta para a transação original
    reverses_id      UUID REFERENCES financial_transactions(id),
    is_courtesy      BOOLEAN NOT NULL DEFAULT FALSE,       -- cortesia: registra mas NÃO conta como faturamento
    description      TEXT,
    occurred_on      DATE NOT NULL DEFAULT CURRENT_DATE,
    performed_by     UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fin_tx_shop_date ON financial_transactions(barbershop_id, occurred_on);
CREATE INDEX idx_fin_tx_category ON financial_transactions(barbershop_id, category, direction);

-- ============================================================================
-- 13. COMISSÕES
-- ============================================================================
-- Regras configuráveis: fixa, por serviço, por produto, por meta (bônus)
CREATE TABLE commission_rules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    barber_id        UUID REFERENCES barbers(id),          -- NULL = regra da barbearia inteira
    rule_type        TEXT NOT NULL CHECK (rule_type IN ('flat','per_service','per_product','goal_bonus')),
    service_id       UUID REFERENCES services(id),
    product_category_id UUID REFERENCES product_categories(id),
    percentage       NUMERIC(5,2) CHECK (percentage BETWEEN 0 AND 100),
    -- para goal_bonus
    goal_amount      NUMERIC(12,2),                        -- ex.: faturar > 5000 no mês
    bonus_percentage NUMERIC(5,2),                         -- +5%
    priority         INTEGER NOT NULL DEFAULT 0,           -- desempate
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_commission_rules_barber ON commission_rules(barbershop_id, barber_id);

-- Comissão efetivamente gerada (lançamento). É despesa no financeiro.
CREATE TABLE commissions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    barber_id        UUID NOT NULL REFERENCES barbers(id),
    source_type      TEXT NOT NULL CHECK (source_type IN ('service','product','bonus')),
    appointment_item_id UUID REFERENCES appointment_items(id),
    order_item_id    UUID REFERENCES order_items(id),
    base_amount      NUMERIC(12,2) NOT NULL,               -- valor bruto base
    percentage       NUMERIC(5,2) NOT NULL,
    amount           NUMERIC(12,2) NOT NULL,               -- comissão calculada
    status           TEXT NOT NULL DEFAULT 'accrued'
                       CHECK (status IN ('accrued','paid','canceled')),
    reference_month  DATE,                                 -- competência (1º dia do mês)
    paid_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_commissions_barber_month ON commissions(barber_id, reference_month);

-- FK pendente: financial_transactions.commission_id
ALTER TABLE financial_transactions
    ADD CONSTRAINT fk_fin_tx_commission
    FOREIGN KEY (commission_id) REFERENCES commissions(id);

-- ============================================================================
-- 14. FIDELIDADE
-- ============================================================================
CREATE TABLE loyalty_programs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    is_active        BOOLEAN NOT NULL DEFAULT FALSE,
    required_count   INTEGER NOT NULL DEFAULT 10 CHECK (required_count > 0), -- nº de cortes p/ ganhar
    reward_service_id UUID REFERENCES services(id),        -- serviço grátis oferecido
    only_paid_counts BOOLEAN NOT NULL DEFAULT TRUE,        -- só conta serviço pago
    reward_generates_commission BOOLEAN NOT NULL DEFAULT FALSE, -- corte grátis gera comissão?
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (barbershop_id)
);

-- Cartão do cliente (saldo atual do ciclo)
CREATE TABLE loyalty_cards (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    customer_id      UUID NOT NULL REFERENCES customers(id),
    program_id       UUID NOT NULL REFERENCES loyalty_programs(id),
    current_count    INTEGER NOT NULL DEFAULT 0,
    rewards_earned   INTEGER NOT NULL DEFAULT 0,
    rewards_redeemed INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, program_id)
);

-- Histórico de pontos (carimbo) e resgates
CREATE TABLE loyalty_movements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    loyalty_card_id  UUID NOT NULL REFERENCES loyalty_cards(id),
    movement_type    TEXT NOT NULL CHECK (movement_type IN ('earn','redeem','adjust','expire')),
    appointment_id   UUID REFERENCES appointments(id),
    points           INTEGER NOT NULL,                     -- +1 ganho, -required ao resgatar
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_loyalty_mov_card ON loyalty_movements(loyalty_card_id, created_at);

-- ============================================================================
-- 15. METAS
-- ============================================================================
CREATE TABLE goals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    scope            TEXT NOT NULL CHECK (scope IN ('shop','barber','store')), -- store = loja/shop
    barber_id        UUID REFERENCES barbers(id),
    metric           TEXT NOT NULL CHECK (metric IN ('revenue','services_count','products_count','profit')),
    target_value     NUMERIC(14,2) NOT NULL CHECK (target_value > 0),
    period_start     DATE NOT NULL,
    period_end       DATE NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    CHECK (period_end >= period_start)
);
CREATE INDEX idx_goals_shop ON goals(barbershop_id, period_start, period_end);

-- ============================================================================
-- 16. AVALIAÇÕES
-- ============================================================================
CREATE TABLE reviews (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    appointment_id   UUID NOT NULL REFERENCES appointments(id),
    customer_id      UUID NOT NULL REFERENCES customers(id),
    barber_id        UUID NOT NULL REFERENCES barbers(id),
    rating_overall   SMALLINT NOT NULL CHECK (rating_overall BETWEEN 1 AND 5),
    rating_service   SMALLINT CHECK (rating_service BETWEEN 1 AND 5),
    rating_ambience  SMALLINT CHECK (rating_ambience BETWEEN 1 AND 5),
    rating_punctuality SMALLINT CHECK (rating_punctuality BETWEEN 1 AND 5),
    rating_result    SMALLINT CHECK (rating_result BETWEEN 1 AND 5),
    comment          TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (appointment_id)                                -- 1 avaliação por atendimento
);
CREATE INDEX idx_reviews_barber ON reviews(barber_id);

-- ============================================================================
-- 17. MARKETING
-- ============================================================================
CREATE TABLE marketing_campaigns (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    name             TEXT NOT NULL,
    target_segment   TEXT NOT NULL CHECK (target_segment IN ('inactive','birthday','vip','frequent','all','custom')),
    channel          TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','push','email','sms')),
    message_template TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','canceled')),
    scheduled_at     TIMESTAMPTZ,
    sent_at          TIMESTAMPTZ,
    created_by       UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);

CREATE TABLE campaign_recipients (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id      UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    customer_id      UUID NOT NULL REFERENCES customers(id),
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','read')),
    sent_at          TIMESTAMPTZ
);
CREATE INDEX idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);

-- ============================================================================
-- 18. NOTIFICAÇÕES (in-app / push)
-- ============================================================================
CREATE TABLE notifications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    user_id          UUID REFERENCES users(id),            -- destinatário (barbeiro/dono)
    customer_id      UUID REFERENCES customers(id),        -- destinatário cliente
    type             TEXT NOT NULL,                        -- 'new_appointment','appt_canceled','low_stock','payment_confirmed'...
    title            TEXT NOT NULL,
    body             TEXT,
    payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
    channel          TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','push','whatsapp','email')),
    read_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX idx_notifications_customer ON notifications(customer_id, read_at);

-- 18.1 Tokens de push (PWA / Web Push)
CREATE TABLE push_subscriptions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
    endpoint         TEXT NOT NULL,
    p256dh           TEXT NOT NULL,
    auth             TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (endpoint)
);

-- ============================================================================
-- 19. CONFIGURAÇÕES (chave-valor por barbearia) + formas de pagamento
-- ============================================================================
CREATE TABLE settings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    key              TEXT NOT NULL,                        -- ex.: 'no_show_block_threshold','require_prepay_after_no_show'
    value            JSONB NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (barbershop_id, key)
);

CREATE TABLE payment_methods (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id    UUID NOT NULL REFERENCES barbershops(id),
    method           TEXT NOT NULL CHECK (method IN ('cash','pix','debit','credit','credits')),
    is_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    fee_percentage   NUMERIC(5,2) NOT NULL DEFAULT 0,      -- taxa do cartão p/ cálculo de líquido
    UNIQUE (barbershop_id, method)
);

-- ============================================================================
-- 20. AUDITORIA (valor antigo/novo, soft delete) — para TODAS as tabelas
-- ============================================================================
CREATE TABLE audit_logs (
    id               BIGserial PRIMARY KEY,
    barbershop_id    UUID,
    table_name       TEXT NOT NULL,
    record_id        TEXT NOT NULL,
    action           TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
    old_data         JSONB,
    new_data         JSONB,
    changed_fields   TEXT[],
    performed_by     UUID,                                 -- app seta via SET LOCAL app.current_user_id
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_shop ON audit_logs(barbershop_id, created_at);

-- Função de auditoria genérica (lê o usuário atual de uma GUC setada pela aplicação)
CREATE OR REPLACE FUNCTION fn_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_user UUID;
    v_shop UUID;
    v_changed TEXT[];
BEGIN
    BEGIN
        v_user := nullif(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_user := NULL;
    END;

    IF (TG_OP = 'INSERT') THEN
        BEGIN v_shop := (to_jsonb(NEW)->>'barbershop_id')::uuid; EXCEPTION WHEN OTHERS THEN v_shop := NULL; END;
        INSERT INTO audit_logs(barbershop_id, table_name, record_id, action, new_data, performed_by)
        VALUES (v_shop, TG_TABLE_NAME, (to_jsonb(NEW)->>'id'), 'INSERT', to_jsonb(NEW), v_user);
        RETURN NEW;
    ELSIF (TG_OP = 'UPDATE') THEN
        BEGIN v_shop := (to_jsonb(NEW)->>'barbershop_id')::uuid; EXCEPTION WHEN OTHERS THEN v_shop := NULL; END;
        SELECT array_agg(key) INTO v_changed
        FROM jsonb_each(to_jsonb(NEW))
        WHERE to_jsonb(NEW)->key IS DISTINCT FROM to_jsonb(OLD)->key;
        INSERT INTO audit_logs(barbershop_id, table_name, record_id, action, old_data, new_data, changed_fields, performed_by)
        VALUES (v_shop, TG_TABLE_NAME, (to_jsonb(NEW)->>'id'), 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), v_changed, v_user);
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        BEGIN v_shop := (to_jsonb(OLD)->>'barbershop_id')::uuid; EXCEPTION WHEN OTHERS THEN v_shop := NULL; END;
        INSERT INTO audit_logs(barbershop_id, table_name, record_id, action, old_data, performed_by)
        VALUES (v_shop, TG_TABLE_NAME, (to_jsonb(OLD)->>'id'), 'DELETE', to_jsonb(OLD), v_user);
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
