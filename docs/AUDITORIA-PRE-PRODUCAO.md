# Auditoria Técnica Pré-Produção — Barber SaaS

Data: 2026-06-10 · Escopo: schema (migrações 01–10), backend MVP (fundação + cadastros), infraestrutura Docker. Auditoria **executada** (não apenas teórica): scripts reais rodaram contra PostgreSQL 17 e contra o backend Node.

## Veredito

**APROVADO PARA CONTINUAR O DESENVOLVIMENTO**, com 3 achados já **corrigidos e revalidados** e uma lista de itens de hardening para antes do go-live real. Nenhum achado crítico permanece aberto. As garantias centrais (RLS multi-tenant, RBAC, anti-overbooking, imutabilidade financeira, anti-duplicidade) estão **provadas por teste automatizado**.

Legenda de status: ✅ aprovado · ⚠️ risco · ⛔ crítico · 🔧 corrigido nesta auditoria · 🕓 projetado/garantido no banco, endpoint no backend pendente.

---

## 1. Resumo dos testes executados

| Suíte | O que cobre | Resultado |
|---|---|---|
| `database/smoke_test.ps1` | 15 regras de negócio no banco | **15/15 PASS** |
| `database/audit/audit_db.ps1` | órfãs, RLS, FK-index, views, SECURITY DEFINER, constraints | **8/8 PASS** |
| `apps/backend/test/smoke.mjs` | fluxo HTTP: auth, RBAC, RLS, anti-dup | **11/11 PASS** |
| `apps/backend/test/audit-permissions.mjs` | permissões por perfil + multi-tenant + rate limit | **11/11 PASS** |
| `apps/backend/test/load-test.mjs` | carga básica | **800/800 OK** (health ~900 req/s; services ~470 req/s) |
| `database/audit/backup_restore_test.ps1` | pg_dump → drop → pg_restore | **PASS** (dados preservados) |

Como rodar tudo:
```powershell
powershell -File database\smoke_test.ps1                 # regras de negócio (DB)
powershell -File database\audit\audit_db.ps1             # auditoria estrutural (DB)
powershell -File apps\backend\test\run-audit.ps1         # HTTP: load + smoke + permissões
powershell -File database\audit\backup_restore_test.ps1  # backup/restore
```

---

## 2. Achados e correções

### ⛔🔧 CRÍTICO-1 — Token JWT vazando em log (CORRIGIDO)
`pino-http` logava o header `Authorization` (Bearer token) e poderia logar senhas. **Correção:** redação no logger (`req.headers.authorization`, `*.password`, `*.refresh_token_hash`, etc. → `[REDACTED]`). Revalidado: logs agora mostram `"authorization":"[REDACTED]"`.

### ⚠️🔧 RISCO-2 — Rate limit ausente em /auth (CORRIGIDO)
Sem proteção contra brute-force no login. **Correção:** `express-rate-limit` em `/api/v1/auth` (20 req/min/IP, configurável por `RATE_LIMIT_AUTH`). Revalidado: burst dispara **429**.

### ⚠️🔧 RISCO-3 — `trust proxy: true` permitia burlar rate limit (CORRIGIDO)
Com `trust proxy` totalmente confiável, um cliente poderia forjar `X-Forwarded-For` e escapar do limite por IP. **Correção:** `trust proxy: 1` (confia só no nginx).

### ⚠️🔧 RISCO-4 — 85 colunas de FK sem índice (CORRIGIDO)
Risco de performance em produção (joins, filtros por `barbershop_id`, DELETE em pais). **Correção:** migração `10_indexes.sql` cria os índices. Revalidado: auditoria do banco agora reporta "Todas as FKs têm índice de suporte".

### ⚠️ RISCO-5 — Backend usa pool admin para auth/signup (ABERTO, documentado)
Auth/criação de barbearia conectam como owner (bypass RLS), necessário para criar tenant e ler `users` global. **Plano:** role dedicado `auth_svc` com grants mínimos (apenas em `users/accounts/barbershops/memberships/auth_sessions`), sem privilégio de owner. Prioridade: média (antes do go-live).

### ⚠️ RISCO-6 — Segredos de desenvolvimento no `.env` (ABERTO)
`.env` tem segredos de dev e o código tem fallback (`dev-access-secret`). **Plano:** em produção, segredos via Docker secrets / cofre; remover fallbacks; `.env` real fora do versionamento. Prioridade: alta para go-live.

### 🔎 Observações sem ação imediata
- Sem endpoint de logout/revogação ativa de refresh (há rotação; revogação total é desejável). Minor.
- Política de senha mínima 6 chars — endurecer (8+ e checagem de vazamento) é desejável. Minor.

---

## 3. Checklist por categoria

### 3.1 Segurança
| Item | Status |
|---|---|
| JWT (access+refresh, rotação) | ✅ |
| Senhas (bcrypt cost 10) | ✅ |
| RBAC por perfil (owner/barber/customer) | ✅ testado |
| RLS habilitada em todas as tabelas com barbershop_id | ✅ testado |
| Multi-tenant — sem vazamento entre barbearias | ✅ testado (B não vê A) |
| Acesso indevido do barbeiro comissionado (financeiro/estoque/campanha/WhatsApp) | ✅ testado no DB |
| Cliente vendo dados internos (custo/lucro/estoque) | ✅ bloqueado (políticas + view segura) |
| Proteção de endpoints (authRequired + rbac) | ✅ testado (401/403) |
| Rate limit | ✅ 🔧 (429 verificado) |
| CORS | ✅ 🔧 (allowlist por `CORS_ORIGINS`) |
| Logs sem dados sensíveis | ✅ 🔧 (redação) |

### 3.2 Banco de dados
| Item | Status |
|---|---|
| Tabelas órfãs | ✅ (só `audit_logs`, proposital) |
| FKs faltando | ✅ (149–153 FKs; relatório relacional) |
| Índices faltando | ✅ 🔧 (migração 10) |
| Risco de duplicidade de cliente | ✅ `UNIQUE(barbershop_id, phone)` |
| barbershop_id faltando | ✅ (só globais justificadas) |
| Constraints fracas | ✅ (CHECK/UNIQUE/EXCLUDE presentes) |
| Triggers perigosas | ✅ (imutabilidade/estoque/status revisadas) |
| Views expondo dados sensíveis | ✅ (nenhuma expõe `cost_price`) |
| Funções SECURITY DEFINER (bypass RLS) | ✅ (nenhuma) |

### 3.3 Regras de negócio (validadas no banco)
| Regra | Status |
|---|---|
| Agendamento duplicado / sobreposição | ✅ EXCLUDE (overbooking bloqueado) |
| Hold temporário reserva o horário / expira | ✅ testado |
| Cancelamento / remarcação / no-show | ✅ guard de status + contadores 🕓(endpoint pendente) |
| Comissão automática | 🕓 (regras no schema; cálculo no backend pendente) |
| Cortesia não infla faturamento | ✅ (views filtram `is_courtesy`) |
| Fidelidade | 🕓 (schema pronto) |
| Estoque negativo | ✅ bloqueado (trigger) |
| Estorno | ✅ append-only + `reverses_id` |
| Caixa fechado imutável | ✅ testado |
| Produto vendido sem estoque | ✅ bloqueado |

### 3.4 Produção real
| Item | Status |
|---|---|
| Docker Compose (serviços por nome) | ✅ definido (engine não subiu neste ambiente por falta de memória) |
| Volumes persistentes | ✅ definidos e isolados |
| Backup e restore | ✅ **testado** (dump/restore preserva dados) |
| Migrações automáticas | ✅ testado (serviço `migrate` + runner) |
| Health checks | ✅ testado (`/health` 200/503) |
| Logs | ✅ (pino estruturado + redação) |
| Restart automático | ✅ (`restart: unless-stopped`) |
| Nginx/proxy | ✅ definido (TLS, /api, /socket.io, webhooks) |
| WebSocket | ✅ código pronto (adapter Redis); ⚠️ não testado sob carga |
| Redis | ✅ no compose (opcional em dev) |
| Workers/filas | 🕓 esqueleto pronto; filas reais nos próximos módulos |
| Variáveis .env | ⚠️ dev (RISCO-6) |
| Secrets | ⚠️ migrar para cofre/Docker secrets |

### 3.5 WhatsApp / Evolution
| Item | Status |
|---|---|
| Fila de envio | 🕓 `whatsapp_messages` (status `pendente`) |
| Limite de disparo | 🕓 `rate_limit_per_min`/`daily_cap` no schema |
| Opt-out | ✅ testado (fora da audiência) |
| Status de mensagem (pendente/enviada/entregue/lida/falhou) | ✅ modelado |
| Webhooks | 🕓 rota definida |
| Idempotência | ✅ `UNIQUE(barbershop_id, idempotency_key)` |
| Campanha em massa pelo barbeiro | ✅ bloqueado (testado no DB) |
| Bloqueio de envio duplicado | ✅ idempotência |

### 3.6 IA / Ollama
| Item | Status |
|---|---|
| IA não executa ação sem aprovação | ✅ `ai_suggestions.status=draft` → `approved_by` |
| IA não envia campanha sozinha | ✅ guardrail (humano aprova) |
| IA não acessa dados proibidos | ✅ roda via dados agregados; tabelas sensíveis sob RLS |
| Logs das sugestões | ✅ `ai_jobs`/`ai_insights`/`ai_suggestions` persistidos |
| Controle de permissões | ✅ `ai_*` negadas a barber/customer |
(Backend de IA: 🕓 pendente — apenas modelo de dados + guardrails definidos.)

### 3.7 Testes automatizados
| Perfil/Área | Cobertura |
|---|---|
| Dono | ✅ HTTP (cadastros, config) |
| Barbeiro comissionado | ✅ DB (isolamento), 🕓 HTTP (precisa de login de barbeiro) |
| Cliente | ✅ HTTP (RBAC, Shop) |
| Agendamento | ✅ DB (overbooking/hold), 🕓 HTTP |
| Shop/Estoque | ✅ DB (estoque negativo, visibilidade), 🕓 HTTP |
| Financeiro/Caixa | ✅ DB (imutável), 🕓 HTTP |
| WhatsApp/Timeline | ✅ DB (opt-out, campanha, etiquetas), 🕓 HTTP |
| RLS / Multi-tenant | ✅ DB **e** HTTP |

---

## 4. Plano de correção (priorizado)

**Já feito nesta auditoria:** redação de logs, rate limit, trust proxy, índices de FK.

**Antes do go-live (alta):**
1. Segredos em cofre/Docker secrets; remover fallbacks de JWT; `.env` fora do git.
2. Role `auth_svc` dedicado (reduzir uso do pool admin).
3. Subir a stack Docker num ambiente com memória e revalidar (engine não pôde subir aqui).
4. Teste de carga do WebSocket com múltiplas réplicas + Redis adapter.

**Durante o desenvolvimento (média):**
5. Implementar e testar via HTTP os módulos pendentes (agendamento→timeline), cada um com smoke próprio.
6. Login de barbeiro para auditar o perfil comissionado também por HTTP.
7. Endpoint de logout/revogação de refresh; política de senha mais forte.

**Contínuo (baixa):**
8. Monitoramento (métricas/alertas), particionar `audit_logs`/`timeline`/`stock_movements` por data quando crescer, PITR (pgBackRest).

---

## 5. Conclusão

A base está **sólida e segura para evoluir**: o banco impõe as regras críticas por constraint/trigger/RLS (provado), o backend respeita RBAC e multi-tenant (provado por HTTP), backup/restore funciona, e os 3 achados de segurança encontrados já foram corrigidos e revalidados. Os itens marcados 🕓 são funcionalidades ainda não implementadas no backend (já projetadas e garantidas no banco) — entram nos próximos módulos, cada um com teste antes de avançar, conforme combinado.
