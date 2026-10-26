import { randomUUID } from 'node:crypto';
import { cleanText, MAX_HISTORY, MAX_MESSAGE_LENGTH, REACTIONS } from '../utils/events.js';

export class ChatService {
  #messages = [];
  list() { return this.#messages.map((message) => structuredClone(message)); }
  #find(id) {
    const message = this.#messages.find((entry) => entry.id === id);
    if (!message) throw new Error('El mensaje ya no existe.');
    return message;
  }
  create(user, text, replyTo = null) {
    const content = cleanText(text, MAX_MESSAGE_LENGTH, 'Mensaje');
    let reply = null;
    if (replyTo !== null) {
      const parent = this.#find(replyTo);
      reply = { id: parent.id, author: parent.author, text: parent.text.slice(0, 160) };
    }
    const message = { id: randomUUID(), authorId: user.id, author: user.name, text: content, time: new Date().toISOString(), edited: false, pinned: false, reactions: {}, reply };
    this.#messages.push(message);
    if (this.#messages.length > MAX_HISTORY) this.#messages.shift();
    return structuredClone(message);
  }
  edit(id, user, text) {
    const message = this.#find(id);
    if (message.authorId !== user.id) throw new Error('Solo el autor puede editar este mensaje.');
    message.text = cleanText(text, MAX_MESSAGE_LENGTH, 'Mensaje');
    message.edited = true;
    return structuredClone(message);
  }
  delete(id, user) {
    const index = this.#messages.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('El mensaje ya no existe.');
    if (this.#messages[index].authorId !== user.id) throw new Error('Solo el autor puede eliminar este mensaje.');
    this.#messages.splice(index, 1);
    for (const message of this.#messages) {
      if (message.reply?.id === id) message.reply = { ...message.reply, text: 'Mensaje eliminado' };
    }
    return id;
  }
  toggleReaction(id, user, emoji) {
    if (!REACTIONS.has(emoji)) throw new Error('Reacción no permitida.');
    const message = this.#find(id);
    const reactors = new Set(message.reactions[emoji] ?? []);
    if (reactors.has(user.id)) reactors.delete(user.id); else reactors.add(user.id);
    if (reactors.size) message.reactions[emoji] = [...reactors]; else delete message.reactions[emoji];
    return structuredClone(message);
  }
  togglePin(id, user) {
    const message = this.#find(id);
    if (message.authorId !== user.id) throw new Error('Solo el autor puede fijar o desfijar este mensaje.');
    message.pinned = !message.pinned;
    return structuredClone(message);
  }
}
