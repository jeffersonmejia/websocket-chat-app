import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createChatServer } from '../server/server.js';

const waitFor = (ws, predicate, timeout = 2500) => new Promise((resolve, reject) => {
  const bufferedIndex = ws.frames?.findIndex(predicate) ?? -1;
  if (bufferedIndex >= 0) { const [frame] = ws.frames.splice(bufferedIndex, 1); resolve(frame); return; }
  const timer = setTimeout(() => { cleanup(); reject(new Error('Tiempo de espera agotado para evento WebSocket')); }, timeout);
  const waiter = { predicate, resolve, cleanup: () => clearTimeout(timer) };
  const cleanup = () => { waiter.cleanup(); ws.waiters = ws.waiters.filter((entry) => entry !== waiter); };
  ws.waiters.push(waiter);
});

const send = (ws, type, payload = {}) => ws.send(JSON.stringify({ type, payload }));
const makeClient = (url, name, id) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.frames = []; ws.waiters = [];
  ws.on('message', (raw) => {
    let frame; try { frame = JSON.parse(raw.toString()); } catch { return; }
    const waiter = ws.waiters.find((entry) => entry.predicate(frame));
    if (waiter) { ws.waiters = ws.waiters.filter((entry) => entry !== waiter); waiter.cleanup(); waiter.resolve(frame); }
    else ws.frames.push(frame);
  });
  ws.once('error', reject);
  ws.once('open', () => {
    const sync = waitFor(ws, (frame) => frame.type === 'chat:sync');
    send(ws, 'user:join', { id, name });
    sync.then((frame) => resolve({ ws, user: frame.payload.user })).catch(reject);
  });
});

test('chat WebSocket: broadcast, users, permisos, retos, errores y recuperación', async (t) => {
  const { httpServer, wsServer } = createChatServer();
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`;
  const clients = [];
  t.after(async () => {
    for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.close();
    await new Promise((resolve) => wsServer.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  for (const [name, id] of [['Ana', 'client-ana-0001'], ['Beto', 'client-beto-0002'], ['Cris', 'client-cris-0003'], ['Dani', 'client-dani-0004']]) {
    const client = await makeClient(wsUrl, name, id); clients.push(client.ws);
    assert.equal(client.user.name, name);
  }
  const [ana, beto, cris, dani] = clients;
  const usersFrame = await waitFor(dani, (frame) => frame.type === 'users:list' && frame.payload.count === 4);
  assert.equal(usersFrame.payload.users.length, 4);

  const deliveries = [beto, cris, dani].map((ws) => waitFor(ws, (frame) => frame.type === 'message:new'));
  send(ana, 'message:new', { text: 'Hola a todos' });
  const first = (await deliveries[0]).payload.message;
  const received = await Promise.all(deliveries.slice(1));
  assert.equal(first.text, 'Hola a todos');
  assert.equal(first.author, 'Ana');
  assert.ok(first.id);
  assert.ok(Number.isFinite(Date.parse(first.time)));
  assert.equal(received[0].payload.message.id, first.id);
  assert.equal(received[1].payload.message.id, first.id);

  const denial = waitFor(beto, (frame) => frame.type === 'error');
  send(beto, 'message:edit', { id: first.id, text: 'Edición ajena' });
  assert.match((await denial).payload.message, /autor/);
  const edit = waitFor(beto, (frame) => frame.type === 'message:edit');
  send(ana, 'message:edit', { id: first.id, text: 'Hola editado' });
  assert.equal((await edit).payload.message.edited, true);

  const reaction = waitFor(beto, (frame) => frame.type === 'reaction:toggle');
  send(beto, 'reaction:toggle', { id: first.id, emoji: '👍' });
  assert.deepEqual((await reaction).payload.message.reactions['👍'], ['client-beto-0002']);

  const replyDelivery = waitFor(dani, (frame) => frame.type === 'message:new');
  send(beto, 'message:new', { text: 'Respuesta', replyTo: first.id });
  const reply = (await replyDelivery).payload.message;
  assert.equal(reply.reply.id, first.id);

  const pin = waitFor(cris, (frame) => frame.type === 'message:pin');
  send(ana, 'message:pin', { id: first.id });
  assert.equal((await pin).payload.message.pinned, true);
  const replacementPin = waitFor(cris, (frame) => frame.type === 'message:pin' && frame.payload.message.id === reply.id);
  send(beto, 'message:pin', { id: reply.id });
  const pinUpdate = (await replacementPin).payload;
  assert.equal(pinUpdate.message.pinned, true);
  assert.equal(pinUpdate.previousMessage.id, first.id);
  assert.equal(pinUpdate.previousMessage.pinned, false);

  const typing = waitFor(beto, (frame) => frame.type === 'typing:start');
  send(ana, 'typing:start');
  assert.equal((await typing).payload.name, 'Ana');
  const typingStop = waitFor(beto, (frame) => frame.type === 'typing:stop');
  send(ana, 'typing:stop');
  assert.equal((await typingStop).payload.userId, 'client-ana-0001');
  const away = waitFor(beto, (frame) => frame.type === 'presence:update');
  send(ana, 'presence:update', { presence: 'away' });
  assert.equal((await away).payload.user.presence, 'away');

  const malformed = waitFor(ana, (frame) => frame.type === 'error');
  ana.send('{esto no es json');
  assert.match((await malformed).payload.message, /formato|JSON|válido/i);

  const forbidden = waitFor(beto, (frame) => frame.type === 'error');
  send(beto, 'message:delete', { id: first.id });
  assert.match((await forbidden).payload.message, /autor/);
  const deleted = waitFor(dani, (frame) => frame.type === 'message:delete');
  send(ana, 'message:delete', { id: first.id });
  assert.equal((await deleted).payload.id, first.id);

  const leave = waitFor(dani, (frame) => frame.type === 'user:leave');
  beto.close();
  assert.equal((await leave).payload.user.name, 'Beto');
  await waitFor(dani, (frame) => frame.type === 'users:list' && frame.payload.count === 3);

  const replay = await makeClient(wsUrl, 'Beto', 'client-beto-0002'); clients.push(replay.ws);
  assert.equal(replay.user.id, 'client-beto-0002');
  assert.equal(replay.user.name, 'Beto');
});

test('llamada de sala: todos reciben opción para unirse, señalización privada y cierre', async (t) => {
  const { httpServer, wsServer } = createChatServer();
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const wsUrl = `ws://127.0.0.1:${httpServer.address().port}/ws`;
  const clients = [];
  t.after(async () => {
    for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.close();
    await new Promise((resolve) => wsServer.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });
  const alice = await makeClient(wsUrl, 'Alice', 'caller-test-0001'); clients.push(alice.ws);
  const bob = await makeClient(wsUrl, 'Bob', 'callee-test-0002'); clients.push(bob.ws);
  const cara = await makeClient(wsUrl, 'Cara', 'observer-test-003'); clients.push(cara.ws);
  await waitFor(cara.ws, (frame) => frame.type === 'call:available' && frame.payload.callId === null);

  const aliceConnecting = waitFor(alice.ws, (frame) => frame.type === 'call:state' && frame.payload.state === 'connecting');
  const availableAtBob = waitFor(bob.ws, (frame) => frame.type === 'call:available' && frame.payload.callId);
  const availableAtCara = waitFor(cara.ws, (frame) => frame.type === 'call:available' && frame.payload.callId);
  send(alice.ws, 'call:start');
  const callId = (await aliceConnecting).payload.callId;
  for (const frame of await Promise.all([availableAtBob, availableAtCara])) {
    assert.equal(frame.payload.callId, callId);
    assert.deepEqual(frame.payload.participants, [{ id: alice.user.id, name: 'Alice' }]);
  }

  const aliceSeesBob = waitFor(alice.ws, (frame) => frame.type === 'call:participant-joined' && frame.payload.peer.id === bob.user.id);
  const bobConnecting = waitFor(bob.ws, (frame) => frame.type === 'call:state' && frame.payload.state === 'connecting');
  send(bob.ws, 'call:join', { callId });
  await Promise.all([aliceSeesBob, bobConnecting]);

  const offerDelivery = waitFor(bob.ws, (frame) => frame.type === 'webrtc:offer');
  send(alice.ws, 'webrtc:offer', { callId, description: { type: 'offer', sdp: 'test-sdp' } });
  assert.deepEqual((await offerDelivery).payload, { callId, description: { type: 'offer', sdp: 'test-sdp' } });
  assert.equal(cara.ws.frames.some((frame) => frame.type === 'webrtc:offer'), false);

  const endedAtBob = waitFor(bob.ws, (frame) => frame.type === 'call:state' && frame.payload.state === 'ended');
  const bobLeftAtAlice = waitFor(alice.ws, (frame) => frame.type === 'call:participant-left' && frame.payload.peerId === bob.user.id);
  send(bob.ws, 'call:end', { callId });
  await Promise.all([endedAtBob, bobLeftAtAlice]);
  const callEndedForCara = waitFor(cara.ws, (frame) => frame.type === 'call:available' && frame.payload.callId === null);
  send(alice.ws, 'call:end', { callId });
  await callEndedForCara;
});

test('chat limita ráfagas de mensajes por usuario', async (t) => {
  const { httpServer, wsServer } = createChatServer();
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const wsUrl = `ws://127.0.0.1:${httpServer.address().port}/ws`;
  const clients = [];
  t.after(async () => {
    for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.close();
    await new Promise((resolve) => wsServer.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });
  const sender = await makeClient(wsUrl, 'Flood test', 'flood-test-user-01'); clients.push(sender.ws);
  const error = waitFor(sender.ws, (frame) => frame.type === 'error' && /muy rápido/.test(frame.payload.message));
  for (let index = 0; index < 13; index += 1) send(sender.ws, 'message:new', { text: `Mensaje ${index}` });
  assert.match((await error).payload.message, /Espera \d+ s/);
});
