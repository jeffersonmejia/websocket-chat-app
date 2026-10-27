import { element, setConnection, toast } from '../ui.js';

/** Keeps WebSocket/presence UI independent from chat message behavior. */
export class PresenceFeature {
  constructor(socket, state, chat, roster) {
    this.socket = socket;
    this.state = state;
    this.chat = chat;
    this.roster = roster;
    this.bindSocketEvents();
    this.bindControls();
  }
  handleConnection = ({ detail }) => {
    setConnection(detail.state);
    if (detail.state !== 'connected') {
      this.state.users = [];
      this.roster.reset();
    }
  };
  handleRetry = ({ detail }) => {
    const seconds = Math.ceil(detail.delay / 1000);
    toast(`Conexión interrumpida. Reintento ${detail.attempt} en ${seconds} s.`);
  };
  handleSocketEvent = ({ detail: frame }) => {
    if (frame.type === 'presence:update') this.renderProfile(frame.payload.user);
    if (frame.type === 'chat:sync') this.renderProfile({ name: this.state.identity?.name });
  };
  bindSocketEvents() {
    this.socket.addEventListener('state', this.handleConnection);
    this.socket.addEventListener('retry', this.handleRetry);
    this.socket.addEventListener('transport-error', this.handleTransportError);
    this.socket.addEventListener('protocol-error', this.handleProtocolError);
    this.socket.addEventListener('event', this.handleSocketEvent);
  }
  handleTransportError = () => setConnection('disconnected');
  handleProtocolError = ({ detail }) => toast(detail.message);
  bindControls() {
    element('#presence-button').addEventListener('click', () => this.togglePresence());
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('focus', this.handleFocus);
  }
  togglePresence() {
    const user = this.state.users.find((entry) => entry.id === this.state.userId);
    if (user) this.socket.send('presence:update', { presence: user.presence === 'away' ? 'online' : 'away' });
  }
  updatePresence() {
    if (this.state.userId) this.socket.send('presence:update', { presence: document.hidden ? 'away' : 'online' });
  }
  handleVisibilityChange = () => {
    this.updatePresence();
    if (!document.hidden && document.hasFocus()) this.chat.clearUnread();
  };
  handleFocus = () => { this.chat.clearUnread(); this.updatePresence(); };
  renderProfile(user) {
    if (user.name) {
      element('#my-name').textContent = user.name;
      element('#my-avatar').textContent = [...user.name][0].toLocaleUpperCase('es');
    }
  }
  destroy() {
    this.socket.removeEventListener('state', this.handleConnection);
    this.socket.removeEventListener('retry', this.handleRetry);
    this.socket.removeEventListener('transport-error', this.handleTransportError);
    this.socket.removeEventListener('protocol-error', this.handleProtocolError);
    this.socket.removeEventListener('event', this.handleSocketEvent);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('focus', this.handleFocus);
  }
}
