# Análise de Mercado — SaaS de Gestão para Barbearia (2026)

Pesquisa profissional para fundamentar as decisões de produto e schema antes de codar. Foco em concorrentes do Brasil (Trinks, AppBarber, BestBarbers, Avec, Opero) e globais (Booksy, Squire, theCut, Zenoti, GlossGenius), e nas tendências de 2026.

---

## 1. O que um sistema moderno de barbearia precisa ter (tabela-aposta)

Funções que **todos** os líderes oferecem — são o piso de entrada, não diferencial:

- Agenda online com app do cliente e link público de agendamento.
- Lembrete automático e confirmação (hoje via WhatsApp no Brasil).
- Cadastro de serviços/produtos, histórico de atendimento e ficha do cliente.
- Relatórios financeiros e **controle de comissão** por profissional.
- Módulo do profissional (cada barbeiro com sua agenda).
- Integração com pagamentos e, cada vez mais, **clube de assinatura/recorrência**.
- Controle de estoque e fila de espera (waitlist).

Nosso schema já cobre tudo isso. O ponto é **executar melhor** o que abaixo separa os vencedores.

## 2. Diferenciais que fazem um SaaS vender mais

Baseado nas tendências de 2026 (Zenoti Benchmark, Booksy, GlossGenius):

- **Redução de no-show com depósito/sinal + lembrete**: combinação de SMS/WhatsApp + depósito reduz faltas em até ~75%. É o argumento de venda nº 1 (dinheiro perdido visível).
- **Waitlist automática**: barbearias com lista de espera automática preenchem 60–70% dos horários cancelados — receita que hoje evapora.
- **Retenção/assinatura**: o crescimento de 2026 vem de extrair mais do cliente atual (memberships cresceram ~20% a/a). Quem tem clube de assinatura fideliza e estabiliza caixa.
- **IA com ROI medível**: locais com forte adoção de features de IA geraram ~US$ 9.900/mês de receita incremental (Zenoti). IA para waitlist, "estou atrasado", recuperação de inativos e previsão.
- **WhatsApp nativo no Brasil**: agendar e confirmar pelo WhatsApp sem baixar app é o maior atrito removido para o cliente brasileiro (Opero vende exatamente isso).

## 3. Funções que os concorrentes costumam ter

| Função | Trinks | AppBarber | Booksy | Squire | theCut |
|---|---|---|---|---|---|
| Agenda + app cliente | ✅ | ✅ | ✅ | ✅ | ✅ |
| Comissão por profissional | ✅ | ✅ | ✅ | ✅ (folha avançada) | ✅ |
| Clube de assinatura | ✅ (forte) | parcial | ✅ | ✅ | parcial |
| Marketplace de descoberta | ✅ | parcial | ✅ (7M+ usuários) | ✅ (20% 1ª visita) | ✅ |
| Walk-in / fila | parcial | ✅ | ✅ | ✅ (forte) | ✅ |
| Estoque | ✅ | ✅ | parcial | ✅ | parcial |
| Booth rent (aluguel de cadeira) | parcial | parcial | parcial | ✅ | ✅ |
| WhatsApp confirmação | ✅ | ✅ | (SMS/EUA) | (SMS/EUA) | (SMS) |

Observação de modelo: Booksy cobra mensalidade plana sem comissão sobre agendamentos; Squire cobra 20% na 1ª visita vinda do marketplace e foca gestão multi-cadeira. theCut trata **booth rent e comissão** como modelos de primeira classe — relevante para o nosso "barbeiro comissionado".

## 4. O que quase ninguém oferece (nossas vantagens)

Oportunidades de posicionamento (poucos players entregam bem, sobretudo no Brasil):

1. **IA local (Ollama) sem custo por token e com dado privado** — previsão de faturamento, recuperação de inativos e geração de campanha rodando on-prem/VPS do dono. Concorrentes que têm IA cobram caro e mandam dado pra nuvem.
2. **WhatsApp self-hosted (Evolution API)** — sem depender da Cloud API oficial nem de verificação de negócio, com custo marginal baixo e multi-instância por barbearia.
3. **Modo "barbeiro comissionado" com isolamento real de dados** — o barbeiro vê só o que é dele (clientes, comissões, a receber) e não enxerga lucro do dono, estoque ou financeiro. Quase nenhum concorrente isola isso no nível de banco (RLS) — é diferencial de confiança para shops com barbeiros parceiros/freelance.
4. **Anti-overbooking e imutabilidade financeira garantidos no banco** — robustez de "software de verdade", não planilha glorificada.
5. **Timeline operacional em tempo real** (estilo feed) unindo agenda, caixa, estoque e IA — visão de "o que está acontecendo agora" que poucos têm.

## 5. Regras de negócio ainda faltantes (a adicionar)

Identificadas na pesquisa e que recomendo formalizar:

- **Depósito/sinal antifalta** (pré-pagamento parcial no agendamento, com política configurável). Liga ao bloqueio por no-show que já temos.
- **Lista de espera (waitlist)** com promoção automática quando um horário vaga (cancelamento → notifica próximo).
- **Clube de assinatura do cliente** (mensalidade que dá direito a N cortes/mês) — diferente da assinatura SaaS do dono.
- **Booth rent / aluguel de cadeira** como alternativa à comissão (alguns barbeiros pagam fixo em vez de %).
- **Janela de cancelamento** (cancelar com < X horas gera taxa/perde sinal).
- **Reativação por inatividade em faixas** (30/45/60/90 dias) com mensagem específica por faixa.

## 6. Módulos a adicionar no schema antes de codar

A serem implementados na migração `06_extensions.sql`:

- **RBAC granular + perfil "barbeiro comissionado"** (isolamento por barbeiro via RLS restritiva).
- **WhatsApp/Evolution**: `whatsapp_instances`, `message_templates`, `message_outbox`, `message_inbox`.
- **IA/Ollama**: `ai_jobs`, `ai_insights`, `ai_suggestions`.
- **Timeline**: `timeline_events`.
- **A receber / repasse**: `commission_payouts` + view `vw_barber_receivables`.
- **(Roadmap próximo)**: `waitlist`, `client_subscriptions` (clube), `booth_rents`, `appointment.deposit_amount`.

## 7. Separação de acesso: dono x barbeiro comissionado x cliente

Modelo de papéis (RBAC) + isolamento por linha (RLS):

- **Dono (owner) / gerente (manager)**: acesso total à barbearia (dashboard, financeiro, lucro, estoque, relatórios, config, todos os barbeiros e clientes).
- **Barbeiro comissionado (barber)**: vê **apenas** os próprios agendamentos, atendimentos, comissões, "a receber", clientes que **ele** atendeu e seus serviços. Pode **lançar cliente na hora** — e o sistema atribui o atendimento automaticamente a ele e calcula a comissão pela regra do dono. **Não** vê: estoque geral, lucro do dono, financeiro completo, relatórios administrativos, configurações, dados de outros barbeiros.
- **Cliente (customer)**: vê só a própria área (agendar, histórico, shop, fidelidade, perfil).
- **Recepção (receptionist)**: agenda e caixa, sem financeiro estratégico/lucro.

Garantia técnica: além da checagem na aplicação, **RLS restritiva** no banco usando `app.role` + `app.barber_id`/`app.customer_id`, de modo que mesmo uma falha na app não vaza dados de outro barbeiro ou o lucro do dono.

## 8. Como estruturar WhatsApp + Evolution API

Evolution API é open-source (baseada na Baileys), expõe REST com API key, suporta **multi-instância** (um número por barbearia) e **webhooks** em tempo real — sem verificação de negócio da Meta. Arquitetura proposta:

- Uma `whatsapp_instance` por barbearia (`api_url`, `api_key`, `instance_name`, número conectado, status).
- Envio assíncrono via **outbox** (`message_outbox`): a app enfileira a mensagem (com `idempotency_key`), um worker chama o endpoint de envio da Evolution, e atualiza status (queued→sent→delivered→read/failed).
- **Webhook** da Evolution alimenta `message_inbox` (respostas e botões Confirmar/Remarcar/Cancelar) e atualiza status de entrega.
- Templates versionados em `message_templates` com variáveis (`{{cliente}}`, `{{hora}}`, `{{barbeiro}}`).
- Conformidade: como é self-hosted no VPS do dono, os dados de conversa ficam na infra dele (LGPD-friendly).

## 9. Como estruturar IA com Ollama no projeto

Ollama roda LLM local (sem custo por token, dado privado), expõe REST e suporta **structured outputs** (JSON Schema) — ideal para gerar dados confiáveis (campanhas, classificação, previsão) consumíveis pelo backend Node.

- **Worker de IA** consome `ai_jobs` (fila): tipos como `revenue_forecast`, `churn_scan`, `weak_hours`, `top_barber`, `campaign_suggestion`, `message_suggestion`.
- Saída persistida em `ai_insights` (alertas/insights para o dashboard) e `ai_suggestions` (rascunhos de mensagem/campanha que o dono aprova antes de enviar via WhatsApp).
- **Structured output (JSON Schema)** garante que a sugestão venha no formato certo (ex.: `{segmento, titulo, mensagem, desconto_sugerido}`).
- Pipeline: dados agregados (views) → prompt → Ollama → JSON validado → `ai_*` → dashboard/WebSocket. Nenhum dado sai da infra do cliente.
- **Guardrail**: IA nunca dispara WhatsApp sozinha; ela **sugere**, o humano aprova (especialmente campanhas) — evita spam e protege a marca.

## 10. Como transformar em SaaS vendável

- **Planos por nº de barbeiros/unidades** (Básico/Pro/Premium) já modelados; cobrança e inadimplência via `subscriptions`.
- **Onboarding de 5 minutos**: cadastro da barbearia → serviços → barbeiros → link de agendamento no WhatsApp. Tempo até o primeiro valor é decisivo.
- **Gancho de venda nº 1**: "reduza no-show e recupere clientes sumidos" — mostrar dinheiro recuperado no próprio dashboard.
- **Multi-unidade/franquia** já preparado (multi-tenant + RLS) para vender plano Premium a redes.
- **Diferencial técnico de marketing**: IA local + WhatsApp próprio = "sua barbearia com IA, sem mandar seus dados pra fora e sem custo por mensagem".
- **Métrica de retenção do SaaS**: ativar clube de assinatura e automação de recuperação aumenta o LtV do dono — e reduz churn do nosso próprio SaaS.

---

## Fontes

- [Opero — AppBarber alternativas / sistemas 2026](https://operosistemas.com.br/blog/comercial/appbarber-alternativa-sistemas-barbearia-2026)
- [Trinks — sistema para barbearia](https://www.trinks.com/negocios/sistema-para-barbearia)
- [AppBarber](https://appbarber.com.br/)
- [Capterra — Best Barbershop Software 2026](https://www.capterra.com/barbershop-software/)
- [Booksy vs Squire (GoodCall)](https://www.goodcall.com/appointment-scheduling-software/booksy-vs-squire)
- [Booksy — comparação Squire](https://biz.booksy.com/en-us/comparison/squire-comparison)
- [Zenoti — Best Barbershop Software 2026 Guide](https://www.zenoti.com/guides/barbershop-software-guide)
- [Booksy — Ultimate Guide to Barbershop Management 2026](https://biz.booksy.com/en-us/blog/barbershop-management)
- [AgentZap — Reduce No-Shows by 70%](https://agentzap.ai/blog/how-to-reduce-barbershop-no-shows-by-70-proven-strategies-for-barbers)
- [Evolution API — GitHub](https://github.com/evolution-foundation/evolution-api)
- [Evolution API — Webhooks docs](https://doc.evolution-api.com/v2/en/configuration/webhooks)
- [Ollama — Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [Squire — booth rent vs commission](https://getsquire.com/business-edge/what-new-barbers-need-to-know-about-booth-rent-vs-commission-shops)
- [theCut — app para barbearias](https://thecut.co/)
