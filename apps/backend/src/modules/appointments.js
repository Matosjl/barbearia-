import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../config/db.js';
import { authRequired, rbac, validate } from '../middleware.js';
import { asyncH, notFound, badRequest, forbidden, conflict, normalizePhone } from '../utils.js';
import { emitShop, emitBarber } from '../realtime/socket.js';

export const router = Router();
router.use(authRequired);

// Contexto real (papel do token) — autorização via RLS.
const realCtx = (req) => req.auth;
// Contexto de SISTEMA: elevado para 'manager' mas SEMPRE isolado por barbershop_id.
// Usado para efeitos colaterais (financeiro/comissão/timeline) que barbeiro/cliente
// não podem escrever direto. A autorização já foi checada antes (leitura via RLS).
const sysCtx = (req) => ({ barbershopId: req.auth.barbershopId, userId: req.auth.userId, role: 'manager' });

const staffOrBarber = rbac('owner', 'manager', 'receptionist', 'barber');

// Carrega serviços + comissão configurada do barbeiro (barber_services -> default).
async function loadServices(c, barbershopId, barberId, serviceIds) {
  const r = await c.query(
    `SELECT s.id, s.name, s.duration_minutes, s.price,
            COALESCE(bs.commission_pct, b.default_service_commission_pct) AS commission_pct
       FROM services s
       JOIN barbers b ON b.id = $2 AND b.barbershop_id = $1 AND b.deleted_at IS NULL
       LEFT JOIN barber_services bs ON bs.service_id = s.id AND bs.barber_id = b.id
      WHERE s.id = ANY($3::uuid[]) AND s.barbershop_id = $1 AND s.deleted_at IS NULL`,
    [barbershopId, barberId, serviceIds],
  );
  return r.rows;
}

async function timeline(c, req, ev) {
  await c.query(
    `INSERT INTO timeline_events(barbershop_id, actor_user_id, barber_id, event_type,
                                 entity_type, entity_id, summary, customer_id, appointment_id, payload)
     VALUES ($1,$2,$3,$4,'appointment',$5,$6,$7,$5,$8)`,
    [req.auth.barbershopId, req.auth.userId, ev.barberId || null, ev.type, ev.appointmentId,
      ev.summary, ev.customerId || null, JSON.stringify(ev.payload || {})],
  );
}

// Cria os itens (snapshot) e devolve totais.
async function createItems(c, barbershopId, appointmentId, services) {
  let total = 0; let minutes = 0;
  for (const s of services) {
    total += Number(s.price); minutes += s.duration_minutes;
    await c.query(
      `INSERT INTO appointment_items(barbershop_id, appointment_id, service_id, service_name,
                                     duration_minutes, unit_price, commission_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [barbershopId, appointmentId, s.id, s.name, s.duration_minutes, s.price, s.commission_pct || 0],
    );
  }
  return { total, minutes };
}

// ----------------------------------------------------- POST /appointments/hold
// Cliente reserva um horário temporariamente (anti-corrida). Hold expira.
router.post(
  '/hold',
  validate({
    body: z.object({
      barberId: z.string().uuid(),
      serviceIds: z.array(z.string().uuid()).min(1),
      startsAt: z.string().datetime({ local: true, offset: true }),
      customerId: z.string().uuid().optional(),
      idempotencyKey: z.string().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    // cliente só agenda para si; staff precisa informar customerId
    let customerId = b.customerId || null;
    if (req.auth.role === 'customer') customerId = req.auth.customerId;
    if (!customerId) throw badRequest('customerId obrigatório');

    const out = await withTenant(sysCtx(req), async (c) => {
      // purga holds vencidos: horário expirado NÃO pode bloquear
      await c.query('SELECT fn_expire_slot_holds()');

      const services = await loadServices(c, req.auth.barbershopId, b.barberId, b.serviceIds);
      if (services.length !== b.serviceIds.length) throw badRequest('Serviço(s) inválido(s) para este barbeiro');
      const minutes = services.reduce((a, s) => a + s.duration_minutes, 0);
      const total = services.reduce((a, s) => a + Number(s.price), 0);

      // hold_minutes da config (default 5)
      const cfg = await c.query(
        "SELECT (value->>'value')::int AS v FROM settings WHERE barbershop_id=$1 AND key='hold_minutes'",
        [req.auth.barbershopId],
      );
      const holdMin = cfg.rows[0]?.v ?? 5;

      const appt = await c.query(
        `INSERT INTO appointments(barbershop_id, customer_id, barber_id, starts_at, ends_at,
                                  status, origin, services_total, final_total, hold_expires_at,
                                  created_by, idempotency_key)
         VALUES ($1,$2,$3,$4::timestamptz, $4::timestamptz + ($5||' minutes')::interval,
                 'pending_hold', $6, $7, $7, now() + ($8||' minutes')::interval, $9, $10)
         RETURNING id, code, starts_at, ends_at, hold_expires_at`,
        [req.auth.barbershopId, customerId, b.barberId, b.startsAt, String(minutes),
          req.auth.role === 'customer' ? 'client_app' : 'staff', total, String(holdMin),
          req.auth.userId, b.idempotencyKey || null],
      );
      await createItems(c, req.auth.barbershopId, appt.rows[0].id, services);
      // hold é efêmero (pode ser purgado ao expirar) -> NÃO gera timeline.
      // A timeline começa na confirmação/walk-in (agendamentos que persistem).
      return appt.rows[0];
    });

    emitShop(req.auth.barbershopId, 'appointment.hold_created', { id: out.id });
    emitBarber(b.barberId, 'appointment.hold_created', { id: out.id });
    res.status(201).json(out);
  }),
);

// ------------------------------------------------- PATCH /appointments/:id/confirm
router.patch('/:id/confirm', validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncH(async (req, res) => {
    // autorização: o ator precisa enxergar o agendamento (RLS)
    const appt = await withTenant(realCtx(req), (c) =>
      c.query('SELECT id, status, barber_id, customer_id FROM appointments WHERE id=$1', [req.params.id]).then((r) => r.rows[0]));
    if (!appt) throw notFound('Agendamento não encontrado');
    if (!['pending_hold', 'scheduled'].includes(appt.status)) throw conflict('Agendamento não pode ser confirmado neste status');

    await withTenant(sysCtx(req), async (c) => {
      await c.query("UPDATE appointments SET status='confirmed' WHERE id=$1", [req.params.id]);
      await timeline(c, req, { type: 'appointment_confirmed', barberId: appt.barber_id, appointmentId: appt.id, customerId: appt.customer_id, summary: 'Agendamento confirmado' });
    });
    emitShop(req.auth.barbershopId, 'appointment.confirmed', { id: appt.id });
    emitBarber(appt.barber_id, 'appointment.confirmed', { id: appt.id });
    res.json({ id: appt.id, status: 'confirmed' });
  }),
);

// ------------------------------------------------- PATCH /appointments/:id/cancel
router.patch('/:id/cancel',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      reason: z.enum(['customer_gave_up', 'customer_no_show', 'scheduling_error', 'internal_problem', 'other']),
    }),
  }),
  asyncH(async (req, res) => {
    const appt = await withTenant(realCtx(req), (c) =>
      c.query('SELECT id, status, barber_id, customer_id FROM appointments WHERE id=$1', [req.params.id]).then((r) => r.rows[0]));
    if (!appt) throw notFound('Agendamento não encontrado');
    if (['completed', 'canceled', 'no_show'].includes(appt.status)) throw conflict('Agendamento já encerrado');

    await withTenant(sysCtx(req), async (c) => {
      await c.query(
        "UPDATE appointments SET status='canceled', cancel_reason=$2, canceled_by=$3 WHERE id=$1",
        [req.params.id, req.body.reason, req.auth.userId],
      );
      await timeline(c, req, { type: 'appointment_canceled', barberId: appt.barber_id, appointmentId: appt.id, customerId: appt.customer_id, summary: `Cancelado: ${req.body.reason}`, payload: { reason: req.body.reason } });
    });
    emitShop(req.auth.barbershopId, 'appointment.canceled', { id: appt.id, reason: req.body.reason });
    emitBarber(appt.barber_id, 'appointment.canceled', { id: appt.id });
    res.json({ id: appt.id, status: 'canceled', reason: req.body.reason });
  }),
);

// ----------------------------------------------- PATCH /appointments/:id/reschedule
router.patch('/:id/reschedule',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ startsAt: z.string().datetime({ local: true, offset: true }), barberId: z.string().uuid().optional() }),
  }),
  asyncH(async (req, res) => {
    const appt = await withTenant(realCtx(req), (c) =>
      c.query('SELECT id, status, barber_id, customer_id, starts_at, ends_at FROM appointments WHERE id=$1', [req.params.id]).then((r) => r.rows[0]));
    if (!appt) throw notFound('Agendamento não encontrado');
    if (!['pending_hold', 'scheduled', 'confirmed'].includes(appt.status)) throw conflict('Não é possível remarcar neste status');

    const newBarber = req.body.barberId || appt.barber_id;
    const out = await withTenant(sysCtx(req), async (c) => {
      // duração atual a partir dos itens
      const dur = await c.query('SELECT COALESCE(SUM(duration_minutes),0) AS m FROM appointment_items WHERE appointment_id=$1', [appt.id]);
      const minutes = dur.rows[0].m;
      const upd = await c.query(
        `UPDATE appointments
            SET starts_at=$2::timestamptz,
                ends_at=$2::timestamptz + ($3||' minutes')::interval,
                barber_id=$4
          WHERE id=$1
          RETURNING starts_at, ends_at`,
        [appt.id, req.body.startsAt, String(minutes), newBarber],
      );
      // mantém histórico da remarcação na timeline
      await timeline(c, req, {
        type: 'appointment_rescheduled', barberId: newBarber, appointmentId: appt.id, customerId: appt.customer_id,
        summary: 'Remarcado', payload: { from: appt.starts_at, to: upd.rows[0].starts_at, fromBarber: appt.barber_id, toBarber: newBarber },
      });
      return upd.rows[0];
    });
    emitShop(req.auth.barbershopId, 'appointment.rescheduled', { id: appt.id });
    res.json({ id: appt.id, ...out });
  }),
);

// ------------------------------------------------- POST /appointments/walk-in
// Lançar cliente na hora. Barbeiro comissionado: atribui automaticamente a si.
router.post('/walk-in',
  staffOrBarber,
  validate({
    body: z.object({
      customerName: z.string().min(2),
      phone: z.string().min(8),
      serviceIds: z.array(z.string().uuid()).min(1),
      barberId: z.string().uuid().optional(),
      notes: z.string().optional(),
      idempotencyKey: z.string().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    const b = req.body;
    // Regra: se quem lança é barbeiro, o atendimento é DELE (ignora barberId do corpo).
    const barberId = req.auth.role === 'barber' ? req.auth.barberId : b.barberId;
    if (!barberId) throw badRequest('barberId obrigatório');
    const phoneN = normalizePhone(b.phone);

    const out = await withTenant(sysCtx(req), async (c) => {
      await c.query('SELECT fn_expire_slot_holds()');
      // cliente único por telefone (anti-duplicidade) — reaproveita cadastro
      const cust = await c.query(
        `INSERT INTO customers(barbershop_id, name, phone) VALUES ($1,$2,$3)
         ON CONFLICT (barbershop_id, phone) DO UPDATE SET name=EXCLUDED.name
         RETURNING id`,
        [req.auth.barbershopId, b.customerName, phoneN],
      );
      const customerId = cust.rows[0].id;
      const services = await loadServices(c, req.auth.barbershopId, barberId, b.serviceIds);
      if (services.length !== b.serviceIds.length) throw badRequest('Serviço(s) inválido(s) para este barbeiro');
      const minutes = services.reduce((a, s) => a + s.duration_minutes, 0);
      const total = services.reduce((a, s) => a + Number(s.price), 0);

      const appt = await c.query(
        `INSERT INTO appointments(barbershop_id, customer_id, barber_id, starts_at, ends_at,
                                  status, origin, services_total, final_total, notes, created_by, idempotency_key)
         VALUES ($1,$2,$3, now(), now() + ($4||' minutes')::interval,
                 'in_progress', 'walk_in', $5, $5, $6, $7, $8)
         RETURNING id, code, customer_id, barber_id, status`,
        [req.auth.barbershopId, customerId, barberId, String(minutes), total, b.notes || null, req.auth.userId, b.idempotencyKey || null],
      );
      await createItems(c, req.auth.barbershopId, appt.rows[0].id, services);
      await timeline(c, req, { type: 'checked_in', barberId, appointmentId: appt.rows[0].id, customerId, summary: 'Cliente lançado na hora' });
      return appt.rows[0];
    });
    emitShop(req.auth.barbershopId, 'appointment.checked_in', { id: out.id });
    emitBarber(barberId, 'appointment.checked_in', { id: out.id });
    res.status(201).json(out);
  }),
);

// ----------------------------------------------- PATCH /appointments/:id/start
router.patch('/:id/start', staffOrBarber, validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncH(async (req, res) => {
    const appt = await withTenant(realCtx(req), (c) =>
      c.query('SELECT id, status, barber_id FROM appointments WHERE id=$1', [req.params.id]).then((r) => r.rows[0]));
    if (!appt) throw notFound('Agendamento não encontrado');
    await withTenant(sysCtx(req), (c) => c.query("UPDATE appointments SET status='in_progress' WHERE id=$1", [req.params.id]));
    emitShop(req.auth.barbershopId, 'appointment.started', { id: appt.id });
    res.json({ id: appt.id, status: 'in_progress' });
  }),
);

// --------------------------------------------- PATCH /appointments/:id/complete
// Finaliza: comissão automática + entrada financeira + timeline + WebSocket.
router.patch('/:id/complete',
  staffOrBarber,
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      paymentMethod: z.enum(['cash', 'pix', 'debit', 'credit', 'credits', 'free']),
      discount: z.number().nonnegative().optional(),
    }),
  }),
  asyncH(async (req, res) => {
    // autorização + estado via RLS (barbeiro só enxerga os seus)
    const appt = await withTenant(realCtx(req), (c) =>
      c.query('SELECT id, status, barber_id, customer_id, services_total, is_courtesy FROM appointments WHERE id=$1', [req.params.id]).then((r) => r.rows[0]));
    if (!appt) throw notFound('Agendamento não encontrado');
    if (appt.status !== 'in_progress') throw conflict('Só é possível finalizar um atendimento em andamento');

    const bsid = req.auth.barbershopId;
    const method = req.body.paymentMethod;
    const TZDATE = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
    const result = await withTenant(sysCtx(req), async (c) => {
      const discount = req.body.discount || 0;
      const isCourtesy = appt.is_courtesy === true;
      const finalTotal = isCourtesy ? 0 : Math.max(0, Number(appt.services_total) - discount);

      // status -> completed (trigger registra histórico + completed_at)
      await c.query(
        'UPDATE appointments SET status=$2, payment_method=$3, discount_total=$4, final_total=$5 WHERE id=$1',
        [appt.id, 'completed', isCourtesy ? 'free' : method, discount, finalTotal],
      );

      // Regra de remuneração do barbeiro (congelada no momento do atendimento)
      const bCfg = (await c.query(
        'SELECT remuneration_type, commission_on_courtesy, card_fee_deducted_from, supplies_deducted_from FROM barbers WHERE id=$1',
        [appt.barber_id],
      )).rows[0] || {};
      const remType = bCfg.remuneration_type || 'comissionado';
      const commOnCourtesy = bCfg.commission_on_courtesy ?? false;
      const cardFeeFrom = bCfg.card_fee_deducted_from || 'barbershop';
      const suppliesFrom = bCfg.supplies_deducted_from || 'barbershop';

      // 1) COMISSÃO bruta por item (pct já congelado no item no momento do hold)
      const items = await c.query('SELECT id, unit_price, commission_pct FROM appointment_items WHERE appointment_id=$1', [appt.id]);
      let totalGross = 0;
      const itemComms = [];
      for (const it of items.rows) {
        // fixo: sem comissão; cortesia sem flag: sem comissão
        let gross = 0;
        if (remType !== 'fixo' && (!isCourtesy || commOnCourtesy)) {
          gross = Math.round(Number(it.unit_price) * Number(it.commission_pct)) / 100;
        }
        totalGross += gross;
        itemComms.push({ id: it.id, unitPrice: it.unit_price, pct: it.commission_pct, gross });
      }

      // 2) TAXA DE CARTÃO
      let cardFee = 0;
      if (!isCourtesy && finalTotal > 0) {
        const fm = await c.query('SELECT fee_percentage FROM payment_methods WHERE barbershop_id=$1 AND method=$2', [bsid, method]);
        cardFee = Math.round(finalTotal * Number(fm.rows[0]?.fee_percentage || 0)) / 100;
      }

      // 3) INSUMOS consumidos (CMV do serviço) -> baixa de estoque + custo
      const sup = await c.query(
        `SELECT ss.product_id, SUM(ss.quantity) AS qty, p.cost_price
           FROM appointment_items ai
           JOIN service_supplies ss ON ss.service_id = ai.service_id
           JOIN products p ON p.id = ss.product_id
          WHERE ai.appointment_id=$1 GROUP BY ss.product_id, p.cost_price`,
        [appt.id],
      );
      let insumoCost = 0;
      for (const s of sup.rows) {
        insumoCost += Number(s.qty) * Number(s.cost_price);
        await c.query(
          `INSERT INTO stock_movements(barbershop_id, product_id, movement_type, reason, quantity, appointment_id, performed_by)
           VALUES ($1,$2,'out','service_consumption',$3,$4,$5)`,
          [bsid, s.product_id, s.qty, appt.id, req.auth.userId],
        );
      }
      insumoCost = Math.round(insumoCost * 100) / 100;

      // 4) DEDUÇÕES DO BARBEIRO (taxa/insumos rateados proporcionalmente quando configurado)
      let barberCardShare = 0, barberSuppliesShare = 0;
      if (!isCourtesy && totalGross > 0 && finalTotal > 0) {
        const ratio = totalGross / finalTotal;
        if (cardFeeFrom === 'barber' && cardFee > 0)
          barberCardShare = Math.round(cardFee * ratio * 100) / 100;
        if (suppliesFrom === 'barber' && insumoCost > 0)
          barberSuppliesShare = Math.round(insumoCost * ratio * 100) / 100;
      }
      const totalDeductions = barberCardShare + barberSuppliesShare;
      const totalCommission = Math.max(0, totalGross - totalDeductions);
      // Fator de ajuste proporcional aplicado a cada item
      const netFactor = totalGross > 0 ? totalCommission / totalGross : 0;

      // 5) Persiste itens + comissões com valor LÍQUIDO e snapshot da regra vigente
      for (const it of itemComms) {
        const netAmount = Math.round(it.gross * netFactor * 100) / 100;
        await c.query(
          `UPDATE appointment_items
              SET commission_amount=$2, remuneration_type=$3,
                  card_fee_deducted_from=$4, supplies_deducted_from=$5
            WHERE id=$1`,
          [it.id, netAmount, remType, cardFeeFrom, suppliesFrom],
        );
        if (netAmount > 0) {
          await c.query(
            `INSERT INTO commissions(barbershop_id, barber_id, source_type, appointment_item_id,
                                     base_amount, percentage, amount, status, reference_month)
             VALUES ($1,$2,'service',$3,$4,$5,$6,'accrued', date_trunc('month', now())::date)`,
            [bsid, appt.barber_id, it.id, it.unitPrice, it.pct, netAmount],
          );
        }
      }

      // 4) PAGAMENTO (taxa registrada -> net_amount gerado pelo banco) + vínculo ao caixa aberto
      const pay = await c.query(
        `INSERT INTO payments(barbershop_id, appointment_id, method, amount, fee_amount, status, cash_register_id)
         VALUES ($1,$2,$3,$4,$5,'confirmed',
                 (SELECT id FROM cash_registers WHERE barbershop_id=$1 AND status='open' LIMIT 1))
         RETURNING id`,
        [bsid, appt.id, isCourtesy ? 'free' : method, finalTotal, cardFee],
      );

      // 5) FINANCEIRO — receita (cortesia NÃO entra como faturamento) + saídas
      if (isCourtesy) {
        await c.query(
          `INSERT INTO financial_transactions(barbershop_id, direction, category, amount, appointment_id, occurred_on, is_courtesy, performed_by)
           VALUES ($1,'in','service',0,$2, ${TZDATE}, true,$3)`,
          [bsid, appt.id, req.auth.userId]);
      } else if (finalTotal > 0) {
        await c.query(
          `INSERT INTO financial_transactions(barbershop_id, direction, category, amount, method, appointment_id, payment_id, occurred_on, performed_by)
           VALUES ($1,'in','service',$2,$3,$4,$5, ${TZDATE},$6)`,
          [bsid, finalTotal, method, appt.id, pay.rows[0].id, req.auth.userId]);
      }
      if (totalCommission > 0) {
        await c.query(
          `INSERT INTO financial_transactions(barbershop_id, direction, category, amount, appointment_id, occurred_on, performed_by)
           VALUES ($1,'out','commission',$2,$3, ${TZDATE},$4)`,
          [bsid, totalCommission, appt.id, req.auth.userId]);
      }
      if (cardFee > 0) {
        await c.query(
          `INSERT INTO financial_transactions(barbershop_id, direction, category, amount, method, appointment_id, payment_id, occurred_on, performed_by)
           VALUES ($1,'out','card_fee',$2,$3,$4,$5, ${TZDATE},$6)`,
          [bsid, cardFee, method, appt.id, pay.rows[0].id, req.auth.userId]);
      }
      if (insumoCost > 0) {
        await c.query(
          `INSERT INTO financial_transactions(barbershop_id, direction, category, amount, appointment_id, occurred_on, performed_by)
           VALUES ($1,'out','supplies',$2,$3, ${TZDATE},$4)`,
          [bsid, insumoCost, appt.id, req.auth.userId]);
      }

      // 6) CRM
      await c.query(
        `UPDATE customers SET visits_count=visits_count+1, last_visit_at=now(), total_spent=total_spent + $2 WHERE id=$1`,
        [appt.customer_id, finalTotal],
      );

      // 7) FIDELIDADE: carimba 1 atendimento pago (se programa ativo)
      if (!isCourtesy) {
        const prog = await c.query('SELECT id FROM loyalty_programs WHERE barbershop_id=$1 AND is_active', [bsid]);
        if (prog.rowCount) {
          const card = await c.query(
            `INSERT INTO loyalty_cards(barbershop_id, customer_id, program_id, current_count) VALUES ($1,$2,$3,1)
             ON CONFLICT (customer_id, program_id) DO UPDATE SET current_count=loyalty_cards.current_count+1, updated_at=now()
             RETURNING id`,
            [bsid, appt.customer_id, prog.rows[0].id]);
          await c.query(
            `INSERT INTO loyalty_movements(barbershop_id, loyalty_card_id, movement_type, appointment_id, points)
             VALUES ($1,$2,'earn',$3,1)`, [bsid, card.rows[0].id, appt.id]);
        }
      }

      // 8) LUCRO REAL = receita - comissão - taxa - insumos
      const realProfit = Math.round((finalTotal - totalCommission - cardFee - insumoCost) * 100) / 100;

      await timeline(c, req, {
        type: 'service_completed', barberId: appt.barber_id, appointmentId: appt.id, customerId: appt.customer_id,
        summary: 'Atendimento finalizado',
        payload: { finalTotal, commission: totalCommission, cardFee, insumoCost, realProfit, method },
      });

      return {
        finalTotal, commission: Number(totalCommission.toFixed(2)),
        cardFee: Number(cardFee.toFixed(2)), insumoCost: Number(insumoCost.toFixed(2)), realProfit,
      };
    });

    emitShop(bsid, 'appointment.completed', { id: appt.id, ...result });
    emitShop(bsid, 'dashboard.updated', {});
    emitBarber(appt.barber_id, 'appointment.completed', { id: appt.id, commission: result.commission });
    res.json({ id: appt.id, status: 'completed', ...result });
  }),
);

// --------------------------------------------------------- GET /appointments
// Agenda do dono (tudo) / do barbeiro (só os dele, via RLS). Cliente NÃO acessa.
router.get('/', staffOrBarber, asyncH(async (req, res) => {
  const date = req.query.date ? String(req.query.date) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await withTenant(realCtx(req), (c) =>
    c.query(
      `SELECT a.id, a.code, a.starts_at, a.ends_at, a.status, a.origin, a.final_total,
              a.barber_id, b.display_name AS barber_name,
              a.customer_id, cu.name AS customer_name, cu.phone,
              (SELECT string_agg(ai.service_name, ', ') FROM appointment_items ai WHERE ai.appointment_id=a.id) AS services
         FROM appointments a
         JOIN barbers b ON b.id = a.barber_id
         JOIN customers cu ON cu.id = a.customer_id
        WHERE a.deleted_at IS NULL
          AND ($1::date IS NULL OR (a.starts_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date)
          AND ($2::text IS NULL OR a.status = $2::text)
        ORDER BY a.starts_at`,
      [date, status],
    ).then((r) => r.rows),
  );
  res.json({ data: rows });
}));

// Cliente vê apenas o PRÓPRIO histórico (não a agenda interna).
router.get('/mine', rbac('customer'), asyncH(async (req, res) => {
  const rows = await withTenant(realCtx(req), (c) =>
    c.query(
      `SELECT a.id, a.code, a.starts_at, a.ends_at, a.status, a.final_total,
              b.display_name AS barber_name,
              (SELECT string_agg(ai.service_name, ', ') FROM appointment_items ai WHERE ai.appointment_id=a.id) AS services
         FROM appointments a JOIN barbers b ON b.id=a.barber_id
        WHERE a.deleted_at IS NULL ORDER BY a.starts_at DESC LIMIT 100`,
    ).then((r) => r.rows),
  );
  res.json({ data: rows });
}));
