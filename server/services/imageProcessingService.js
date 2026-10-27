import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const workerFile = fileURLToPath(new URL('../workers/imageWorker.js', import.meta.url));

/** Runs CPU-heavy image encoding off the main event loop using a bounded worker pool. */
export class ImageProcessingService {
  #workers = [];
  #queue = [];
  #nextId = 0;
  #closed = false;

  constructor({ size = Math.max(1, Math.min(2, availableParallelism() - 1)), maxQueue = 20 } = {}) {
    this.size = size;
    this.maxQueue = maxQueue;
  }

  process(buffer, type) {
    if (this.#closed) return Promise.reject(new Error('El procesador de imágenes está detenido.'));
    if (!this.#workers.length) {
      for (let index = 0; index < this.size; index += 1) this.#spawnWorker();
    }
    if (this.#queue.length >= this.maxQueue && this.#workers.every((slot) => slot.task)) {
      return Promise.reject(new Error('El servidor está procesando muchas imágenes. Inténtalo de nuevo.'));
    }
    return new Promise((resolve, reject) => {
      this.#queue.push({ id: ++this.#nextId, data: Uint8Array.from(buffer), type, resolve, reject });
      this.#dispatch();
    });
  }

  #spawnWorker() {
    const slot = { worker: new Worker(workerFile), task: null, stopping: false };
    this.#workers.push(slot);
    slot.worker.on('message', (result) => {
      const task = slot.task;
      if (!task || result.id !== task.id) return;
      slot.task = null;
      if (result.error) task.reject(new Error(result.error));
      else task.resolve(Buffer.from(result.data));
      this.#dispatch();
    });
    slot.worker.on('error', (error) => {
      if (slot.task) slot.task.reject(new Error(`Falló el procesamiento de imagen: ${error.message}`));
      slot.task = null;
    });
    slot.worker.on('exit', (code) => {
      this.#workers = this.#workers.filter((entry) => entry !== slot);
      if (slot.task) slot.task.reject(new Error(`El worker de imágenes terminó (${code}).`));
      slot.task = null;
      if (!this.#closed && !slot.stopping) this.#spawnWorker();
      this.#dispatch();
    });
  }

  #dispatch() {
    for (const slot of this.#workers) {
      if (slot.task || !this.#queue.length) continue;
      const task = this.#queue.shift();
      slot.task = task;
      slot.worker.postMessage({ id: task.id, data: task.data.buffer, type: task.type }, [task.data.buffer]);
    }
  }

  async close() {
    this.#closed = true;
    for (const task of this.#queue.splice(0)) task.reject(new Error('El servidor está cerrando.'));
    await Promise.all(this.#workers.map(async (slot) => {
      slot.stopping = true;
      if (slot.task) slot.task.reject(new Error('El servidor está cerrando.'));
      slot.task = null;
      await slot.worker.terminate();
    }));
    this.#workers = [];
  }
}
