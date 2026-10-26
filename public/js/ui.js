const $ = (selector, parent = document) => parent.querySelector(selector);
const escapeInitial = (value) => [...(value || '?')][0].toLocaleUpperCase('es');

export function setConnection(state) {
  const labels = { connected: 'Conectado', disconnected: 'Desconectado', reconnecting: 'Reconectando', connecting: 'Conectando' };
  $('#connection-status').textContent = labels[state] || 'Desconectado';
  $('#connection-dot').className = `connection-dot ${state}`;
}
export function setUsers(users) {
  $('#user-count').textContent = String(users.length);
  $('#header-count').textContent = `${users.length} ${users.length === 1 ? 'persona' : 'personas'}`;
  const list = $('#user-list');
  list.replaceChildren();
  for (const user of users) {
    const item = document.createElement('li'); item.className = 'user-item';
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = escapeInitial(user.name);
    const copy = document.createElement('span'); copy.className = 'user-copy';
    const name = document.createElement('strong'); name.textContent = user.name;
    const presence = document.createElement('small'); presence.textContent = user.presence === 'away' ? 'Ausente' : 'En línea';
    copy.append(name, presence); const dot = document.createElement('span'); dot.className = `presence-dot ${user.presence}`; dot.setAttribute('aria-label', presence.textContent);
    item.append(avatar, copy, dot); list.append(item);
  }
}
function renderReactionButtons(message, callbacks) {
  const row = document.createElement('div'); row.className = 'reaction-row';
  for (const emoji of ['👍', '❤️', '😂']) {
    const users = message.reactions?.[emoji] || [];
    const button = document.createElement('button'); button.type = 'button'; button.className = `reaction ${users.length ? 'has-reactions' : ''}`;
    button.textContent = `${emoji}${users.length ? ` ${users.length}` : ''}`; button.setAttribute('aria-label', `Reaccionar con ${emoji}`);
    button.addEventListener('click', () => callbacks.react(message.id, emoji)); row.append(button);
  }
  return row;
}
export function renderMessages(messages, currentUserId, callbacks, filter = '') {
  const list = $('#messages'); const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const term = filter.trim().toLocaleLowerCase('es');
  list.replaceChildren();
  for (const message of messages) {
    if (term && !`${message.author} ${message.text}`.toLocaleLowerCase('es').includes(term)) continue;
    const item = document.createElement('li'); item.className = `message${message.pinned ? ' is-pinned' : ''}`; item.dataset.messageId = message.id;
    const avatar = document.createElement('span'); avatar.className = 'avatar message-avatar'; avatar.textContent = escapeInitial(message.author);
    const content = document.createElement('div'); content.className = 'message-content';
    const meta = document.createElement('div'); meta.className = 'message-meta';
    const author = document.createElement('strong'); author.textContent = message.author;
    const time = document.createElement('time'); time.dateTime = message.time; time.textContent = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.time));
    meta.append(author, time);
    if (message.edited) { const edited = document.createElement('span'); edited.className = 'edited-mark'; edited.textContent = 'editado'; meta.append(edited); }
    if (message.pinned) { const pinned = document.createElement('span'); pinned.className = 'pinned-mark'; pinned.textContent = 'Fijado'; meta.append(pinned); }
    content.append(meta);
    if (message.reply) { const quote = document.createElement('button'); quote.type = 'button'; quote.className = 'reply-quote'; quote.textContent = `↳ ${message.reply.author}: ${message.reply.text}`; quote.addEventListener('click', () => document.querySelector(`[data-message-id="${CSS.escape(message.reply.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); content.append(quote); }
    const text = document.createElement('p'); text.className = 'message-text'; text.textContent = message.text; content.append(text, renderReactionButtons(message, callbacks));
    if (message.authorId === currentUserId) {
      const actions = document.createElement('div'); actions.className = 'message-actions';
      const addAction = (label, action, title = label) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title; button.addEventListener('click', action); actions.append(button); };
      addAction('Responder', () => callbacks.reply(message));
      addAction(message.pinned ? 'Desfijar' : 'Fijar', () => callbacks.pin(message.id));
      addAction('Editar', () => callbacks.edit(message));
      addAction('Eliminar', () => callbacks.remove(message.id));
      content.append(actions);
    }
    item.append(avatar, content); list.append(item);
  }
  if (atBottom) list.scrollTop = list.scrollHeight;
}
export function setPinned(message) {
  const bar = $('#pinned-bar');
  bar.hidden = !message;
  $('#pinned-text').textContent = message ? `${message.author}: ${message.text}` : '';
}
export function setTyping(names) { $('#typing-indicator').textContent = names.length ? `${names.join(', ')} ${names.length === 1 ? 'está escribiendo' : 'están escribiendo'}…` : ''; }
export function toast(text) { const element = $('#toast'); element.textContent = text; element.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('visible'), 2800); }
export function showChat(name) {
  $('#login-view').hidden = true; $('#chat-view').hidden = false;
  $('#my-name').textContent = name; $('#my-avatar').textContent = escapeInitial(name);
}
export function showLogin(message = '') { $('#chat-view').hidden = true; $('#login-view').hidden = false; $('#login-error').textContent = message; }
export function setReply(message, cancel) {
  const bar = $('#reply-bar'); bar.hidden = !message; bar.replaceChildren();
  if (!message) return;
  const text = document.createElement('span'); text.textContent = `Respondiendo a ${message.author}: ${message.text}`;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Cancelar respuesta'); close.addEventListener('click', cancel);
  bar.append(text, close);
}
export function setUnread(count) { const badge = $('#unread-badge'); badge.hidden = !count; badge.textContent = `${count} ${count === 1 ? 'mensaje nuevo' : 'mensajes nuevos'} · vuelve al chat`; }
export const element = (selector) => $(selector);
