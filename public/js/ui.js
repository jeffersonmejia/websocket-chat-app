const $ = (selector, parent = document) => parent.querySelector(selector);
const renderedMessageNodes = new Map();
const escapeInitial = (value) => [...(value || '?')][0].toLocaleUpperCase('es');
const avatarTone = (id = '') => {
  let hash = 2166136261;
  for (const char of String(id)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Math.abs(hash >>> 0) % 5;
};
const applyAvatarTone = (avatar, id) => {
  for (const className of avatar.classList) if (className.startsWith('avatar-tone-')) avatar.classList.remove(className);
  avatar.classList.add(`avatar-tone-${avatarTone(id)}`);
};
document.addEventListener('pointerdown', ({ target }) => {
  for (const menu of document.querySelectorAll('.message-menu:not([hidden])')) {
    const toolbar = menu.closest('.message-actions');
    if (toolbar?.contains(target)) continue;
    menu.hidden = true;
    toolbar?.querySelector('.message-more')?.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const menu = document.querySelector('.message-menu:not([hidden])');
  if (!menu) return;
  menu.hidden = true;
  const toggle = menu.closest('.message-actions')?.querySelector('.message-more');
  toggle?.setAttribute('aria-expanded', 'false');
  toggle?.focus();
});

export function setConnection(state) {
  const labels = { connected: 'Conectado', disconnected: 'Desconectado', reconnecting: 'Reconectando', connecting: 'Conectando' };
  $('#connection-status').textContent = labels[state] || 'Desconectado';
  $('#connection-dot').className = `connection-dot ${state}`;
}
export function setUsers(users, currentUserId = null) {
  $('#user-count').textContent = String(users.length);
  $('#header-count').textContent = `${users.length} ${users.length === 1 ? 'persona' : 'personas'}`;
  const list = $('#user-list');
  list.replaceChildren();
  for (const user of users) {
    const item = document.createElement('li'); item.className = 'user-item';
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = escapeInitial(user.name);
    applyAvatarTone(avatar, user.id);
    const copy = document.createElement('span'); copy.className = 'user-copy';
    const name = document.createElement('strong'); name.textContent = user.name;
    if (user.id === currentUserId) { item.classList.add('is-current-user'); const marker = document.createElement('span'); marker.className = 'self-marker'; marker.textContent = 'Tú'; name.append(' ', marker); }
    const presence = document.createElement('small'); presence.textContent = user.presence === 'away' ? 'Ausente' : 'En línea';
    copy.append(name, presence); const dot = document.createElement('span'); dot.className = `presence-dot ${user.presence}`; dot.setAttribute('aria-label', presence.textContent);
    item.append(avatar, copy, dot);
    list.append(item);
  }
  const currentUser = users.find((user) => user.id === currentUserId);
  if (currentUser) applyAvatarTone($('#my-avatar'), currentUser.id);
  window.lucide?.createIcons();
}
function renderReactionButtons(message, callbacks, currentUserId) {
  const row = document.createElement('div'); row.className = 'reaction-row';
  const reactionIcons = { '👍': ['thumbs-up', 'Me gusta'], '❤️': ['heart', 'Me encanta'], '😂': ['laugh', 'Me divierte'] };
  for (const [emoji, [iconName, label]] of Object.entries(reactionIcons)) {
    const users = message.reactions?.[emoji] || [];
    const button = document.createElement('button'); button.type = 'button'; button.className = `reaction ${users.length ? 'has-reactions' : ''}`;
    const selected = users.includes(currentUserId);
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${label}${users.length ? `, ${users.length}` : ''}`); button.title = label;
    const icon = document.createElement('i'); icon.dataset.lucide = iconName; button.append(icon);
    if (users.length) { const count = document.createElement('span'); count.textContent = String(users.length); button.append(count); }
    button.addEventListener('click', () => callbacks.react(message.id, emoji)); row.append(button);
  }
  return row;
}
export function renderMessages(messages, currentUserId, callbacks, filter = '', editingMessageId = null) {
  const list = $('#messages'); const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const term = filter.trim().toLocaleLowerCase('es');
  const desiredNodes = [];
  for (const message of messages) {
    if (term && !`${message.author} ${message.text} ${(message.attachments || []).map((file) => file.name).join(' ')}`.toLocaleLowerCase('es').includes(term)) continue;
    const snapshot = JSON.stringify({ message, editing: message.id === editingMessageId });
    const cached = renderedMessageNodes.get(message.id);
    if (cached?.snapshot === snapshot) { desiredNodes.push(cached.node); continue; }
    const item = document.createElement('li'); item.className = `message${message.pinned ? ' is-pinned' : ''}${message.authorId === currentUserId ? ' mine' : ''}`; item.dataset.messageId = message.id;
    const avatar = document.createElement('span'); avatar.className = 'avatar message-avatar'; avatar.textContent = escapeInitial(message.author);
    applyAvatarTone(avatar, message.authorId);
    const content = document.createElement('div'); content.className = 'message-content';
    const meta = document.createElement('div'); meta.className = 'message-meta';
    const author = document.createElement('strong'); author.textContent = message.author;
    if (message.authorId === currentUserId) { const marker = document.createElement('span'); marker.className = 'mine-marker'; marker.textContent = 'Tú'; author.append(' ', marker); }
    const time = document.createElement('time'); time.dateTime = message.time; time.textContent = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.time));
    meta.append(author, time);
    if (message.edited) { const edited = document.createElement('span'); edited.className = 'edited-mark'; edited.textContent = 'editado'; meta.append(edited); }
    if (message.pinned) { const pinned = document.createElement('span'); pinned.className = 'pinned-mark'; pinned.textContent = 'Fijado'; meta.append(pinned); }
    content.append(meta);
    if (message.reply) { const quote = document.createElement('button'); quote.type = 'button'; quote.className = 'reply-quote'; quote.textContent = `${message.reply.author}: ${message.reply.text}`; quote.addEventListener('click', () => document.querySelector(`[data-message-id="${CSS.escape(message.reply.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); content.append(quote); }
    if (message.id === editingMessageId && message.text) {
      const editor = document.createElement('form'); editor.className = 'message-editor';
      const input = document.createElement('textarea'); input.className = 'message-editor-input'; input.value = message.text; input.maxLength = 2000; input.setAttribute('aria-label', 'Editar mensaje');
      const footer = document.createElement('div'); footer.className = 'message-editor-footer';
      const hint = document.createElement('span'); hint.textContent = 'Esc cancelar · Enter guardar · Shift+Enter nueva línea';
      const buttons = document.createElement('div'); buttons.className = 'message-editor-buttons';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'message-editor-cancel'; cancel.textContent = 'Cancelar'; cancel.addEventListener('click', callbacks.cancelEdit);
      const save = document.createElement('button'); save.type = 'submit'; save.className = 'message-editor-save'; save.textContent = 'Guardar';
      buttons.append(cancel, save); footer.append(hint, buttons); editor.append(input, footer);
      editor.addEventListener('submit', (event) => { event.preventDefault(); callbacks.saveEdit(message, input.value); });
      editor.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); callbacks.cancelEdit(); }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); editor.requestSubmit(); }
      });
      content.append(editor);
      queueMicrotask(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
    } else {
      if (message.text) { const text = document.createElement('p'); text.className = 'message-text'; text.textContent = message.text; content.append(text); }
      const attachments = document.createElement('div'); attachments.className = 'message-attachments';
      for (const file of message.attachments || []) {
        const image = /^image\/(jpeg|png|gif|webp)$/i.test(file.type || '');
        if (image) {
          const link = document.createElement('a'); link.className = 'attachment-image-link'; link.href = file.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Abrir ${file.name}`);
          const preview = document.createElement('img'); preview.src = file.url; preview.alt = file.name; preview.loading = 'lazy';
          preview.addEventListener('error', () => { link.classList.add('attachment-image-error'); link.replaceChildren(document.createTextNode(`No se pudo cargar ${file.name}`)); });
          link.append(preview); attachments.append(link);
        } else {
          const link = document.createElement('a'); link.className = 'attachment-file'; link.href = file.url; link.download = file.name;
          const icon = document.createElement('i'); icon.dataset.lucide = 'file-text';
          const copy = document.createElement('span'); copy.className = 'attachment-file-copy';
          const name = document.createElement('strong'); name.textContent = file.name;
          const size = document.createElement('small'); size.textContent = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
          copy.append(name, size); link.append(icon, copy); attachments.append(link);
        }
      }
      if (attachments.childElementCount) content.append(attachments);
      const reactions = renderReactionButtons(message, callbacks, currentUserId);
      reactions.hidden = !Object.values(message.reactions || {}).some((users) => users.length);
      content.append(reactions);
    }
    if (message.id !== editingMessageId) {
      const isOwnMessage = message.authorId === currentUserId;
      const actions = document.createElement('div'); actions.className = 'message-actions';
      const reactionToggle = document.createElement('button'); reactionToggle.type = 'button'; reactionToggle.className = 'message-tool';
      const reactionRow = content.querySelector('.reaction-row');
      reactionToggle.setAttribute('aria-label', 'Añadir reacción'); reactionToggle.setAttribute('aria-expanded', String(!reactionRow.hidden));
      const reactionIcon = document.createElement('i'); reactionIcon.dataset.lucide = 'smile'; reactionToggle.append(reactionIcon);
      reactionToggle.addEventListener('click', () => {
        reactionRow.hidden = !reactionRow.hidden;
        reactionToggle.setAttribute('aria-expanded', String(!reactionRow.hidden));
      });
      const more = document.createElement('button'); more.type = 'button'; more.className = 'message-tool message-more';
      more.setAttribute('aria-label', 'Más opciones'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.title = 'Más opciones';
      const moreIcon = document.createElement('i'); moreIcon.dataset.lucide = 'ellipsis'; more.append(moreIcon);
      const menu = document.createElement('div'); menu.className = 'message-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
      const addAction = (label, action, className = '') => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.setAttribute('role', 'menuitem'); if (className) button.classList.add(className);
        button.addEventListener('click', () => { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); action(); });
        menu.append(button);
      };
      addAction(message.pinned ? 'Quitar fijado' : 'Fijar mensaje', () => callbacks.pin(message.id));
      addAction('Responder', () => callbacks.reply(message));
      if (isOwnMessage) {
        if (message.text) addAction('Editar mensaje', () => callbacks.edit(message));
        addAction('Eliminar mensaje', () => callbacks.remove(message.id), 'danger');
      }
      more.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
        more.setAttribute('aria-expanded', String(!menu.hidden));
        if (!menu.hidden) {
          const conversation = menu.closest('.conversation');
          const panel = conversation?.getBoundingClientRect();
          const actions = menu.parentElement?.getBoundingClientRect();
          if (panel && actions) {
            const width = Math.max(0, Math.min(176, panel.width - 24));
            const left = Math.max(panel.left + 12, Math.min(actions.right - width, panel.right - 12 - width));
            menu.style.width = `${width}px`;
            menu.style.left = `${left - actions.left}px`;
            menu.style.right = 'auto';
          }
        } else {
          menu.style.removeProperty('width');
          menu.style.removeProperty('left');
          menu.style.removeProperty('right');
        }
      });
      actions.append(reactionToggle, more, menu);
      content.append(actions);
    }
    item.append(avatar, content);
    if (cached) item.classList.add('no-animation');
    renderedMessageNodes.set(message.id, { node: item, snapshot });
    if (cached?.node.isConnected) cached.node.replaceWith(item);
    desiredNodes.push(item);
  }
  const liveIds = new Set(messages.map((message) => message.id));
  for (const id of renderedMessageNodes.keys()) if (!liveIds.has(id)) renderedMessageNodes.delete(id);
  desiredNodes.forEach((node, index) => {
    if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
  });
  while (list.children.length > desiredNodes.length) list.lastElementChild.remove();
  if (atBottom) list.scrollTop = list.scrollHeight;
  window.lucide?.createIcons();
}
export function setPinned(message) {
  const bar = $('#pinned-bar');
  bar.hidden = !message;
  $('#pinned-text').textContent = message ? `${message.author}: ${message.text || (message.attachments || []).map((file) => file.name).join(', ')}` : '';
}
export function setTyping(people) {
  const indicator = $('#typing-indicator');
  indicator.replaceChildren();
  if (!people.length) { indicator.removeAttribute('aria-label'); return; }

  const names = people.map((person) => person.name || 'Alguien');
  const phrase = people.length === 1
    ? `${names[0]} está escribiendo`
    : people.length === 2
      ? `${names[0]} y ${names[1]} están escribiendo`
      : `${names[0]} y ${people.length - 1} más están escribiendo`;
  indicator.setAttribute('aria-label', `${phrase}…`);

  const avatars = document.createElement('span'); avatars.className = 'typing-avatars';
  for (const person of people.slice(0, 3)) {
    const avatar = document.createElement('span'); avatar.className = 'typing-avatar';
    avatar.textContent = escapeInitial(person.name); applyAvatarTone(avatar, person.id);
    avatar.setAttribute('aria-hidden', 'true'); avatars.append(avatar);
  }
  const bubble = document.createElement('span'); bubble.className = 'typing-bubble';
  const label = document.createElement('span'); label.className = 'typing-label'; label.textContent = phrase;
  const dots = document.createElement('span'); dots.className = 'typing-dots'; dots.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 3; index += 1) dots.append(document.createElement('i'));
  bubble.append(label, dots); indicator.append(avatars, bubble);
}
export function toast(text) { const element = $('#toast'); element.textContent = text; element.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('visible'), 2800); }
export function showChat(name) {
  $('#login-view').hidden = true; $('#chat-view').hidden = false;
  $('#my-name').textContent = name; $('#my-avatar').textContent = escapeInitial(name);
}
export function showLogin(message = '') { $('#chat-view').hidden = true; $('#login-view').hidden = false; $('#login-error').textContent = message; }
export function setReply(message, cancel) {
  const bar = $('#reply-bar'); bar.hidden = !message; bar.replaceChildren();
  if (!message) return;
  const text = document.createElement('span'); text.textContent = `Respondiendo a ${message.author}: ${message.text || (message.attachments || []).map((file) => file.name).join(', ')}`;
  const close = document.createElement('button'); close.type = 'button'; close.setAttribute('aria-label', 'Cancelar respuesta');
  const icon = document.createElement('i'); icon.dataset.lucide = 'x'; close.append(icon); close.addEventListener('click', cancel);
  bar.append(text, close);
  window.lucide?.createIcons();
}
export function setUnread(count) { const badge = $('#unread-badge'); badge.hidden = !count; badge.textContent = `${count} ${count === 1 ? 'mensaje nuevo' : 'mensajes nuevos'} · vuelve al chat`; }
export const element = (selector) => $(selector);
