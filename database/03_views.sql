-- ============================================================================
--  BARBER SAAS — VIEWS DE RELATÓRIO / DASHBOARD
--  Regras-chave aplicadas:
--    - Cortesia (is_courtesy) NÃO entra no faturamento.
--    - Faturamento != lucro. Produto desconta CMV. Comissão é despesa.
--    - Só conta venda/serviço com pagamento confirmado.
-- ============================================================================

-- 1. RECEITA DE SERVIÇOS (exclui cortesia; exige pagamento confirmado)
CREATE OR REPLACE VIEW vw_service_revenue AS
SELECT
    a.barbershop_id,
    a.id              AS appointment_id,
    a.barber_id,
    a.customer_id,
    a.completed_at,
    (a.completed_at AT TIME ZONE 'America/Sao_Paulo')::date AS revenue_date,
    a.final_total     AS gross_amount,
    a.payment_method
FROM appointments a
WHERE a.status = 'completed'
  AND a.is_courtesy = FALSE          -- cortesia não infla faturamento
  AND a.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM payments p
              WHERE p.appointment_id = a.id AND p.status = 'confirmed');

-- 2. RECEITA + CMV DE PRODUTOS (lucro = venda - custo)
CREATE OR REPLACE VIEW vw_product_revenue AS
SELECT
    o.barbershop_id,
    o.id              AS order_id,
    o.barber_id,
    o.customer_id,
    o.paid_at,
    (o.paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS revenue_date,
    o.final_total     AS gross_amount,
    o.cost_total      AS cogs,
    (o.final_total - o.cost_total) AS gross_profit,
    o.payment_method
FROM orders o
WHERE o.status IN ('paid','fulfilled')
  AND o.deleted_at IS NULL;

-- 3. DRE SIMPLES POR DIA (entradas, CMV, comissão, despesas, lucro líquido)
CREATE OR REPLACE VIEW vw_daily_pnl AS
WITH svc AS (
    SELECT barbershop_id, revenue_date, SUM(gross_amount) AS service_revenue
    FROM vw_service_revenue GROUP BY 1,2
),
prod AS (
    SELECT barbershop_id, revenue_date,
           SUM(gross_amount) AS product_revenue,
           SUM(cogs)         AS cogs
    FROM vw_product_revenue GROUP BY 1,2
),
expenses AS (
    SELECT barbershop_id, occurred_on AS revenue_date,
           SUM(amount) FILTER (WHERE direction='out' AND category='commission') AS commission_expense,
           SUM(amount) FILTER (WHERE direction='out' AND category NOT IN ('commission')) AS other_expense
    FROM financial_transactions
    WHERE is_courtesy = FALSE
    GROUP BY 1,2
)
SELECT
    COALESCE(s.barbershop_id, p.barbershop_id, e.barbershop_id) AS barbershop_id,
    COALESCE(s.revenue_date, p.revenue_date, e.revenue_date)    AS day,
    COALESCE(s.service_revenue,0)                               AS service_revenue,
    COALESCE(p.product_revenue,0)                               AS product_revenue,
    COALESCE(s.service_revenue,0) + COALESCE(p.product_revenue,0) AS gross_revenue,
    COALESCE(p.cogs,0)                                          AS cogs,
    COALESCE(e.commission_expense,0)                            AS commission_expense,
    COALESCE(e.other_expense,0)                                 AS other_expense,
    -- Lucro líquido = receita - CMV - comissão - demais despesas
    COALESCE(s.service_revenue,0) + COALESCE(p.product_revenue,0)
      - COALESCE(p.cogs,0) - COALESCE(e.commission_expense,0) - COALESCE(e.other_expense,0)
      AS net_profit
FROM svc s
FULL JOIN prod p ON p.barbershop_id = s.barbershop_id AND p.revenue_date = s.revenue_date
FULL JOIN expenses e ON e.barbershop_id = COALESCE(s.barbershop_id,p.barbershop_id)
                    AND e.revenue_date = COALESCE(s.revenue_date,p.revenue_date);

-- 4. RANKING DE SERVIÇOS (mais realizados / mais lucrativos)
CREATE OR REPLACE VIEW vw_service_ranking AS
SELECT
    ai.barbershop_id,
    ai.service_id,
    ai.service_name,
    COUNT(*)                          AS times_performed,
    SUM(ai.unit_price)                AS gross_revenue,
    SUM(ai.unit_price - ai.commission_amount) AS shop_net
FROM appointment_items ai
JOIN appointments a ON a.id = ai.appointment_id
WHERE a.status = 'completed' AND a.is_courtesy = FALSE
GROUP BY 1,2,3;

-- 5. RANKING DE PRODUTOS (mais vendidos / maior margem)
CREATE OR REPLACE VIEW vw_product_ranking AS
SELECT
    oi.barbershop_id,
    oi.product_id,
    oi.product_name,
    SUM(oi.quantity)                            AS qty_sold,
    SUM(oi.line_total)                          AS gross_revenue,
    SUM(oi.line_total - oi.unit_cost*oi.quantity) AS gross_profit
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status IN ('paid','fulfilled')
GROUP BY 1,2,3;

-- 6. DESEMPENHO POR BARBEIRO (faturamento, atendimentos, ticket, comissão)
CREATE OR REPLACE VIEW vw_barber_performance AS
SELECT
    a.barbershop_id,
    a.barber_id,
    b.display_name,
    COUNT(*) FILTER (WHERE a.status='completed' AND NOT a.is_courtesy) AS services_done,
    SUM(a.final_total) FILTER (WHERE a.status='completed' AND NOT a.is_courtesy) AS revenue,
    AVG(a.final_total) FILTER (WHERE a.status='completed' AND NOT a.is_courtesy) AS avg_ticket,
    COUNT(*) FILTER (WHERE a.status='no_show')  AS no_shows,
    COUNT(*) FILTER (WHERE a.status='canceled') AS cancellations
FROM appointments a
JOIN barbers b ON b.id = a.barber_id
GROUP BY 1,2,3;

-- 7. PAGAMENTOS POR MÉTODO (mix de formas de pagamento)
CREATE OR REPLACE VIEW vw_payment_mix AS
SELECT
    barbershop_id,
    method,
    (paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
    COUNT(*)        AS tx_count,
    SUM(amount)     AS gross_amount,
    SUM(net_amount) AS net_amount
FROM payments
WHERE status = 'confirmed'
GROUP BY 1,2,3;

-- 8. CLIENTES INATIVOS (sem visita há 45+ dias) — base p/ marketing
CREATE OR REPLACE VIEW vw_inactive_customers AS
SELECT
    c.barbershop_id,
    c.id AS customer_id,
    c.name,
    c.phone,
    c.last_visit_at,
    (now()::date - c.last_visit_at::date) AS days_since_last_visit
FROM customers c
WHERE c.deleted_at IS NULL
  AND (c.last_visit_at IS NULL OR c.last_visit_at < now() - INTERVAL '45 days');

-- 9. CONFERÊNCIA DE CAIXA: esperado por método em um caixa aberto
--    (usado no fechamento para calcular esperado x informado)
CREATE OR REPLACE VIEW vw_cash_register_expected AS
SELECT
    cr.id AS cash_register_id,
    cr.barbershop_id,
    cr.opening_amount,
    -- entradas por método dentro do período do caixa
    COALESCE(SUM(p.amount) FILTER (WHERE p.method='cash'),0)   AS payments_cash,
    COALESCE(SUM(p.amount) FILTER (WHERE p.method='pix'),0)    AS payments_pix,
    COALESCE(SUM(p.amount) FILTER (WHERE p.method='debit'),0)  AS payments_debit,
    COALESCE(SUM(p.amount) FILTER (WHERE p.method='credit'),0) AS payments_credit
FROM cash_registers cr
LEFT JOIN payments p
       ON p.cash_register_id = cr.id AND p.status = 'confirmed'
GROUP BY cr.id, cr.barbershop_id, cr.opening_amount;
