import pino from 'pino';
import { env } from './env.js';

// Redação de dados sensíveis nos logs: token JWT, cookies e senhas NUNCA
// devem aparecer em log (achado crítico da auditoria).
export const logger = pino({
  level: env.isProd ? 'info' : 'debug',
  base: { service: 'barber-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.refreshToken',
      '*.password',
      '*.password_hash',
      '*.refresh_token_hash',
      '*.api_key_enc',
    ],
    censor: '[REDACTED]',
  },
});
