import http from 'node:http';
import { buildApp } from './app.js';
import { initSocket } from './realtime/socket.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closePools } from './config/db.js';

const app = buildApp();
const server = http.createServer(app);

await initSocket(server);

server.listen(env.port, () => {
  logger.info(`backend ouvindo na porta ${env.port} (${env.nodeEnv})`);
});

async function shutdown(sig) {
  logger.info(`recebido ${sig}, encerrando...`);
  server.close(async () => {
    await closePools();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
