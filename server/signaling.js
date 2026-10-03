import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { getUser, getUserByToken } from './sessions.js';
import { getRoom, deleteRoom, canWatch } from './rooms.js';

const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
const publicUser = (u) => ({ id: u.id, name: u.name, avatar: u.avatar });

function viewerList(room) {
  return [...room.viewers.entries()].map(([peerId, v]) => ({ peerId, ...publicUser(v.user) }));
}

export function attachSignaling(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url, 'http://x').searchParams;
    // Na Atividade do Discord não há cookie: a sessão vem como ?token=.
    const user = params.get('token') ? getUserByToken(params.get('token')) : getUser(req.headers.cookie);
    const roomId = params.get('room');
    const room = roomId && getRoom(roomId);

    if (!user) return ws.close(4401, 'login necessário');
    if (!room) return ws.close(4404, 'sala não existe');
    if (!canWatch(room, user)) return ws.close(4403, 'sem permissão');

    const isHost = user.id === room.host.id;
    const peerId = isHost ? 'host' : crypto.randomBytes(6).toString('hex');

    if (isHost) {
      if (room.hostSocket) room.hostSocket.close(4409, 'aberto em outra aba');
      room.hostSocket = ws;
      send(ws, { type: 'hello', role: 'host', viewers: viewerList(room) });
      for (const v of room.viewers.values()) send(v.ws, { type: 'host-online' });
    } else {
      room.viewers.set(peerId, { ws, user });
      send(ws, { type: 'hello', role: 'viewer', peerId, live: Boolean(room.hostSocket) });
      if (room.hostSocket) {
        send(room.hostSocket, { type: 'viewer-joined', peerId, user: publicUser(user) });
      }
    }

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === 'signal') {
        // Host fala com um espectador específico; espectador só fala com o host.
        if (isHost) {
          const target = room.viewers.get(msg.to);
          if (target) send(target.ws, { type: 'signal', from: 'host', data: msg.data });
        } else if (room.hostSocket) {
          send(room.hostSocket, { type: 'signal', from: peerId, data: msg.data });
        }
      } else if (msg.type === 'kick' && isHost) {
        room.viewers.get(msg.peerId)?.ws.close(4403, 'removido pelo host');
      } else if (msg.type === 'end' && isHost) {
        for (const v of room.viewers.values()) v.ws.close(4410, 'transmissão encerrada');
        deleteRoom(room.id);
        ws.close(1000);
      }
    });

    ws.on('close', () => {
      if (isHost) {
        if (room.hostSocket !== ws) return;
        room.hostSocket = null;
        for (const v of room.viewers.values()) send(v.ws, { type: 'host-offline' });
      } else {
        room.viewers.delete(peerId);
        if (room.hostSocket) send(room.hostSocket, { type: 'viewer-left', peerId });
      }
    });
  });

  // Mantém conexões vivas atrás de proxies que derrubam WebSocket ocioso.
  const ping = setInterval(() => wss.clients.forEach((c) => c.ping()), 25_000);
  wss.on('close', () => clearInterval(ping));
  return wss;
}
