import { element, renderMessages, setPinned, setReply, setTyping, setUnread, toast } from '../ui.js';

/** Owns chat history, message actions, typing signals and chat-related controls. */
export class ChatFeature {
  constructor(socket, state) {
    this.socket = socket;
    this.state = state;
    this.messages = [];
    this.replyTo = null;
    this.editingMessageId = null;
    this.search = '';
    this.unread = 0;
    this.sentAt = [];
    this.typingTimer = null;
    this.wasTyping = false;
    this.typingUsers = new Map();
    this.attachments = [];
    this.pendingAttachmentIds = null;
    this.pendingAttachmentText = '';
    this.socket.addEventListener('event', this.handleFrame);
    this.bindControls();
  }
  handleFrame = ({ detail: frame }) => {
    const payload = frame.payload || {};
    const handlers = {
      'chat:sync': () => this.sync(payload.messages || []),
      'message:new': () => this.receiveMessage(payload.message),
      'message:edit': () => this.replaceMessage(payload.message, true),
      'reaction:toggle': () => this.replaceMessage(payload.message),
      'message:pin': () => this.updatePinnedMessages(payload),
      'message:delete': () => this.deleteMessage(payload.id),
      'typing:start': () => this.setTypingUser(payload.userId, payload.name),
      'typing:stop': () => this.removeTypingUser(payload.userId),
      'user:leave': () => this.removeTypingUser(payload.user.id),
      error: () => {
        if (this.pendingAttachmentIds) {
          this.pendingAttachmentIds = null;
          const input = element('#message-input');
          if (!input.value) input.value = this.pendingAttachmentText;
          this.pendingAttachmentText = '';
        }
        toast(payload.message || 'No se pudo completar la operación.');
      },
    };
    handlers[frame.type]?.();
  };
  sync(messages) {
    this.messages = messages;
    if (this.pendingAttachmentIds) {
      const sent = messages.find((message) => message.authorId === this.state.userId && this.pendingAttachmentIds.every((id) => (message.attachments || []).some((file) => file.id === id)));
      if (sent) { this.pendingAttachmentIds = null; this.pendingAttachmentText = ''; this.attachments = []; this.renderAttachmentQueue(); }
    }
    this.render();
  }
  receiveMessage(message) {
    if (!message || this.messages.some((entry) => entry.id === message.id)) return;
    if (message.authorId === this.state.userId && this.pendingAttachmentIds) {
      const receivedIds = (message.attachments || []).map((file) => file.id);
      if (this.pendingAttachmentIds.length === receivedIds.length && this.pendingAttachmentIds.every((id) => receivedIds.includes(id))) {
        this.pendingAttachmentIds = null; this.pendingAttachmentText = '';
        this.attachments = [];
        this.renderAttachmentQueue();
      }
    }
    this.messages.push(message);
    this.render();
    if (message.authorId !== this.state.userId && (document.hidden || !document.hasFocus())) {
      this.unread += 1;
      setUnread(this.unread);
    }
  }
  replaceMessage(message, resetEditor = false) {
    if (!message) return;
    if (resetEditor) this.editingMessageId = null;
    this.messages = this.messages.map((entry) => entry.id === message.id ? message : entry);
    this.render();
  }
  updatePinnedMessages({ message, previousMessage }) {
    if (!message) return;
    this.messages = this.messages.map((entry) => {
      if (entry.id === message.id) return message;
      if (previousMessage && entry.id === previousMessage.id) return previousMessage;
      return entry;
    });
    this.render();
  }
  deleteMessage(id) {
    this.messages = this.messages.filter((message) => message.id !== id)
      .map((message) => message.reply?.id === id ? { ...message, reply: { ...message.reply, text: 'Mensaje eliminado' } } : message);
    this.render();
  }
  setTypingUser(id, name) { this.typingUsers.set(id, { id, name }); setTyping([...this.typingUsers.values()]); }
  removeTypingUser(id) { this.typingUsers.delete(id); setTyping([...this.typingUsers.values()]); }
  render() {
    renderMessages(this.messages, this.state.userId, {
      react: (id, emoji) => this.socket.send('reaction:toggle', { id, emoji }),
      reply: (message) => this.replyToMessage(message),
      edit: (message) => { this.editingMessageId = message.id; this.render(); },
      saveEdit: (message, text) => this.saveEdit(message, text),
      cancelEdit: () => { this.editingMessageId = null; this.render(); },
      remove: (id) => { if (confirm('¿Eliminar este mensaje?')) this.socket.send('message:delete', { id }); },
      pin: (id) => this.socket.send('message:pin', { id }),
    }, this.search, this.editingMessageId);
    setPinned(this.messages.find((message) => message.pinned) || null);
  }
  replyToMessage(message) {
    this.replyTo = message.id;
    setReply(message, () => { this.replyTo = null; setReply(null); });
    element('#message-input').focus();
  }
  saveEdit(message, text) {
    if (!text.trim()) { toast('El mensaje no puede quedar vacío.'); return; }
    if (this.socket.send('message:edit', { id: message.id, text })) this.editingMessageId = null;
    else toast('No hay conexión. No se pudo editar el mensaje.');
    this.render();
  }
  updateTyping() {
    if (!this.state.identity) return;
    if (!this.wasTyping) { this.socket.send('typing:start'); this.wasTyping = true; }
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.stopTyping(), 1400);
  }
  stopTyping() {
    clearTimeout(this.typingTimer);
    if (this.wasTyping) this.socket.send('typing:stop');
    this.wasTyping = false;
  }
  sendMessage(event) {
    event.preventDefault();
    const input = element('#message-input');
    const text = input.value.trim();
    if (!text && !this.attachments.length) return;
    if (this.pendingAttachmentIds) return;
    if (this.attachments.some((attachment) => attachment.status !== 'ready')) {
      toast('Espera a que terminen de cargar los adjuntos o vuelve a intentarlo.');
      return;
    }
    const now = Date.now();
    this.sentAt = this.sentAt.filter((time) => now - time < 10_000);
    if (this.sentAt.length >= 12) {
      const waitSeconds = Math.max(1, Math.ceil((this.sentAt[0] + 10_000 - now) / 1000));
      toast(`Estás enviando mensajes muy rápido. Espera ${waitSeconds} s.`);
      return;
    }
    const fileIds = this.attachments.map((attachment) => attachment.metadata.id);
    if (!this.socket.send('message:new', { text, replyTo: this.replyTo, attachments: fileIds })) { toast('No hay conexión. El mensaje no se envió.'); return; }
    if (fileIds.length) { this.pendingAttachmentIds = fileIds; this.pendingAttachmentText = text; }
    this.sentAt.push(now);
    input.value = '';
    this.replyTo = null;
    setReply(null);
    input.style.height = 'auto';
    this.stopTyping();
  }
  bindControls() {
    element('#message-form').addEventListener('submit', (event) => this.sendMessage(event));
    element('#message-input').addEventListener('input', (event) => {
      event.currentTarget.style.height = 'auto';
      event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 128)}px`;
      this.updateTyping();
    });
    element('#message-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); element('#message-form').requestSubmit(); }
    });
    element('#search-input').addEventListener('input', (event) => { this.search = event.currentTarget.value; this.render(); });
    element('#clear-search').addEventListener('click', () => this.clearSearch());
    element('#attachment-button').addEventListener('click', () => this.openAttachmentDialog());
    element('#attachment-input').addEventListener('change', (event) => {
      this.addAttachments([...event.currentTarget.files]);
      event.currentTarget.value = '';
    });
    element('#attachment-confirm-cancel').addEventListener('click', () => this.cancelAttachmentSelection());
    element('#attachment-confirm-continue').addEventListener('click', () => this.continueAttachmentSelection());
    element('#attachment-confirm-dialog').addEventListener('cancel', (event) => { event.preventDefault(); this.cancelAttachmentSelection(); });
    element('#attachment-confirm-dialog').addEventListener('click', (event) => {
      if (event.target === element('#attachment-confirm-dialog')) this.cancelAttachmentSelection();
    });
  }
  formatFileSize(size) {
    return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(2)} MB`;
  }
  openAttachmentDialog() {
    const room = Math.max(0, 5 - this.attachments.length);
    if (!room) { toast('Ya tienes el máximo de 5 fotos en este mensaje.'); return; }
    const dialog = element('#attachment-confirm-dialog');
    if (!dialog.open) dialog.showModal();
    window.lucide?.createIcons();
  }
  continueAttachmentSelection() {
    element('#attachment-confirm-dialog').close();
    element('#attachment-input').click();
  }
  cancelAttachmentSelection() {
    const dialog = element('#attachment-confirm-dialog');
    if (dialog.open) dialog.close();
  }
  addAttachments(files) {
    if (!files.length) return;
    const room = Math.max(0, 5 - this.attachments.length);
    if (!room) { toast('Ya tienes el máximo de 5 fotos en este mensaje.'); return; }
    if (files.length > room) toast('Puedes adjuntar hasta 5 fotos por mensaje.');
    for (const file of files.slice(0, room)) {
      const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
      const error = !allowedTypes.has(file.type) ? 'Solo se permiten fotos JPG, PNG, GIF o WebP.'
        : file.size === 0 ? 'La foto está vacía.'
        : file.size > 5 * 1024 * 1024 ? 'Supera el límite de 5 MB.' : '';
      if (error) {
        this.attachments.push({ localId: crypto.randomUUID(), file, status: 'error', progress: 0, error });
        continue;
      }
      const attachment = { localId: crypto.randomUUID(), file, status: 'uploading', progress: 0, xhr: null };
      this.attachments.push(attachment);
      this.uploadAttachment(attachment);
    }
    this.renderAttachmentQueue();
  }
  uploadAttachment(attachment) {
    const xhr = new XMLHttpRequest();
    attachment.xhr = xhr;
    xhr.open('POST', `/api/uploads?name=${encodeURIComponent(attachment.file.name)}`);
    xhr.setRequestHeader('Content-Type', attachment.file.type || 'application/octet-stream');
    if (this.state.userId) xhr.setRequestHeader('X-Chat-User-Id', this.state.userId);
    xhr.timeout = 60_000;
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      attachment.progress = Math.round((event.loaded / event.total) * 100);
      this.renderAttachmentQueue();
    });
    xhr.addEventListener('load', () => {
      if (!this.attachments.includes(attachment)) return;
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300 || !result.attachment) throw new Error(result.message || 'No se pudo cargar el archivo.');
        attachment.metadata = result.attachment;
        attachment.status = 'ready'; attachment.progress = 100; attachment.xhr = null;
      } catch (error) { attachment.status = 'error'; attachment.error = error.message || 'No se pudo cargar el archivo.'; attachment.xhr = null; }
      this.renderAttachmentQueue();
    });
    xhr.addEventListener('error', () => this.failUpload(attachment, 'Error de conexión al cargar el archivo.'));
    xhr.addEventListener('timeout', () => this.failUpload(attachment, 'La carga tardó demasiado. Inténtalo de nuevo.'));
    xhr.addEventListener('abort', () => {});
    xhr.send(attachment.file);
  }
  failUpload(attachment, message) {
    if (!this.attachments.includes(attachment)) return;
    attachment.status = 'error'; attachment.error = message; attachment.xhr = null;
    this.renderAttachmentQueue();
  }
  removeAttachment(attachment) {
    attachment.xhr?.abort();
    if (attachment.metadata && this.state.userId) fetch(`/api/uploads/${attachment.metadata.id}`, { method: 'DELETE', headers: { 'X-Chat-User-Id': this.state.userId } }).catch(() => {});
    this.attachments = this.attachments.filter((entry) => entry !== attachment);
    this.renderAttachmentQueue();
  }
  renderAttachmentQueue() {
    const queue = element('#attachment-queue');
    queue.replaceChildren(); queue.hidden = !this.attachments.length;
    for (const attachment of this.attachments) {
      const row = document.createElement('div'); row.className = `attachment-pending ${attachment.status}`;
      const details = document.createElement('div'); details.className = 'attachment-pending-copy';
      const name = document.createElement('strong'); name.textContent = attachment.file.name;
      const status = document.createElement('small');
      status.textContent = attachment.status === 'uploading' ? `Cargando ${attachment.progress}%` : attachment.status === 'ready' ? 'Listo para enviar' : attachment.error;
      details.append(name, status); row.append(details);
      if (attachment.status === 'uploading') {
        const progress = document.createElement('progress'); progress.max = 100; progress.value = attachment.progress; progress.setAttribute('aria-label', `Cargando ${attachment.file.name}`); row.append(progress);
      }
      const actions = document.createElement('span'); actions.className = 'attachment-pending-actions';
      if (attachment.status === 'error') {
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Reintentar'; retry.addEventListener('click', () => { attachment.status = 'uploading'; attachment.error = ''; attachment.progress = 0; this.renderAttachmentQueue(); this.uploadAttachment(attachment); }); actions.append(retry);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Quitar'; remove.setAttribute('aria-label', `Quitar ${attachment.file.name}`); remove.addEventListener('click', () => this.removeAttachment(attachment)); actions.append(remove); row.append(actions); queue.append(row);
    }
  }
  clearSearch() {
    element('#search-input').value = '';
    this.search = '';
    this.render();
    element('#search-input').focus();
  }
  reset() {
    for (const attachment of this.attachments) { attachment.xhr?.abort(); if (attachment.metadata && this.state.userId) fetch(`/api/uploads/${attachment.metadata.id}`, { method: 'DELETE', headers: { 'X-Chat-User-Id': this.state.userId } }).catch(() => {}); }
    this.attachments = []; this.pendingAttachmentIds = null; this.pendingAttachmentText = ''; this.renderAttachmentQueue();
    this.stopTyping();
    this.messages = []; this.replyTo = null; this.editingMessageId = null; this.search = ''; this.unread = 0; this.sentAt = [];
    this.typingUsers.clear();
    element('#message-input').value = ''; element('#search-input').value = '';
    setReply(null); setPinned(null); setTyping([]); setUnread(0); this.render();
  }
  clearUnread() { this.unread = 0; setUnread(0); }
  destroy() { this.stopTyping(); this.socket.removeEventListener('event', this.handleFrame); for (const attachment of this.attachments) attachment.xhr?.abort(); }
}
