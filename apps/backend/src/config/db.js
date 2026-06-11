// ============================================================================
//  Camada de banco — DOIS pools:
//   - adminPool: role owner/admin (migrações, auth/bootstrap). BYPASS RLS.
//   - appPool:   role barber_app (todas as queries de negócio). SUJEITO a RLS.
//
//  withTenant() roda a função dentro de UMA transação no appPool, setando o
//  contexto multi-tenant via set_config (SET LOCAL). Assim a RLS isola por
//  barbershop_id e o RBAC por app.role/app.barber_id/app.customer_id.
//  RLS NUNCA é desligado: toda query de negócio passa por aqui.
// ============================================================================
import pg from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';

// dinheiro/numeric volta como string no pg por padrão; deixamos assim para
// não perder precisão (o app converte onde precisa).
export const adminPool = new pg.Pool({ connectionString: env.db.adminUrl, max: 8 });
export const appPool = new pg.Pool({ connectionString: env.db.appUrl, max: 20 });

adminPool.on('error', (e) => logger.error({ err: e }, 'adminPool error'));
appPool.on('error', (e) => logger.error({ err: e }, 'appPool error'));

// Query administrativa (sem RLS) — uso restrito: migrações, login, signup.
export function adminQuery(text, params) {
  return adminPool.query(text, params);
}

// Executa fn(client) dentro de transação com contexto de tenant + papel.
export async function withTenant(ctx, fn) {
  if (!ctx || !ctx.barbershopId) {
    throw new Error('withTenant requer barbershopId no contexto');
  }
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    // set_config(..., true) => escopo LOCAL (morre no fim da transação).
    await client.query(
      `SELECT set_config('app.barbershop_id', $1, true),
              set_config('app.current_user_id', $2, true),
              set_config('app.role', $3, true),
              set_config('app.barber_id', $4, true),
              set_config('app.customer_id', $5, true)`,
      [
        ctx.barbershopId,
        ctx.userId || '',
        ctx.role || '',
        ctx.barberId || '',
        ctx.customerId || '',
      ],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function ping() {
  const r = await adminPool.query('SELECT 1 AS ok');
  return r.rows[0].ok === 1;
}

export async function closePools() {
  await Promise.allSettled([adminPool.end(), appPool.end()]);
}
