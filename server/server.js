import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UserService } from './services/userService.js';
import { ChatService } from './services/chatService.js';
import { attachConnectionHandlers } from './socket/connectionHandler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createChatServer() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(express.static(path.join(root, 'public')));
  const httpServer = createServer(app);
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  const users = new UserService();
  const chat = new ChatService();
  attachConnectionHandlers(wsServer, users, chat);
  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') { socket.destroy(); return; }
    wsServer.handleUpgrade(request, socket, head, (ws) => wsServer.emit('connection', ws, request));
  });
  return { app, httpServer, wsServer, users, chat };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { httpServer, wsServer } = createChatServer();
  httpServer.listen(port, '0.0.0.0', () => console.log(`Chat listo en http://localhost:${port}`));
  const shutdown = () => {
    wsServer.clients.forEach((client) => client.close(1001, 'Servidor detenido'));
    wsServer.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
