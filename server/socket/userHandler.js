import { EVENTS } from '../utils/events.js';

export function handleUserEvent({ ws, type, payload, users, chat, broadcast, send }) {
  if (type === EVENTS.JOIN) {
    const user = users.join(ws, payload.id, payload.name);
    send(ws, EVENTS.SYNC, { user: { id: user.id, name: user.name }, users: users.list(), messages: chat.list() });
    broadcast(EVENTS.USERS, { users: users.list(), count: users.list().length });
    broadcast(EVENTS.JOIN, { user: { id: user.id, name: user.name } }, ws);
    return true;
  }
  if (type === EVENTS.PRESENCE) {
    const user = users.setPresence(ws, payload.presence);
    broadcast(EVENTS.PRESENCE, { user });
    broadcast(EVENTS.USERS, { users: users.list(), count: users.list().length });
    return true;
  }
  return false;
}
