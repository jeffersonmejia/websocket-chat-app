import { EVENTS } from '../utils/events.js';
import { createCallService } from '../services/callService.js';

const CALL_EVENTS = new Set([
  EVENTS.CALL_END,
  EVENTS.CALL_JOIN,
  EVENTS.WEBRTC_OFFER,
  EVENTS.WEBRTC_ANSWER,
  EVENTS.WEBRTC_ICE,
  EVENTS.CALL_MEDIA_STATE,
]);

/** Adapts incoming WebSocket frames to call service commands. */
export function createCallHandler({ users, send }) {
  const callService = createCallService({ users, send });

  const handle = ({ ws, type, payload }) => {
    const user = users.getBySocket(ws);
    if (!user) throw new Error('Ingresa al chat antes de iniciar una llamada.');

    if (type === EVENTS.CALL_START) {
      callService.start(user);
      return true;
    }
    if (type === EVENTS.CALL_JOIN) {
      callService.join(user, payload.callId);
      return true;
    }
    if (!CALL_EVENTS.has(type)) return false;

    if (type === EVENTS.CALL_END) callService.end(user, payload.callId);
    else callService.signal(user, type, payload);
    return true;
  };

  return {
    handle,
    announceAvailability: callService.announceAvailability,
    disconnected: callService.disconnected,
    close: callService.close,
  };
}
