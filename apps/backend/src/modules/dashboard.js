import { Router } from 'express';
import { withTenant } from '../config/db.js';
import { authRequired, rbac } from '../middleware.js';
import { asyncH } from '../utils.js';

export const router = Router();
router.use(authRequired);

const TZ = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";

// --------------------------------------------------------- GET /dashboard (dono)
router.get('/', rbac('owner', 'manager'), asyncH(async (req, res) => {
  const data = await withTenant(req.auth, async (c) => {
    // faturamento e lucro de hoje e de ontem (comparativo)
    const pnl = await c.query(
      `SELECT day, COALESCE(SUM(gross_revenue),0) AS revenue, COALESCE(SUM(net_profit),0) AS profit
         FROM vw_daily_pnl
        WHERE barbershop_id=app_current_barbershop() AND day IN (${TZ}, ${TZ} - 1)
        GROUP BY day`,
    );
    // mapeia por data (YYYY-MM-DD)
    const map = Object.fromEntries(pnl.rows.map((r) => [String(r.day).slice(0, 10), r]));
    const dnow = (await c.query(`SELECT ${TZ} AS d, ${TZ} - 1 AS y`)).rows[0];
    const dToday = String(dnow.d).slice(0, 10);
    const dYest = String(dnow.y).slice(0, 10);
    const revenueToday = Number(map[dToday]?.revenue || 0);
    const profitToday = Number(map[dToday]?.profit || 0);
    const revenueYesterday = Number(map[dYest]?.revenue || 0);

    const counts = await c.query(
      `SELECT
         (SELECT COUNT(*) FROM appointments WHERE barbershop_id=app_current_barbershop()
            AND status='completed' AND (completed_at AT TIME ZONE 'America/Sao_Paulo')::date = ${TZ}) AS done_today,
         (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE barbershop_id=app_current_barbershop()
            AND created_at::date = ${TZ}) AS commissions_today,
         (SELECT COUNT(*) FROM customers WHERE barbershop_id=app_current_barbershop()
            AND created_at::date = ${TZ}) AS new_customers`,
    );

    const upcoming = await c.query(
      `SELECT a.id, a.starts_at, a.status, b.display_name AS barber, cu.name AS customer,
              (SELECT string_agg(ai.service_name, ', ') FROM appointment_items ai WHERE ai.appointment_id=a.id) AS services
         FROM appointments a JOIN barbers b ON b.id=a.barber_id JOIN customers cu ON cu.id=a.customer_id
        WHERE a.barbershop_id=app_current_barbershop() AND a.status IN ('scheduled','confirmed','in_progress')
          AND a.starts_at >= now() ORDER BY a.starts_at LIMIT 5`,
    );

    const topServices = await c.query(
      `SELECT ai.service_name, COUNT(*) AS qty
         FROM appointment_items ai JOIN appointments a ON a.id=ai.appointment_id
        WHERE a.barbershop_id=app_current_barbershop() AND a.status='completed'
          AND (a.completed_at AT TIME ZONE 'America/Sao_Paulo')::date = ${TZ}
        GROUP BY ai.service_name ORDER BY qty DESC LIMIT 5`,
    );

    const timeline = await c.query(
      `SELECT id, event_type, summary, created_at FROM timeline_events
        WHERE barbershop_id=app_current_barbershop() ORDER BY created_at DESC LIMIT 10`,
    );

    const cmp = revenueYesterday > 0
      ? Math.round(((revenueToday - revenueYesterday) / revenueYesterday) * 1000) / 10
      : null;

    return {
      revenueToday, profitToday, revenueYesterday,
      comparativoOntemPct: cmp,
      servicesToday: Number(counts.rows[0].done_today),
      commissionsToday: Number(counts.rows[0].commissions_today),
      newCustomersToday: Number(counts.rows[0].new_customers),
      upcoming: upcoming.rows,
      topServices: topServices.rows,
      timeline: timeline.rows,
    };
  });
  res.json(data);
}));

// ------------------------------------------------ GET /dashboard/barber (barbeiro)
router.get('/barber', rbac('barber'), asyncH(async (req, res) => {
  const data = await withTenant(req.auth, async (c) => {
    // RLS já restringe tudo ao próprio barbeiro
    const today = await c.query(
      `SELECT
         (SELECT COUNT(*) FROM appointments WHERE status='completed'
            AND (completed_at AT TIME ZONE 'America/Sao_Paulo')::date=${TZ}) AS services_today,
         (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE created_at::date=${TZ}) AS commission_today,
         (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE reference_month=date_trunc('month',now())::date) AS commission_month`,
    );
    const receivable = await c.query('SELECT COALESCE(SUM(total_to_receive),0) AS to_receive FROM vw_barber_receivables');
    const upcoming = await c.query(
      `SELECT a.id, a.starts_at, a.status, cu.name AS customer,
              (SELECT string_agg(ai.service_name, ', ') FROM appointment_items ai WHERE ai.appointment_id=a.id) AS services
         FROM appointments a JOIN customers cu ON cu.id=a.customer_id
        WHERE a.status IN ('scheduled','confirmed','in_progress') AND a.starts_at >= now()
        ORDER BY a.starts_at LIMIT 10`,
    );
    const history = await c.query(
      `SELECT a.id, a.completed_at, a.final_total, cu.name AS customer
         FROM appointments a JOIN customers cu ON cu.id=a.customer_id
        WHERE a.status='completed' ORDER BY a.completed_at DESC LIMIT 20`,
    );
    return {
      servicesToday: Number(today.rows[0].services_today),
      commissionToday: Number(today.rows[0].commission_today),
      commissionMonth: Number(today.rows[0].commission_month),
      toReceive: Number(receivable.rows[0].to_receive),
      upcoming: upcoming.rows,
      history: history.rows,
    };
  });
  res.json(data);
}));
