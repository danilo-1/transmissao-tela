import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, iceServers } from './config.js';
import { authRouter } from './auth.js';
import { getUser } from './sessions.js';
import { createRoom, getRoom, canWatch, publicRoom } from './rooms.js';
import { attachSignaling } from './signaling.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    req.user = getUser(req.headers.cookie);
    next();
  });

  app.use('/auth', authRouter);
  app.use(express.static(publicDir, { extensions: ['html'] }));
  app.use(express.json());

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'login necessário' });
    res.json({ user: req.user, devMode: config.devMode });
  });

  app.get('/api/config', (req, res) => res.json({ iceServers: iceServers(), devMode: config.devMode }));

  app.post('/api/rooms', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'login necessário' });
    const guild = req.user.guilds.find((g) => g.id === req.body?.guildId);
    if (!guild) return res.status(400).json({ error: 'escolha um servidor do Discord' });
    const room = createRoom(req.user, guild);
    res.status(201).json({ ...publicRoom(room), link: `${config.baseUrl}/s/${room.id}` });
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'sala não existe ou já acabou' });
    if (!req.user) return res.status(401).json({ error: 'login necessário' });
    if (!canWatch(room, req.user)) {
      return res.status(403).json({ error: `só quem está no servidor "${room.guild.name}" pode assistir` });
    }
    res.json({ ...publicRoom(room), isHost: room.host.id === req.user.id });
  });

  app.get('/s/:id', (req, res) => res.sendFile(path.join(publicDir, 'room.html')));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = http.createServer(createApp());
  attachSignaling(server);
  server.listen(config.port, () => {
    console.log(`Rodando em ${config.baseUrl}`);
    if (config.devMode) console.log('Modo de desenvolvimento: sem DISCORD_CLIENT_ID, login pede só um nome.');
  });
}
