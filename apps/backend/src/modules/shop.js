import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../config/db.js';
import { authRequired, ownerOnly, validate } from '../middleware.js';
import { asyncH } from '../utils.js';

export const router = Router();
router.use(authRequired);

// Dados da barbearia atual (do contexto/token)
router.get('/shop', asyncH(async (req, res) => {
  const data = await withTenant(req.auth, async (c) => {
    const shop = await c.query(
      `SELECT id, name, slug, logo_url, welcome_message, phone, email,
              address_line, district, city, state, timezone, slot_interval_minutes, is_active
         FROM barbershops WHERE id=$1`,
      [req.auth.barbershopId],
    );
    const hours = await c.query(
      'SELECT weekday, opens_at, closes_at, is_closed FROM business_hours WHERE barbershop_id=$1 ORDER BY weekday',
      [req.auth.barbershopId],
    );
    const methods = await c.query(
      'SELECT method, is_enabled, fee_percentage FROM payment_methods WHERE barbershop_id=$1',
      [req.auth.barbershopId],
    );
    return { shop: shop.rows[0], businessHours: hours.rows, paymentMethods: methods.rows };
  });
  res.json(data);
}));

// Atualizar dados/config da barbearia (dono/gerente)
router.patch(
  '/shop',
  ownerOnly,
  validate({
    body: z.object({
      name: z.string().min(2).optional(),
      welcomeMessage: z.string().optional(),
      phone: z.string().optional(),
      addressLine: z.string().optional(),
      district: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      slotIntervalMinutes: z.number().int().positive().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    const row = await withTenant(req.auth, (c) =>
      c.query(
        `UPDATE barbershops SET
           name=COALESCE($2,name),
           welcome_message=COALESCE($3,welcome_message),
           phone=COALESCE($4,phone),
           address_line=COALESCE($5,address_line),
           district=COALESCE($6,district),
           city=COALESCE($7,city),
           state=COALESCE($8,state),
           slot_interval_minutes=COALESCE($9,slot_interval_minutes)
         WHERE id=$1
         RETURNING id, name, slug, slot_interval_minutes`,
        [req.auth.barbershopId, b.name ?? null, b.welcomeMessage ?? null, b.phone ?? null,
          b.addressLine ?? null, b.district ?? null, b.city ?? null, b.state ?? null,
          b.slotIntervalMinutes ?? null],
      ).then((r) => r.rows[0]),
    );
    res.json(row);
  }),
);

// Configurações chave/valor (dono/gerente)
router.get('/shop/settings', ownerOnly, asyncH(async (req, res) => {
  const rows = await withTenant(req.auth, (c) =>
    c.query('SELECT key, value FROM settings WHERE barbershop_id=$1', [req.auth.barbershopId]).then((r) => r.rows),
  );
  res.json({ data: rows });
}));

router.put(
  '/shop/settings',
  ownerOnly,
  validate({ body: z.object({ key: z.string().min(1), value: z.any() }) }),
  asyncH(async (req, res) => {
    const { key, value } = req.body;
    const row = await withTenant(req.auth, (c) =>
      c.query(
        `INSERT INTO settings(barbershop_id, key, value) VALUES ($1,$2,$3)
         ON CONFLICT (barbershop_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()
         RETURNING key, value`,
        // padroniza como {"value": <x>} — convenção lida em todo o sistema
        [req.auth.barbershopId, key, JSON.stringify({ value })],
      ).then((r) => r.rows[0]),
    );
    res.json(row);
  }),
);
