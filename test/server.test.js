import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { attachSignaling } from '../server/signaling.js';

let server;
let wss;
let base;

before(async () => {
  server = http.createServer(createApp());
  wss = attachSignaling(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  wss.close();
  for (const c of wss.clients) c.terminate();
  server.closeAllConnections();
  server.close();
});

async function login(name) {
  const res = await fetch(`${base}/auth/dev-login`, {
    method: 'POST',
    body: new URLSearchParams({ name, next: '/' }),
    redirect: 'manual',
  });
  return res.headers.get('set-cookie').split(';')[0];
}

function openWs(roomId, cookie) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${roomId}`, { headers: { cookie } });
  const messages = [];
  ws.on('message', (m) => messages.push(JSON.parse(m)));
  const next = (type) =>
    new Promise((resolve) => {
      const check = () => {
        const i = messages.findIndex((m) => m.type === type);
        if (i >= 0) return resolve(messages.splice(i, 1)[0]);
        ws.once('message', check);
      };
      check();
    });
  return { ws, next, closed: new Promise((r) => ws.on('close', (code) => r(code))) };
}

test('sem login não cria sala', async () => {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('host cria sala e espectador recebe sinal do host', async () => {
  const hostCookie = await login('Host');
  const room = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { cookie: hostCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ guildId: 'dev' }),
  }).then((r) => r.json());
  assert.ok(room.id);

  const viewerCookie = await login('Amigo');
  const info = await fetch(`${base}/api/rooms/${room.id}`, { headers: { cookie: viewerCookie } }).then((r) => r.json());
  assert.equal(info.isHost, false);

  const host = openWs(room.id, hostCookie);
  await host.next('hello');
  const viewer = openWs(room.id, viewerCookie);
  const hello = await viewer.next('hello');
  assert.equal(hello.live, true);

  const joined = await host.next('viewer-joined');
  assert.equal(joined.user.name, 'Amigo');

  host.ws.send(JSON.stringify({ type: 'signal', to: joined.peerId, data: { description: { type: 'offer', sdp: 'x' } } }));
  const signal = await viewer.next('signal');
  assert.equal(signal.data.description.type, 'offer');

  host.ws.send(JSON.stringify({ type: 'kick', peerId: joined.peerId }));
  assert.equal(await viewer.closed, 4403);
  host.ws.close();
});

test('sala inexistente e sem login fecham o WebSocket', async () => {
  const cookie = await login('X');
  assert.equal(await openWs('nao-existe', cookie).closed, 4404);
  assert.equal(await openWs('nao-existe', '').closed, 4401);
});

test('next do login não aceita domínio externo', async () => {
  const res = await fetch(`${base}/auth/dev-login`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'a', next: '//evil.com' }),
    redirect: 'manual',
  });
  assert.equal(res.headers.get('location'), '/');
});
