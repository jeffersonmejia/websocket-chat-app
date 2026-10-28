import { ChatSocket } from './socket.js';
import { CallFeature } from './features/callFeature.js';
import { ChatFeature } from './features/chatFeature.js';
import { PresenceFeature } from './features/presenceFeature.js';
import { RosterFeature } from './features/rosterFeature.js';
import { SessionFeature } from './features/sessionFeature.js';

/** Composition root: wires independent features to the shared WebSocket transport. */
const socket = new ChatSocket();
const state = { identity: null, userId: null, users: [] };

window.lucide?.createIcons();

const calls = new CallFeature(socket);
const roster = new RosterFeature(socket, state, calls);
const chat = new ChatFeature(socket, state);
new PresenceFeature(socket, state, chat, roster);
new SessionFeature(socket, state, { chat, call: calls, roster });
requestAnimationFrame(() => { const splash = document.querySelector('#app-skeleton'); if (splash) splash.hidden = true; });
