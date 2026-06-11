import { Router } from 'express';
import { z } from 'zod';
import { adminPool } from '../config/db.js';
import { adminKeyOnly, validate } from '../middleware.js';
import { asyncH, hashPassword, signAccess, signRefresh, sha256, slugify, normalizePhone, badRequest } from '../utils.js';
import { env } from '../config/env.js';

export const router = Router();

router.use(adminKeyOnly);

async function adminTx(fn) {
  const c = await adminPool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

async function uniqueSlug(client, base) {
  let slug = slugify(base) || 'barbearia';
  for (let i = 0; i < 5; i++) {
    const r = await client.query('SELECT 1 FROM barbershops WHERE slug=$1', [slug]);
    if (r.rowCount === 0) return slug;
    slug = `${slugify(base)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${slugify(base)}-${Date.now().toString(36)}`;
}

// POST /admin/register-shop — cria barbearia + dono, protegido por ADMIN_API_KEY
router.post(
  '/register-shop',
  validate({
    body: z.object({
      shopName: z.string().min(2),
      ownerName: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
      phone: z.string().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const { shopName, ownerName, email, password, phone } = req.body;

    const result = await adminTx(async (c) => {
      const dup = await c.query('SELECT 1 FROM users WHERE email=$1', [email]);
      if (dup.rowCount) throw badRequest('E-mail já cadastrado');

      const plan = await c.query("SELECT id FROM plans WHERE code='pro' LIMIT 1");
      if (!plan.rowCount) throw badRequest('Planos não inicializados');

      const acc = await c.query(
        `INSERT INTO accounts(legal_name, plan_id, status, trial_ends_at)
         VALUES ($1,$2,'trial', now() + interval '14 days') RETURNING id`,
        [shopName, plan.rows[0].id],
      );

      const slug = await uniqueSlug(c, shopName);
      const shop = await c.query(
        `INSERT INTO barbershops(account_id, name, slug, welcome_message)
         VALUES ($1,$2,$3,$4) RETURNING id, slug, name`,
        [acc.rows[0].id, shopName, slug, 'Bem-vindo! Agende seu horário em segundos.'],
      );
      const bsid = shop.rows[0].id;

      const user = await c.query(
        `INSERT INTO users(name, email, phone, password_hash)
         VALUES ($1,$2,$3,$4) RETURNING id, name, email`,
        [ownerName, email, normalizePhone(phone), await hashPassword(password)],
      );
      const userId = user.rows[0].id;

      await c.query(
        "INSERT INTO memberships(user_id, barbershop_id, role) VALUES ($1,$2,'owner')",
        [userId, bsid],
      );

      await c.query(
        `INSERT INTO payment_methods(barbershop_id, method, fee_percentage) VALUES
           ($1,'cash',0),($1,'pix',0),($1,'debit',1.5),($1,'credit',3.5)`,
        [bsid],
      );
      await c.query(
        `INSERT INTO business_hours(barbershop_id, weekday, opens_at, closes_at)
         SELECT $1, d, TIME '09:00', TIME '19:00' FROM generate_series(2,6) d`,
        [bsid],
      );
      await c.query(
        `INSERT INTO settings(barbershop_id, key, value) VALUES
           ($1,'hold_minutes','{"value":5}'),
           ($1,'no_show_block_threshold','{"value":3}'),
           ($1,'allow_barber_whatsapp','{"value":false}')`,
        [bsid],
      );

      return {
        shop: shop.rows[0],
        owner: { id: userId, name: ownerName, email },
      };
    });

    res.status(201).json(result);
  }),
);

// GET /admin/shops — lista todas as barbearias
router.get(
  '/shops',
  asyncH(async (_req, res) => {
    const r = await adminPool.query(
      `SELECT b.id, b.name, b.slug, b.created_at,
              u.name AS owner_name, u.email AS owner_email
         FROM barbershops b
         JOIN memberships m ON m.barbershop_id = b.id AND m.role = 'owner' AND m.deleted_at IS NULL
         JOIN users u ON u.id = m.user_id
        WHERE b.deleted_at IS NULL
        ORDER BY b.created_at DESC`,
    );
    res.json({ data: r.rows });
  }),
);
