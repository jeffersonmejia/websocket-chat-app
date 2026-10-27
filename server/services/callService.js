import { randomUUID } from 'node:crypto';
import { EVENTS } from '../utils/events.js';

const MAX_SDP_LENGTH = 48_000;
const validId = (value) => typeof value === 'string' && /^[\w-]{8,80}$/.test(value);

/** Owns group call rooms, participant reservations, signaling and cleanup. */
export function createCallService({ users, send }) {
  const calls = new Map();
  const byUser = new Map();

  const deliver = (userId, type, payload) => {
    const recipient = users.getById(userId);
    if (recipient) send(recipient.ws, type, payload);
  };
  const participantList = (call) => [...call.participants.values()].map(({ id, name }) => ({ id, name }));
  const availability = () => {
    const active = [...calls.values()].filter((call) => call.state === 'active');
    for (const user of users.list()) {
      const room = active.find((call) => !call.participants.has(user.id));
      if (!room) deliver(user.id, EVENTS.CALL_AVAILABLE, { callId: null });
      else deliver(user.id, EVENTS.CALL_AVAILABLE, {
        callId: room.callId,
        participants: participantList(room),
        count: room.participants.size,
      });
    }
  };
  const announceAvailability = (user) => {
    const room = [...calls.values()].find((call) => call.state === 'active' && !call.participants.has(user.id));
    deliver(user.id, EVENTS.CALL_AVAILABLE, room ? {
      callId: room.callId,
      participants: participantList(room),
      count: room.participants.size,
    } : { callId: null });
  };
  const getCall = (user, callId) => {
    if (!validId(callId)) throw new Error('Identificador de llamada inválido.');
    const call = calls.get(callId);
    if (!call) throw new Error('La llamada ya no está disponible.');
    return call;
  };

  const start = (user) => {
    if (byUser.has(user.id)) {
      deliver(user.id, EVENTS.CALL_STATE, { state: 'failed', message: 'Ya estás en una llamada.' });
      return;
    }
    if ([...calls.values()].some((call) => call.state === 'active')) {
      deliver(user.id, EVENTS.CALL_STATE, { state: 'failed', message: 'Ya hay una llamada en curso. Únete desde el aviso.' });
      return;
    }
    const callId = randomUUID();
    const call = {
      callId, state: 'active',
      participants: new Map([[user.id, { id: user.id, name: user.name }]]),
    };
    calls.set(callId, call);
    byUser.set(user.id, callId);
    deliver(user.id, EVENTS.CALL_STATE, { callId, state: 'connecting', selfId: user.id, participants: participantList(call) });
    availability();
  };

  const join = (user, callId) => {
    const call = getCall(user, callId);
    if (call.state !== 'active') throw new Error('Esta llamada todavía no está disponible para unirse.');
    if (byUser.has(user.id)) throw new Error('Ya estás en una llamada.');
    const existing = participantList(call);
    call.participants.set(user.id, { id: user.id, name: user.name });
    byUser.set(user.id, callId);
    deliver(user.id, EVENTS.CALL_STATE, { callId, state: 'connecting', selfId: user.id, participants: existing });
    for (const participant of call.participants.values()) {
      if (participant.id !== user.id) deliver(participant.id, EVENTS.CALL_PARTICIPANT_JOINED, { callId, peer: { id: user.id, name: user.name } });
    }
    availability();
  };

  const end = (user, callId) => {
    const call = getCall(user, callId);
    if (!call.participants.has(user.id)) throw new Error('No perteneces a esta llamada.');
    call.participants.delete(user.id);
    byUser.delete(user.id);
    deliver(user.id, EVENTS.CALL_STATE, { callId, state: 'ended', message: 'Saliste de la llamada.' });
    for (const participant of call.participants.values()) deliver(participant.id, EVENTS.CALL_PARTICIPANT_LEFT, { callId, peerId: user.id });
    if (!call.participants.size) {
      calls.delete(callId);
    }
    availability();
  };

  const signal = (user, type, payload) => {
    const call = getCall(user, payload.callId);
    if (call.state !== 'active' || !call.participants.has(user.id)) throw new Error('No perteneces a una llamada activa.');
    const peerId = payload.toId;
    if (!validId(peerId) || peerId === user.id || !call.participants.has(peerId)) throw new Error('Participante de llamada inválido.');
    if (type === EVENTS.CALL_MEDIA_STATE) {
      const { audioEnabled, videoEnabled } = payload;
      if (typeof audioEnabled !== 'boolean' || typeof videoEnabled !== 'boolean') throw new Error('Estado de micrófono/cámara inválido.');
      deliver(peerId, type, { callId: call.callId, fromId: user.id, audioEnabled, videoEnabled });
      return;
    }
    if (type === EVENTS.WEBRTC_OFFER || type === EVENTS.WEBRTC_ANSWER) {
      const description = payload.description;
      const expectedType = type === EVENTS.WEBRTC_OFFER ? 'offer' : 'answer';
      if (!description || description.type !== expectedType || typeof description.sdp !== 'string' || description.sdp.length > MAX_SDP_LENGTH) throw new Error('Descripción WebRTC inválida.');
      deliver(peerId, type, { callId: call.callId, fromId: user.id, description });
      return;
    }
    const candidate = payload.candidate;
    if (!candidate || typeof candidate !== 'object' || typeof candidate.candidate !== 'string' || candidate.candidate.length > 2000) throw new Error('Candidato WebRTC inválido.');
    deliver(peerId, type, { callId: call.callId, fromId: user.id, candidate });
  };

  const disconnected = (userId) => {
    const callId = byUser.get(userId);
    const call = calls.get(callId);
    if (!call) return;
    if (call.participants.has(userId)) {
      call.participants.delete(userId);
      byUser.delete(userId);
      for (const participant of call.participants.values()) deliver(participant.id, EVENTS.CALL_PARTICIPANT_LEFT, { callId, peerId: userId });
      if (!call.participants.size) calls.delete(callId);
      availability();
    }
  };

  const close = () => {
    calls.clear();
    byUser.clear();
  };

  return { start, end, join, signal, announceAvailability, disconnected, close };
}
