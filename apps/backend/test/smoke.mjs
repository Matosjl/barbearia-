// ============================================================================
//  Smoke test HTTP do backend (roda no HOST contra o backend no container).
//  Valida: health, RBAC, multi-tenant/RLS, anti-duplicidade de cliente,
//  e que cliente/barbeiro não criam/veem o que não devem.
//  BASE_URL via env (default http://localhost:3000).
// ============================================================================
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (n) => { console.log(`  PASS: ${n}`); pass++; };
const ko = (n, e) => { console.log(`  FAIL: ${n} -> ${e}`); fail++; };

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const rnd = Math.random().toString(36).slice(2, 8);

async function main() {
  // 0. Health
  {
    const r = await api('GET', '/health');
    r.status === 200 && r.json?.db === true ? ok('health db ok') : ko('health', JSON.stringify(r.json));
  }

  // 1. Registrar barbearia A (dono)
  const shopA = await api('POST', '/api/v1/auth/register-shop', {
    body: { shopName: `Barbearia ${rnd}`, ownerName: 'Dono A', email: `dono_${rnd}@ex.com`, password: 'secret123' },
  });
  shopA.status === 201 && shopA.json?.tokens?.accessToken
    ? ok('register-shop A') : ko('register-shop A', JSON.stringify(shopA.json));
  const ownerA = shopA.json?.tokens?.accessToken;
  const slugA = shopA.json?.shop?.slug;

  // 2. Login do dono A
  const login = await api('POST', '/api/v1/auth/login', {
    body: { email: `dono_${rnd}@ex.com`, password: 'secret123' },
  });
  login.status === 200 && login.json?.tokens?.accessToken ? ok('login dono A') : ko('login', JSON.stringify(login.json));

  // 3. Criar serviço (dono)
  const svc = await api('POST', '/api/v1/services', {
    token: ownerA, body: { name: 'Corte', durationMinutes: 30, price: 40 },
  });
  svc.status === 201 && svc.json?.id ? ok('criar serviço') : ko('criar serviço', JSON.stringify(svc.json));

  // 4. Criar barbeiro (dono)
  const barber = await api('POST', '/api/v1/barbers', {
    token: ownerA, body: { displayName: 'Carlos', defaultServiceCommissionPct: 50, serviceIds: [svc.json?.id] },
  });
  barber.status === 201 && barber.json?.id ? ok('criar barbeiro') : ko('criar barbeiro', JSON.stringify(barber.json));

  // 5. Criar cliente (staff) + anti-duplicidade por telefone
  const c1 = await api('POST', '/api/v1/customers', {
    token: ownerA, body: { name: 'João', phone: '11 99999-0001' },
  });
  const c2 = await api('POST', '/api/v1/customers', {
    token: ownerA, body: { name: 'João Silva', phone: '11999990001' },
  });
  c1.json?.id && c2.json?.id && c1.json.id === c2.json.id
    ? ok('anti-duplicidade: mesmo telefone = mesmo cliente') : ko('anti-duplicidade', `${c1.json?.id} != ${c2.json?.id}`);

  // 6. Registrar cliente (perfil customer) na barbearia A
  const cust = await api('POST', '/api/v1/auth/register-customer', {
    body: { shopSlug: slugA, name: 'Cliente Final', phone: '11 98888-0002', password: 'cliente123' },
  });
  const custToken = cust.json?.tokens?.accessToken;
  cust.status === 201 && custToken ? ok('register-customer') : ko('register-customer', JSON.stringify(cust.json));

  // 7. RBAC: cliente NÃO pode criar serviço
  const forbidden = await api('POST', '/api/v1/services', {
    token: custToken, body: { name: 'Hack', durationMinutes: 10, price: 1 },
  });
  forbidden.status === 403 ? ok('RBAC: cliente bloqueado de criar serviço') : ko('RBAC cliente', `status ${forbidden.status}`);

  // 8. Cliente PODE listar serviços (precisa para agendar)
  const listSvc = await api('GET', '/api/v1/services', { token: custToken });
  listSvc.status === 200 && Array.isArray(listSvc.json?.data)
    ? ok('cliente lista serviços') : ko('cliente lista serviços', JSON.stringify(listSvc.json));

  // 9. Multi-tenant: criar barbearia B e garantir que B não vê serviço de A
  const shopB = await api('POST', '/api/v1/auth/register-shop', {
    body: { shopName: `Outra ${rnd}`, ownerName: 'Dono B', email: `dono_b_${rnd}@ex.com`, password: 'secret123' },
  });
  const ownerB = shopB.json?.tokens?.accessToken;
  const listB = await api('GET', '/api/v1/services', { token: ownerB });
  (listB.json?.data || []).length === 0
    ? ok('RLS multi-tenant: barbearia B não vê serviços de A') : ko('RLS multi-tenant', `viu ${listB.json?.data?.length}`);

  // 10. Sem token = 401
  const noAuth = await api('GET', '/api/v1/services');
  noAuth.status === 401 ? ok('sem token = 401') : ko('sem token', `status ${noAuth.status}`);

  console.log(`\nRESULTADO: ${pass} passou, ${fail} falhou`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('erro no smoke:', e); process.exit(1); });
