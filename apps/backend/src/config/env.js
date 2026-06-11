// Centraliza variáveis de ambiente. Hosts vêm por NOME DE CONTAINER no Docker.
const {
  NODE_ENV = 'development',
  PORT = '3000',
  TZ = 'America/Sao_Paulo',

  // Conexão da APLICAÇÃO (role barber_app — sujeito a RLS)
  DATABASE_URL,
  APP_DATABASE_URL,

  // Conexão ADMIN/owner (migrações e auth/bootstrap — bypass RLS)
  ADMIN_DATABASE_URL,
  POSTGRES_HOST = 'postgres',
  POSTGRES_PORT = '5432',
  POSTGRES_DB = 'barber',
  POSTGRES_ADMIN_USER = 'postgres',
  POSTGRES_ADMIN_PASSWORD = 'postgres',
  POSTGRES_USER = 'barber_app',
  POSTGRES_PASSWORD = 'barber_app',

  REDIS_URL, // opcional; se ausente, roda single-instance sem adapter

  JWT_ACCESS_SECRET = 'dev-access-secret',
  JWT_REFRESH_SECRET = 'dev-refresh-secret',
  JWT_ACCESS_TTL = '900',      // 15 min
  JWT_REFRESH_TTL = '2592000', // 30 dias

  MIGRATIONS_DIR, // pasta com os .sql (canônico: /app/database no Docker)

  CORS_ORIGINS,        // lista separada por vírgula; vazio = libera em dev
  RATE_LIMIT_AUTH = '20',  // req/min por IP nos endpoints de auth

  ADMIN_API_KEY, // chave secreta para rotas privadas de administração
} = process.env;

const adminUrl =
  ADMIN_DATABASE_URL ||
  `postgres://${POSTGRES_ADMIN_USER}:${POSTGRES_ADMIN_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;

const appUrl =
  APP_DATABASE_URL ||
  DATABASE_URL ||
  `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;

export const env = {
  nodeEnv: NODE_ENV,
  isProd: NODE_ENV === 'production',
  port: Number(PORT),
  tz: TZ,
  db: {
    adminUrl,
    appUrl,
    appUser: POSTGRES_USER,
    appPassword: POSTGRES_PASSWORD,
  },
  redisUrl: REDIS_URL || null,
  jwt: {
    accessSecret: JWT_ACCESS_SECRET,
    refreshSecret: JWT_REFRESH_SECRET,
    accessTtl: Number(JWT_ACCESS_TTL),
    refreshTtl: Number(JWT_REFRESH_TTL),
  },
  migrationsDir: MIGRATIONS_DIR || null,
  corsOrigins: CORS_ORIGINS ? CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : null,
  rateLimitAuth: Number(RATE_LIMIT_AUTH),
  adminApiKey: ADMIN_API_KEY || null,
};
