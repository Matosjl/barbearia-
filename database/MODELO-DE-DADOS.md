# Barber SaaS — Modelo de Dados e Regras de Negócio

Documento de arquitetura do banco (PostgreSQL 15+). É a fundação sobre a qual o backend, o tempo real (WebSocket) e o frontend serão construídos. Foi desenhado **multi-tenant e production-ready desde o dia 1**.

Arquivos do schema, na ordem de execução (**01 → 02 → 05 → 03 → 04**):

1. `01_schema.sql` — tabelas, tipos, constraints, índices, função de auditoria.
2. `02_triggers.sql` — triggers de regra de negócio (auditoria, imutabilidade, estoque, status, no-show).
3. `05_improvements.sql` — **idempotência, reserva temporária de horário (slot hold) e Row-Level Security**.
4. `06_extensions.sql` — **RBAC barbeiro comissionado (RLS restritiva), WhatsApp/Evolution, IA/Ollama, timeline, a receber**.
5. `07_whatsapp_crm.sql` — **Central WhatsApp (conversas+mensagens unificadas), etiquetas/selo, segmentação, opt-out, fila com limite, auto-tags**.
6. `08_relational_hardening.sql` — **cobertura RLS total: `barbershop_id` nas filhas, reforço de relacionamentos**.
7. `09_product_media.sql` — **visualizador 360° do produto (`product_media`, `product_viewer_settings`) + correção de visibilidade do Shop para o cliente**.
8. `03_views.sql` — views de relatório/dashboard/DRE.
9. `04_seed.sql` — planos SaaS + barbearia de exemplo.

Ordem de execução: **01 → 02 → 05 → 06 → 07 → 08 → 09 → 03 → 04**.

> **Status: validado.** O schema completo foi executado num PostgreSQL 17 e passou em 15 testes
> (ver seção 7). Inventário: **60 tabelas, 13 views, 59 triggers, 87 policies RLS, 151 índices**.
> Arquitetura Docker em `docs/ARQUITETURA-DOCKER.md`; monorepo em `docs/ESTRUTURA-MONOREPO.md`.
>
> Documentos complementares: `docs/PESQUISA-MERCADO.md` (análise de mercado),
> `docs/FLUXOS-OPERACIONAIS.md` (23 fluxos + matrizes + endpoints) e
> `docs/RELATORIO-RELACIONAL.md` (auditoria de integridade: 0 órfãs operacionais, 149 FKs).

---

## 1. Princípios de arquitetura

| Princípio | Como é garantido |
|---|---|
| Multi-tenant (franquias/unidades) | `accounts` → `barbershops`; **toda** tabela de negócio carrega `barbershop_id`. |
| Nada financeiro é apagado | `deleted_at` (soft delete) + triggers que bloqueiam `DELETE`/`UPDATE` em caixa fechado e transações. |
| Anti-overbooking real | Constraint `EXCLUDE USING gist` no banco — não depende só da aplicação. |
| Auditoria total | Trigger `fn_audit` grava `old_data`/`new_data`/`changed_fields` em `audit_logs`. |
| Dinheiro correto | `NUMERIC(12,2)`, nunca float. |
| Fuso horário | `TIMESTAMPTZ` em tudo; `barbershops.timezone` por unidade. |

---

## 2. Mapa das tabelas por domínio

**SaaS/Tenant:** `plans`, `accounts`, `subscriptions`, `subscription_payments`, `barbershops`, `business_hours`, `business_closures`.

**Identidade/RBAC:** `users`, `memberships` (papel por barbearia: owner/manager/barber/receptionist/customer), `auth_sessions`.

**Profissionais:** `barbers`, `barber_schedules`, `barber_time_off`, `barber_services`.

**Catálogo:** `service_categories`, `services`, `service_supplies` (insumos), `product_categories`, `products`.

**Estoque:** `stock_movements` (kardex append-only; saldo em `products.stock_qty` é mantido por trigger).

**CRM:** `customers`, `customer_favorites`.

**Agenda:** `appointments`, `appointment_items` (combos), `appointment_status_history`.

**Shop:** `orders`, `order_items`.

**Financeiro:** `payments`, `financial_transactions`, `expense_categories`, `cash_registers`, `cash_movements`.

**Comissão:** `commission_rules`, `commissions`.

**Fidelidade:** `loyalty_programs`, `loyalty_cards`, `loyalty_movements`.

**Engajamento:** `goals`, `reviews`, `marketing_campaigns`, `campaign_recipients`, `notifications`, `push_subscriptions`.

**Config/Auditoria:** `settings`, `payment_methods`, `audit_logs`.

---

## 3. Validação das regras de negócio obrigatórias

Cada regra crítica do briefing e **onde o schema a garante**:

### 3.1 Conflito de horário / agenda inteligente (itens 3 e 22)
Garantido pela constraint de banco em `appointments`:

```sql
EXCLUDE USING gist (barber_id WITH =, time_range WITH &&)
  WHERE (status IN ('scheduled','confirmed','in_progress','completed') AND deleted_at IS NULL)
```

`time_range` é uma coluna **gerada** `tstzrange(starts_at, ends_at, '[)')`. Dois agendamentos do mesmo barbeiro que se sobreponham são **rejeitados pelo banco**, mesmo sob concorrência. Cancelado/no-show liberam o horário (saem do `WHERE`). Duração do serviço, intervalo `[)` (fim exclusivo → 7:30+30min libera 8:00) e folgas (`barber_time_off`) entram no cálculo de disponibilidade feito pela aplicação antes do insert.

### 3.2 Cortesia não infla faturamento (itens 8 e 9)
- `appointments.is_courtesy` e `financial_transactions.is_courtesy`.
- Todas as views de receita (`vw_service_revenue`, `vw_daily_pnl`) filtram `is_courtesy = FALSE`. O atendimento grátis **aparece no histórico**, mas **não soma no faturamento**.

### 3.3 Faturamento ≠ lucro; produto desconta custo; comissão é despesa (item 9)
- `orders.cost_total` (CMV) e `order_items.unit_cost` (snapshot do custo).
- `vw_product_revenue.gross_profit = final_total − cost_total`.
- `vw_daily_pnl` = receita − CMV − comissão − demais despesas = **lucro líquido** (DRE simples).
- Comissão sempre lançada em `financial_transactions` como `direction='out', category='commission'`.

### 3.4 Venda só confirma após pagamento (itens 5 e 9)
- Receita de serviço exige `EXISTS payment confirmado` (`vw_service_revenue`).
- Receita de produto só conta com `orders.status IN ('paid','fulfilled')`.

### 3.5 Estoque só vende com saldo; baixa automática (itens 5 e 20)
- Trigger `fn_apply_stock_movement` recalcula `stock_qty` e **lança exceção se ficaria negativo**.
- Toda saída gera `stock_movements` (compra/venda/ajuste/perda/quebra/vencimento/devolução/consumo).
- Insumos por serviço (`service_supplies`) são baixados ao finalizar o atendimento (orquestrado pela aplicação, gerando `stock_movements` com `reason='service_consumption'`).
- Estoque ≤ mínimo dispara `notifications` (consumidas pelo WebSocket → alerta em tempo real).

### 3.6 Cancelamento estorna financeiro e estoque (item 9)
- `financial_transactions.reverses_id` aponta para a transação original; estorno é **nova linha**, nunca update.
- Devolução de estoque = novo `stock_movements` `reason='return', movement_type='in'`.

### 3.7 Caixa imutável após fechado (item 15)
- Trigger `fn_protect_closed_register`: caixa `status='closed'` não aceita `UPDATE`/`DELETE`.
- Índice único `uniq_one_open_register_per_shop`: **só 1 caixa aberto** por barbearia.
- `vw_cash_register_expected` calcula o esperado por método; `difference = contado − esperado` (sobra/falta).
- Erros viram `cash_movements` `movement_type='correction'` — histórico original preservado.

### 3.8 Nada financeiro apagado / soft delete / auditoria (itens 19 e 32)
- `fn_protect_financial_tx` bloqueia delete e alteração de valor/direção/categoria.
- `stock_movements`/`cash_movements` são append-only (`fn_block_mutation`).
- `fn_audit` grava cada INSERT/UPDATE/DELETE com valor antigo e novo em `audit_logs`, incluindo o usuário (lido de `app.current_user_id`).

### 3.9 Comissão automática e avançada (itens 7 e 23)
- `commission_rules` cobre os 4 tipos: `flat`, `per_service`, `per_product`, `goal_bonus`.
- `commissions` registra cada apuração (base, %, valor, competência), com status `accrued/paid/canceled`.
- `appointment_items` congela `commission_pct`/`commission_amount` no ato (snapshot histórico).

### 3.10 Fidelidade configurável (item 8)
- `loyalty_programs`: `required_count`, `reward_service_id`, `only_paid_counts`, `reward_generates_commission`.
- `loyalty_cards` (saldo do ciclo) + `loyalty_movements` (carimbos/resgates).

### 3.11 No-show e bloqueio automático (item 17)
- Status `no_show`; trigger `fn_customer_counters` incrementa `customers.no_show_count`.
- Bloqueio automático ao atingir `settings.no_show_block_threshold`; `fn_block_appointment_for_blocked_customer` impede novo agendamento (liberável via pré-pagamento com `app.bypass_block`).

### 3.12 Ciclo de status válido (itens 4 e 17)
- `fn_appointment_status_guard` valida transições (`scheduled→confirmed→in_progress→completed`; cancelamento/no-show a partir de estados abertos; `completed` é terminal) e grava `appointment_status_history`.

---

## 4. Multi-barbearia e SaaS (itens 28 e 29)
- `accounts.plan_id` + `plans.max_barbers`/`max_units` controlam limites por plano (Básico/Pro/Premium).
- `subscriptions` + `subscription_payments` controlam vigência, status e inadimplência (bloqueio quando `past_due`).
- Dashboard consolidado de franquia = agregação por `account_id` sobre as `barbershops`.

---

## 5. Tempo real (WebSocket) — itens 11 e 33
Os eventos do briefing mapeiam para mudanças observáveis no banco; a camada Socket.io emite a partir delas:

| Evento | Origem no banco |
|---|---|
| Novo/cancelado/confirmado agendamento | `appointments` INSERT/UPDATE status |
| Cliente chegou / serviço finalizado | `appointments.status` = `in_progress`/`completed` |
| Nova venda no Shop / pagamento confirmado | `orders`, `payments` |
| Estoque baixo | `notifications` type `low_stock` (gerado por trigger) |
| Caixa/Dashboard atualizado | `cash_*`, views de PnL |

Recomendação: emitir eventos a partir dos **use cases** (após COMMIT) e/ou via `LISTEN/NOTIFY` do Postgres para os triggers que já existem (ex.: `low_stock`).

---

## 6. Melhorias propostas (gaps que identifiquei no briefing)

Itens que **não estavam explícitos** mas são necessários para produção — recomendo incluir antes de codar:

1. **Idempotência de pagamento/pedido.** Adicionar `idempotency_key` único em `orders`/`payments` para evitar cobrança/baixa duplicada em retries de rede (mobile cai muito). *Sugestão: coluna `TEXT UNIQUE`.*
2. **Reserva temporária de horário (hold).** Entre escolher o horário e confirmar, o slot deve ficar "segurado" por X minutos para evitar corrida entre dois clientes. *Sugestão: status `pending_hold` + `expires_at`, ou tabela `slot_holds`.*
3. **Política de cancelamento/antecedência.** Cancelar com menos de N horas pode gerar taxa/perder crédito. *Sugestão: `settings` `cancel_window_hours` + regra na app.*
4. **Carteira de créditos com extrato.** Já existe `customers.credits_balance`; falta o livro-razão. *Sugestão: tabela `credit_movements` (append-only) — mesma filosofia do financeiro.*
5. **Sinal/pré-pagamento (deposit).** Para clientes com histórico de falta. Liga-se ao item 17. *Sugestão: `appointments.deposit_amount` + `payments` vinculado.*
6. **Row-Level Security (RLS).** Isolamento multi-tenant forte no próprio banco (`barbershop_id = current_setting('app.barbershop_id')`). Fortemente recomendado para SaaS.
7. **Tabela de feriados por unidade** já incluída (`business_closures`) — confirmá-la no fluxo de disponibilidade.
8. **Webhooks/integração WhatsApp** (item 18): tabela `message_log` para rastrear envio/entrega/resposta dos lembretes 24h/2h e os botões confirmar/remarcar/cancelar.
9. **Particionamento futuro** de `audit_logs`/`notifications`/`stock_movements` por mês quando o volume crescer (já são append-only, ideal para partição por data).
10. **Versão fiscal (futuro).** Campos para NFC-e/emissor caso a barbearia precise emitir nota — deixar `orders`/`payments` extensíveis via `JSONB metadata`.

Itens 1, 2 e 6 são os que eu **recomendo fortemente** já no MVP, porque mexem na modelagem e são caros de retrofitar depois.

### 6.1 Melhorias 1, 2 e 6 — IMPLEMENTADAS (`05_improvements.sql`)

**(1) Idempotência.** Coluna `idempotency_key` em `orders`, `payments` e `appointments`, com índice único parcial por barbearia. A app envia uma chave por operação; o banco rejeita a 2ª gravação com a mesma chave (retry de rede não duplica cobrança/baixa).

**(2) Reserva temporária (slot hold).** Em vez de um segundo mecanismo de overlap, reaproveito a constraint anti-overbooking: um hold é um `appointment` em status `pending_hold` com `hold_expires_at`, já incluído no `WHERE` do `EXCLUDE`. Logo, **o hold reserva o horário no próprio banco** durante a janela de confirmação. Holds vencidos são removidos por `fn_expire_slot_holds()` (job a cada 1 min). Transições válidas: `pending_hold → scheduled/confirmed/canceled`. Expiração de hold **não** conta como cancelamento/falta do cliente.

**(6) Row-Level Security.** RLS habilitado em todas as tabelas com `barbershop_id` (35 policies), isolando por `current_setting('app.barbershop_id')`. O backend conecta como o role `barber_app` (sujeito às policies) e roda cada requisição dentro de transação com `SET LOCAL app.barbershop_id` e `SET LOCAL app.current_user_id`. Superuser/owner ignoram RLS, então migrações e seed funcionam normalmente.

---

## 7. Verificação (smoke test — APROVADO)

O schema completo foi executado em **PostgreSQL 17** numa instância temporária e descartável.
Resultado em `smoke_result.txt`. Todos os scripts aplicaram sem erro e os seguintes testes
funcionais **passaram**:

| Teste | O que valida | Resultado |
|---|---|---|
| anti-overbooking | 2º agendamento sobreposto do mesmo barbeiro é rejeitado | PASS |
| slot-hold | um `pending_hold` reserva o horário e bloqueia outro agendamento | PASS |
| estoque não-negativo | venda acima do saldo é bloqueada | PASS |
| caixa imutável | `UPDATE` em caixa fechado é bloqueado | PASS |
| RLS multi-tenant | `barber_app` só enxerga linhas da barbearia do contexto | PASS |
| idempotência | pedido com `idempotency_key` repetida é rejeitado | PASS |
| expurgo de holds | `fn_expire_slot_holds()` remove holds vencidos | PASS |

### Como rodar você mesmo no Windows

Há um script pronto que sobe um Postgres temporário, aplica tudo, testa e limpa:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\BarberProject\database\smoke_test.ps1"
# resultado detalhado em: C:\BarberProject\database\smoke_result.txt
```

Para aplicar no **seu banco real** (psql está em `C:\Program Files\PostgreSQL\17\bin`):

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
createdb -U postgres barber
psql -U postgres -d barber -v ON_ERROR_STOP=1 `
  -f 01_schema.sql -f 02_triggers.sql -f 05_improvements.sql -f 03_views.sql -f 04_seed.sql
```

---

## 8. Próximos passos (sua lista de prioridades)

Concluído o item **1 (Banco de dados completo)** e o **2 (Regras de negócio)**. Próximos na ordem que você definiu:

3. **Fluxos operacionais** — diagramas de sequência (agendar, finalizar atendimento, vender no Shop, fechar caixa).
4. **APIs** — contrato REST + eventos WebSocket por módulo.
5. **UX/UI** — wireframes mobile-first (área cliente + painel).
6. **Estrutura do projeto** — monorepo backend/frontend.
7. **MVP** — implementação das 14 funcionalidades iniciais.
8. **Desenvolvimento incremental** dos módulos avançados.
