import { randomUUID } from 'node:crypto';
import { EVENTS } from '../utils/events.js';

const MAX_SDP_LENGTH = 48_000;
const validId = (value) => typeof value === 'string' && /^[\w-]{8,80}$/.test(value);

/** Owns one-to-one call invitations, participant state and private signaling. */
export function createCallService({ users, send }) {
  const calls = new Map();
  const byUser = new Map();
  const pending = new Map();
  const deliver = (userId, type, payload) => {
    const recipient = users.getById(userId);
    if (recipient) send(recipient.ws, type, payload);
  };
  const getCall = (user, callId) => {
    if (!validId(callId)) throw new Error('Identificador de llamada inválido.');
    const call = calls.get(callId);
    if (!call || !call.participants.has(user.id)) throw new Error('La llamada ya no está disponible.');
    return call;
  };
  const clearCall = (call, state, message) => {
    calls.delete(call.callId);
    for (const id of call.participants) byUser.delete(id);
    for (const id of call.participants) deliver(id, EVENTS.CALL_STATE, { callId: call.callId, state, message });
  };

  const start = (user, toId) => {
    if (!validId(toId) || toId === user.id) throw new Error('Selecciona a otro usuario para llamar.');
    const recipient = users.getById(toId);
    if (!recipient) throw new Error('El usuario ya no está conectado.');
    if (byUser.has(user.id) || pending.has(user.id)) throw new Error('Ya tienes una llamada o invitación pendiente.');
    if (byUser.has(toId) || pending.has(toId)) throw new Error('El usuario está ocupado.');
    const callId = randomUUID();
    const call = { callId, callerId: user.id, calleeId: toId, state: 'ringing', participants: new Set([user.id, toId]) };
    calls.set(callId, call);
    pending.set(user.id, callId); pending.set(toId, callId);
    call.timer = setTimeout(() => {
      if (calls.get(callId) !== call || call.state !== 'ringing') return;
      calls.delete(callId); pending.delete(call.callerId); pending.delete(call.calleeId);
      deliver(call.callerId, EVENTS.CALL_STATE, { callId, state: 'failed', message: 'No respondieron a la llamada.' });
      deliver(call.calleeId, EVENTS.CALL_STATE, { callId, state: 'ended', message: 'La invitación expiró.' });
    }, 30_000);
    call.timer.unref?.();
    deliver(user.id, EVENTS.CALL_STATE, { callId, state: 'outgoing', peer: { id: toId, name: recipient.name } });
    deliver(toId, EVENTS.CALL_INCOMING, { callId, caller: { id: user.id, name: user.name } });
  };

  const accept = (user, callId) => {
    const call = calls.get(callId);
    if (!call || call.state !== 'ringing' || call.calleeId !== user.id) throw new Error('La invitación ya no está disponible.');
    pending.delete(call.callerId); pending.delete(call.calleeId);
    call.state = 'active';
    byUser.set(call.callerId, callId); byUser.set(call.calleeId, callId);
    const caller = users.getById(call.callerId);
    const callee = users.getById(call.calleeId);
    clearTimeout(call.timer);
    deliver(call.callerId, EVENTS.CALL_STATE, { callId, state: 'connecting', selfId: call.callerId, participants: [{ id: call.calleeId, name: user.name }], offerPeerIds: [call.calleeId] });
    deliver(call.calleeId, EVENTS.CALL_STATE, { callId, state: 'connecting', selfId: call.calleeId, participants: [{ id: call.callerId, name: caller?.name || 'Usuario' }], offerPeerIds: [] });
  };

  const reject = (user, callId) => {
    const call = calls.get(callId);
    if (!call || call.state !== 'ringing' || call.calleeId !== user.id) throw new Error('La invitación ya no está disponible.');
    clearTimeout(call.timer);
    pending.delete(call.callerId); pending.delete(call.calleeId); calls.delete(callId);
    deliver(call.callerId, EVENTS.CALL_STATE, { callId, state: 'rejected', peer: { id: user.id, name: user.name }, message: `${user.name} rechazó la llamada.` });
    deliver(user.id, EVENTS.CALL_STATE, { callId, state: 'ended', message: 'Rechazaste la llamada.' });
  };

  const end = (user, callId) => {
    const call = calls.get(callId);
    if (!call || !call.participants.has(user.id)) throw new Error('La llamada ya no está disponible.');
    if (call.state === 'ringing') {
      const peerId = call.callerId === user.id ? call.calleeId : call.callerId;
      clearTimeout(call.timer); pending.delete(call.callerId); pending.delete(call.calleeId); calls.delete(callId);
      deliver(user.id, EVENTS.CALL_STATE, { callId, state: 'ended', message: 'Cancelaste la llamada.' });
      deliver(peerId, EVENTS.CALL_STATE, { callId, state: 'ended', message: 'La llamada fue cancelada.' });
      return;
    }
    clearCall(call, 'ended', `${user.name} finalizó la llamada.`);
  };

  const signal = (user, type, payload) => {
    const call = getCall(user, payload.callId);
    if (call.state !== 'active') throw new Error('La llamada no está activa.');
    const peerId = [...call.participants].find((id) => id !== user.id);
    if (!peerId || !users.getById(peerId)) throw new Error('El otro usuario ya no está conectado.');
    if (type === EVENTS.CALL_MEDIA_STATE) {
      const { audioEnabled, videoEnabled } = payload;
      if (typeof audioEnabled !== 'boolean' || typeof videoEnabled !== 'boolean') throw new Error('Estado de micrófono/cámara inválido.');
      deliver(peerId, type, { callId: call.callId, fromId: user.id, audioEnabled, videoEnabled }); return;
    }
    if (type === EVENTS.WEBRTC_OFFER || type === EVENTS.WEBRTC_ANSWER) {
      const description = payload.description;
      const expectedType = type === EVENTS.WEBRTC_OFFER ? 'offer' : 'answer';
      if (!description || description.type !== expectedType || typeof description.sdp !== 'string' || description.sdp.length > MAX_SDP_LENGTH) throw new Error('Descripción WebRTC inválida.');
      deliver(peerId, type, { callId: call.callId, fromId: user.id, description }); return;
    }
    const candidate = payload.candidate;
    if (!candidate || typeof candidate !== 'object' || typeof candidate.candidate !== 'string' || candidate.candidate.length > 2000) throw new Error('Candidato WebRTC inválido.');
    deliver(peerId, type, { callId: call.callId, fromId: user.id, candidate });
  };

  const disconnected = (userId) => {
    const callId = pending.get(userId) || byUser.get(userId);
    const call = calls.get(callId);
    if (!call) return;
    if (call.state === 'ringing') {
      clearTimeout(call.timer); pending.delete(call.callerId); pending.delete(call.calleeId); calls.delete(callId);
      const peerId = call.callerId === userId ? call.calleeId : call.callerId;
      deliver(peerId, EVENTS.CALL_STATE, { callId, state: 'failed', message: 'El otro usuario se desconectó.' });
    } else clearCall(call, 'ended', 'El otro usuario se desconectó.');
  };
  const close = () => { for (const call of calls.values()) clearTimeout(call.timer); calls.clear(); byUser.clear(); pending.clear(); };
  return { start, accept, reject, end, signal, disconnected, close };
}
