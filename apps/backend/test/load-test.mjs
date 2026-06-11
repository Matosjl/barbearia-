// ============================================================================
//  Teste de carga BÁSICO — concorrência no /health e em endpoint autenticado.
//  Mede sucesso, throughput e latência p50/p95. Não substitui teste de carga
//  real (k6/artillery), serve para detectar regressões grosseiras.
// ============================================================================
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function timed(fn) { const t0 = performance.now(); const r = await fn(); return { r, ms: performance.now() - t0 }; }
function pct(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.floor((p / 100) * (s.length - 1))]; }

async function run(label, total, concurrency, makeReq) {
  const lat = []; let okc = 0, errc = 0;
  const t0 = performance.now();
  let i = 0;
  async function worker() {
    while (i < total) { i++; const { r, ms } = await timed(makeReq); lat.push(ms); (r.ok ? okc++ : errc++); }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const secs = (performance.now() - t0) / 1000;
  console.log(`  ${label}: ${okc}/${total} ok, ${errc} erro | ${(total / secs).toFixed(0)} req/s | p50 ${pct(lat,50).toFixed(1)}ms p95 ${pct(lat,95).toFixed(1)}ms`);
  return errc === 0;
}

async function main() {
  // token para endpoint autenticado
  const rnd = Math.random().toString(36).slice(2, 8);
  const reg = await fetch(BASE + '/api/v1/auth/register-shop', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shopName: `Load ${rnd}`, ownerName: 'Load Owner', email: `load_${rnd}@ex.com`, password: 'secret123' }),
  }).then((r) => r.json());
  const token = reg?.tokens?.accessToken;

  let allOk = true;
  allOk &= await run('GET /health        ', 500, 50, () => fetch(BASE + '/health'));
  allOk &= await run('GET /services (auth)', 300, 30, () =>
    fetch(BASE + '/api/v1/services', { headers: { authorization: `Bearer ${token}` } }));

  console.log(allOk ? '\nLOAD: OK (0 erros)' : '\nLOAD: FALHAS detectadas');
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error('erro load:', e); process.exit(1); });
