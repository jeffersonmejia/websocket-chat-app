import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function matchesImageType(buffer, type) {
  if (type === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/gif') return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6));
  if (type === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function safeName(value = '') {
  const name = path.basename(String(value).replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || 'archivo').slice(0, 180);
}

export class UploadService {
  #records = new Map();
  constructor(directory) { this.directory = directory; }
  async init() { this.initializing = mkdir(this.directory, { recursive: true }); await this.initializing; }
  async create(ownerId, name, type, buffer) {
    await (this.initializing || this.init());
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('El archivo está vacío.');
    if (buffer.length > MAX_ATTACHMENT_SIZE) throw new Error('La imagen supera el límite de 5 MB.');
    const id = randomUUID();
    const normalizedType = String(type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!INLINE_TYPES.has(normalizedType) || !matchesImageType(buffer, normalizedType)) throw new Error('Solo se permiten imágenes JPG, PNG, GIF o WebP válidas.');
    const filePath = path.join(this.directory, id);
    await writeFile(filePath, buffer, { flag: 'wx' });
    const record = { id, ownerId, name: safeName(name), type: normalizedType, size: buffer.length, path: filePath, attached: false };
    this.#records.set(id, record);
    return this.publicRecord(record);
  }
  publicRecord(record) {
    return { id: record.id, name: record.name, type: record.type, size: record.size, url: `/api/uploads/${record.id}` };
  }
  resolveAttachments(items, ownerId) {
    if (!Array.isArray(items) || items.length > MAX_ATTACHMENTS) throw new Error(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos.`);
    const seen = new Set();
    return items.map((item) => {
      const id = typeof item === 'string' ? item : item?.id;
      if (typeof id !== 'string' || seen.has(id)) throw new Error('La lista de adjuntos no es válida.');
      seen.add(id);
      const record = this.#records.get(id);
      if (!record || record.ownerId !== ownerId || record.attached) throw new Error('Uno de los archivos ya no está disponible. Vuelve a adjuntarlo.');
      return this.publicRecord(record);
    });
  }
  markAttached(items) { for (const item of items) { const record = this.#records.get(item.id); if (record) record.attached = true; } }
  async remove(id, ownerId) {
    const record = this.#records.get(id);
    if (!record || record.ownerId !== ownerId || record.attached) return false;
    this.#records.delete(id);
    await rm(record.path, { force: true });
    return true;
  }
  async get(id) {
    const record = this.#records.get(id);
    return record ? { ...this.publicRecord(record), path: record.path, inline: INLINE_TYPES.has(record.type), data: await readFile(record.path) } : null;
  }
}
