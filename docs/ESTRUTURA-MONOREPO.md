# Estrutura do Monorepo — Barber SaaS

Monorepo com workspaces (npm/pnpm). Backend, frontend, worker e pacotes compartilhados num só repositório, orquestrados por Docker. Código compartilhado (tipos, contratos de API, schemas de validação) fica em `packages/` e é consumido por backend e frontend — fonte única de verdade.

```
BarberProject/
├─ docker-compose.yml            # produção (serviços por nome de container)
├─ docker-compose.override.yml   # dev (HMR, bind-mounts, portas)
├─ docker-compose.legacy.yml     # backup do compose antigo (Streamlit/IACC)
├─ .env.example                  # variáveis (hosts = nomes de container)
├─ package.json                  # raiz: workspaces + scripts
│
├─ apps/
│  ├─ backend/                   # Node.js + Express + Socket.io + BullMQ
│  │  ├─ Dockerfile              # multi-stage (deps/dev/build/prod)
│  │  ├─ package.json
│  │  └─ src/
│  │     ├─ index.js             # bootstrap API + Socket.io
│  │     ├─ config/              # env, db pool, redis, logger
│  │     ├─ middleware/          # auth JWT, tenant (SET LOCAL app.*), rbac, rate-limit
│  │     ├─ modules/             # 1 pasta por domínio (vertical slices)
│  │     │  ├─ auth/             #   controller + service + routes + validators
│  │     │  ├─ barbershops/
│  │     │  ├─ appointments/     #   inclui slot-hold e anti-overbooking
│  │     │  ├─ customers/        #   upsert por telefone (anti-duplicidade)
│  │     │  ├─ services/
│  │     │  ├─ barbers/          #   + comissão
│  │     │  ├─ products/  stock/ #   estoque + insumos
│  │     │  ├─ orders/           #   Shop
│  │     │  ├─ payments/ cash/   #   pagamento + caixa
│  │     │  ├─ finance/          #   transações + DRE
│  │     │  ├─ loyalty/  goals/
│  │     │  ├─ crm/  tags/       #   etiquetas/segmentação
│  │     │  ├─ whatsapp/         #   conversas, mensagens, Evolution client
│  │     │  ├─ campaigns/
│  │     │  ├─ ai/               #   Ollama client + jobs
│  │     │  ├─ timeline/
│  │     │  └─ realtime/         #   emissão de eventos WebSocket
│  │     ├─ workers/             # processadores de fila (mesmo serviço, npm run worker)
│  │     │  ├─ whatsapp-send.js  #   respeita rate_limit_per_min/daily_cap
│  │     │  ├─ campaign-dispatch.js
│  │     │  ├─ ai-jobs.js
│  │     │  ├─ reminders.js      #   lembretes 24h/2h
│  │     │  └─ tags-recompute.js
│  │     └─ db/
│  │        ├─ migrations/       # 01..09 .sql (espelham /database)
│  │        └─ migrate.js        # runner (npm run db:migrate)
│  │
│  └─ frontend/                  # React + Vite + Tailwind + PWA
│     ├─ Dockerfile              # dev (vite) / prod (nginx + dist)
│     ├─ nginx.conf              # SPA fallback
│     ├─ package.json
│     └─ src/
│        ├─ main.tsx  App.tsx
│        ├─ pwa/                 # service worker + manifest
│        ├─ lib/                 # api client, socket client, auth store
│        ├─ components/          # design system (botões, cards, bottom-nav)
│        ├─ features/
│        │  ├─ client/           # área do cliente (mobile-first)
│        │  │  ├─ Home  Booking  History  Shop  Profile
│        │  │  └─ Shop/Product360Viewer.tsx   # visualizador 360° premium
│        │  ├─ owner/            # painel: dashboard, agenda, financeiro, CRM, WhatsApp
│        │  └─ barber/           # versão restrita do barbeiro comissionado
│        └─ routes/
│
├─ packages/                     # código compartilhado (fonte única)
│  ├─ shared-types/              # tipos TS de domínio + DTOs
│  ├─ api-contract/              # contratos REST + eventos WS (zod schemas)
│  └─ ui/                        # componentes/temas reutilizáveis (opcional)
│
├─ infra/
│  ├─ nginx/conf.d/              # proxy edge (TLS, /api, /socket.io, /webhooks)
│  ├─ postgres/initdb/           # cria role da app + db da Evolution
│  └─ backup/backup.sh           # pg_dump + retenção
│
├─ database/                     # SCHEMA canônico (01..09) + smoke test + docs
│  ├─ 01_schema.sql ... 09_*.sql
│  ├─ smoke_test.ps1  introspect.ps1
│  └─ MODELO-DE-DADOS.md
│
└─ docs/                         # PESQUISA, FLUXOS, RELATÓRIO RELACIONAL,
                                 # ARQUITETURA-DOCKER, este arquivo, WIREFRAME
```

## Convenções

- **Vertical slices**: cada domínio em `modules/<x>/` com controller, service, routes e validators juntos — fácil de navegar e de dar a um time/IA por módulo.
- **Contrato único**: `packages/api-contract` (schemas Zod) valida no backend e tipa o frontend. Mudou o contrato, muda nos dois lados de uma vez.
- **Migrações = `database/`**: a fonte de verdade do schema é a pasta `database/` (01..09), espelhada em `apps/backend/db/migrations` e aplicada pelo serviço `migrate`.
- **Workers compartilham a imagem do backend**: mesmo código, comando diferente (`npm run worker`) — menos imagens, menos drift.
- **Sem segredo no código**: tudo via `.env` (hosts por nome de container).

## Scripts (raiz)

```jsonc
{
  "scripts": {
    "dev":        "docker compose up",                 // tudo em dev (HMR)
    "build":      "docker compose build",
    "up":         "docker compose --env-file .env up -d",
    "db:migrate": "node apps/backend/db/migrate.js",
    "db:smoke":   "powershell -File database/smoke_test.ps1", // valida o schema
    "logs":       "docker compose logs -f backend worker"
  }
}
```
