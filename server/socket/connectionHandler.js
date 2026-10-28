import { EVENTS, parseFrame } from '../utils/events.js';
import { handleMessageEvent } from './messageHandler.js';
import { handleUserEvent } from './userHandler.js';
import { createCallHandler } from './callHandler.js';
import { MessageRateLimiter } from '../services/messageRateLimiter.js';

export function attachConnectionHandlers(server, users, chat, uploads) {
  const typing = new Map();
  const send = (ws, type, payload) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type, payload }));
  };
  const broadcast = (type, payload, except = null) => {
    for (const client of server.clients) if (client !== except && client.readyState === 1) send(client, type, payload);
  };
  const calls = createCallHandler({ users, send });
  const messageRateLimiter = new MessageRateLimiter();
  server.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      let frame;
      try { frame = parseFrame(data); }
      catch (error) { send(ws, EVENTS.ERROR, { message: error.message }); return; }
      try {
        if (frame.type === EVENTS.JOIN && typeof frame.payload.id === 'string') {
          const prior = users.getById(frame.payload.id);
          if (prior && prior.ws !== ws) calls.disconnected(prior.id);
        }
        const handled = handleUserEvent({ ws, ...frame, users, chat, broadcast, send });
        if (!handled && !calls.handle({ ws, ...frame })) handleMessageEvent({ ws, ...frame, users, chat, uploads, broadcast, send, typing, messageRateLimiter });
      } catch (error) {
        send(ws, EVENTS.ERROR, { message: error.message, requestId: frame.requestId });
      }
    });
    ws.on('close', () => {
      const user = users.remove(ws);
      if (!user) return;
      calls.disconnected(user.id);
      clearTimeout(typing.get(user.id));
      typing.delete(user.id);
      messageRateLimiter.remove(user.id);
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
    calls.close();
    clearInterval(heartbeat);
    for (const timer of typing.values()) clearTimeout(timer);
    typing.clear();
  });
}
