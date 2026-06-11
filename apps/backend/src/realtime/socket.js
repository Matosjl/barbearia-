// Socket.io: salas por barbearia (shop:{id}) e por barbeiro (barber:{id}).
// Adapter Redis é ativado se REDIS_URL existir -> WS funciona com N réplicas.
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { verifyAccess } from '../utils.js';
import { logger } from '../config/logger.js';

let io = null;

export async function initSocket(httpServer) {
  io = new Server(httpServer, { path: '/socket.io', cors: { origin: true, credentials: true } });

  if (env.redisUrl) {
    const pub = new Redis(env.redisUrl);
    const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
    logger.info('socket.io: adapter Redis ativo (multi-réplica)');
  } else {
    logger.warn('socket.io: sem Redis (single-instance)');
  }

  // Autenticação no handshake: token no auth ou query
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      const p = verifyAccess(token);
      socket.data.ctx = { barbershopId: p.bsid, role: p.role, barberId: p.barberId, userId: p.sub };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { barbershopId, role, barberId } = socket.data.ctx;
    socket.join(`shop:${barbershopId}`);
    if (role === 'barber' && barberId) socket.join(`barber:${barberId}`);
    logger.debug({ barbershopId, role }, 'socket conectado');
  });

  return io;
}

// Emite para a barbearia inteira (dashboard/agenda em tempo real)
export function emitShop(barbershopId, event, payload) {
  if (io) io.to(`shop:${barbershopId}`).emit(event, payload);
}
// Emite só para o feed restrito de um barbeiro
export function emitBarber(barberId, event, payload) {
  if (io) io.to(`barber:${barberId}`).emit(event, payload);
}
