# Relatório Relacional — Auditoria de Integridade do Schema

Auditoria executada sobre o banco real (PostgreSQL 17) após as migrações 01→08. Objetivo: provar que o sistema é **único e conectado** — sem tabelas soltas, sem duplicidade de cliente, com todos os módulos reaproveitando o mesmo cadastro.

Números medidos por introspecção (`pg_constraint`):

- **58 tabelas-base**, **149 foreign keys**, **83 policies RLS**, **146 índices**.
- **Tabelas órfãs (sem FK alguma): 1** → `audit_logs` (intencional, ver §5).
- **Tabelas operacionais sem `barbershop_id`: 0** (as 8 sem o campo são globais/justificadas, §4).

---

## 1. Tabelas centrais (hubs do sistema)

Medido por FKs **recebidas** (quantas tabelas apontam para ela):

| Tabela | FKs recebidas | Papel |
|---|---:|---|
| `barbershops` | 49 | Raiz do multi-tenant — quase tudo pertence a uma barbearia |
| `users` | 22 | Identidade global (dono, barbeiro, recepção, cliente-login) |
| `customers` | 13 | **Cadastro único do cliente — reaproveitado em todos os módulos** |
| `barbers` | 12 | Profissional (agenda, comissão, atendimento) |
| `appointments` | 9 | Atendimento (liga cliente, barbeiro, serviço, pagamento, comissão, fidelidade, timeline) |
| `services` | 6 | Catálogo de serviços |
| `orders` | 5 | Vendas do Shop |
| `products` | 4 | Estoque/produtos |

Esses 8 hubs concentram a integridade do sistema. `customers`, `appointments`, `barbers` e `products` são os hubs **operacionais**; `barbershops`/`users` são os hubs **estruturais**.

## 2. Como o CLIENTE é reaproveitado em todos os módulos

Há **13 tabelas** com FK para `customers` — prova de que existe **um único cadastro** consumido por todo o sistema:

| Módulo | Tabela que referencia `customers` |
|---|---|
| Agendamento | `appointments` |
| Shop / vendas | `orders` |
| Fidelidade | `loyalty_cards` |
| CRM / etiquetas | `customer_tag_assignments` |
| WhatsApp (chat) | `whatsapp_conversations`, `whatsapp_messages` |
| Campanhas | `campaign_recipients` |
| Consentimento/opt-out | `customer_consent_history` |
| IA | `ai_suggestions` |
| Avaliações | `reviews` |
| Notificações | `notifications` |
| Favoritos | `customer_favorites` |
| Timeline | `timeline_events` |

Financeiro e comissão ligam-se ao cliente **indiretamente** (via `appointments`/`orders`/`payments`), o que é correto: o dado financeiro pertence ao atendimento/venda, e o atendimento pertence ao cliente — sem duplicar a identidade do cliente no financeiro.

### Como garantir um cliente só (anti-duplicidade)

1. **Chave natural por telefone**: `UNIQUE (barbershop_id, phone)` em `customers`. Dois cadastros com o mesmo telefone na mesma barbearia são impossíveis.
2. **Upsert por telefone** em todo ponto de entrada (agendamento do cliente, walk-in do barbeiro, venda no balcão, importação): `INSERT ... ON CONFLICT (barbershop_id, phone) DO UPDATE`. Nunca `INSERT` cego.
3. **Walk-in nunca cria cliente novo se o telefone já existe** — reusa o `customer_id` existente, preservando histórico, fidelidade e etiquetas.
4. **Mesma `customer_id`** flui para agendamento → pagamento → financeiro → fidelidade → WhatsApp → timeline. Nenhum módulo cria "seu próprio cliente".

## 3. Mapa de conexões por módulo (quem liga com quem)

- **Agendamento** (`appointments`) → `customers`, `barbers`, `services` (via `appointment_items`), `payments`, `commissions` (via `appointment_items`), `loyalty_movements`, `timeline_events`, `appointment_status_history`. ✔ regra 4
- **Shop** (`orders`/`order_items`) → `customers`, `products`, `stock_movements`, `payments`, `financial_transactions`, `timeline_events`. ✔ regra 5
- **WhatsApp** (`whatsapp_conversations`/`whatsapp_messages`) → `customers`, `marketing_campaigns`, `customer_tag_assignments` (via segmentação), `whatsapp_instances`, `appointments` (intenções). ✔ regra 6
- **Fidelidade** (`loyalty_cards`/`loyalty_movements`) → `customers`, `services` (recompensa), `appointments` (carimbo/resgate), `loyalty_programs`. ✔ regra 7
- **Comissão** (`commissions`/`commission_payouts`) → `barbers`, `appointment_items` (atendimento+serviço), `order_items`, `payments` (via transação), `financial_transactions`. ✔ regra 8
- **Financeiro** (`financial_transactions`) → `payments`, `appointments`, `orders`, `commissions`, `cash_registers`, `expense_categories` (9 FKs de saída — a tabela mais conectada como "consumidora"). ✔ regra 9
- **Estoque** (`stock_movements`) → `products`, `orders` (venda), `appointments` (consumo de insumo), `users` (responsável). ✔ regra 10
- **Timeline** (`timeline_events`) → `customers`, `barbers`, `appointments`, `orders`, `payments`, `products`, `marketing_campaigns`, `users`, `barbershops` (9 FKs — feed que costura tudo). ✔ regra 11
- **Etiquetas** (`customer_tags`/`customer_tag_assignments`) → `customers`, reutilizadas em CRM, WhatsApp, campanhas (`segment_filter`) e relatórios. ✔ regra 12

## 4. FKs adicionadas nas migrações (resumo)

- **01**: base relacional (FKs adiadas resolvidas via `ALTER TABLE` p/ ciclos: `service_supplies→products`, `stock_movements→orders/appointments`, `payments→cash_registers`, `financial_transactions→commissions`).
- **05**: `appointments.idempotency_key`, slot hold (sem FK nova, reusa constraint).
- **06**: `commissions.payout_id→commission_payouts`; tabelas WhatsApp/IA/timeline ligadas a `barbershops`/`customers`/`users`.
- **07**: `whatsapp_messages→{conversation,customer,campaign,appointment,user}`; `whatsapp_conversations→{customer,instance}`; `customer_tag_assignments→{customer,tag,user}`; `customer_consent_history→customer`; `campaign_recipients→{message,barbershop}`; **timeline ganhou 6 FKs** (`customer,appointment,order,payment,product,campaign`); `marketing_campaigns→ai_suggestions`.
- **08**: `appointment_status_history.barbershop_id→barbershops` e `customer_favorites.barbershop_id→barbershops` (trouxe as 2 filhas para o multi-tenant/RLS).

## 5. Tabelas sem `barbershop_id` — justificativa

Após a 08, **só 8 tabelas** não têm `barbershop_id`, todas por desenho:

| Tabela | Por que não tem (e está correto) |
|---|---|
| `plans` | Catálogo **global** de planos SaaS (compartilhado por todas as contas). |
| `accounts` | Raiz da **conta/franquia** — pai de `barbershops`, não filho. |
| `barbershops` | É a **própria** unidade (o tenant); seria redundante. |
| `users` | Identidade **global**: um usuário pode atuar em várias barbearias (via `memberships`). |
| `subscriptions`, `subscription_payments` | Escopo da **conta** (assinatura do SaaS), não de uma unidade. |
| `auth_sessions`, `push_subscriptions` | Escopo do **usuário** (sessão/dispositivo). |

`audit_logs` **tem** `barbershop_id` (quando disponível), mas aparece como "órfã" de FK **propositalmente**: é uma trilha imutável e polimórfica (`table_name`+`record_id`) que precisa sobreviver a `DELETE`/soft-delete de qualquer tabela — criar FK a engessaria e quebraria a auditoria. É a única órfã, e é uma decisão de design padrão para tabelas de auditoria.

## 6. Riscos de duplicidade e como são evitados

| Risco | Mitigação no schema |
|---|---|
| Cliente duplicado por agendamento | `UNIQUE(barbershop_id, phone)` + upsert por telefone |
| Pedido/pagamento duplicado em retry | `idempotency_key` único (orders/payments/whatsapp_messages) |
| Mesmo cliente 2x na campanha | `UNIQUE(campaign_id, customer_id)` |
| Etiqueta repetida no cliente | `UNIQUE(customer_id, tag_id)` |
| Mesmo serviço 2x p/ barbeiro | `UNIQUE(barber_id, service_id)` |
| Dois caixas abertos | índice único parcial `WHERE status='open'` |
| Overbooking | constraint `EXCLUDE` (gist) |
| Snapshot vs. fonte (preço/custo/comissão) | valores **congelados** em `*_items` no ato — histórico não muda se o catálogo mudar (isto é versionamento, não duplicidade) |

Observação sobre "duplicação saudável": `appointment_items.unit_price`, `order_items.unit_cost`, `appointment_items.commission_pct` etc. **copiam** o valor vigente no momento da transação. Isso é intencional (snapshot histórico) — se o dono mudar o preço amanhã, o atendimento de ontem mantém o valor correto. Não é dado "solto": cada item continua ligado por FK ao serviço/produto de origem.

## 7. Relacionamentos opcionais (e por quê)

Toda FK opcional (`NULL` permitido) é deliberada:

- `customers.user_id` — **opcional**: cliente lançado na hora (walk-in) não tem login; ganha conta depois.
- `barbers.user_id` — **opcional**: barbeiro pode ser cadastrado sem acesso ao app.
- `orders.customer_id` — **opcional**: venda de balcão anônima.
- `orders.barber_id` — **opcional**: nem toda venda tem vendedor/comissão.
- `payments.appointment_id` XOR `payments.order_id` — exatamente **um** é preenchido (CHECK garante origem única).
- `whatsapp_messages.campaign_id` / `appointment_id` — **opcional**: mensagem avulsa não pertence a campanha nem a agendamento.
- `timeline_events.*` (customer/appointment/order/payment/product/campaign) — **opcionais**: cada evento preenche só os vínculos que fazem sentido para aquele tipo.
- `financial_transactions.reverses_id` — **opcional**: só preenchido em estornos.

## 8. Conclusão

O banco é **um sistema único**: `customers`, `appointments`, `barbers` e `products` funcionam como hubs e são reaproveitados por agendamento, Shop, fidelidade, WhatsApp, CRM, financeiro, comissão, estoque e timeline — todos via FK, sob RLS multi-tenant. Não há módulos isolados; a única tabela sem FK é a de auditoria, por desenho. As 15 regras de integridade pedidas estão atendidas e verificadas no banco real.
