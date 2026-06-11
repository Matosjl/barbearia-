import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../config/db.js';
import { authRequired, rbac, validate } from '../middleware.js';
import { asyncH, notFound, normalizePhone, badRequest } from '../utils.js';

export const router = Router();
router.use(authRequired);

// Criar/atualizar cliente — UPSERT por telefone (anti-duplicidade).
// Mesma base usada por agendamento, walk-in e Shop: nunca duplica cliente.
router.post(
  '/',
  rbac('owner', 'manager', 'receptionist'),
  validate({
    body: z.object({
      name: z.string().min(2),
      phone: z.string().min(8),
      email: z.string().email().optional(),
      birthDate: z.string().optional(), // YYYY-MM-DD
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    const phoneN = normalizePhone(b.phone);
    if (!phoneN) throw badRequest('Telefone inválido');
    const row = await withTenant(req.auth, (c) =>
      c.query(
        `INSERT INTO customers(barbershop_id, name, phone, email, birth_date)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (barbershop_id, phone)
           DO UPDATE SET name=EXCLUDED.name,
                         email=COALESCE(EXCLUDED.email, customers.email),
                         birth_date=COALESCE(EXCLUDED.birth_date, customers.birth_date)
         RETURNING id, name, phone, email, segment, visits_count, total_spent`,
        [req.auth.barbershopId, b.name, phoneN, b.email || null, b.birthDate || null],
      ).then((r) => r.rows[0]),
    );
    res.status(201).json(row);
  }),
);

// Listar clientes (staff vê todos; barbeiro vê só os que atendeu — RLS)
router.get(
  '/',
  rbac('owner', 'manager', 'receptionist', 'barber'),
  asyncH(async (req, res) => {
    const search = req.query.search ? `%${String(req.query.search)}%` : null;
    const rows = await withTenant(req.auth, (c) =>
      c.query(
        `SELECT id, name, phone, email, segment, visits_count, total_spent, last_visit_at
           FROM customers
          WHERE deleted_at IS NULL
            AND ($1::text IS NULL OR name ILIKE $1 OR phone ILIKE $1)
          ORDER BY name LIMIT 200`,
        [search],
      ).then((r) => r.rows),
    );
    res.json({ data: rows });
  }),
);

router.get(
  '/:id',
  rbac('owner', 'manager', 'receptionist', 'barber'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncH(async (req, res) => {
    const row = await withTenant(req.auth, (c) =>
      c.query(
        `SELECT id, name, phone, email, birth_date, segment, visits_count, total_spent,
                no_show_count, last_visit_at, is_blocked
           FROM customers WHERE id=$1 AND deleted_at IS NULL`,
        [req.params.id],
      ).then((r) => r.rows[0]),
    );
    if (!row) throw notFound('Cliente não encontrado');
    res.json(row);
  }),
);
