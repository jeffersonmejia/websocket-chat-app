import { randomUUID } from 'node:crypto';
import { cleanText, MAX_NAME_LENGTH, PRESENCE } from '../utils/events.js';

export class UserService {
  #users = new Map();

  join(ws, requestedId, requestedName) {
    const name = cleanText(requestedName, MAX_NAME_LENGTH, 'Nombre');
    const id = typeof requestedId === 'string' && /^[\w-]{8,80}$/.test(requestedId) ? requestedId : randomUUID();
    const prior = this.#users.get(id);
    if (prior?.ws && prior.ws !== ws) prior.ws.close(4001, 'Sesión reanudada en otra pestaña');
    const user = { id, name, ws, presence: prior?.presence ?? 'online', joinedAt: prior?.joinedAt ?? new Date().toISOString() };
    this.#users.set(id, user);
    return user;
  }

  remove(ws) {
    const user = [...this.#users.values()].find((entry) => entry.ws === ws);
    if (!user) return null;
    this.#users.delete(user.id);
    return user;
  }

  getBySocket(ws) { return [...this.#users.values()].find((user) => user.ws === ws) ?? null; }
  getById(id) { return this.#users.get(id) ?? null; }
  list() { return [...this.#users.values()].map(({ id, name, presence }) => ({ id, name, presence })); }
  setPresence(ws, presence) {
    if (!PRESENCE.has(presence)) throw new Error('Estado de presencia inválido.');
    const user = this.getBySocket(ws);
    if (!user) throw new Error('Primero debes ingresar al chat.');
    user.presence = presence;
    return { id: user.id, name: user.name, presence };
  }
}
