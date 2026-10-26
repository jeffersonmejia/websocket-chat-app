import { EVENTS } from '../utils/events.js';

export function handleMessageEvent({ ws, type, payload, users, chat, broadcast, send, typing }) {
  const user = users.getBySocket(ws);
  if (!user) throw new Error('Ingresa con tu nombre antes de usar el chat.');
  switch (type) {
    case EVENTS.NEW: {
      const message = chat.create(user, payload.text, payload.replyTo ?? null);
      broadcast(EVENTS.NEW, { message });
      send(ws, 'message:sent', { id: message.id });
      break;
    }
    case EVENTS.EDIT: {
      const message = chat.edit(payload.id, user, payload.text);
      broadcast(EVENTS.EDIT, { message });
      break;
    }
    case EVENTS.DELETE: {
      const id = chat.delete(payload.id, user);
      broadcast(EVENTS.DELETE, { id });
      break;
    }
    case EVENTS.REACTION: {
      const message = chat.toggleReaction(payload.id, user, payload.emoji);
      broadcast(EVENTS.REACTION, { message });
      break;
    }
    case EVENTS.PIN: {
      const message = chat.togglePin(payload.id, user);
      broadcast(EVENTS.PIN, { message });
      break;
    }
    case EVENTS.TYPING_START:
    case EVENTS.TYPING_STOP: {
      clearTimeout(typing.get(user.id));
      typing.delete(user.id);
      if (type === EVENTS.TYPING_START) {
        typing.set(user.id, setTimeout(() => {
          typing.delete(user.id);
          broadcast(EVENTS.TYPING_STOP, { userId: user.id, name: user.name });
        }, 5000));
      }
      broadcast(type, { userId: user.id, name: user.name }, ws);
      break;
    }
    default: throw new Error('Evento no reconocido.');
  }
}
