# Backend MVP — Status e Como Rodar

Backend Node.js + Express, conectado ao schema validado (migrações 01→09). Esta é a **base sólida** (itens 1–15 do plano) + os primeiros cadastros, tudo testado de verdade contra PostgreSQL (sem mock).

## ✅ Implementado e validado (11/11 testes HTTP)

Fundação:
- Express + estrutura modular (`src/modules/*`), ESM.
- **PostgreSQL** com dois pools: `adminPool` (owner — auth/migrações, bypass RLS) e `appPool` (role `barber_app` — todas as queries de negócio, **sujeito a RLS**).
- **Contexto multi-tenant**: `withTenant()` abre transação e seta `app.barbershop_id`, `app.current_user_id`, `app.role`, `app.barber_id`, `app.customer_id` via `set_config` (SET LOCAL). **RLS nunca é desligado.**
- **Redis** opcional (adapter Socket.io / filas) — ausente no teste, presente no Docker.
- **Migrações automáticas** (`db/migrate.js`) aplicando os `.sql` canônicos + seed de planos.
- **JWT** (access + refresh com rotação em `auth_sessions`).
- **RBAC** por papel (owner/manager/receptionist/barber/customer) — o contexto vem **só do token**, nunca do corpo.
- **Socket.io** com salas `shop:{id}` e `barber:{id}` (adapter Redis quando disponível).
- **Health check** (`/health` checa db + redis).
- **Logs** estruturados (pino) com request-id.
- **Tratamento global de erros** mapeando zod (422), AppError, e códigos do Postgres (unique→409, exclusion/overbooking→409, RLS→403, RAISE EXCEPTION→regra de negócio).
- **Validação de payloads** com zod em todas as rotas.

Módulos (cadastros):
- **Auth**: `POST /auth/register-shop`, `POST /auth/login`, `POST /auth/register-customer`, `POST /auth/refresh`, `GET /auth/me`.
- **Barbearia**: `GET/PATCH /shop`, `GET/PUT /shop/settings`.
- **Serviços**: `GET/POST/PATCH/DELETE /services`.
- **Barbeiros**: `GET/POST/PATCH/DELETE /barbers` (+ serviços que realiza).
- **Clientes**: `POST /customers` (**upsert por telefone — anti-duplicidade**), `GET /customers`, `GET /customers/:id`.

Provas do smoke test (`apps/backend/test/smoke.mjs`):
health · register-shop · login · criar serviço · criar barbeiro · **mesmo telefone = mesmo cliente** · register-customer · **RBAC: cliente não cria serviço (403)** · cliente lista serviços · **RLS: barbearia B não vê dados de A** · sem token = 401.

## Como rodar

### Via Docker (alvo de produção)
Pré-requisito: Docker Desktop com o engine rodando.
```powershell
cd C:\BarberProject
# sobe postgres + redis + migrate + backend (sem ollama/evolution pesados)
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build backend
# valida por HTTP (porta publicada só para teste)
$env:BASE_URL="http://localhost:3000"; node apps/backend/test/smoke.mjs
```
Comunicação entre containers é por nome (`postgres`, `redis`). O `migrate` aplica as migrações montando `./database`.

> Nota: no ambiente atual o Docker Desktop não pôde subir (erro do Windows
> "arquivo de paginação muito pequeno" = falta de memória/pagefile). Assim que
> houver recursos, o comando acima sobe tudo. A validação abaixo (nativa) prova
> o mesmo código.

### Validação nativa (sem Docker) — usada para validar agora
```powershell
powershell -ExecutionPolicy Bypass -File apps\backend\test\run-backend-smoke.ps1
```
Sobe um PostgreSQL temporário, aplica migrações, sobe o backend real e roda o smoke HTTP. Resultado: **11/11 PASSOU**.

## Garantias de segurança respeitadas
- RLS sempre ativo; toda query de negócio passa por `withTenant` com `barbershop_id`.
- Cliente/barbeiro comissionado não acessam custo/lucro/estoque (políticas do banco + módulos não expõem essas colunas).
- Cliente nunca é duplicado (chave `UNIQUE(barbershop_id, phone)` + upsert).

## Hardening pendente (anotado)
- O backend usa o pool **admin** para auth/signup (criar barbearia e ler tabela global `users`). Próximo passo de segurança: role dedicado `auth_svc` com grants mínimos em vez do owner.

## Módulo de Agendamento e Atendimento (implementado e validado — 17/17)

Endpoints (`/api/v1/appointments`):
- `POST /hold` — reserva temporária (anti-corrida). Purga holds vencidos antes (horário expirado **não** bloqueia). Cria `appointment_items` com snapshot de preço/duração/comissão.
- `PATCH /:id/confirm` — `pending_hold`/`scheduled` → `confirmed` (timeline + WS).
- `PATCH /:id/cancel` — exige **motivo** (enum); registra `canceled_by` + timeline.
- `PATCH /:id/reschedule` — novo horário/barbeiro, re-checa overbooking, mantém **histórico** na timeline.
- `POST /walk-in` — lançar cliente na hora; se quem lança é **barbeiro**, o sistema força `barber_id = ele`; upsert de cliente por telefone (anti-duplicidade).
- `PATCH /:id/start` / `PATCH /:id/complete` — finalizar gera **comissão automática** (% configurado), **entrada financeira** (serviço in + comissão out), atualiza CRM do cliente, **timeline** e emite **WebSocket** (`appointment.completed`, `dashboard.updated`).
- `GET /` — agenda (dono vê tudo; **barbeiro vê só a dele via RLS**; cliente **não** acessa → 403).
- `GET /mine` — cliente vê só o próprio histórico.

Modelo de segurança: autorização sempre verificada com o papel real (RLS esconde o que não é do ator); efeitos de sistema que o barbeiro não pode escrever (financeiro/comissão/timeline) rodam em contexto elevado mas **sempre isolado por `barbershop_id`**.

Provas (`apps/backend/test/smoke-appointments.mjs` — **17/17 PASS**): anti-overbooking (409), hold expirado purgado, confirmar, cancelar sem motivo (422)/com motivo, remarcar, walk-in atribuído ao barbeiro, barbeiro só vê a própria agenda, barbeiro não vê/conclui agendamento de outro (RLS → 404), cliente sem agenda interna (403), comissão automática (R$20 = 50% de R$40), financeiro gerado.
Rodar: `powershell -File apps\backend\test\run-appointments.ps1`.

Achados corrigidos nesta etapa: (1) settings padronizadas como `{"value": x}`; (2) `timeline_events.appointment_id` com `ON DELETE SET NULL` + hold não gera timeline (evita FK ao purgar hold); (3) RLS de `customers` ampliada para o barbeiro ver clientes de qualquer agendamento dele (não só os já atendidos); (4) `POST /barbers` agora pode criar o barbeiro com login.

## Financeiro + Dashboard com LUCRO REAL (implementado e validado — 13/13)

Princípio: **o barbeiro trabalha, o sistema pensa.** A finalização do atendimento agora gera **tudo automaticamente**, sem depender da memória do barbeiro:
- **Comissão** (% configurado, congelado no item).
- **Taxa de cartão/método** (de `payment_methods.fee_percentage`) → `payments.fee_amount` + financeiro `card_fee`.
- **Insumos/CMV** (de `service_supplies` × custo do produto) → baixa de estoque + financeiro `supplies`.
- **Fidelidade** (carimba 1 atendimento se programa ativo).
- **CRM** (visitas/última visita/total gasto), **timeline**, **WebSocket**.
- **Cortesia** entra como cortesia (não infla faturamento).

**Lucro Real = Receita − Comissão − Taxa − Insumos** é calculado e devolvido na própria finalização e nos relatórios. Ex.: R$40 no crédito → −R$20 comissão −R$1,40 taxa = **R$18,60 de lucro real** (validado).

Endpoints financeiros (`/api/v1/financial`, dono/gerente; barbeiro e cliente bloqueados):
- `GET /summary` — faturamento bruto, comissão, taxa, insumos, despesas, **lucro real**.
- `GET /dre` — DRE "Lucro Real" linha a linha.
- `GET /transactions` — extrato (comissão/taxa aparecem como **saída**; estorno é lançamento reverso).
- `GET /barber-commissions` — dono vê todos; **barbeiro só as próprias (RLS)**.
- `GET /cashflow` — entradas/saídas/saldo por dia.

Dashboards (`/api/v1/dashboard`):
- `GET /` (dono) — faturamento/lucro do dia, atendimentos, comissões, clientes novos, próximos horários, top serviços, comparativo com ontem, timeline recente.
- `GET /barber` (barbeiro) — serviços do dia, comissão do dia/mês, próximos horários, histórico, **a receber**. Nunca vê o lucro do dono.

Provas (`apps/backend/test/smoke-financial.mjs` — **13/13 PASS**): lucro real correto, dono vê tudo, barbeiro sem lucro (403) e só comissão própria, cliente sem financeiro (403), comissão/taxa como saída, dashboard reflete o atendimento e timeline.
Rodar: `powershell -File apps\backend\test\run-financial.ps1`.

## Status e congelamento
Em vigor o **congelamento de novas features** (sem IA, 360°, campanhas, integrações) até o MVP operável. Gate de produção V1 em `docs/AUDITORIA-PRODUCAO-V1.md` (itens 1–8 aprovados; 9–13 dependem de Docker/VPS).

## Próximos módulos (sequência congelada)
Shop + Carrinho (estados de pedido; só `paid`/`completed` abatem estoque/financeiro) → WhatsApp (fila/outbox) → Caixa (abrir/fechar com conferência) → Frontend mobile-first → roteiro de operação real (30 clientes / 3 barbeiros / 30 dias). Cada um com teste antes de avançar.
