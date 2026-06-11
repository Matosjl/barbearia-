import { Router } from 'express';
import { z } from 'zod';
import { withTenant, adminPool } from '../config/db.js';
import { authRequired, ownerOnly, validate } from '../middleware.js';
import { asyncH, notFound, conflict, hashPassword } from '../utils.js';

export const router = Router();
router.use(authRequired);

async function adminTx(fn) {
  const c = await adminPool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

// Listar barbeiros (RLS recorta: barbeiro vê só a si; cliente vê ativos)
router.get('/', asyncH(async (req, res) => {
  const rows = await withTenant(req.auth, (c) =>
    c.query(
      `SELECT id, display_name, phone, photo_url, is_active,
              default_service_commission_pct, default_product_commission_pct
         FROM barbers WHERE deleted_at IS NULL ORDER BY display_name`,
    ).then((r) => r.rows),
  );
  res.json({ data: rows });
}));

// Criar barbeiro (dono/gerente) + serviços que realiza (opcional)
router.post(
  '/',
  ownerOnly,
  validate({
    body: z.object({
      displayName: z.string().min(2),
      phone: z.string().optional(),
      // login opcional do barbeiro (cria acesso ao app do profissional)
      email: z.string().email().optional(),
      password: z.string().min(6).optional(),
      defaultServiceCommissionPct: z.number().min(0).max(100).optional(),
      defaultProductCommissionPct: z.number().min(0).max(100).optional(),
      serviceIds: z.array(z.string().uuid()).optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    const bsid = req.auth.barbershopId;

    // Com login: cria user global + membership barber via admin (users não é do tenant).
    if (b.email && b.password) {
      const row = await adminTx(async (c) => {
        const dup = await c.query('SELECT 1 FROM users WHERE email=$1', [b.email]);
        if (dup.rowCount) throw conflict('E-mail já cadastrado');
        const user = await c.query(
          'INSERT INTO users(name, email, password_hash) VALUES ($1,$2,$3) RETURNING id',
          [b.displayName, b.email, await hashPassword(b.password)],
        );
        await c.query("INSERT INTO memberships(user_id, barbershop_id, role) VALUES ($1,$2,'barber')",
          [user.rows[0].id, bsid]);
        const barber = await c.query(
          `INSERT INTO barbers(barbershop_id, user_id, display_name, phone,
                               default_service_commission_pct, default_product_commission_pct)
           VALUES ($1,$2,$3,$4, COALESCE($5,0), COALESCE($6,0))
           RETURNING id, display_name, default_service_commission_pct`,
          [bsid, user.rows[0].id, b.displayName, b.phone || null,
            b.defaultServiceCommissionPct ?? null, b.defaultProductCommissionPct ?? null],
        );
        if (b.serviceIds?.length) {
          for (const sid of b.serviceIds) {
            await c.query(
              `INSERT INTO barber_services(barbershop_id, barber_id, service_id)
               VALUES ($1,$2,$3) ON CONFLICT (barber_id, service_id) DO NOTHING`,
              [bsid, barber.rows[0].id, sid]);
          }
        }
        return { ...barber.rows[0], hasLogin: true };
      });
      return res.status(201).json(row);
    }

    // Sem login: barbeiro simples sob RLS do tenant.
    const row = await withTenant(req.auth, async (c) => {
      const ins = await c.query(
        `INSERT INTO barbers(barbershop_id, display_name, phone,
                             default_service_commission_pct, default_product_commission_pct)
         VALUES ($1,$2,$3, COALESCE($4,0), COALESCE($5,0))
         RETURNING id, display_name, default_service_commission_pct`,
        [bsid, b.displayName, b.phone || null,
          b.defaultServiceCommissionPct ?? null, b.defaultProductCommissionPct ?? null],
      );
      const barber = ins.rows[0];
      if (b.serviceIds?.length) {
        for (const sid of b.serviceIds) {
          await c.query(
            `INSERT INTO barber_services(barbershop_id, barber_id, service_id)
             VALUES ($1,$2,$3) ON CONFLICT (barber_id, service_id) DO NOTHING`,
            [bsid, barber.id, sid]);
        }
      }
      return barber;
    });
    res.status(201).json(row);
  }),
);

router.patch(
  '/:id',
  ownerOnly,
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      displayName: z.string().min(2).optional(),
      phone: z.string().optional(),
      defaultServiceCommissionPct: z.number().min(0).max(100).optional(),
      defaultProductCommissionPct: z.number().min(0).max(100).optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    const row = await withTenant(req.auth, (c) =>
      c.query(
        `UPDATE barbers SET
           display_name=COALESCE($2,display_name),
           phone=COALESCE($3,phone),
           default_service_commission_pct=COALESCE($4,default_service_commission_pct),
           default_product_commission_pct=COALESCE($5,default_product_commission_pct),
           is_active=COALESCE($6,is_active)
         WHERE id=$1 AND deleted_at IS NULL
         RETURNING id, display_name, is_active`,
        [req.params.id, b.displayName ?? null, b.phone ?? null,
          b.defaultServiceCommissionPct ?? null, b.defaultProductCommissionPct ?? null, b.isActive ?? null],
      ).then((r) => r.rows[0]),
    );
    if (!row) throw notFound('Barbeiro não encontrado');
    res.json(row);
  }),
);

router.delete('/:id', ownerOnly, validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncH(async (req, res) => {
    const row = await withTenant(req.auth, (c) =>
      c.query('UPDATE barbers SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id',
        [req.params.id]).then((r) => r.rows[0]),
    );
    if (!row) throw notFound('Barbeiro não encontrado');
    res.json({ ok: true });
  }),
);
