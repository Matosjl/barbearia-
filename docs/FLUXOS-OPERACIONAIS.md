# Fluxos Operacionais — Barber SaaS

Documento técnico dos fluxos principais, regras de negócio e contratos de API. Base para implementação. Convenções:

- **$$ → financeiro**: cria registro em `financial_transactions`.
- **📦 → estoque**: cria `stock_movements`.
- **💈 → comissão**: gera `commissions`.
- **📲 → WhatsApp**: enfileira em `message_outbox` (Evolution API).
- **🕓 → timeline**: cria `timeline_events`.
- **🔴 → tempo real**: emite evento WebSocket (atualiza dashboard/agenda).

Toda requisição roda dentro de transação com contexto multi-tenant:

```
BEGIN;
SET LOCAL app.barbershop_id = '<uuid>';
SET LOCAL app.current_user_id = '<uuid>';
SET LOCAL app.role = 'owner|manager|barber|receptionist|customer';
SET LOCAL app.barber_id = '<uuid>';     -- quando role=barber
SET LOCAL app.customer_id = '<uuid>';   -- quando role=customer
-- ... queries ...
COMMIT;
```

Autenticação: JWT com `barbershop_id`, `role`, `barber_id`/`customer_id` no payload. O middleware traduz o token nos `SET LOCAL` acima — **o cliente nunca informa esses IDs no corpo**.

---

## 1. Agendamento com reserva temporária de horário

**Quem:** cliente (app) ou recepção. **Objetivo:** marcar sem corrida entre dois clientes.

Passos:
1. Cliente escolhe serviço(s) → profissional → data.
2. Backend calcula **slots disponíveis**: cruza `business_hours`, `barber_schedules`, `barber_time_off`, duração somada dos serviços e agendamentos ativos (incl. `pending_hold`).
3. Cliente escolhe o horário → backend cria `appointment` em **`pending_hold`** com `hold_expires_at = now() + 5min`. A constraint anti-overbooking **reserva o slot no banco**. 🔴🕓
4. Cliente revisa e confirma dentro da janela → vai para o Fluxo 2.
5. Se não confirmar, `fn_expire_slot_holds()` (job 1/min) remove o hold e o slot volta a ficar livre. 🔴

Regras: hold dura X min (config `hold_minutes`); um cliente bloqueado por faltas só passa do passo 3 com sinal (ver Fluxo 17/no-show). Sem sobreposição — garantido por `EXCLUDE`.

**API**
- `GET  /shops/{slug}/availability?barberId=&serviceIds=&date=` → lista de slots.
- `POST /appointments/hold` `{barberId, serviceIds, startsAt}` → cria `pending_hold`, retorna `appointmentId, holdExpiresAt`.
- `DELETE /appointments/{id}/hold` → libera manualmente.
- WS: `appointment.hold_created`, `appointment.hold_released`.

## 2. Confirmação pelo cliente

1. Cliente confirma o hold → `PATCH /appointments/{id}/confirm`.
2. Backend valida que o hold não expirou e muda status `pending_hold → scheduled` (ou `confirmed`), zera `hold_expires_at`. 🕓🔴
3. Enfileira confirmação no WhatsApp (template `appt_confirm`). 📲
4. Agenda lembretes futuros (`appt_reminder` 24h e 2h antes) em `message_outbox` com `scheduled_at`. 📲

Regras: se o hold expirou, retornar 409 e oferecer novo horário. Confirmação NÃO gera financeiro (pagamento só no atendimento, salvo sinal).

**API**
- `PATCH /appointments/{id}/confirm` → `scheduled`/`confirmed`.
- WS: `appointment.confirmed`.

## 3. Cancelamento e remarcação

**Cancelamento:**
1. `PATCH /appointments/{id}/cancel` `{reason}` (motivo obrigatório: `customer_gave_up|customer_no_show|scheduling_error|internal_problem|other`).
2. Status → `canceled`, grava `canceled_by`, `canceled_at`, motivo. `fn_customer_counters` incrementa `cancel_count`. 🕓🔴
3. Se havia sinal/pagamento, dispara estorno (Fluxo 14). $$📦(se aplicável)
4. WhatsApp `appt_cancel`. 📲 Libera o slot → pode promover waitlist. 🔴

**Remarcação:**
1. `PATCH /appointments/{id}/reschedule` `{newStartsAt, barberId?}`.
2. Backend tenta inserir no novo horário (mesma checagem anti-overbooking). Em sucesso, atualiza `starts_at/ends_at`; em conflito, 409.
3. WhatsApp `appt_reschedule`. 📲🕓🔴

Regras: cancelar/remarcar com < `cancel_window_hours` pode gerar taxa/perda de sinal (config). Histórico preservado em `appointment_status_history`.

**API**
- `PATCH /appointments/{id}/cancel`, `PATCH /appointments/{id}/reschedule`.
- WS: `appointment.canceled`, `appointment.rescheduled`.

## 4. Cliente que chegou na hora (walk-in)

**Quem:** recepção, dono **ou barbeiro comissionado**.

1. `POST /appointments/walk-in` `{customerName, phone, serviceIds, barberId?, paymentMethod?, amount?, notes?}`.
2. Backend faz **upsert do cliente** por `(barbershop_id, phone)` — cliente novo é salvo automaticamente. 🕓
3. Cria `appointment` com `origin='walk_in'`, status `in_progress` (ou `scheduled` se vai aguardar).
4. **Regra de atribuição:** se quem lança é `role=barber`, o backend **força `barber_id = app.barber_id`** (ignora qualquer barberId do corpo). 💈(no fim, Fluxo 7)
5. Segue para finalização (Fluxo 6).

Regras: anti-overbooking também vale para walk-in. Todo walk-in cria/atualiza ficha do cliente.

**API**
- `POST /appointments/walk-in` → cria e já inicia atendimento.
- WS: `appointment.created`, `appointment.checked_in`.

## 5. Barbeiro comissionado lançando atendimento

Caso especial do Fluxo 4 com **RBAC restrito** (ver Fluxo 19):
1. Barbeiro autenticado (`role=barber`) abre "+ Lançar cliente".
2. `POST /appointments/walk-in` — backend seta `barber_id = app.barber_id` automaticamente.
3. Ao finalizar (Fluxo 6), comissão é calculada pelas **regras do dono** (`commission_rules`/`barber_services`), não por valores que o barbeiro escolha. 💈
4. O barbeiro vê o atendimento e a comissão na própria área (`vw_barber_appointments`, `vw_barber_receivables`); **não** vê lucro do dono nem financeiro. (RLS)

Regras: barbeiro nunca define o próprio % de comissão; só o dono. RLS garante isolamento mesmo se a app falhar.

## 6. Finalização do atendimento

Operação transacional (tudo ou nada):
1. `PATCH /appointments/{id}/complete` `{paymentMethod, discount?, paidAmount}`.
2. Valida transição (`in_progress → completed`). 🕓
3. Para cada `appointment_item`: calcula `commission_amount` pela regra vigente (Fluxo 7). 💈
4. **Baixa de insumos** (`service_supplies`) → cria `stock_movements` `reason='service_consumption'`. 📦
5. Cria `payment` (Fluxo 11) e `financial_transactions` (entrada de serviço). $$
6. Atualiza CRM do cliente: `visits_count++`, `last_visit_at`, `total_spent += final_total`.
7. Carimba fidelidade (Fluxo 8). 
8. WhatsApp pós-atendimento `post_service` + pedido de avaliação. 📲
9. Atualiza dashboard. 🔴🕓

Regras: **cortesia (`is_courtesy=true`) não entra no faturamento** (mas registra). Venda só "conta" após pagamento confirmado.

**API**
- `PATCH /appointments/{id}/start` → `in_progress`.
- `PATCH /appointments/{id}/complete` → executa 3–9 em transação.
- WS: `appointment.completed`, `dashboard.updated`.

## 7. Cálculo de comissão

Resolução de regra (prioridade): `barber_services.commission_pct` (por barbeiro+serviço) → `commission_rules` (`per_service`/`flat`) → `barbers.default_service_commission_pct`. Produto: `per_product`/`default_product_commission_pct`.

1. Base = valor do item (serviço) ou linha (produto), líquido de desconto.
2. `commission_amount = base * pct`. Congela `commission_pct`/`commission_amount` no `appointment_item`/`order_item`. 💈
3. Cria `commissions` (`status='accrued'`, `reference_month`).
4. Lança `financial_transactions` `direction='out', category='commission'`. $$
5. **Meta/bônus** (`goal_bonus`): job mensal verifica se o barbeiro bateu `goal_amount`; se sim, gera `commissions` `source_type='bonus'`. 💈$$
6. Cortesia: gera comissão só se `loyalty_programs.reward_generates_commission=true`.

**API**
- `GET /barbers/{id}/commissions?period=` → extrato.
- `GET /barbers/{id}/receivables` → `vw_barber_receivables`.

## 8. Cartão fidelidade

1. Ao finalizar serviço pago (Fluxo 6): se `loyalty_programs.is_active`, faz upsert de `loyalty_cards` e cria `loyalty_movements` `earn (+1)`. (Só conta serviço pago se `only_paid_counts`.) 🕓
2. Ao atingir `required_count`: `rewards_earned++`; cliente pode resgatar.
3. **Resgate:** próximo atendimento marcado como `is_courtesy=true`, `loyalty_movements` `redeem (-required)`. Registrado no histórico e no financeiro **como cortesia (não soma faturamento)**. 📲(`loyalty_reward`)

Regras: cortesia gera comissão só se configurado. Resgate não infla DRE.

**API**
- `GET /customers/{id}/loyalty` → saldo/cartão.
- `POST /appointments/{id}/redeem-loyalty` → marca cortesia.

## 9. Venda no Shop

1. Cliente monta carrinho (`orders.status='cart'`) → `POST /orders` / `POST /orders/{id}/items`.
2. **Regra:** só adiciona item se `products.stock_qty >= quantity`.
3. Cliente escolhe pagamento → `POST /orders/{id}/checkout` `{paymentMethod, idempotencyKey}` → status `pending_payment`. 🕓🔴(notifica dono)
4. Dono confirma pagamento (Fluxo 11) → status `paid`.
5. **Baixa de estoque** automática (Fluxo 10). 📦
6. Lança financeiro (entrada de produto) e calcula lucro = venda − custo (snapshot `unit_cost`). $$
7. Comissão de produto ao vendedor, se houver (Fluxo 7). 💈
8. Status `fulfilled` na entrega. 📲🔴

Regras: `idempotency_key` evita pedido/baixa duplicados. Cancelamento estorna (Fluxo 14).

**API**
- `POST /orders`, `POST /orders/{id}/items`, `POST /orders/{id}/checkout`, `POST /orders/{id}/confirm-payment`, `POST /orders/{id}/fulfill`.
- WS: `order.created`, `order.paid`, `order.fulfilled`, `stock.low` (se aplicável).

## 10. Baixa de estoque

Toda saída/entrada cria `stock_movements`; `products.stock_qty` é mantido por trigger `fn_apply_stock_movement` (e **bloqueia saldo negativo**). 📦

Gatilhos de movimentação:
- Venda confirmada (Shop/balcão) → `out/sale`.
- Consumo de insumo ao finalizar serviço → `out/service_consumption`.
- Compra/reposição → `in/purchase` (com `unit_cost` p/ CMV).
- Ajuste/perda/quebra/vencimento/devolução → tipos correspondentes.

Ao atingir `min_stock_qty` → cria `notifications` `low_stock` (trigger) → 🔴 alerta no painel do dono.

**API**
- `POST /products/{id}/stock-movements` `{type, reason, quantity, unitCost?, notes?}`.
- `GET /products?lowStock=true`.
- WS: `stock.movement`, `stock.low`.

## 11. Pagamento confirmado

1. `POST /payments` `{appointmentId|orderId, method, amount, fee?, idempotencyKey}`.
2. Cria `payment` (`status='confirmed'`), vincula ao **caixa aberto** (`cash_register_id`). 🕓
3. Cria `financial_transactions` de entrada (`category='service'|'product'`). $$
4. Se método é cartão, `fee_amount` calcula `net_amount`.
5. Marca origem como paga (`appointments`/`orders`). 🔴(dashboard, caixa)

Regras: pagamento exige caixa aberto (senão 409 "abra o caixa"). `idempotency_key` único por barbearia. Pagamento confirmado é pré-condição para a venda contar como faturamento.

**API**
- `POST /payments`, `POST /orders/{id}/confirm-payment`.
- WS: `payment.confirmed`, `cash.updated`, `dashboard.updated`.

## 12. Caixa diário (operação)

1. **Abertura:** `POST /cash-registers` `{openingAmount}` → cria `cash_registers` `status='open'` (só 1 aberto por barbearia — índice único). 🕓🔴
2. Durante o dia: pagamentos vinculam-se ao caixa; sangria/suprimento via `cash_movements`. 🕓🔴
3. `POST /cash-registers/{id}/movements` `{type: withdrawal|supply|extra_in|extra_out, amount, method, description}`.

Regras: sem caixa aberto, pagamentos em dinheiro ficam bloqueados (config). Movimentos são append-only.

**API**
- `POST /cash-registers`, `GET /cash-registers/current`, `POST /cash-registers/{id}/movements`.
- WS: `cash.opened`, `cash.movement`.

## 13. Fechamento de caixa

1. `POST /cash-registers/{id}/close` `{countedCash, countedPix, countedDebit, countedCredit}`.
2. Backend calcula esperado por método (`vw_cash_register_expected` + sangrias/suprimentos) e `difference = informado − esperado` (sobra/falta). 🕓🔴
3. Status → `closed`. **Imutável a partir daqui** (trigger `fn_protect_closed_register`).
4. Erros depois disso → `cash_movements` `correction` (Fluxo 14); nunca editar o fechado.

**API**
- `POST /cash-registers/{id}/close` → retorna conferência (esperado/informado/diferença).
- `GET /cash-registers/{id}` (histórico). WS: `cash.closed`.

## 14. Estorno / correção financeira

1. Cancelamento de venda/atendimento pago, ou erro de lançamento.
2. Cria **nova** `financial_transactions` `category='refund'|'correction'`, `reverses_id = <original>`. **Nunca** edita/apaga o original. $$
3. Se houve baixa de estoque, cria `stock_movements` `return (in)`. 📦
4. Comissão associada → `commissions.status='canceled'` e contra-lançamento. 💈$$
5. Caixa fechado → correção via `cash_movements correction`. 🕓🔴

Regras: imutabilidade garantida por triggers (`fn_protect_financial_tx`). Auditoria registra tudo (`audit_logs`).

**API**
- `POST /financial/refunds` `{originalTransactionId, reason}`.
- `POST /cash-registers/{id}/corrections`.
- WS: `finance.reversed`, `dashboard.updated`.

## 15. WhatsApp via Evolution API

**Saída (outbox):**
1. Eventos de negócio enfileiram `message_outbox` (com template renderizado + `idempotency_key`). 📲
2. Worker pega `status='queued'` com `scheduled_at <= now()` → chama `POST {api_url}/message/sendText/{instance}` com a `api_key`.
3. Atualiza `status` (sending→sent) e `provider_message_id`.
4. **Webhook** da Evolution atualiza `delivered/read/failed`. 🔴

**Entrada (inbox):**
5. `POST /webhooks/evolution/{barbershopId}` recebe respostas/botões → grava `message_inbox`, deduz `intent` (confirm/reschedule/cancel) → dispara o fluxo correspondente. 🔴🕓

Disparam WhatsApp: confirmação (F2), lembrete 24h/2h (F2), remarcação/cancelamento (F3), pós-atendimento (F6), fidelidade (F8), inativo 30/45/60/90 + aniversário + promoção (F16/F17).

**API**
- `POST /whatsapp/instances`, `GET /whatsapp/instances/{id}/qrcode`, `GET /whatsapp/status`.
- `POST /webhooks/evolution/{barbershopId}` (público, validado por assinatura).
- `POST /messages/send` (manual). WS: `message.status`.

## 16. CRM — cliente inativo

1. Job diário recalcula segmentos (`new/frequent/vip/inactive`) e `last_visit_at` (`vw_inactive_customers`). 🕓
2. Cliente sem visita há 30/45/60/90 dias entra em fila de reativação por faixa.
3. IA sugere a mensagem (Fluxo 17) → dono aprova → enfileira WhatsApp por faixa (`inactive_30...90`). 📲
4. Aniversariantes do dia → `birthday`. VIPs → `promo`.

Regras: IA **sugere**, humano **aprova** (anti-spam). Opt-out respeitado.

**API**
- `GET /customers/segments?type=inactive&days=45`.
- `POST /campaigns` `{segment, templateKey, scheduleAt}` → cria `marketing_campaigns` + `campaign_recipients` + outbox.
- WS: `campaign.progress`.

## 17. IA com Ollama (sugestões, alertas, campanhas)

1. Schedulers criam `ai_jobs` (`revenue_forecast`, `churn_scan`, `weak_hours`, `top_barber`, `movement_drop`, `campaign_suggestion`, `message_suggestion`, `frequency_analysis`).
2. Worker monta o prompt a partir de **dados agregados das views** e chama Ollama (`POST /api/generate` ou `/api/chat`) com **structured output (JSON Schema)**.
3. Saída validada vira:
   - `ai_insights` (alertas/previsões para o dashboard). 🔴
   - `ai_suggestions` (rascunhos de mensagem/campanha/promoção; `status='draft'`).
4. Dono revisa em `GET /ai/suggestions` → aceita → vira campanha/mensagem (Fluxo 16/15). 📲

Regras: IA roda **local** (dado não sai da infra). IA **nunca** envia WhatsApp sozinha. Insights de "queda de movimento" geram alerta `critical`.

**IA para campanhas (Central WhatsApp):** a partir do público escolhido, a IA gera (em `ai_suggestions`): texto da campanha + **variações** (curta, persuasiva, tom profissional, tom descontraído), **sugestão de melhor público**, **sugestão de melhor horário de envio** e, após o disparo, **análise do resultado** (entregues/lidas/conversão) com recomendação para a próxima. Tudo como rascunho — o dono aprova antes de virar `marketing_campaigns`.

**API**
- `POST /ai/jobs` `{type, params}`; `GET /ai/insights`; `GET /ai/suggestions`; `PATCH /ai/suggestions/{id}` `{status}`.
- WS: `ai.insight_created`, `ai.suggestion_created`.

## 18. Timeline operacional

1. Cada evento relevante grava `timeline_events` (`event_type`, `summary`, `payload`, `barber_id`). 🕓
2. `GET /timeline?since=` retorna o feed; WebSocket faz push em tempo real. 🔴
3. **RLS:** dono/gerente veem tudo; barbeiro vê só o próprio feed (`barber_id = app.barber_id`).

Entram na timeline: agendamento criado/confirmado/cancelado/no-show, check-in, atendimento finalizado, venda paga, caixa aberto/fechado, sangria/suprimento, estoque baixo, comissão apurada, insight de IA.

**API**
- `GET /timeline?barberId=&since=`. WS: `timeline.event`.

## 19. Permissões por perfil (dono, barbeiro comissionado, cliente)

Camada dupla: (a) checagem na app por `role`/escopo; (b) **RLS no banco** (defesa em profundidade).

| Recurso | Owner/Manager | Barbeiro comissionado | Cliente | Recepção |
|---|---|---|---|---|
| Dashboard/lucro | ✅ | ❌ | ❌ | parcial |
| Financeiro completo | ✅ | ❌ | ❌ | ❌ |
| Estoque geral | ✅ | ❌ | ❌ | leitura |
| Config da barbearia | ✅ | ❌ | ❌ | ❌ |
| Relatórios admin | ✅ | ❌ | ❌ | ❌ |
| Outros barbeiros | ✅ | ❌ | ❌ (só p/ escolher) | ✅ |
| Próprios agendamentos | ✅ | ✅ | ✅ (os dele) | ✅ |
| Próprios atendimentos/serviços | ✅ | ✅ | — | ✅ |
| Próprias comissões / a receber | ✅ | ✅ | ❌ | ❌ |
| Clientes que atendeu | ✅ (todos) | ✅ (só os dele) | — | ✅ |
| Lançar walk-in | ✅ | ✅ (atribui a si) | ❌ | ✅ |
| Shop / fidelidade / perfil | ✅ | — | ✅ | — |

Implementação: policies RESTRICTIVE em `06_extensions.sql` usando `app.role` + `app.barber_id`/`app.customer_id`. Tabelas sensíveis negam `barber`/`customer`; `appointments`/`commissions`/`customers`/`timeline_events` filtram por dono da linha.

**API**: o mesmo endpoint retorna escopos diferentes conforme o token; ex. `GET /appointments` devolve todos (owner) ou só os do barbeiro (barber). Tentativa de acessar recurso fora do escopo → 403 na app e 0 linhas via RLS.

## 20. RLS / multi-tenant — isolamento entre barbearias

1. Toda tabela de negócio tem `barbershop_id` e policy permissiva `tenant_isolation` (`barbershop_id = app_current_barbershop()`).
2. Backend conecta como role `barber_app` (sujeito a RLS); **migrações/seed** rodam como owner (bypass).
3. Cada request: `SET LOCAL app.barbershop_id` a partir do JWT. Sem o contexto, RLS retorna 0 linhas (fail-safe).
4. Sobre o tenant, as policies RESTRICTIVE do Fluxo 19 aplicam o recorte por papel.

Resultado: uma barbearia **nunca** lê/escreve dados de outra, mesmo com bug na aplicação. Pronto para franquias/multi-unidade (dashboard consolidado agrega por `account_id`).

**API**: middleware de tenant injeta os `SET LOCAL`; webhooks recebem `barbershopId` na rota e o resolvem antes de qualquer query.

## 21. Central de WhatsApp (CRM interno)

Aba estilo "WhatsApp CRM" usando Evolution API. **Quem:** dono/gerente (barbeiro só com permissão — Fluxo 19/23).

**Contatos e conversas:**
1. `GET /whatsapp/contacts?filter=...` lista clientes (todos ou filtrados) com etiquetas, último atendimento, valor gasto, barbeiro, fidelidade, verificado.
2. `GET /whatsapp/conversations` lista conversas (`whatsapp_conversations`) ordenadas por `last_message_at`, com `unread_count`.
3. `GET /whatsapp/conversations/{id}/messages` mostra o histórico (`whatsapp_messages`, in/out) com status (pendente/enviada/entregue/lida/falhou). 🔴

**Mensagem individual:**
4. `POST /whatsapp/conversations/{id}/messages` `{body, idempotencyKey}` → cria `whatsapp_messages` `direction=out, status=pendente`; worker envia via Evolution; webhook atualiza status. 📲🕓🔴

**Filtros disponíveis** (combináveis): todos · por etiqueta · por letra inicial (ordem alfabética) · por último atendimento · por frequência · por valor gasto · por barbeiro que atendeu · por serviço realizado · por aniversário · por fidelidade (cartão quase completo) · por status verificado · inativos 30/45/60/90.

**Webhook de entrada:** `POST /webhooks/evolution/{barbershopId}` grava `whatsapp_messages direction=in`, atualiza `whatsapp_conversations`, deduz `intent` (confirm/reschedule/cancel/**stop**). `stop` → seta `customers.marketing_opt_out` + `customer_consent_history`. 🔴

**Regras:** opt-out nunca recebe campanha (`vw_campaign_audience` exclui). Barbeiro comissionado **não** acessa a Central a menos que `settings.allow_barber_whatsapp=true`, e mesmo assim só conversa com clientes que **ele** atendeu (RLS).

**API**: `GET /whatsapp/contacts`, `GET /whatsapp/conversations`, `GET/POST /whatsapp/conversations/{id}/messages`, `POST /customers/{id}/opt-out`. WS: `whatsapp.message_in`, `whatsapp.message_status`, `conversation.updated`.

## 22. Campanhas em massa segmentadas

1. Dono monta o público via **`segment_filter` (JSON composto)** — ex.: inativos há 60 dias **E** etiqueta `cliente_fiel` **E** atendidos pelo barbeiro Carlos.
2. `POST /campaigns` cria `marketing_campaigns` (status `draft`), resolve a audiência por `vw_campaign_audience` + filtros, e gera `campaign_recipients` (sem duplicar cliente). 🕓
3. Dono revisa e aprova → `approved_by/approved_at`, status `scheduled`.
4. Worker enfileira `whatsapp_messages` (status `pendente`) respeitando **`rate_limit_per_min` e `daily_cap`** (anti-bloqueio) + `scheduled_at` escalonado (**fila**). 📲
5. Status de cada destinatário acompanha a mensagem: pendente → enviada → entregue → lida / falhou / optout. 🔴
6. `GET /campaigns/{id}/report` consolida entregues/lidas/falhas e (Fluxo 17) a IA analisa o resultado.

**Públicos suportados** (itens 5–13 do pedido): por filtros, por etiqueta, por ordem alfabética, fiéis/verificados, inativos, aniversariantes, cartão fidelidade quase completo, gasto acima de R$ X, sem voltar há 30/45/60/90 dias.

**Regras:** barbeiro comissionado **não dispara** campanha em massa (RLS nega). Toda campanha tem histórico (`marketing_campaigns` + `campaign_recipients` + `whatsapp_messages`). IA só sugere; dono aprova.

**API**: `POST /campaigns`, `POST /campaigns/{id}/approve`, `POST /campaigns/{id}/send`, `GET /campaigns/{id}/report`, `GET /campaigns/audience/preview?filter=`. WS: `campaign.progress`, `campaign.finished`.

## 23. Etiquetas / selo de cliente

1. **Catálogo** (`customer_tags`): etiquetas do sistema (cliente fiel, VIP, verificado, inativo, novo, recorrente, alto valor, sumido, aniversário, comprador) + personalizadas do dono.
2. **Manual:** `POST /customers/{id}/tags` / `DELETE /customers/{id}/tags/{tagId}` (dono/gerente). 🕓
3. **Automática:** `fn_recompute_customer_tags(shop)` aplica por regra (job diário + após finalizar atendimento/venda): >10 visitas→fiel; ≥R$500→VIP; 60 dias→inativo; telefone validado→verificado; comprou no Shop→comprador; etc.
4. Etiquetas alimentam segmentação de campanha (Fluxo 22), filtros da Central (Fluxo 21), CRM e relatórios.

**Regras:** etiqueta não duplica (`UNIQUE(customer_id, tag_id)`); auto e manual coexistem (`source`). Barbeiro vê etiquetas só dos clientes que atendeu.

**API**: `GET /tags`, `POST /tags`, `POST/DELETE /customers/{id}/tags`, `POST /tags/recompute`. WS: `customer.tagged`.

---

## Matrizes-resumo (cross-cutting)

### A) Ações que criam registro FINANCEIRO ($$)
Pagamento confirmado de serviço (F6/F11) · pagamento de produto (F9/F11) · comissão apurada — saída (F7) · despesas (aluguel/luz/etc.) · taxa de cartão · estorno/correção (F14) · cortesia (registra como `is_courtesy`, **não** soma faturamento) · repasse de comissão pago (F7).

### B) Ações que criam MOVIMENTAÇÃO DE ESTOQUE (📦)
Venda confirmada no Shop/balcão (F9) · consumo de insumo ao finalizar serviço (F6) · compra/reposição · ajuste/perda/quebra/vencimento · devolução por estorno (F14) · carga inicial.

### C) Ações que geram COMISSÃO (💈)
Finalização de serviço (F6/F7) · venda de produto com vendedor (F9) · bônus por meta batida (F7) · cortesia **apenas** se `reward_generates_commission=true` (F8).

### D) Ações que disparam WHATSAPP (📲)
Confirmação (F2) · lembrete 24h/2h (F2) · remarcação e cancelamento (F3) · pós-atendimento/avaliação (F6) · resgate de fidelidade (F8) · inativo 30/45/60/90, aniversário, promoção (F16) · campanha aprovada da IA (F17) · mensagem individual da Central (F21) · campanha em massa segmentada (F22). Sempre via `whatsapp_messages` (fila, com `rate_limit_per_min`/`daily_cap`), nunca para quem deu opt-out.

### E) Ações que entram na TIMELINE (🕓)
Criação/confirmação/cancelamento/no-show de agendamento · check-in · atendimento finalizado · venda paga · abertura/fechamento de caixa · sangria/suprimento · estoque baixo · comissão apurada · insight de IA.

### F) Ações que atualizam o DASHBOARD em tempo real (🔴 WebSocket)
Novo/cancelado/confirmado agendamento · check-in · serviço finalizado · nova venda · pagamento confirmado · estoque baixo · caixa aberto/movimentado/fechado · estorno · insight de IA · qualquer mudança que afete faturamento/lucro/ticket do dia.

### Catálogo de eventos WebSocket (namespace por barbearia)
`appointment.hold_created` · `appointment.hold_released` · `appointment.created` · `appointment.confirmed` · `appointment.checked_in` · `appointment.completed` · `appointment.canceled` · `appointment.rescheduled` · `order.created` · `order.paid` · `order.fulfilled` · `payment.confirmed` · `stock.movement` · `stock.low` · `cash.opened` · `cash.movement` · `cash.closed` · `finance.reversed` · `commission.accrued` · `timeline.event` · `ai.insight_created` · `ai.suggestion_created` · `message.status` · `dashboard.updated` · `whatsapp.message_in` · `whatsapp.message_status` · `conversation.updated` · `campaign.progress` · `campaign.finished` · `customer.tagged`.

---

## Convenções de API (resumo)

- REST sob `/api/v1`, JSON, JWT Bearer. Erros padronizados `{error, code, details}`.
- **Idempotência**: `POST` de pagamento/pedido/agendamento aceita header `Idempotency-Key`.
- **Paginação**: `?page=&pageSize=` + `X-Total-Count`.
- **Tempo real**: Socket.io, sala `shop:{barbershopId}` (e `barber:{barberId}` para o feed restrito).
- **Webhooks Evolution**: `POST /webhooks/evolution/{barbershopId}` validado por assinatura/secret.
- Toda rota aplica o middleware de tenant + RBAC antes do handler.
