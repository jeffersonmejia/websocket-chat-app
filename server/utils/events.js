export const MAX_NAME_LENGTH = 24;
export const MAX_MESSAGE_LENGTH = 2000;
// Límite total, en bytes UTF-8, de cada mensaje WebSocket recibido. En chat
// ordinario los mensajes son pequeños, pero la señalización WebRTC transporta
// ofertas/respuestas SDP con capacidades de audio y video, códecs, formatos y
// parámetros ICE; según el navegador, esos datos pueden superar 8 KB. Este
// límite debe coincidir con `maxPayload` del WebSocketServer para que el frame
// no sea rechazado antes de llegar a `parseFrame`. 64 KB admite SDP de tamaño
// razonable y mantiene un máximo explícito contra frames desmesurados.
export const MAX_PAYLOAD_LENGTH = 65_536;
export const MAX_HISTORY = 200;
export const REACTIONS = new Set(['👍', '❤️', '😂']);
export const PRESENCE = new Set(['online', 'away']);

export const EVENTS = Object.freeze({
  JOIN: 'user:join', LEAVE: 'user:leave', USERS: 'users:list',
  NEW: 'message:new', EDIT: 'message:edit', DELETE: 'message:delete',
  REACTION: 'reaction:toggle', REPLY: 'message:reply', PIN: 'message:pin',
  TYPING_START: 'typing:start', TYPING_STOP: 'typing:stop',
  PRESENCE: 'presence:update', SYNC: 'chat:sync', ERROR: 'error',
  CALL_START: 'call:start', CALL_END: 'call:end', CALL_STATE: 'call:state',
  CALL_JOIN: 'call:join', CALL_AVAILABLE: 'call:available',
  CALL_PARTICIPANT_JOINED: 'call:participant-joined', CALL_PARTICIPANT_LEFT: 'call:participant-left',
  WEBRTC_OFFER: 'webrtc:offer', WEBRTC_ANSWER: 'webrtc:answer', WEBRTC_ICE: 'webrtc:ice-candidate',
  CALL_MEDIA_STATE: 'call:media-state',
});

export function parseFrame(data) {
  const text = typeof data === 'string' ? data : data.toString('utf8');
  if (Buffer.byteLength(text, 'utf8') > MAX_PAYLOAD_LENGTH) throw new Error('El mensaje supera el tamaño permitido.');
  const frame = JSON.parse(text);
  if (!frame || typeof frame !== 'object' || Array.isArray(frame) || typeof frame.type !== 'string' || !frame.type) {
    throw new Error('Formato de evento inválido.');
  }
  if (frame.requestId !== undefined && (typeof frame.requestId !== 'string' || frame.requestId.length > 80)) {
    throw new Error('requestId inválido.');
  }
  if (frame.payload !== undefined && (!frame.payload || typeof frame.payload !== 'object' || Array.isArray(frame.payload))) {
    throw new Error('El payload debe ser un objeto.');
  }
  return { type: frame.type, requestId: frame.requestId, payload: frame.payload ?? {} };
}

export function cleanText(value, max, label = 'Texto') {
  if (typeof value !== 'string') throw new Error(`${label} inválido.`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${label}: usa entre 1 y ${max} caracteres.`);
  return text;
}
