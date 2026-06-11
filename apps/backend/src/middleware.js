import { ZodError } from 'zod';
import { verifyAccess, unauthorized, forbidden, AppError } from './utils.js';
import { logger } from './config/logger.js';
import { env } from './config/env.js';

// ---- Autenticação: lê o JWT e popula req.auth (contexto multi-tenant + papel)
export function authRequired(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(unauthorized());
  try {
    const p = verifyAccess(token);
    // O contexto NUNCA vem do corpo da requisição — só do token assinado.
    req.auth = {
      userId: p.sub,
      barbershopId: p.bsid,
      role: p.role,
      barberId: p.barberId || null,
      customerId: p.customerId || null,
    };
    return next();
  } catch {
    return next(unauthorized('Token inválido ou expirado'));
  }
}

// ---- Admin key: protege rotas privadas com chave estática (só para você)
export function adminKeyOnly(req, _res, next) {
  if (!env.adminApiKey) return next(forbidden('Rota admin não configurada'));
  const h = req.headers.authorization || '';
  const key = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!key || key !== env.adminApiKey) return next(unauthorized('Chave admin inválida'));
  return next();
}

// ---- RBAC: restringe por papel
export const rbac = (...roles) => (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  if (!roles.includes(req.auth.role)) return next(forbidden('Perfil sem acesso a este recurso'));
  return next();
};

// atalhos de papel
export const staffOnly = rbac('owner', 'manager', 'receptionist');
export const ownerOnly = rbac('owner', 'manager');

// ---- Validação de payloads (zod). schema = { body, params, query }
export const validate = (schema) => (req, _res, next) => {
  try {
    if (schema.body) req.body = schema.body.parse(req.body ?? {});
    if (schema.params) req.params = schema.params.parse(req.params ?? {});
    if (schema.query) req.query = schema.query.parse(req.query ?? {});
    next();
  } catch (e) {
    next(e);
  }
};

// ---- Tratamento global de erros (mapeia zod / pg / AppError)
export function errorHandler(err, req, res, _next) {
  // Validação
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: 'validation',
      message: 'Payload inválido',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  // Erros de aplicação
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
  }
  // Erros do PostgreSQL (incl. regras de negócio dos triggers e RLS)
  if (err && err.code) {
    const map = {
      '23505': [409, 'conflict', 'Registro duplicado'],            // unique_violation
      '23P01': [409, 'overbooking', 'Horário em conflito (sobreposição)'], // exclusion_violation
      '23503': [400, 'fk_violation', 'Referência inválida'],       // foreign_key
      '23514': [400, 'check_violation', 'Valor fora das regras'],  // check
      '23502': [400, 'not_null', 'Campo obrigatório ausente'],     // not_null
      P0001: [400, 'business_rule', err.message?.replace(/^.*?:\s*/, '') || 'Regra de negócio'], // RAISE EXCEPTION
      '42501': [403, 'forbidden', 'Acesso negado pela política de segurança (RLS)'],
    };
    const hit = map[err.code];
    if (hit) {
      const [status, code, message] = hit;
      return res.status(status).json({ error: code, message });
    }
  }
  req.log?.error({ err }, 'erro não tratado');
  logger.error({ err: err?.message, stack: err?.stack }, 'unhandled error');
  return res.status(500).json({ error: 'internal', message: 'Erro interno' });
}
