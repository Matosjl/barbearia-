import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../config/db.js';
import { authRequired, rbac, validate } from '../middleware.js';
import { asyncH, notFound, conflict } from '../utils.js';

export const router = Router();
router.use(authRequired);

// Caixa é operação de staff (não-financeiro estratégico). Barbeiro/cliente: 403.
const cashStaff = rbac('owner', 'manager', 'receptionist');

// ----------------------------------------------------------- POST /cash/open
router.post('/open', cashStaff,
  validate({ body: z.object({ openingAmount: z.number().nonnegative().default(0) }) }),
  asyncH(async (req, res) => {
    const row = await withTenant(req.auth, async (c) => {
      const open = await c.query("SELECT id FROM cash_registers WHERE barbershop_id=$1 AND status='open'", [req.auth.barbershopId]);
      if (open.rowCount) throw conflict('Já existe um caixa aberto');
      return c.query(
        `INSERT INTO cash_registers(barbershop_id, opened_by, opening_amount)
         VALUES ($1,$2,$3) RETURNING id, opened_at, opening_amount, status`,
        [req.auth.barbershopId, req.auth.userId, req.body.openingAmount],
      ).then((r) => r.rows[0]);
    });
    res.status(201).json(row);
  }),
);

// --------------------------------------------------------- GET /cash/current
// Caixa aberto + esperado por método (pagamentos + sangrias/suprimentos).
router.get('/current', cashStaff, asyncH(async (req, res) => {
  const data = await withTenant(req.auth, async (c) => {
    const reg = await c.query("SELECT * FROM cash_registers WHERE barbershop_id=$1 AND status='open'", [req.auth.barbershopId]);
    if (!reg.rowCount) return { open: false };
    const id = reg.rows[0].id;
    const exp = await c.query('SELECT * FROM vw_cash_register_expected WHERE cash_register_id=$1', [id]);
    const mov = await c.query('SELECT id, movement_type, amount, method, description, created_at FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at', [id]);
    return { open: true, register: reg.rows[0], expected: exp.rows[0] || null, movements: mov.rows };
  });
  res.json(data);
}));

// -------------------------------------------------- POST /cash/:id/movements
// Sangria, suprimento, entradas/saídas extras.
router.post('/:id/movements', cashStaff,
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      type: z.enum(['withdrawal', 'supply', 'extra_in', 'extra_out']),
      amount: z.number().positive(),
      method: z.enum(['cash', 'pix', 'debit', 'credit']).default('cash'),
      description: z.string().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    const row = await withTenant(req.auth, async (c) => {
      const reg = await c.query("SELECT status FROM cash_registers WHERE id=$1 AND barbershop_id=$2", [req.params.id, req.auth.barbershopId]);
      if (!reg.rowCount) throw notFound('Caixa não encontrado');
      if (reg.rows[0].status !== 'open') throw conflict('Caixa fechado: use lançamento corretivo');
      return c.query(
        `INSERT INTO cash_movements(barbershop_id, cash_register_id, movement_type, amount, method, description, performed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, movement_type, amount, method, created_at`,
        [req.auth.barbershopId, req.params.id, b.type, b.amount, b.method, b.description || null, req.auth.userId],
      ).then((r) => r.rows[0]);
    });
    res.status(201).json(row);
  }),
);

// ----------------------------------------------------------- POST /cash/:id/close
// Calcula esperado x informado -> diferença (sobra/falta). Imutável depois (trigger).
router.post('/:id/close', cashStaff,
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      countedCash: z.number().nonnegative(),
      countedPix: z.number().nonnegative(),
      countedDebit: z.number().nonnegative(),
      countedCredit: z.number().nonnegative(),
      notes: z.string().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    const row = await withTenant(req.auth, async (c) => {
      const reg = await c.query("SELECT status, opening_amount FROM cash_registers WHERE id=$1 AND barbershop_id=$2", [req.params.id, req.auth.barbershopId]);
      if (!reg.rowCount) throw notFound('Caixa não encontrado');
      if (reg.rows[0].status !== 'open') throw conflict('Caixa já fechado');

      const exp = await c.query('SELECT * FROM vw_cash_register_expected WHERE cash_register_id=$1', [req.params.id]);
      const e = exp.rows[0] || {};
      const mv = await c.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE movement_type IN ('supply','extra_in') AND method='cash'),0) AS cash_in,
           COALESCE(SUM(amount) FILTER (WHERE movement_type IN ('withdrawal','extra_out') AND method='cash'),0) AS cash_out
         FROM cash_movements WHERE cash_register_id=$1`, [req.params.id]);
      const m = mv.rows[0];

      const expCash = Number(reg.rows[0].opening_amount) + Number(e.payments_cash || 0) + Number(m.cash_in) - Number(m.cash_out);
      const expPix = Number(e.payments_pix || 0);
      const expDebit = Number(e.payments_debit || 0);
      const expCredit = Number(e.payments_credit || 0);
      const counted = b.countedCash + b.countedPix + b.countedDebit + b.countedCredit;
      const expected = expCash + expPix + expDebit + expCredit;
      const diff = Number((counted - expected).toFixed(2));

      return c.query(
        `UPDATE cash_registers SET
           status='closed', closed_by=$2, closed_at=now(),
           counted_cash=$3, counted_pix=$4, counted_debit=$5, counted_credit=$6,
           expected_cash=$7, expected_pix=$8, expected_debit=$9, expected_credit=$10,
           difference=$11, notes=$12
         WHERE id=$1
         RETURNING id, status, closed_at, difference,
                   expected_cash, expected_pix, expected_debit, expected_credit,
                   counted_cash, counted_pix, counted_debit, counted_credit`,
        [req.params.id, req.auth.userId, b.countedCash, b.countedPix, b.countedDebit, b.countedCredit,
          expCash, expPix, expDebit, expCredit, diff, b.notes || null],
      ).then((r) => r.rows[0]);
    });
    res.json({ ...row, result: row.difference > 0 ? 'sobra' : row.difference < 0 ? 'falta' : 'exato' });
  }),
);

// --------------------------------------------------------- GET /cash/history
router.get('/history', cashStaff, asyncH(async (req, res) => {
  const rows = await withTenant(req.auth, (c) =>
    c.query(
      `SELECT id, opened_at, closed_at, opening_amount, difference, status
         FROM cash_registers WHERE barbershop_id=$1 ORDER BY opened_at DESC LIMIT 60`,
      [req.auth.barbershopId],
    ).then((r) => r.rows),
  );
  res.json({ data: rows });
}));
