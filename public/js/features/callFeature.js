import { VideoCall } from '../webrtc.js';
import { element, toast } from '../ui.js';

/** Coordinates call rooms, peer signaling and the call controls. */
export class CallFeature {
  constructor(socket) {
    this.socket = socket;
    this.media = new VideoCall(socket);
    this.activeCallId = null;
    this.availableCall = null;
    this.connectionState = 'disconnected';
    this.participants = new Map();
    this.remoteMedia = new Map();
    this.durationTimer = null;
    this.connectedAt = null;
    this.bindSocketEvents();
    this.socket.addEventListener('state', this.handleSocketState);
    this.bindControls();
    this.bindMediaEvents();
  }
  startCall = () => this.socket.send('call:start');
  handleFrame = ({ detail: frame }) => {
    const payload = frame.payload || {};
    const handlers = {
      'call:state': () => this.handleState(payload),
      'call:available': () => this.showAvailableCall(payload),
      'call:participant-joined': () => this.participantJoined(payload),
      'call:participant-left': () => this.participantLeft(payload),
      'call:media-state': () => this.updateRemoteMedia(payload),
      'webrtc:offer': () => this.runSignal(payload.callId, () => this.media.receiveOffer(payload.fromId, payload.description)),
      'webrtc:answer': () => this.runSignal(payload.callId, () => this.media.receiveAnswer(payload.fromId, payload.description)),
      'webrtc:ice-candidate': () => this.runSignal(payload.callId, () => this.media.receiveIce(payload.fromId, payload.candidate)),
    };
    handlers[frame.type]?.();
  };
  bindSocketEvents() { this.socket.addEventListener('event', this.handleFrame); }
  handleSocketState = ({ detail }) => {
    this.connectionState = detail.state;
    if (detail.state !== 'connected') {
      if (this.activeCallId) this.reset();
      this.showAvailableCall({ callId: null });
    }
    this.updateStartButton();
  };
  bindControls() {
    element('#start-call').addEventListener('click', this.startCall);
    element('#end-call').addEventListener('click', () => this.end());
    element('#toggle-microphone').addEventListener('click', () => this.toggleMedia('audio'));
    element('#toggle-camera').addEventListener('click', () => this.toggleMedia('video'));
    element('#join-active-call').addEventListener('click', () => {
      if (this.availableCall?.callId) this.socket.send('call:join', { callId: this.availableCall.callId });
    });
  }
  bindMediaEvents() {
    this.media.addEventListener('state', ({ detail }) => this.updateMediaState(detail));
    this.media.addEventListener('local-stream', ({ detail }) => {
      element('#local-video').srcObject = detail;
      element('#local-video').closest('.video-tile').classList.add('has-stream');
      this.syncMediaControls(detail);
      element('#call-skeleton').hidden = true;
    });
    this.media.addEventListener('remote-stream', ({ detail }) => this.attachRemoteStream(detail.peerId, detail.stream));
    this.media.addEventListener('remote-left', ({ detail }) => this.removeRemoteTile(detail.peerId));
    this.media.addEventListener('peer-failed', ({ detail }) => {
      const participant = this.participants.get(detail.peerId);
      if (participant) toast(`Se perdió la conexión con ${participant.name}.`);
    });
    this.media.addEventListener('cleanup', () => this.clearMediaView());
  }
  showAvailableCall(payload) {
    this.availableCall = payload.callId ? payload : null;
    const banner = element('#active-call-banner');
    if (!this.availableCall || this.activeCallId) {
      banner.hidden = true;
      this.updateStartButton();
      return;
    }
    const names = (payload.participants || []).map((participant) => participant.name);
    const visible = names.slice(0, 3);
    let summary = visible.join(', ');
    if (names.length > 3) summary += names.length === 4 ? ' y 1 otro' : ` y ${names.length - 3} otros`;
    element('#active-call-label').textContent = `${summary} ${names.length === 1 ? 'está' : 'están'} en llamada`;
    banner.hidden = false;
    this.updateStartButton();
    window.lucide?.createIcons();
  }
  updateStartButton() {
    const button = element('#start-call');
    button.disabled = this.connectionState !== 'connected' || Boolean(this.activeCallId || this.availableCall);
    button.title = this.availableCall ? 'Hay una llamada grupal en curso; únete desde el aviso.' : 'Avisar a la sala e iniciar una llamada grupal';
  }
  handleState(payload) {
    if (payload.callId && this.activeCallId && payload.callId !== this.activeCallId) return;
    switch (payload.state) {
      case 'connecting': {
        this.activeCallId = payload.callId;
        const peers = (payload.participants || []).filter((participant) => participant.id !== payload.selfId);
        peers.forEach((participant) => this.participants.set(participant.id, participant));
        this.showCallView('Videollamada', 'Conectando audio y video…');
        this.updateCallTitle();
        this.updateStartButton();
        void this.media.start(payload.callId, peers.map((participant) => participant.id), [])
          .then(() => this.sendMediaStateToAll());
        break;
      }
      case 'rejected': case 'ended': case 'failed':
        this.activeCallId = null;
        this.media.cleanup();
        this.updateStartButton();
        if (payload.message) toast(payload.message);
        break;
    }
  }
  participantJoined({ callId, peer }) {
    if (callId !== this.activeCallId || !peer?.id) return;
    this.participants.set(peer.id, peer);
    void this.media.start(callId, [peer.id], [peer.id]).then(() => this.sendMediaState(peer.id));
    this.updateCallTitle();
  }
  participantLeft({ callId, peerId }) {
    if (callId !== this.activeCallId) return;
    this.participants.delete(peerId);
    this.remoteMedia.delete(peerId);
    this.media.removePeer(peerId);
    this.updateCallTitle();
  }
  runSignal(callId, action) {
    if (callId !== this.activeCallId) return;
    Promise.resolve().then(action).catch((error) => toast(`Error de señalización WebRTC: ${error.message}`));
  }
  updateMediaState({ state, message }) {
    const labels = { connecting: 'Conectando audio y video…', connected: 'Videollamada conectada' };
    element('#webrtc-status').textContent = message || labels[state] || 'Conectando…';
    if (state === 'connected') this.startDuration();
    if (state === 'failed') {
      toast(message);
      if (this.activeCallId) this.socket.send('call:end', { callId: this.activeCallId });
      this.media.cleanup();
    }
  }
  toggleMedia(kind) {
    const enabled = this.media.toggleTrack(kind);
    if (enabled === null) return;
    this.updateMediaButton(kind, enabled);
    this.sendMediaStateToAll();
  }
  updateMediaButton(kind, enabled) {
    const camera = kind === 'video';
    const button = element(camera ? '#toggle-camera' : '#toggle-microphone');
    const action = camera ? (enabled ? 'Apagar cámara' : 'Encender cámara') : (enabled ? 'Silenciar micrófono' : 'Activar micrófono');
    button.setAttribute('aria-label', action);
    button.title = action;
    button.setAttribute('aria-pressed', String(!enabled));
    button.classList.toggle('is-off', !enabled);
    button.innerHTML = `<i data-lucide="${camera ? (enabled ? 'video' : 'video-off') : (enabled ? 'mic' : 'mic-off')}"></i><span>${camera ? 'Cámara' : 'Micrófono'}</span>`;
    window.lucide?.createIcons();
    if (camera) {
      const tile = element('#local-video').closest('.video-tile');
      tile.classList.toggle('camera-disabled', !enabled);
      this.setLocalCameraPlaceholder(enabled ? 'Preparando tu cámara…' : 'Cámara apagada', enabled ? 'video' : 'video-off');
    }
  }
  setLocalCameraPlaceholder(text, iconName) {
    const placeholder = element('#local-placeholder');
    const label = placeholder.querySelector('span');
    const icon = placeholder.querySelector('i');
    if (label) label.textContent = text;
    if (icon) icon.dataset.lucide = iconName;
    window.lucide?.createIcons();
  }
  syncMediaControls(stream) {
    for (const [kind, selector] of [['audio', '#toggle-microphone'], ['video', '#toggle-camera']]) {
      const button = element(selector);
      const track = stream.getTracks().find((item) => item.kind === kind);
      button.disabled = !track;
      if (track) this.updateMediaButton(kind, track.enabled);
      else if (kind === 'video') {
        element('#local-video').closest('.video-tile').classList.add('camera-disabled');
        this.setLocalCameraPlaceholder('Cámara no disponible', 'video-off');
      }
    }
  }
  sendMediaState(peerId) {
    const audioEnabled = this.media.stream?.getAudioTracks().some((track) => track.enabled) ?? false;
    const videoEnabled = this.media.stream?.getVideoTracks().some((track) => track.enabled) ?? false;
    this.socket.send('call:media-state', { callId: this.activeCallId, toId: peerId, audioEnabled, videoEnabled });
  }
  sendMediaStateToAll() { for (const peerId of this.participants.keys()) this.sendMediaState(peerId); }
  attachRemoteStream(peerId, stream) {
    const participant = this.participants.get(peerId) || { id: peerId, name: 'Participante' };
    this.participants.set(peerId, participant);
    let tile = this.remoteTile(peerId);
    if (!tile) {
      tile = document.createElement('figure');
      tile.className = 'video-tile remote-tile';
      tile.dataset.peerId = peerId;
      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true;
      const placeholder = document.createElement('div');
      placeholder.className = 'video-placeholder';
      placeholder.textContent = 'Cámara apagada';
      const status = document.createElement('div');
      status.className = 'remote-media-status';
      const camera = document.createElement('span'); camera.className = 'remote-camera-off'; camera.textContent = 'Cámara apagada';
      const microphone = document.createElement('span'); microphone.className = 'remote-microphone-off'; microphone.textContent = 'Micrófono apagado';
      status.append(camera, microphone);
      const caption = document.createElement('figcaption'); caption.textContent = participant.name;
      tile.append(video, placeholder, status, caption);
      element('#remote-tiles').append(tile);
    }
    tile.querySelector('video').srcObject = stream;
    tile.classList.add('has-stream');
    this.applyRemoteMediaToTile(peerId);
  }
  remoteTile(peerId) { return [...element('#remote-tiles').children].find((tile) => tile.dataset.peerId === peerId); }
  updateRemoteMedia(payload) {
    this.remoteMedia.set(payload.fromId, { audioEnabled: payload.audioEnabled, videoEnabled: payload.videoEnabled });
    this.applyRemoteMediaToTile(payload.fromId);
  }
  applyRemoteMediaToTile(peerId) {
    const tile = this.remoteTile(peerId);
    const state = this.remoteMedia.get(peerId);
    if (!tile || !state) return;
    tile.classList.toggle('camera-disabled', !state.videoEnabled);
    tile.classList.toggle('microphone-disabled', !state.audioEnabled);
    tile.querySelector('.remote-camera-off').hidden = state.videoEnabled;
    tile.querySelector('.remote-microphone-off').hidden = state.audioEnabled;
  }
  removeRemoteTile(peerId) { this.remoteTile(peerId)?.remove(); }
  updateCallTitle() {
    const count = this.participants.size + 1;
    element('#call-peer-name').textContent = `Videollamada · ${count} ${count === 1 ? 'participante' : 'participantes'}`;
  }
  clearMediaView() {
    element('#local-video').srcObject = null;
    element('#remote-tiles').replaceChildren();
    element('#local-video').closest('.video-tile').classList.remove('has-stream', 'camera-disabled');
    this.setLocalCameraPlaceholder('Preparando tu cámara…', 'video-off');
    for (const selector of ['#toggle-microphone', '#toggle-camera']) {
      const button = element(selector);
      button.disabled = true;
      button.classList.remove('is-off');
      button.setAttribute('aria-pressed', 'false');
    }
    this.resetMediaButton('#toggle-microphone', 'mic', 'Silenciar micrófono', 'Micrófono');
    this.resetMediaButton('#toggle-camera', 'video', 'Apagar cámara', 'Cámara');
    this.participants.clear();
    this.remoteMedia.clear();
    this.activeCallId = null;
    this.stopDuration();
    this.updateStartButton();
    element('#active-call-banner').hidden = false;
    element('#call-view').hidden = true;
    element('#chat-view').hidden = false;
    if (!this.availableCall) element('#active-call-banner').hidden = true;
  }
  resetMediaButton(selector, icon, label, text) {
    const button = element(selector);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<i data-lucide="${icon}"></i><span>${text}</span>`;
    window.lucide?.createIcons();
  }
  showCallView(title, status) {
    element('#call-peer-name').textContent = title;
    element('#webrtc-status').textContent = status;
    element('#active-call-banner').hidden = true;
    element('#call-skeleton').hidden = false;
    element('#call-view').hidden = false;
    element('#chat-view').hidden = true;
  }
  startDuration() {
    this.stopDuration();
    this.connectedAt = Date.now();
    element('#call-duration').textContent = '00:00';
    this.durationTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - this.connectedAt) / 1000);
      element('#call-duration').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }, 1000);
  }
  stopDuration() { clearInterval(this.durationTimer); this.durationTimer = null; this.connectedAt = null; }
  end() {
    if (this.activeCallId && this.media.callId !== this.activeCallId) this.socket.send('call:end', { callId: this.activeCallId });
    this.media.end();
  }
  reset() { this.activeCallId = null; this.availableCall = null; this.media.cleanup(); element('#active-call-banner').hidden = true; this.updateStartButton(); }
  destroy() {
    this.end();
    this.socket.removeEventListener('event', this.handleFrame);
    this.socket.removeEventListener('state', this.handleSocketState);
  }
}
