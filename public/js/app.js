import { ChatSocket } from './socket.js';
import { element, renderMessages, setConnection, setPinned, setReply, setTyping, setUnread, setUsers, showChat, showLogin, toast } from './ui.js';

const socket = new ChatSocket();
const storeKey = 'chatea-identity';
let identity = null;
let userId = null;
let messages = [];
let users = [];
let replyTo = null;
let search = '';
let unread = 0;
let typingTimer = null;
let wasTyping = false;
const typingUsers = new Map();

function render() {
  renderMessages(messages, userId, {
    react: (id, emoji) => socket.send('reaction:toggle', { id, emoji }),
    reply: (message) => { replyTo = message.id; setReply(message, () => { replyTo = null; setReply(null); }); element('#message-input').focus(); },
    edit: (message) => { const text = prompt('Edita tu mensaje:', message.text); if (text !== null) socket.send('message:edit', { id: message.id, text }); },
    remove: (id) => { if (confirm('¿Eliminar este mensaje?')) socket.send('message:delete', { id }); },
    pin: (id) => socket.send('message:pin', { id }),
  }, search);
  setPinned(messages.find((message) => message.pinned) || null);
}
function connect(name, id = crypto.randomUUID()) {
  identity = { id, name };
  sessionStorage.setItem(storeKey, JSON.stringify({ name }));
  showChat(name);
  socket.connect(identity);
}
function updateTyping() {
  if (!identity) return;
  if (!wasTyping) { socket.send('typing:start'); wasTyping = true; }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { if (wasTyping) socket.send('typing:stop'); wasTyping = false; }, 1400);
}

socket.addEventListener('state', ({ detail }) => {
  setConnection(detail.state);
  if (detail.state !== 'connected') setUsers([]);
});
socket.addEventListener('retry', ({ detail }) => toast(`Conexión interrumpida. Reintento ${detail.attempt} en ${Math.ceil(detail.delay / 1000)} s.`));
socket.addEventListener('transport-error', () => setConnection('disconnected'));
socket.addEventListener('protocol-error', ({ detail }) => toast(detail.message));
socket.addEventListener('event', ({ detail: frame }) => {
  const payload = frame.payload || {};
  switch (frame.type) {
    case 'chat:sync':
      userId = payload.user.id; identity.id = userId; sessionStorage.setItem(storeKey, JSON.stringify({ name: identity.name }));
      messages = payload.messages || []; users = payload.users || []; setUsers(users); render(); break;
    case 'users:list': users = payload.users || []; setUsers(users); break;
    case 'user:join': toast(`${payload.user.name} entró al chat.`); break;
    case 'user:leave': toast(`${payload.user.name} salió del chat.`); typingUsers.delete(payload.user.id); setTyping([...typingUsers.values()]); break;
    case 'message:new':
      if (!messages.some((message) => message.id === payload.message.id)) {
        messages.push(payload.message); render();
        if (payload.message.authorId !== userId && (document.hidden || !document.hasFocus())) { unread += 1; setUnread(unread); }
      }
      break;
    case 'message:edit': case 'reaction:toggle': case 'message:pin':
      messages = messages.map((message) => message.id === payload.message.id ? payload.message : message); render(); break;
    case 'message:delete':
      messages = messages.filter((message) => message.id !== payload.id);
      messages = messages.map((message) => message.reply?.id === payload.id ? { ...message, reply: { ...message.reply, text: 'Mensaje eliminado' } } : message);
      render(); break;
    case 'typing:start': typingUsers.set(payload.userId, payload.name); setTyping([...typingUsers.values()]); break;
    case 'typing:stop': typingUsers.delete(payload.userId); setTyping([...typingUsers.values()]); break;
    case 'presence:update': users = users.map((user) => user.id === payload.user.id ? payload.user : user); setUsers(users); break;
    case 'error': toast(payload.message || 'No se pudo completar la operación.'); break;
  }
});

element('#login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = element('#name-input').value.trim();
  if (!name || name.length > 24) { showLogin('Escribe un nombre de entre 1 y 24 caracteres.'); return; }
  connect(name);
});
element('#message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = element('#message-input');
  const text = input.value.trim();
  if (!text) return;
  if (!socket.send('message:new', { text, replyTo })) { toast('No hay conexión. El mensaje no se envió.'); return; }
  input.value = ''; replyTo = null; setReply(null); input.style.height = 'auto';
  clearTimeout(typingTimer); if (wasTyping) socket.send('typing:stop'); wasTyping = false;
});
element('#message-input').addEventListener('input', (event) => {
  event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 128)}px`; updateTyping();
});
element('#message-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); element('#message-form').requestSubmit(); }
});
element('#search-toggle').addEventListener('click', () => {
  const panel = element('#search-panel'); panel.hidden = !panel.hidden;
  if (!panel.hidden) element('#search-input').focus(); else { search = ''; element('#search-input').value = ''; render(); }
});
element('#search-input').addEventListener('input', (event) => { search = event.currentTarget.value; render(); });
element('#clear-search').addEventListener('click', () => { element('#search-input').value = ''; search = ''; render(); element('#search-input').focus(); });
element('#presence-button').addEventListener('click', () => {
  const user = users.find((entry) => entry.id === userId);
  if (user) socket.send('presence:update', { presence: user.presence === 'away' ? 'online' : 'away' });
});
function updatePresence() { if (userId) socket.send('presence:update', { presence: document.hidden ? 'away' : 'online' }); }
document.addEventListener('visibilitychange', () => {
  updatePresence();
  if (!document.hidden && document.hasFocus()) { unread = 0; setUnread(0); }
});
window.addEventListener('focus', () => { unread = 0; setUnread(0); updatePresence(); });
window.addEventListener('pagehide', () => { if (wasTyping) socket.send('typing:stop'); });

try {
  const saved = JSON.parse(sessionStorage.getItem(storeKey));
  if (saved?.name) { element('#name-input').value = saved.name; connect(saved.name); }
} catch { sessionStorage.removeItem(storeKey); }
