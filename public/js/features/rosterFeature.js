import { element, setUsers, toast } from '../ui.js';

/** Owns the connected-user roster and its server events. */
export class RosterFeature {
  constructor(socket, state) {
    this.socket = socket;
    this.state = state;
    socket.addEventListener('event', this.handleFrame);
  }
  handleFrame = ({ detail: frame }) => {
    const payload = frame.payload || {};
    switch (frame.type) {
      case 'chat:sync':
        this.finishChatSkeleton();
        this.state.userId = payload.user.id;
        if (this.state.identity) this.state.identity.id = payload.user.id;
        this.state.users = payload.users || [];
        this.render();
        break;
      case 'users:list': this.state.users = payload.users || []; this.render(); break;
      case 'presence:update':
        this.state.users = this.state.users.map((user) => user.id === payload.user.id ? payload.user : user);
        this.render();
        break;
      case 'user:join': toast(`${payload.user.name} entró al chat.`); break;
      case 'user:leave': toast(`${payload.user.name} salió del chat.`); break;
    }
  };
  finishChatSkeleton() {
    const skeleton = element('#chat-skeleton');
    const shownAt = this.state.chatSkeletonShownAt ?? performance.now();
    const remaining = Math.max(0, 650 - (performance.now() - shownAt));
    clearTimeout(this.skeletonTimer);
    this.skeletonTimer = setTimeout(() => { skeleton.hidden = true; }, remaining);
  }
  render() { setUsers(this.state.users, this.state.userId); }
  reset() { clearTimeout(this.skeletonTimer); this.state.users = []; this.render(); }
  destroy() { this.socket.removeEventListener('event', this.handleFrame); }
}
