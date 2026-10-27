const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Owns shared local media and one peer connection for each call participant. */
export class VideoCall extends EventTarget {
  constructor(socket) {
    super();
    this.socket = socket;
    this.peers = new Map();
    this.stream = null;
    this.callId = null;
    this.pendingSignals = [];
    this.startPromise = null;
    this.generation = 0;
  }
  emit(state, message = '') { this.dispatchEvent(new CustomEvent('state', { detail: { state, message } })); }

  start(callId, peers = [], offerPeerIds = []) {
    if (this.callId === callId && this.startPromise && !this.stream) {
      return this.startPromise.then(async () => {
        await Promise.all(peers.map((peerId) => this.addPeer(peerId, offerPeerIds.includes(peerId))));
        await this.flushPendingSignals();
      });
    }
    if (this.callId === callId && this.stream) {
      return Promise.all(peers.map((peerId) => this.addPeer(peerId, offerPeerIds.includes(peerId))))
        .then(() => this.flushPendingSignals());
    }
    this.callId = callId;
    const generation = ++this.generation;
    this.emit('connecting');
    this.startPromise = this.initialize(callId, peers, offerPeerIds, generation)
      .catch((error) => this.handleStartError(error, generation))
      .finally(() => { if (generation === this.generation) this.startPromise = null; });
    return this.startPromise;
  }

  async initialize(callId, peerIds, offerPeerIds, generation) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (generation !== this.generation) { stopStream(stream); return; }
    this.stream = stream;
    this.dispatchEvent(new CustomEvent('local-stream', { detail: stream }));
    for (const peerId of peerIds) await this.addPeer(peerId, offerPeerIds.includes(peerId));
    await this.flushPendingSignals();
  }

  async addPeer(peerId, shouldOffer = false) {
    if (!peerId || this.peers.has(peerId) || !this.stream) return;
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const remoteStream = new MediaStream();
    const entry = { peer, remoteStream, queuedIce: [] };
    this.peers.set(peerId, entry);
    this.stream.getTracks().forEach((track) => peer.addTrack(track, this.stream));
    peer.ontrack = ({ streams, track }) => {
      if (streams[0]) entry.remoteStream = streams[0];
      else entry.remoteStream.addTrack(track);
      this.dispatchEvent(new CustomEvent('remote-stream', { detail: { peerId, stream: entry.remoteStream } }));
    };
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.send('webrtc:ice-candidate', { callId: this.callId, toId: peerId, candidate: candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => this.handleConnectionState(peerId, peer);
    if (shouldOffer) await this.sendOffer(peerId);
  }

  async sendOffer(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    const offer = await entry.peer.createOffer();
    await entry.peer.setLocalDescription(offer);
    this.socket.send('webrtc:offer', { callId: this.callId, toId: peerId, description: entry.peer.localDescription });
  }
  handleConnectionState(peerId, peer) {
    if (this.peers.get(peerId)?.peer !== peer) return;
    if (peer.connectionState === 'connected') this.emit('connected');
    if (peer.connectionState === 'failed') this.dispatchEvent(new CustomEvent('peer-failed', { detail: { peerId } }));
  }
  async receiveOffer(peerId, description) { await this.receiveSignal({ type: 'offer', peerId, value: description }); }
  async receiveAnswer(peerId, description) { await this.receiveSignal({ type: 'answer', peerId, value: description }); }
  async receiveIce(peerId, candidate) { await this.receiveSignal({ type: 'ice', peerId, value: candidate }); }
  async receiveSignal(signal) {
    if (!this.callId) return;
    if (!this.stream || !this.peers.has(signal.peerId)) { this.pendingSignals.push(signal); return; }
    await this.applySignal(signal);
  }
  async applySignal(signal) {
    const entry = this.peers.get(signal.peerId);
    if (!entry) { this.pendingSignals.push(signal); return; }
    const peer = entry.peer;
    if (signal.type === 'offer') {
      await peer.setRemoteDescription(signal.value);
      await this.flushQueuedIce(entry);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      this.socket.send('webrtc:answer', { callId: this.callId, toId: signal.peerId, description: peer.localDescription });
    } else if (signal.type === 'answer') {
      await peer.setRemoteDescription(signal.value);
      await this.flushQueuedIce(entry);
    } else if (signal.type === 'ice') {
      if (!peer.remoteDescription) entry.queuedIce.push(signal.value);
      else await peer.addIceCandidate(signal.value);
    }
  }
  async flushPendingSignals() {
    for (const signal of this.pendingSignals.splice(0)) await this.applySignal(signal);
  }
  async flushQueuedIce(entry) {
    for (const candidate of entry.queuedIce.splice(0)) await entry.peer.addIceCandidate(candidate);
  }
  removePeer(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    entry.peer.ontrack = null;
    entry.peer.onicecandidate = null;
    entry.peer.onconnectionstatechange = null;
    entry.peer.close();
    this.peers.delete(peerId);
    this.dispatchEvent(new CustomEvent('remote-left', { detail: { peerId } }));
  }
  toggleTrack(kind) {
    const track = this.stream?.getTracks().find((item) => item.kind === kind);
    if (!track) return null;
    track.enabled = !track.enabled;
    return track.enabled;
  }
  handleStartError(error, generation) {
    if (generation !== this.generation) return;
    const message = error.name === 'NotAllowedError' ? 'Permite el acceso a cámara y micrófono para llamar.'
      : error.name === 'NotFoundError' ? 'No se encontró cámara o micrófono en este dispositivo.'
        : `No se pudo iniciar audio y video: ${error.message}`;
    this.emit('failed', message);
    if (this.callId) this.socket.send('call:end', { callId: this.callId });
    this.cleanup();
  }
  cleanup() {
    this.generation += 1;
    for (const peerId of [...this.peers.keys()]) this.removePeer(peerId);
    stopStream(this.stream);
    this.stream = null;
    this.callId = null;
    this.pendingSignals = [];
    this.startPromise = null;
    this.dispatchEvent(new Event('cleanup'));
  }
  end() {
    if (this.callId) this.socket.send('call:end', { callId: this.callId });
    this.cleanup();
  }
}

function stopStream(stream) { stream?.getTracks().forEach((track) => track.stop()); }
