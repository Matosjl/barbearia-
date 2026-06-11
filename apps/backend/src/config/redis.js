// Redis é OPCIONAL no MVP/teste. Em produção (Docker) está sempre presente e é
// usado para: adapter do Socket.io (WS com N réplicas), filas e cache.
import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

let client = null;

export function getRedis() {
  if (!env.redisUrl) return null;
  if (!client) {
    client = new Redis(env.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 });
    client.on('error', (e) => logger.warn({ err: e?.message }, 'redis error'));
  }
  return client;
}

export async function redisOk() {
  const r = getRedis();
  if (!r) return null; // não configurado
  try {
    const pong = await r.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
