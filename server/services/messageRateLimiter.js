const WINDOW_MS = 10_000;
const MAX_MESSAGES = 12;

/** Sliding-window per-identity guard shared by every socket for that user. */
export class MessageRateLimiter {
  #sentAtByUser = new Map();

  check(userId, now = Date.now()) {
    const recent = (this.#sentAtByUser.get(userId) || []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= MAX_MESSAGES) {
      const retryAfter = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
      this.#sentAtByUser.set(userId, recent);
      throw new Error(`Estás enviando mensajes muy rápido. Espera ${retryAfter} s.`);
    }
    recent.push(now);
    this.#sentAtByUser.set(userId, recent);
  }

  remove(userId) { this.#sentAtByUser.delete(userId); }
  clear() { this.#sentAtByUser.clear(); }
}
