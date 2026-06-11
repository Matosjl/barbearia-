# Frontend MVP — BarberSystem

> **Princípio:** O barbeiro trabalha. O sistema pensa.

---

## Stack

| Item            | Tecnologia                        |
|-----------------|-----------------------------------|
| Framework       | React 18 + Vite 5                 |
| Roteamento      | React Router v6                   |
| HTTP            | fetch nativo (api.js)             |
| Real-time       | Socket.io-client                  |
| Estilo          | CSS puro (mobile-first, sem lib)  |
| Auth            | JWT — accessToken + refreshToken  |

---

## Instalação

```bash
cd apps/frontend
cp .env.example .env        # edite VITE_API_URL e VITE_SHOP_SLUG
npm install
npm run dev                  # http://localhost:5173
```

### Variáveis de ambiente

| Variável          | Descrição                                      |
|-------------------|------------------------------------------------|
| `VITE_API_URL`    | URL base do backend (ex: `http://localhost:3000`) |
| `VITE_SHOP_SLUG`  | Slug da barbearia (para cadastro de clientes)   |

---

## Estrutura de arquivos

```
apps/frontend/
├── src/
│   ├── main.jsx                  # Bootstrap React
│   ├── App.jsx                   # Rotas + Guards
│   ├── index.css                 # CSS global mobile-first
│   ├── lib/
│   │   ├── api.js                # fetch + JWT + auto-refresh
│   │   └── socket.js             # Socket.io client
│   ├── context/
│   │   └── AuthContext.jsx       # Auth state + login/logout
│   ├── hooks/
│   │   └── useApi.js             # useApi + useMutation
│   ├── components/
│   │   ├── Layout.jsx            # BarberLayout | OwnerLayout | CustomerLayout
│   │   └── ui.jsx                # Componentes compartilhados
│   └── pages/
│       ├── Login.jsx
│       ├── barber/
│       │   ├── BarberHome.jsx    ← TELA MAIS IMPORTANTE
│       │   ├── BarberAgenda.jsx
│       │   ├── BarberComissoes.jsx
│       │   └── BarberPerfil.jsx
│       ├── owner/
│       │   ├── OwnerDashboard.jsx
│       │   ├── OwnerAgenda.jsx
│       │   ├── OwnerFinanceiro.jsx
│       │   └── OwnerConfig.jsx
│       └── customer/
│           ├── CustomerHome.jsx
│           ├── CustomerAgendar.jsx
│           ├── CustomerHistorico.jsx
│           └── CustomerPerfil.jsx
```

---

## Rotas

| Rota                       | Componente             | Perfil permitido       |
|----------------------------|------------------------|------------------------|
| `/login`                   | Login                  | público                |
| `/barber`                  | BarberHome             | barber                 |
| `/barber/agenda`           | BarberAgenda           | barber                 |
| `/barber/comissoes`        | BarberComissoes        | barber                 |
| `/barber/perfil`           | BarberPerfil           | barber                 |
| `/owner`                   | OwnerDashboard         | owner, manager         |
| `/owner/agenda`            | OwnerAgenda            | owner, manager         |
| `/owner/financeiro`        | OwnerFinanceiro        | owner, manager         |
| `/owner/config`            | OwnerConfig            | owner, manager         |
| `/customer`                | CustomerHome           | customer               |
| `/customer/agendar`        | CustomerAgendar        | customer               |
| `/customer/historico`      | CustomerHistorico      | customer               |
| `/customer/perfil`         | CustomerPerfil         | customer               |

**Guard:** todo acesso autenticado passa pelo componente `Guard` em `App.jsx`.
JWT inválido → redirect para `/login`. Role errado → redirect para `/login`.

---

## Endpoints consumidos

### Auth
| Método | Endpoint                    | Tela               |
|--------|-----------------------------|--------------------|
| POST   | `/auth/login`               | Login              |
| POST   | `/auth/register-customer`   | Login (cadastro)   |
| POST   | `/auth/refresh`             | automático (api.js)|
| GET    | `/auth/me`                  | AuthContext        |

### Serviços
| Método | Endpoint      | Tela                             |
|--------|---------------|----------------------------------|
| GET    | `/services`   | BarberHome, CustomerAgendar      |

### Barbeiros
| Método | Endpoint   | Tela                |
|--------|------------|---------------------|
| GET    | `/barbers` | CustomerAgendar     |

### Agendamentos
| Método | Endpoint                        | Tela                     |
|--------|---------------------------------|--------------------------|
| POST   | `/appointments/walk-in`         | BarberHome (walk-in)     |
| PATCH  | `/appointments/:id/complete`    | BarberHome, BarberAgenda, OwnerAgenda |
| PATCH  | `/appointments/:id/start`       | BarberAgenda, OwnerAgenda|
| PATCH  | `/appointments/:id/cancel`      | BarberAgenda, OwnerAgenda, CustomerHistorico |
| PATCH  | `/appointments/:id/reschedule`  | (pendente — próxima fase)|
| GET    | `/appointments?date=&status=`   | BarberAgenda, OwnerAgenda|
| GET    | `/appointments/mine`            | CustomerHome, CustomerHistorico |
| POST   | `/appointments/hold`            | CustomerAgendar          |
| PATCH  | `/appointments/:id/confirm`     | CustomerAgendar          |

### Dashboard
| Método | Endpoint           | Tela              |
|--------|--------------------|-------------------|
| GET    | `/dashboard`       | OwnerDashboard    |
| GET    | `/dashboard/barber`| BarberComissoes   |

### Financeiro (somente owner/manager)
| Método | Endpoint                          | Tela              |
|--------|-----------------------------------|-------------------|
| GET    | `/financial/summary?from=&to=`    | OwnerFinanceiro   |
| GET    | `/financial/dre?from=&to=`        | OwnerFinanceiro   |
| GET    | `/financial/transactions?from=&to=` | OwnerFinanceiro |
| GET    | `/financial/barber-commissions?from=&to=` | OwnerFinanceiro |

---

## Regras de permissão (frontend)

| Dado                     | Cliente | Barbeiro | Dono  |
|--------------------------|---------|----------|-------|
| Financeiro / lucro real  | ❌      | ❌       | ✅    |
| Comissões próprias       | ❌      | ✅       | ✅    |
| Agenda própria           | ❌      | ✅       | ✅    |
| Agenda de todos          | ❌      | ❌       | ✅    |
| Walk-in                  | ❌      | ✅       | ✅    |
| Iniciar / Finalizar      | ❌      | ✅ (próprio) | ✅  |
| Cancelar agendamento     | ✅ (próprio) | ✅ (próprio) | ✅ |
| Ver histórico próprio    | ✅      | ✅       | ✅    |
| Configurações da barbearia| ❌     | ❌       | ✅    |

> A isolação real é garantida pelo **RLS do banco** + **rbac do backend**.
> O frontend apenas esconde campos — o backend rejeita acessos indevidos.

---

## Estados de loading / erro / sucesso

Cada tela trata os 3 estados:

```jsx
{loading && <LoadingInline />}
{error && <ErrorBox message={error} onRetry={load} />}
{data && <ConteudoReal />}
```

Operações mutativas (walk-in, complete, cancel, etc.) desabilitam o botão
durante o request e exibem mensagem de erro inline caso falhem.

A tela de **Atendimento Rápido** exibe uma tela de sucesso com o valor e
a comissão após cada finalização.

---

## Fluxo crítico: Atendimento Rápido (walk-in)

```
Barbeiro abre /barber
  ↓
Preenche: Nome + Telefone
  ↓
Toca: Serviço (chips)
  ↓
Toca: Pagamento (chips)
  ↓
Toca FINALIZAR
  ↓
api.post('/appointments/walk-in') → id
  ↓
api.patch('/appointments/:id/complete', { paymentMethod })
  ↓
Backend executa automaticamente:
  ✅ Cria/atualiza cliente (anti-duplicidade por telefone)
  ✅ Calcula comissão por item
  ✅ Calcula taxa do cartão
  ✅ Baixa insumos do estoque
  ✅ Registra pagamento
  ✅ Gera transações financeiras (receita + despesas)
  ✅ Atualiza CRM (visits_count, last_visit_at, total_spent)
  ✅ Carimba fidelidade
  ✅ Cria evento de timeline
  ✅ Emite WebSocket dashboard.updated
  ↓
Frontend exibe tela de sucesso com valor + comissão
```

Meta: < 10 segundos do início ao "FINALIZAR".

---

## Fluxo: Agendamento pelo cliente

```
Cliente abre /customer/agendar
  Step 1: Escolhe serviço (GET /services)
  Step 2: Escolhe barbeiro (GET /barbers)
  Step 3: Escolhe data + horário (slots gerados localmente, 30min)
  Step 4: Confirma
    → POST /appointments/hold
    → PATCH /appointments/:id/confirm
    → Erro 409 = slot ocupado → marca slot como "Ocupado"
  → Tela de sucesso
```

---

## Socket.io — Eventos em tempo real

| Evento                 | Tratado em          |
|------------------------|---------------------|
| `dashboard.updated`    | OwnerDashboard      |
| `appointment.completed`| OwnerDashboard      |
| `appointment.checked_in`| OwnerDashboard     |

Conexão via `connectSocket()` após login. Desconexão via `disconnectSocket()` no logout.

---

## Pendências conhecidas

| Item                              | Prioridade | Notas                                         |
|-----------------------------------|------------|-----------------------------------------------|
| Remarcar agendamento (UI)         | Alta       | Endpoint existe (`PATCH /:id/reschedule`), falta tela |
| Endpoint de disponibilidade       | Alta       | Hoje cliente vê 409 para slots ocupados       |
| Atualização socket na agenda      | Média      | Barbeiro não recebe push em BarberAgenda      |
| Gestão de barbeiros (dono)        | Média      | Endpoints existem, falta tela                 |
| Gestão de serviços (dono)         | Média      | Endpoints existem, falta tela                 |
| Gestão de clientes (dono)         | Média      | Endpoint `/customers` existe, falta tela      |
| Cortesia (is_courtesy)            | Baixa      | Atendimento gratuito — falta campo na UI      |
| Desconto no atendimento           | Baixa      | Campo `discount` no /complete                 |
| Configurações de caixa (cash)     | Baixa      | Módulo `cash.js` existe no backend            |
| PWA / Instalação mobile           | Baixa      | Adicionar manifest.json + service worker      |

---

## Bugs conhecidos

Nenhum bug crítico identificado. Pontos de atenção:

1. **Slots de horário**: gerados client-side sem checar disponibilidade real. O 409 do backend corrige, mas UX melhora com endpoint `/barbers/:id/availability`.
2. **Refresh token**: em ambientes com múltiplas abas, pode haver race condition. Mitigado com a variável `refreshing` em `api.js`.
3. **`VITE_SHOP_SLUG`**: obrigatório para cadastro de cliente. Se não configurado, o cadastro falha com mensagem clara.

---

## Próximos passos recomendados

1. **Copiar `.env.example` → `.env`** e configurar `VITE_API_URL` + `VITE_SHOP_SLUG`.
2. **`npm install` + `npm run dev`** e testar cada perfil com usuários reais do banco.
3. **Implementar a tela de remarcar** (BarberAgenda → sheet com date picker + `/reschedule`).
4. **Adicionar endpoint `/barbers/:id/availability`** no backend para mostrar só slots livres.
5. **Tela de clientes para o dono** (histórico, total gasto, fidelidade).
6. **Notificações push** via PWA quando for a vez do cliente.
