import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './config/env.js';

// ---- Erros de aplicação ----
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m, d) => new AppError(400, 'bad_request', m, d);
export const unauthorized = (m = 'Não autenticado') => new AppError(401, 'unauthorized', m);
export const forbidden = (m = 'Sem permissão') => new AppError(403, 'forbidden', m);
export const notFound = (m = 'Não encontrado') => new AppError(404, 'not_found', m);
export const conflict = (m, d) => new AppError(409, 'conflict', m, d);

// ---- Senha ----
export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// ---- JWT ----
export function signAccess(payload) {
  return jwt.sign(payload, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl });
}
export function signRefresh(payload) {
  return jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshTtl });
}
export function verifyAccess(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}
export function verifyRefresh(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- Slug ----
export function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

// ---- Telefone (normaliza para dígitos; base de anti-duplicidade) ----
export function normalizePhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
