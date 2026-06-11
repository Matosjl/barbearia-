// ============================================================================
//  Auditoria de PERMISSÕES e MULTI-TENANT (HTTP). Complementa smoke.mjs.
//  Verifica: RBAC por perfil, isolamento entre barbearias, endpoints
//  protegidos, tokens inválidos e rate limit em /auth.
// ============================================================================
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (n) => { console.log(`  PASS: ${n}`); pass++; };
const ko = (n, e) => { console.log(`  FAIL: ${n} -> ${e}`); fail++; };

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const rnd = Math.random().toString(36).slice(2, 8);

async function main() {
  // Barbearia A + dono + cliente
  const A = await api('POST', '/api/v1/auth/register-shop', {
    body: { shopName: `Aud ${rnd}`, ownerName: 'Dono', email: `aud_${rnd}@ex.com`, password: 'secret123' },
  });
  const ownerA = A.json?.tokens?.accessToken;
  const slugA = A.json?.shop?.slug;
  await api('POST', '/api/v1/services', { token: ownerA, body: { name: 'Corte', durationMinutes: 30, price: 40 } });
  await api('POST', '/api/v1/customers', { token: ownerA, body: { name: 'Cli A', phone: `11 90000-${rnd.slice(0,4)}` } });

  const cust = await api('POST', '/api/v1/auth/register-customer', {
    body: { shopSlug: slugA, name: 'Cliente', phone: `11 95555-${rnd.slice(0,4)}`, password: 'cliente123' },
  });
  const custTok = cust.json?.tokens?.accessToken;

  // --- RBAC: cliente bloqueado de ações de staff ---
  (await api('POST', '/api/v1/barbers', { token: custTok, body: { displayName: 'X' } })).status === 403
    ? ok('cliente não cria barbeiro (403)') : ko('cliente cria barbeiro', 'esperado 403');
  (await api('PATCH', '/api/v1/shop', { token: custTok, body: { name: 'Hack' } })).status === 403
    ? ok('cliente não edita barbearia (403)') : ko('cliente edita shop', 'esperado 403');
  (await api('GET', '/api/v1/shop/settings', { token: custTok })).status === 403
    ? ok('cliente não lê settings (403)') : ko('cliente lê settings', 'esperado 403');
  (await api('POST', '/api/v1/customers', { token: custTok, body: { name: 'Y', phone: '11 0000-0000' } })).status === 403
    ? ok('cliente não cria cliente (403)') : ko('cliente cria cliente', 'esperado 403');

  // --- Cliente PODE ver o que é dele ---
  (await api('GET', '/api/v1/services', { token: custTok })).status === 200
    ? ok('cliente lista serviços (Shop)') : ko('cliente lista serviços', 'esperado 200');

  // --- Multi-tenant: barbearia B não enxerga dados de A ---
  const B = await api('POST', '/api/v1/auth/register-shop', {
    body: { shopName: `Outra ${rnd}`, ownerName: 'Dono B', email: `audb_${rnd}@ex.com`, password: 'secret123' },
  });
  const ownerB = B.json?.tokens?.accessToken;
  const bSvc = await api('GET', '/api/v1/services', { token: ownerB });
  (bSvc.json?.data || []).length === 0 ? ok('multi-tenant: B não vê serviços de A') : ko('multi-tenant serviços', `viu ${bSvc.json?.data?.length}`);
  const bCust = await api('GET', '/api/v1/customers', { token: ownerB });
  (bCust.json?.data || []).length === 0 ? ok('multi-tenant: B não vê clientes de A') : ko('multi-tenant clientes', `viu ${bCust.json?.data?.length}`);

  // --- Tokens inválidos ---
  (await api('GET', '/api/v1/services', { token: 'lixo.invalido.token' })).status === 401
    ? ok('token inválido = 401') : ko('token inválido', 'esperado 401');
  (await api('GET', '/api/v1/auth/me')).status === 401
    ? ok('sem token em /me = 401') : ko('me sem token', 'esperado 401');

  // --- /auth/me reflete papel ---
  const me = await api('GET', '/api/v1/auth/me', { token: custTok });
  me.json?.auth?.role === 'customer' ? ok('/me reflete role=customer') : ko('/me role', JSON.stringify(me.json?.auth));

  // --- Rate limit em /auth (burst) ---
  let got429 = false;
  for (let i = 0; i < 40; i++) {
    const r = await api('POST', '/api/v1/auth/login', { body: { email: 'nao@existe.com', password: 'x' } });
    if (r.status === 429) { got429 = true; break; }
  }
  got429 ? ok('rate limit em /auth dispara 429') : ko('rate limit', 'não disparou 429 (ajuste RATE_LIMIT_AUTH)');

  console.log(`\nPERMISSÕES: ${pass} passou, ${fail} falhou`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('erro audit-permissions:', e); process.exit(1); });
