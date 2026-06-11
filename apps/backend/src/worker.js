// Worker de filas (BullMQ) — esqueleto. As filas reais (whatsapp-send,
// campaign-dispatch, ai-jobs, reminders, tags-recompute) entram nos próximos
// módulos. Mantido para o serviço "worker" do Docker subir sem erro.
import { logger } from './config/logger.js';
import { env } from './config/env.js';

logger.info('worker iniciado');
if (!env.redisUrl) logger.warn('worker sem REDIS_URL: filas desativadas (MVP inicial)');

// mantém o processo vivo
setInterval(() => {}, 1 << 30);
