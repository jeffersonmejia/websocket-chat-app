import { EVENTS, parseFrame } from '../utils/events.js';
import { handleMessageEvent } from './messageHandler.js';
import { handleUserEvent } from './userHandler.js';

export function attachConnectionHandlers(server, users, chat) {
  const typing = new Map();
  const send = (ws, type, payload) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type, payload }));
  };
  const broadcast = (type, payload, except = null) => {
    for (const client of server.clients) if (client !== except && client.readyState === 1) send(client, type, payload);
  };
  server.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      let frame;
      try { frame = parseFrame(data); }
      catch (error) { send(ws, EVENTS.ERROR, { message: error.message }); return; }
      try {
        const handled = handleUserEvent({ ws, ...frame, users, chat, broadcast, send });
        if (!handled) handleMessageEvent({ ws, ...frame, users, chat, broadcast, send, typing });
      } catch (error) {
        send(ws, EVENTS.ERROR, { message: error.message, requestId: frame.requestId });
      }
    });
    ws.on('close', () => {
      const user = users.remove(ws);
      if (!user) return;
      clearTimeout(typing.get(user.id));
      typing.delete(user.id);
      broadcast(EVENTS.LEAVE, { user: { id: user.id, name: user.name } });
      broadcast(EVENTS.USERS, { users: users.list(), count: users.list().length });
    });
    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    for (const ws of server.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const timer of typing.values()) clearTimeout(timer);
    typing.clear();
  });
}
