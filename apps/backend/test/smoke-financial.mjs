// ============================================================================
//  Smoke test HTTP — FINANCEIRO e DASHBOARD (+ Lucro Real).
//  Dono vê tudo; barbeiro sem lucro, só comissão própria; cliente 403;
//  atendimento finalizado aparece no resumo; comissão como saída; dashboard
//  atualiza após atendimento; LUCRO REAL = receita - comissão - taxa - insumos.
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

async function main() {
  // setup
  const shop = await api('POST', '/api/v1/auth/register-shop', { body: { shopName: `Fin ${rnd}`, ownerName: 'Dono', email: `fin_${rnd}@ex.com`, password: 'secret123' } });
  const owner = shop.json?.tokens?.accessToken;
  const svcId = (await api('POST', '/api/v1/services', { token: owner, body: { name: 'Corte', durationMinutes: 30, price: 40 } })).json?.id;
  const barber = await api('POST', '/api/v1/barbers', { token: owner, body: { displayName: 'Carlos', email: `c_${rnd}@ex.com`, password: 'barber123', defaultServiceCommissionPct: 50, serviceIds: [svcId] } });
  const barberId = barber.json?.id;
  const barberTok = (await api('POST', '/api/v1/auth/login', { body: { email: `c_${rnd}@ex.com`, password: 'barber123' } })).json?.tokens?.accessToken;

  // walk-in do barbeiro + finalizar no CRÉDITO (taxa 3,5%)
  const walk = await api('POST', '/api/v1/appointments/walk-in', { token: barberTok, body: { customerName: 'Cli', phone: `11 96666-${rnd.slice(0,4)}`, serviceIds: [svcId] } });
  const done = await api('PATCH', `/api/v1/appointments/${walk.json.id}/complete`, { token: barberTok, body: { paymentMethod: 'credit' } });
  // 40 - comissão 20 - taxa (3,5% de 40 = 1,40) = 18,60
  (done.json?.commission === 20 && done.json?.cardFee === 1.4 && done.json?.realProfit === 18.6)
    ? ok('Lucro Real no atendimento: 40 - 20 - 1,40 = 18,60') : ko('lucro real', JSON.stringify(done.json));

  // --- Dono vê financeiro completo ---
  const sum = await api('GET', '/api/v1/financial/summary', { token: owner });
  (sum.status === 200 && sum.json?.grossRevenue === 40 && sum.json?.commission === 20 && sum.json?.cardFee === 1.4 && sum.json?.realProfit === 18.6)
    ? ok('dono: summary com faturamento e lucro real') : ko('summary dono', JSON.stringify(sum.json));

  const dre = await api('GET', '/api/v1/financial/dre', { token: owner });
  (dre.json?.faturamentoBruto === 40 && dre.json?.menosComissao === 20 && dre.json?.menosTaxaCartao === 1.4 && dre.json?.lucroReal === 18.6)
    ? ok('dono: DRE Lucro Real linha a linha') : ko('dre', JSON.stringify(dre.json));

  // comissão aparece como SAÍDA no extrato
  const tx = await api('GET', '/api/v1/financial/transactions', { token: owner });
  const hasCommissionOut = (tx.json?.data || []).some((t) => t.category === 'commission' && t.direction === 'out');
  const hasCardFeeOut = (tx.json?.data || []).some((t) => t.category === 'card_fee' && t.direction === 'out');
  (hasCommissionOut && hasCardFeeOut) ? ok('comissão e taxa aparecem como saída') : ko('saídas', JSON.stringify(tx.json?.data?.map((t) => t.category)));

  // --- Barbeiro NÃO vê lucro da barbearia ---
  (await api('GET', '/api/v1/financial/summary', { token: barberTok })).status === 403 ? ok('barbeiro não vê summary (403)') : ko('barbeiro summary', 'esperado 403');
  (await api('GET', '/api/v1/financial/dre', { token: barberTok })).status === 403 ? ok('barbeiro não vê DRE (403)') : ko('barbeiro dre', 'esperado 403');
  (await api('GET', '/api/v1/financial/transactions', { token: barberTok })).status === 403 ? ok('barbeiro não vê transações (403)') : ko('barbeiro tx', 'esperado 403');

  // --- Barbeiro vê APENAS comissão própria ---
  const bc = await api('GET', '/api/v1/financial/barber-commissions', { token: barberTok });
  const onlyOwn = (bc.json?.data || []).every((x) => x.barber_id === barberId);
  (bc.status === 200 && onlyOwn && bc.json.data.length === 1 && Number(bc.json.data[0].total) === 20)
    ? ok('barbeiro vê só a própria comissão (R$20)') : ko('barbeiro comissão', JSON.stringify(bc.json));

  // --- Cliente não acessa financeiro ---
  const custReg = await api('POST', '/api/v1/auth/register-customer', { body: { shopSlug: shop.json.shop.slug, name: 'Cliente', phone: `11 97777-${rnd.slice(0,4)}`, password: 'cliente123' } });
  const custTok = custReg.json?.tokens?.accessToken;
  const cf = await api('GET', '/api/v1/financial/summary', { token: custTok });
  cf.status === 403 ? ok('cliente não acessa financeiro (403)') : ko('cliente financeiro', `status ${cf.status} reg=${custReg.status}:${JSON.stringify(custReg.json)}`);

  // --- Dashboard do dono atualiza após atendimento ---
  const dash = await api('GET', '/api/v1/dashboard', { token: owner });
  (dash.status === 200 && dash.json?.revenueToday === 40 && dash.json?.servicesToday === 1 && dash.json?.commissionsToday === 20)
    ? ok('dashboard do dono reflete o atendimento') : ko('dashboard dono', JSON.stringify({ rev: dash.json?.revenueToday, s: dash.json?.servicesToday, c: dash.json?.commissionsToday }));
  (Array.isArray(dash.json?.timeline) && dash.json.timeline.length >= 1) ? ok('dashboard mostra timeline recente') : ko('dashboard timeline', 'sem eventos');

  // --- Dashboard do barbeiro: comissão própria ---
  const bdash = await api('GET', '/api/v1/dashboard/barber', { token: barberTok });
  (bdash.status === 200 && bdash.json?.commissionToday === 20 && bdash.json?.servicesToday === 1 && bdash.json?.toReceive === 20)
    ? ok('dashboard do barbeiro: comissão e a receber') : ko('dashboard barbeiro', JSON.stringify(bdash.json));
  (await api('GET', '/api/v1/dashboard', { token: barberTok })).status === 403 ? ok('barbeiro não acessa dashboard do dono (403)') : ko('barbeiro dash dono', 'esperado 403');

  console.log(`\nFINANCEIRO/DASHBOARD: ${pass} passou, ${fail} falhou`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('erro:', e); process.exit(1); });
