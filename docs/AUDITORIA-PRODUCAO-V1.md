# Auditoria de Produção V1 — Gate antes de escalar o MVP

Objetivo: provar que o que existe aguenta 3 barbearias reais por 30 dias. Status: ✅ aprovado · ⚠️ risco controlado · ⛔ bloqueado pelo ambiente (Docker não sobe aqui por falta de memória/pagefile) · 🕓 pendente (depende do item bloqueado).

Princípio mestre adotado: **o barbeiro trabalha, o sistema pensa.** Congelamento de novas features (IA, 360°, campanhas, integrações) em vigor — foco em operação real.

| # | Item | Status | Evidência / Plano |
|---|---|---|---|
| 1 | RLS 100% coberta | ✅ | `audit_db.ps1`: toda tabela com `barbershop_id` tem RLS. 87 policies. |
| 2 | Todas as tabelas operacionais com `barbershop_id` | ✅ | `audit_db.ps1`: 0 operacionais sem; só 8 globais justificadas. |
| 3 | Nenhuma FK sem índice | ✅ | Migração `10_indexes.sql`; auditoria confirma "todas as FKs têm índice". |
| 4 | Nenhuma tabela operacional órfã | ✅ | Só `audit_logs` (proposital, trilha imutável). |
| 5 | Nenhum endpoint usando owner pool indevidamente | ⚠️ | Uso do pool admin é **restrito e justificado**: signup, login, criar barbeiro-com-login, e efeitos de sistema em `complete()`/`walk-in` (contexto elevado mas **isolado por barbershop_id**). Hardening planejado: role `auth_svc` com grants mínimos (RISCO-5). |
| 6 | JWT sem vazamento | ✅ | Redação de logs (`authorization`/senhas → `[REDACTED]`), verificada. |
| 7 | Rate limit | ✅ | `express-rate-limit` em `/auth`; 429 disparado em teste. `trust proxy=1`. |
| 8 | Backup e restore | ✅ | `backup_restore_test.ps1`: dump→drop→restore preservou os dados. |
| 9 | Docker funcionando em VPS real | ⛔ | Engine não sobe neste ambiente (pagefile/memória). `docker-compose.yml` pronto; **rodar em VPS Linux**: `docker compose up -d`. |
| 10 | Teste de carga WebSocket | 🕓 | Precisa de Redis + réplicas (Docker). Código pronto (adapter Redis). Rodar `k6/artillery` contra `/socket.io` em VPS. |
| 11 | Recuperação após queda do PostgreSQL | 🕓 | Precisa Docker p/ derrubar/subir o container. Mitigação no código: pool com reconexão, healthcheck, `restart: unless-stopped`, migração idempotente. |
| 12 | Recuperação após queda da Evolution | 🕓 | WhatsApp é **assíncrono via fila** (`whatsapp_messages` status `pendente`); ao voltar, o worker reprocessa. Validar em VPS. |
| 13 | Recuperação após queda do Redis | 🕓 | Código trata Redis **opcional** (degrada para single-instance); filas reprocessam. Validar reconexão em VPS. |

## Conclusão do gate

Itens 1–8 (núcleo de segurança/integridade/backup): **APROVADOS e testados**. Itens 9–13 dependem do Docker rodando, **bloqueados pelo ambiente atual** — não por falha do projeto. Conforme alinhado ("não travar o dev por questão ambiental"), seguimos o desenvolvimento nativo de Financeiro + Dashboard; os itens 9–13 entram numa bateria de validação assim que a stack subir num VPS (ou no Docker local com memória).

**Sequência congelada do MVP:** V1 audit → **Financeiro + Dashboard** → Shop + Carrinho → WhatsApp → Frontend mobile-first → roteiro de operação real (30 clientes / 3 barbeiros / 30 dias).
