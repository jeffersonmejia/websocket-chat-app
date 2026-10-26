export class ChatSocket extends EventTarget {
  constructor() { super(); this.socket = null; this.identity = null; this.retry = 0; this.retryTimer = null; this.stopped = true; }
  connect(identity) { this.identity = identity; this.stopped = false; this.#open(); }
  #emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  #open() {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${location.host}/ws`);
    this.socket = socket;
    this.#emit('state', { state: this.retry ? 'reconnecting' : 'connecting' });
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      this.retry = 0;
      this.#emit('state', { state: 'connected' });
      this.send('user:join', this.identity);
    });
    socket.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (!frame || typeof frame.type !== 'string') throw new Error('Evento inválido');
        this.#emit('event', frame);
      } catch { this.#emit('protocol-error', { message: 'Se recibió un evento inválido del servidor.' }); }
    });
    socket.addEventListener('error', () => this.#emit('transport-error'));
    socket.addEventListener('close', () => {
      if (socket !== this.socket || this.stopped) return;
      this.#emit('state', { state: 'disconnected' });
      this.retry += 1;
      const delay = Math.min(10000, 400 * (2 ** Math.min(this.retry - 1, 5)));
      this.#emit('retry', { attempt: this.retry, delay });
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (!this.stopped) { this.#emit('state', { state: 'reconnecting' }); this.#open(); }
      }, delay);
    });
  }
  send(type, payload = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, payload }));
    return true;
  }
  close() { this.stopped = true; clearTimeout(this.retryTimer); this.socket?.close(1000, 'Cliente cerrado'); }
}
