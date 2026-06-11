/**
 * socket.js — Socket.io client (real-time updates).
 *
 * Eventos emitidos pelo backend:
 *   appointment.hold_created | appointment.confirmed | appointment.canceled
 *   appointment.rescheduled  | appointment.checked_in | appointment.started
 *   appointment.completed    | dashboard.updated
 */

import { io } from 'socket.io-client';
import { getTokens } from './api';

const BASE = import.meta.env.VITE_API_URL ?? '';

let socket = null;

export function connectSocket() {
  if (socket?.connected) return socket;

  const { accessToken } = getTokens() ?? {};

  socket = io(BASE, {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on('connect_error', (err) => {
    console.warn('[socket] connect_error:', err.message);
  });

  return socket;
}

export function getSocket() { return socket; }

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
