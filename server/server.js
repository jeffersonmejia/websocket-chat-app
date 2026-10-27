import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UserService } from './services/userService.js';
import { ChatService } from './services/chatService.js';
import { UploadService, MAX_ATTACHMENT_SIZE } from './services/uploadService.js';
import { attachConnectionHandlers } from './socket/connectionHandler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createChatServer() {
  const app = express();
  app.disable('x-powered-by');
  const users = new UserService();
  const chat = new ChatService();
  const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || path.join(root, '.chat-uploads'));
  const uploads = new UploadService(uploadDirectory);
  app.post('/api/uploads', express.raw({ type: () => true, limit: MAX_ATTACHMENT_SIZE }), async (req, res, next) => {
    try {
      const user = users.getById(req.get('X-Chat-User-Id'));
      if (!user) return res.status(401).json({ message: 'Ingresa al chat antes de subir archivos.' });
      const attachment = await uploads.create(user.id, req.query.name, req.get('Content-Type'), req.body);
      return res.status(201).json({ attachment });
    } catch (error) { return next(error); }
  });
  app.delete('/api/uploads/:id', async (req, res) => {
    const user = users.getById(req.get('X-Chat-User-Id'));
    if (!user) return res.status(401).json({ message: 'Ingresa al chat antes de gestionar archivos.' });
    await uploads.remove(req.params.id, user.id);
    return res.status(204).end();
  });
  app.get('/api/uploads/:id', async (req, res, next) => {
    try {
      const file = await uploads.get(req.params.id);
      if (!file) return res.status(404).json({ message: 'El archivo ya no está disponible.' });
      const disposition = file.inline ? 'inline' : 'attachment';
      res.set({ 'Content-Type': file.type, 'Content-Length': String(file.size), 'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
      return res.send(file.data);
    } catch (error) { return next(error); }
  });
  app.use((error, _req, res, _next) => {
    if (error.status === 413 || error.type === 'entity.too.large') return res.status(413).json({ message: 'La imagen supera el límite de 5 MB.' });
    return res.status(400).json({ message: error.message || 'No se pudo cargar el archivo.' });
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(express.static(path.join(root, 'public'), {
    setHeaders(res, filePath) {
      if (/\.(?:html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store');
    },
  }));
  const httpServer = createServer(app);
  // Debe ser igual o mayor que MAX_PAYLOAD_LENGTH en utils/events.js. El
  // servidor WebSocket aplica este tope antes del manejador de mensajes; si
  // aquí queda el antiguo límite de 8 KB, una oferta/respuesta SDP grande se
  // descarta antes de que callService pueda reenviarla al otro participante.
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 65_536 });
  attachConnectionHandlers(wsServer, users, chat, uploads);
  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') { socket.destroy(); return; }
    wsServer.handleUpgrade(request, socket, head, (ws) => wsServer.emit('connection', ws, request));
  });
  return { app, httpServer, wsServer, users, chat, uploads };
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
