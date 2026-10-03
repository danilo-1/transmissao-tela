// Teste ponta a ponta: um host compartilha a tela (falsa, do Chromium) e um amigo recebe o vídeo.
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApp } from '../server/index.js';
import { attachSignaling } from '../server/signaling.js';

const server = http.createServer(createApp());
const wss = attachSignaling(server);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
  ],
});

async function login(page, name) {
  await page.fill('input[name=name]', name);
  await page.click('button[type=submit]');
}

try {
  const host = await (await browser.newContext()).newPage();
  await host.goto(`${base}/auth/login`);
  await login(host, 'Host');
  await host.click('#create');
  await host.waitForURL(/\/s\//);
  const roomPath = new URL(host.url()).pathname;

  const viewer = await (await browser.newContext()).newPage();
  await viewer.goto(`${base}${roomPath}`);
  await viewer.click('#login');
  await login(viewer, 'Amigo');
  await viewer.waitForSelector('#stage:not(.hidden)');

  await host.waitForFunction(() => document.getElementById('count').textContent === '1');
  await host.click('#share');
  await viewer.waitForFunction(
    () => {
      const v = document.getElementById('video');
      return v.srcObject && v.videoWidth > 0 && !v.paused;
    },
    null,
    { timeout: 15_000 },
  );

  await host.click('#stop');
  await viewer.waitForFunction(() => document.getElementById('badge').textContent === 'offline');
  assert.match(await viewer.textContent('#status'), /Aguardando/);
  console.log('ok - amigo recebeu a tela do host e viu a transmissão parar');
} finally {
  await browser.close();
  for (const c of wss.clients) c.terminate();
  wss.close();
  server.closeAllConnections();
  server.close();
}
