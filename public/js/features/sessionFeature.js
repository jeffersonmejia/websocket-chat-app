import { element, setConnection, showChat, showLogin, toast } from '../ui.js';

/** Owns identity persistence and entry/exit from the chat session. */
export class SessionFeature {
  constructor(socket, state, { chat, call, roster }) {
    this.socket = socket;
    this.state = state;
    this.chat = chat;
    this.call = call;
    this.roster = roster;
    this.storeKey = 'chatea-identity';
    element('#login-form').addEventListener('submit', this.handleLogin);
    element('#leave-button').addEventListener('click', this.leave);
    this.socket.addEventListener('event', this.handleSocketEvent);
    window.addEventListener('pagehide', this.handlePageHide);
    this.restore();
  }
  handleLogin = (event) => {
    event.preventDefault();
    const name = element('#name-input').value.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 24) { showLogin('Escribe un nombre de entre 1 y 24 caracteres.'); return; }
    if (!/^\p{L}+(?: \p{L}+)*$/u.test(name)) { showLogin('Usa solo letras y espacios, sin números ni símbolos.'); return; }
    this.connect(name);
  };
  connect(name, id = crypto.randomUUID()) {
    this.state.chatSkeletonShownAt = performance.now();
    this.state.identity = { id, name };
    sessionStorage.setItem(this.storeKey, JSON.stringify({ name }));
    showChat(name);
    element('#chat-skeleton').hidden = false;
    this.socket.connect(this.state.identity);
  }
  leave = () => {
    this.call.end();
    this.socket.close();
    sessionStorage.removeItem(this.storeKey);
    this.state.identity = null;
    this.state.userId = null;
    this.chat.reset();
    this.call.reset();
    this.roster.reset();
    setConnection('disconnected');
    showLogin();
  };
  handlePageHide = () => this.chat.stopTyping();
  handleSocketEvent = ({ detail: frame }) => {
    if (frame.type !== 'error' || this.state.userId) return;
    this.socket.close();
    sessionStorage.removeItem(this.storeKey);
    this.state.identity = null;
    showLogin(frame.payload?.message || 'No se pudo ingresar al chat.');
  };
  restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.storeKey));
      if (saved?.name) { element('#name-input').value = saved.name; this.connect(saved.name); }
      else showLogin();
    } catch {
      sessionStorage.removeItem(this.storeKey);
      showLogin();
      toast('No se pudo recuperar la sesión guardada.');
    }
  }
  destroy() {
    element('#login-form').removeEventListener('submit', this.handleLogin);
    element('#leave-button').removeEventListener('click', this.leave);
    this.socket.removeEventListener('event', this.handleSocketEvent);
    window.removeEventListener('pagehide', this.handlePageHide);
  }
}
