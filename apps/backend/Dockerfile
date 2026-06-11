# ============================================================================
#  Backend (Node.js + Express + Socket.io + Workers BullMQ)
#  Multi-stage: deps -> dev (nodemon) / prod (build enxuto).
#  A mesma imagem roda: API (npm start), worker (npm run worker) e migrate.
# ============================================================================
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- Dev (HMR/nodemon, código montado via volume no override) ----
FROM node:22-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- Build de produção ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build || echo "sem etapa de build (JS puro)"

# ---- Runtime de produção (sem devDeps) ----
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app .
# usuário não-root
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
