import { Router } from 'express';
import { z } from 'zod';
import { adminPool, adminQuery } from '../config/db.js';
import { authRequired, validate } from '../middleware.js';
import {
  asyncH, hashPassword, verifyPassword, signAccess, signRefresh, verifyRefresh,
  sha256, slugify, normalizePhone, badRequest, unauthorized, notFound,
} from '../utils.js';
import { env } from '../config/env.js';

export const router = Router();

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

// resolve barberId/customerId do usuário naquela barbearia (p/ contexto RLS)
async function resolveScopeIds(client, userId, barbershopId, role) {
  let barberId = null;
  let customerId = null;
  if (role === 'barber') {
    const r = await client.query(
      'SELECT id FROM barbers WHERE user_id=$1 AND barbershop_id=$2 AND deleted_at IS NULL',
      [userId, barbershopId],
    );
    barberId = r.rows[0]?.id || null;
  } else if (role === 'customer') {
    const r = await client.query(
      'SELECT id FROM customers WHERE user_id=$1 AND barbershop_id=$2 AND deleted_at IS NULL',
      [userId, barbershopId],
    );
    customerId = r.rows[0]?.id || null;
  }
  return { barberId, customerId };
}

async function issueTokens(client, { userId, barbershopId, role, barberId, customerId, userAgent, ip }) {
  const payload = { sub: userId, bsid: barbershopId, role, barberId, customerId };
  const access = signAccess(payload);
  const refresh = signRefresh({ sub: userId, bsid: barbershopId });
  await client.query(
    `INSERT INTO auth_sessions(user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' seconds')::interval)`,
    [userId, sha256(refresh), userAgent || null, ip || null, String(env.jwt.refreshTtl)],
  );
  return { accessToken: access, refreshToken: refresh, tokenType: 'Bearer', expiresIn: env.jwt.accessTtl };
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

// -------------------------------------------------- POST /auth/register-shop
router.post(
  '/auth/register-shop',
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
      if (!plan.rowCount) throw badRequest('Planos não inicializados (rode o seed de planos)');

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

      // Defaults úteis (config inicial)
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

      const tokens = await issueTokens(c, {
        userId, barbershopId: bsid, role: 'owner', barberId: null, customerId: null,
        userAgent: req.headers['user-agent'], ip: req.ip,
      });
      return { shop: shop.rows[0], user: user.rows[0], tokens };
    });
    res.status(201).json(result);
  }),
);

// ------------------------------------------------------------- POST /auth/login
router.post(
  '/auth/login',
  validate({
    body: z.object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      password: z.string().min(1),
      barbershopId: z.string().uuid().optional(),
    }).refine((b) => b.email || b.phone, { message: 'Informe email ou phone' }),
  }),
  asyncH(async (req, res) => {
    const { email, phone, password, barbershopId } = req.body;
    const u = await adminQuery(
      `SELECT id, name, email, password_hash FROM users
        WHERE deleted_at IS NULL
          AND (($1::citext IS NOT NULL AND email=$1::citext) OR ($2::text IS NOT NULL AND phone=$2::text))
        LIMIT 1`,
      [email || null, normalizePhone(phone)],
    );
    if (!u.rowCount || !u.rows[0].password_hash) throw unauthorized('Credenciais inválidas');
    const ok = await verifyPassword(password, u.rows[0].password_hash);
    if (!ok) throw unauthorized('Credenciais inválidas');
    const userId = u.rows[0].id;

    const mem = await adminQuery(
      `SELECT barbershop_id, role FROM memberships
        WHERE user_id=$1 AND is_active AND deleted_at IS NULL
        ORDER BY (role='owner') DESC`,
      [userId],
    );
    if (!mem.rowCount) throw unauthorized('Usuário sem acesso a nenhuma barbearia');
    const chosen = barbershopId
      ? mem.rows.find((m) => m.barbershop_id === barbershopId)
      : mem.rows[0];
    if (!chosen) throw unauthorized('Sem acesso à barbearia informada');

    const result = await adminTx(async (c) => {
      const { barberId, customerId } = await resolveScopeIds(c, userId, chosen.barbershop_id, chosen.role);
      const tokens = await issueTokens(c, {
        userId, barbershopId: chosen.barbershop_id, role: chosen.role, barberId, customerId,
        userAgent: req.headers['user-agent'], ip: req.ip,
      });
      return {
        user: { id: userId, name: u.rows[0].name, email: u.rows[0].email },
        membership: { barbershopId: chosen.barbershop_id, role: chosen.role },
        tokens,
      };
    });
    res.json(result);
  }),
);

// --------------------------------------------------- POST /auth/register-customer
router.post(
  '/auth/register-customer',
  validate({
    body: z.object({
      shopSlug: z.string().min(1),
      name: z.string().min(2),
      phone: z.string().min(8),
      email: z.string().email().optional(),
      password: z.string().min(6),
    }),
  }),
  asyncH(async (req, res) => {
    const { shopSlug, name, phone, email, password } = req.body;
    const phoneN = normalizePhone(phone);
    const result = await adminTx(async (c) => {
      const shop = await c.query('SELECT id FROM barbershops WHERE slug=$1 AND deleted_at IS NULL', [shopSlug]);
      if (!shop.rowCount) throw notFound('Barbearia não encontrada');
      const bsid = shop.rows[0].id;

      const user = await c.query(
        `INSERT INTO users(name, phone, email, password_hash) VALUES ($1,$2,$3,$4)
         ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name
         RETURNING id, name`,
        [name, phoneN, email || null, await hashPassword(password)],
      );
      const userId = user.rows[0].id;

      // ANTI-DUPLICIDADE: cliente único por (barbershop_id, phone)
      const cust = await c.query(
        `INSERT INTO customers(barbershop_id, user_id, name, phone, email)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (barbershop_id, phone)
           DO UPDATE SET name=EXCLUDED.name, user_id=COALESCE(customers.user_id, EXCLUDED.user_id)
         RETURNING id`,
        [bsid, userId, name, phoneN, email || null],
      );
      await c.query(
        `INSERT INTO memberships(user_id, barbershop_id, role) VALUES ($1,$2,'customer')
         ON CONFLICT (user_id, barbershop_id, role) DO NOTHING`,
        [userId, bsid],
      );

      const tokens = await issueTokens(c, {
        userId, barbershopId: bsid, role: 'customer', barberId: null, customerId: cust.rows[0].id,
        userAgent: req.headers['user-agent'], ip: req.ip,
      });
      return { customer: { id: cust.rows[0].id, name }, tokens };
    });
    res.status(201).json(result);
  }),
);

// ----------------------------------------------------------- POST /auth/refresh
router.post(
  '/auth/refresh',
  validate({ body: z.object({ refreshToken: z.string().min(10) }) }),
  asyncH(async (req, res) => {
    const { refreshToken } = req.body;
    let decoded;
    try { decoded = verifyRefresh(refreshToken); } catch { throw unauthorized('Refresh inválido'); }
    const hash = sha256(refreshToken);
    const result = await adminTx(async (c) => {
      const sess = await c.query(
        `SELECT id FROM auth_sessions
          WHERE user_id=$1 AND refresh_token_hash=$2 AND revoked_at IS NULL AND expires_at > now()`,
        [decoded.sub, hash],
      );
      if (!sess.rowCount) throw unauthorized('Sessão expirada');
      await c.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1', [sess.rows[0].id]);

      const mem = await c.query(
        `SELECT role FROM memberships WHERE user_id=$1 AND barbershop_id=$2 AND is_active AND deleted_at IS NULL`,
        [decoded.sub, decoded.bsid],
      );
      if (!mem.rowCount) throw unauthorized('Acesso revogado');
      const role = mem.rows[0].role;
      const { barberId, customerId } = await resolveScopeIds(c, decoded.sub, decoded.bsid, role);
      const tokens = await issueTokens(c, {
        userId: decoded.sub, barbershopId: decoded.bsid, role, barberId, customerId,
        userAgent: req.headers['user-agent'], ip: req.ip,
      });
      return { tokens };
    });
    res.json(result);
  }),
);

// ---------------------------------------------------------------- GET /auth/me
router.get('/auth/me', authRequired, asyncH(async (req, res) => {
  const u = await adminQuery('SELECT id, name, email, phone FROM users WHERE id=$1', [req.auth.userId]);
  res.json({ auth: req.auth, profile: u.rows[0] || null });
}));
