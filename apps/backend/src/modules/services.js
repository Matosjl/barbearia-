import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../config/db.js';
import { authRequired, ownerOnly, validate } from '../middleware.js';
import { asyncH, notFound } from '../utils.js';

export const router = Router();
router.use(authRequired);

// Listar serviços (qualquer perfil autenticado; cliente precisa para agendar)
router.get('/', asyncH(async (req, res) => {
  const rows = await withTenant(req.auth, (c) =>
    c.query(
      `SELECT id, category_id, name, description, duration_minutes, price, is_active
         FROM services WHERE deleted_at IS NULL ORDER BY name`,
    ).then((r) => r.rows),
  );
  res.json({ data: rows });
}));

// Criar serviço (dono/gerente)
router.post(
  '/',
  ownerOnly,
  validate({
    body: z.object({
      name: z.string().min(2),
      categoryId: z.string().uuid().optional(),
      description: z.string().optional(),
      durationMinutes: z.number().int().positive(),
      price: z.number().nonnegative(),
      isActive: z.boolean().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    const row = await withTenant(req.auth, (c) =>
      c.query(
        `INSERT INTO services(barbershop_id, category_id, name, description, duration_minutes, price, is_active)
         VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7,true))
         RETURNING id, name, duration_minutes, price, is_active`,
        [req.auth.barbershopId, b.categoryId || null, b.name, b.description || null,
          b.durationMinutes, b.price, b.isActive ?? null],
      ).then((r) => r.rows[0]),
    );
    res.status(201).json(row);
  }),
);

// Atualizar serviço
router.patch(
  '/:id',
  ownerOnly,
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      name: z.string().min(2).optional(),
      description: z.string().optional(),
      durationMinutes: z.number().int().positive().optional(),
      price: z.number().nonnegative().optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    const row = await withTenant(req.auth, (c) =>
      c.query(
        `UPDATE services SET
           name = COALESCE($2,name),
           description = COALESCE($3,description),
           duration_minutes = COALESCE($4,duration_minutes),
           price = COALESCE($5,price),
           is_active = COALESCE($6,is_active)
         WHERE id=$1 AND deleted_at IS NULL
         RETURNING id, name, duration_minutes, price, is_active`,
        [req.params.id, b.name ?? null, b.description ?? null, b.durationMinutes ?? null,
          b.price ?? null, b.isActive ?? null],
      ).then((r) => r.rows[0]),
    );
    if (!row) throw notFound('Serviço não encontrado');
    res.json(row);
  }),
);

// Desativar (soft delete)
router.delete('/:id', ownerOnly, validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncH(async (req, res) => {
    const row = await withTenant(req.auth, (c) =>
      c.query('UPDATE services SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id',
        [req.params.id]).then((r) => r.rows[0]),
    );
    if (!row) throw notFound('Serviço não encontrado');
    res.json({ ok: true });
  }),
);
