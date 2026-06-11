import { Router } from 'express';
import { withTenant } from '../config/db.js';
import { authRequired, rbac } from '../middleware.js';
import { asyncH } from '../utils.js';

export const router = Router();
router.use(authRequired);

// dono/gerente veem o financeiro completo (lucro). Barbeiro/cliente: bloqueados.
const ownerFin = rbac('owner', 'manager');
const TZ = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
const period = (req) => ({ from: req.query.from || null, to: req.query.to || null });

// Quebra de despesas por categoria (comissão, taxa, insumos, outras, estorno).
async function expenseBreakdown(c, from, to) {
  const r = await c.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE category='commission'),0) AS commission,
       COALESCE(SUM(amount) FILTER (WHERE category='card_fee'),0)   AS card_fee,
       COALESCE(SUM(amount) FILTER (WHERE category='supplies'),0)    AS supplies,
       COALESCE(SUM(amount) FILTER (WHERE category NOT IN ('commission','card_fee','supplies','refund')),0) AS other_expense,
       COALESCE(SUM(amount) FILTER (WHERE category='refund'),0)      AS refunds
     FROM financial_transactions
     WHERE barbershop_id=app_current_barbershop() AND direction='out' AND is_courtesy=false
       AND occurred_on BETWEEN COALESCE($1::date, ${TZ}) AND COALESCE($2::date, ${TZ})`,
    [from, to],
  );
  return r.rows[0];
}
async function grossRevenue(c, from, to) {
  const r = await c.query(
    `SELECT COALESCE(SUM(gross_amount),0) AS gross, COUNT(*) AS services
       FROM vw_service_revenue
      WHERE barbershop_id=app_current_barbershop()
        AND revenue_date BETWEEN COALESCE($1::date, ${TZ}) AND COALESCE($2::date, ${TZ})`,
    [from, to],
  );
  return r.rows[0];
}

// ----------------------------------------------------- GET /financial/summary
// Faturamento BRUTO separado do LUCRO REAL (- comissão - taxa - insumos - despesas).
router.get('/summary', ownerFin, asyncH(async (req, res) => {
  const { from, to } = period(req);
  const data = await withTenant(req.auth, async (c) => {
    const rev = await grossRevenue(c, from, to);
    const e = await expenseBreakdown(c, from, to);
    const gross = Number(rev.gross);
    const realProfit = Math.round((gross - Number(e.commission) - Number(e.card_fee) - Number(e.supplies) - Number(e.other_expense)) * 100) / 100;
    return {
      grossRevenue: gross,
      services: Number(rev.services),
      commission: Number(e.commission),
      cardFee: Number(e.card_fee),
      supplies: Number(e.supplies),
      otherExpense: Number(e.other_expense),
      refunds: Number(e.refunds),
      realProfit,
    };
  });
  res.json(data);
}));

// --------------------------------------------------------- GET /financial/dre
// DRE "Lucro Real" linha a linha (o que o dono realmente ganhou).
router.get('/dre', ownerFin, asyncH(async (req, res) => {
  const { from, to } = period(req);
  const data = await withTenant(req.auth, async (c) => {
    const rev = await grossRevenue(c, from, to);
    const e = await expenseBreakdown(c, from, to);
    const gross = Number(rev.gross);
    const lucroReal = Math.round((gross - Number(e.commission) - Number(e.card_fee) - Number(e.supplies) - Number(e.other_expense)) * 100) / 100;
    return {
      faturamentoBruto: gross,
      menosComissao: Number(e.commission),
      menosTaxaCartao: Number(e.card_fee),
      menosInsumos: Number(e.supplies),
      menosDespesas: Number(e.other_expense),
      lucroReal,
    };
  });
  res.json(data);
}));

// ------------------------------------------------- GET /financial/transactions
router.get('/transactions', ownerFin, asyncH(async (req, res) => {
  const { from, to } = period(req);
  const dir = req.query.direction || null;
  const cat = req.query.category || null;
  const rows = await withTenant(req.auth, (c) =>
    c.query(
      `SELECT id, direction, category, amount, method, occurred_on, description,
              appointment_id, order_id, payment_id, reverses_id, is_courtesy, created_at
         FROM financial_transactions
        WHERE barbershop_id=app_current_barbershop()
          AND occurred_on BETWEEN COALESCE($1::date, ${TZ}) AND COALESCE($2::date, ${TZ})
          AND ($3::text IS NULL OR direction=$3)
          AND ($4::text IS NULL OR category=$4)
        ORDER BY created_at DESC LIMIT 300`,
      [from, to, dir, cat],
    ).then((r) => r.rows),
  );
  res.json({ data: rows });
}));

// --------------------------------------------- GET /financial/barber-commissions
// Dono vê de todos; barbeiro vê só as próprias (RLS). Cliente: bloqueado.
router.get('/barber-commissions', rbac('owner', 'manager', 'barber'), asyncH(async (req, res) => {
  const { from, to } = period(req);
  const rows = await withTenant(req.auth, (c) =>
    c.query(
      `SELECT c.barber_id, b.display_name,
              COUNT(*) AS items,
              COALESCE(SUM(c.amount),0) AS total,
              COALESCE(SUM(c.amount) FILTER (WHERE c.status='accrued' AND c.payout_id IS NULL),0) AS to_receive
         FROM commissions c JOIN barbers b ON b.id=c.barber_id
        WHERE c.barbershop_id=app_current_barbershop()
          AND c.created_at::date BETWEEN COALESCE($1::date, ${TZ}) AND COALESCE($2::date, ${TZ})
        GROUP BY c.barber_id, b.display_name ORDER BY total DESC`,
      [from, to],
    ).then((r) => r.rows),
  );
  res.json({ data: rows });
}));

// ---------------------------------------------------- GET /financial/cashflow
router.get('/cashflow', ownerFin, asyncH(async (req, res) => {
  const { from, to } = period(req);
  const rows = await withTenant(req.auth, (c) =>
    c.query(
      `SELECT occurred_on AS day,
              COALESCE(SUM(amount) FILTER (WHERE direction='in' AND is_courtesy=false),0) AS inflow,
              COALESCE(SUM(amount) FILTER (WHERE direction='out'),0) AS outflow
         FROM financial_transactions
        WHERE barbershop_id=app_current_barbershop()
          AND occurred_on BETWEEN COALESCE($1::date, ${TZ} - 30) AND COALESCE($2::date, ${TZ})
        GROUP BY occurred_on ORDER BY occurred_on`,
      [from, to],
    ).then((r) => r.rows.map((x) => ({ ...x, balance: Number(x.inflow) - Number(x.outflow) }))),
  );
  res.json({ data: rows });
}));
