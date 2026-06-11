// ============================================================================
//  Smoke test HTTP — AGENDAMENTO e ATENDIMENTO.
//  Cobre: hold + anti-overbooking, hold expirado não bloqueia, confirmar,
//  cancelar (com motivo), remarcar, walk-in do barbeiro, escopo do barbeiro,
//  cliente sem agenda interna, finalizar gerando comissão automática.
// ============================================================================
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (n) => { console.log(`  PASS: ${n}`); pass++; };
const ko = (n, e) => { console.log(`  FAIL: ${n} -> ${e}`); fail++; };
async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const rnd = Math.random().toString(36).slice(2, 7);
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const MIN = 60 * 1000;

async function main() {
  // setup: barbearia + serviço + barbeiro COM login + 2 clientes
  const shop = await api('POST', '/api/v1/auth/register-shop', {
    body: { shopName: `Ag ${rnd}`, ownerName: 'Dono', email: `ag_${rnd}@ex.com`, password: 'secret123' },
  });
  const owner = shop.json?.tokens?.accessToken;
  const svc = await api('POST', '/api/v1/services', { token: owner, body: { name: 'Corte', durationMinutes: 30, price: 40 } });
  const svcId = svc.json?.id;
  const barber = await api('POST', '/api/v1/barbers', {
    token: owner, body: { displayName: 'Carlos', email: `carlos_${rnd}@ex.com`, password: 'barber123', defaultServiceCommissionPct: 50, serviceIds: [svcId] },
  });
  barber.status === 201 && barber.json?.id ? ok('criar barbeiro com login') : ko('criar barbeiro login', JSON.stringify(barber.json));
  const barberId = barber.json?.id;
  const bLogin = await api('POST', '/api/v1/auth/login', { body: { email: `carlos_${rnd}@ex.com`, password: 'barber123' } });
  const barberTok = bLogin.json?.tokens?.accessToken;
  bLogin.json?.membership?.role === 'barber' ? ok('login do barbeiro (role=barber)') : ko('login barbeiro', JSON.stringify(bLogin.json?.membership));

  const c1 = (await api('POST', '/api/v1/customers', { token: owner, body: { name: 'João', phone: `11 91111-${rnd.slice(0,4)}` } })).json?.id;
  const c2 = (await api('POST', '/api/v1/customers', { token: owner, body: { name: 'Pedro', phone: `11 92222-${rnd.slice(0,4)}` } })).json?.id;

  // --- HOLD + ANTI-OVERBOOKING ---
  const t1 = iso(24 * 60 * MIN);            // amanhã
  const h1 = await api('POST', '/api/v1/appointments/hold', { token: owner, body: { barberId, serviceIds: [svcId], startsAt: t1, customerId: c1 } });
  h1.status === 201 ? ok('criar hold') : ko('criar hold', JSON.stringify(h1.json));
  const overlap = await api('POST', '/api/v1/appointments/hold', { token: owner, body: { barberId, serviceIds: [svcId], startsAt: iso(24 * 60 * MIN + 15 * MIN), customerId: c2 } });
  overlap.status === 409 ? ok('anti-overbooking: hold sobreposto bloqueado (409)') : ko('overbooking', `status ${overlap.status}`);

  // --- CONFIRMAR ---
  const conf = await api('PATCH', `/api/v1/appointments/${h1.json.id}/confirm`, { token: owner });
  conf.json?.status === 'confirmed' ? ok('confirmar agendamento') : ko('confirmar', JSON.stringify(conf.json));

  // --- CANCELAR exige motivo ---
  const noReason = await api('PATCH', `/api/v1/appointments/${h1.json.id}/cancel`, { token: owner, body: {} });
  noReason.status === 422 ? ok('cancelar sem motivo = 422') : ko('cancel sem motivo', `status ${noReason.status}`);
  const cancel = await api('PATCH', `/api/v1/appointments/${h1.json.id}/cancel`, { token: owner, body: { reason: 'customer_gave_up' } });
  cancel.json?.status === 'canceled' ? ok('cancelar com motivo') : ko('cancelar', JSON.stringify(cancel.json));

  // --- HOLD EXPIRADO NÃO BLOQUEIA (hold_minutes=0 -> expira já) ---
  await api('PUT', '/api/v1/shop/settings', { token: owner, body: { key: 'hold_minutes', value: 0 } });
  const t3 = iso(30 * 60 * MIN);
  const exp1 = await api('POST', '/api/v1/appointments/hold', { token: owner, body: { barberId, serviceIds: [svcId], startsAt: t3, customerId: c1 } });
  await new Promise((r) => setTimeout(r, 50));
  const exp2 = await api('POST', '/api/v1/appointments/hold', { token: owner, body: { barberId, serviceIds: [svcId], startsAt: t3, customerId: c2 } });
  (exp1.status === 201 && exp2.status === 201) ? ok('hold expirado é purgado e não bloqueia o horário') : ko('hold expirado', `exp1=${exp1.status}:${JSON.stringify(exp1.json)} exp2=${exp2.status}:${JSON.stringify(exp2.json)}`);
  // restaura
  await api('PUT', '/api/v1/shop/settings', { token: owner, body: { key: 'hold_minutes', value: 5 } });

  // --- REMARCAR mantém histórico ---
  const t4 = iso(48 * 60 * MIN);
  const toResched = await api('POST', '/api/v1/appointments/hold', { token: owner, body: { barberId, serviceIds: [svcId], startsAt: t4, customerId: c1 } });
  const resched = await api('PATCH', `/api/v1/appointments/${toResched.json.id}/reschedule`, { token: owner, body: { startsAt: iso(49 * 60 * MIN) } });
  resched.status === 200 ? ok('remarcar agendamento') : ko('remarcar', JSON.stringify(resched.json));

  // --- WALK-IN do barbeiro (atribui a si) ---
  const walk = await api('POST', '/api/v1/appointments/walk-in', { token: barberTok, body: { customerName: 'Avulso', phone: `11 93333-${rnd.slice(0,4)}`, serviceIds: [svcId] } });
  (walk.status === 201 && walk.json?.barber_id === barberId) ? ok('barbeiro lança walk-in atribuído a si') : ko('walk-in', JSON.stringify(walk.json));
  const walkId = walk.json?.id;

  // --- ESCOPO: barbeiro só vê os próprios; cliente não vê agenda interna ---
  const barberAgenda = await api('GET', '/api/v1/appointments', { token: barberTok });
  const allOwn = (barberAgenda.json?.data || []).every((a) => a.barber_id === barberId);
  (barberAgenda.status === 200 && allOwn && barberAgenda.json.data.length >= 1) ? ok('barbeiro vê só a própria agenda') : ko('escopo barbeiro', JSON.stringify(barberAgenda.json?.data?.map((a) => a.barber_id)));

  // segundo barbeiro + walk-in dele (pelo dono) — barbeiro1 não pode ver
  const b2 = await api('POST', '/api/v1/barbers', { token: owner, body: { displayName: 'Rafa', serviceIds: [svcId], defaultServiceCommissionPct: 40 } });
  const walk2 = await api('POST', '/api/v1/appointments/walk-in', { token: owner, body: { customerName: 'Cli B2', phone: `11 94444-${rnd.slice(0,4)}`, serviceIds: [svcId], barberId: b2.json.id } });
  const barberAgenda2 = await api('GET', '/api/v1/appointments', { token: barberTok });
  const seesOther = (barberAgenda2.json?.data || []).some((a) => a.barber_id === b2.json.id);
  !seesOther ? ok('barbeiro NÃO vê agendamento de outro barbeiro (RLS)') : ko('vazamento barbeiro', 'viu agendamento de outro');

  const custReg = await api('POST', '/api/v1/auth/register-customer', { body: { shopSlug: shop.json.shop.slug, name: 'Cli', phone: `11 95555-${rnd.slice(0,4)}`, password: 'cliente123' } });
  const custTok = custReg.json?.tokens?.accessToken;
  (await api('GET', '/api/v1/appointments', { token: custTok })).status === 403 ? ok('cliente não vê agenda interna (403)') : ko('cliente agenda', 'esperado 403');

  // --- barbeiro não finaliza atendimento de outro (RLS esconde -> 404) ---
  const crossComplete = await api('PATCH', `/api/v1/appointments/${walk2.json.id}/complete`, { token: barberTok, body: { paymentMethod: 'pix' } });
  crossComplete.status === 404 ? ok('barbeiro não finaliza atendimento de outro (404)') : ko('cross complete', `status ${crossComplete.status}`);

  // --- FINALIZAR gerando comissão automática (40 * 50% = 20) ---
  const done = await api('PATCH', `/api/v1/appointments/${walkId}/complete`, { token: barberTok, body: { paymentMethod: 'pix' } });
  (done.status === 200 && done.json?.status === 'completed') ? ok('finalizar atendimento') : ko('finalizar', JSON.stringify(done.json));
  done.json?.commission === 20 ? ok('comissão automática correta (R$20 = 50% de R$40)') : ko('comissão', `veio ${done.json?.commission}`);
  done.json?.finalTotal === 40 ? ok('financeiro: total do atendimento R$40') : ko('finalTotal', `veio ${done.json?.finalTotal}`);

  console.log(`\nAGENDAMENTO/ATENDIMENTO: ${pass} passou, ${fail} falhou`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('erro:', e); process.exit(1); });
