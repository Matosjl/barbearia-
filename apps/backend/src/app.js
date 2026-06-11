import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { ping } from './config/db.js';
import { redisOk } from './config/redis.js';
import { errorHandler } from './middleware.js';
import { router as apiRouter } from './routes.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  // Confia em 1 proxy (nosso nginx). 'true' permitiria spoof de X-Forwarded-For
  // e burlaria o rate limit por IP (achado da auditoria).
  app.set('trust proxy', 1);
  app.use(helmet());

  // CORS: em produção, restringe à allowlist (CORS_ORIGINS). Em dev, reflete origem.
  app.use(cors({
    origin: env.corsOrigins && env.corsOrigins.length ? env.corsOrigins : true,
    credentials: true,
  }));

  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger }));

  // Rate limit nos endpoints de autenticação (anti brute-force).
  app.use('/api/v1/auth', rateLimit({
    windowMs: 60_000,
    limit: env.rateLimitAuth,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Muitas tentativas, aguarde um instante' },
  }));

  // Health check (usado pelo Docker healthcheck e pelo proxy)
  app.get('/health', async (_req, res) => {
    const [db, redis] = await Promise.all([ping().catch(() => false), redisOk()]);
    const healthy = db === true;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      db,
      redis, // null = não configurado
      ts: new Date().toISOString(),
    });
  });

  app.use('/api/v1', apiRouter);

  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Rota não encontrada' }));
  app.use(errorHandler);
  return app;
}
