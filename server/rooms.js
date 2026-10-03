import crypto from 'node:crypto';

// Salas vivem em memória enquanto o host estiver conectado.
const rooms = new Map();

export function createRoom(host, guild) {
  const id = crypto.randomBytes(9).toString('base64url');
  const room = { id, host, guild, hostSocket: null, viewers: new Map(), createdAt: Date.now() };
  rooms.set(id, room);
  // Sala criada e nunca aberta pelo host expira em 10 minutos.
  setTimeout(
    () => {
      if (rooms.get(id) === room && !room.hostSocket) rooms.delete(id);
    },
    10 * 60 * 1000,
  ).unref();
  return room;
}

export function getRoom(id) {
  return rooms.get(id) || null;
}

export function deleteRoom(id) {
  rooms.delete(id);
}

// Nível A do plano: entra o host ou quem está no servidor do Discord escolhido para a sala.
export function canWatch(room, user) {
  if (!user) return false;
  if (user.id === room.host.id) return true;
  return user.guilds.some((g) => g.id === room.guild.id);
}

// Salas ao vivo cujo host está na mesma call (canal de voz) que o espectador da Atividade.
export function roomsForCall(guildId, voiceUserIds) {
  const inCall = new Set(voiceUserIds);
  return [...rooms.values()].filter((r) => r.hostSocket && r.guild.id === guildId && inCall.has(r.host.id));
}

export function publicRoom(room) {
  return {
    id: room.id,
    host: { id: room.host.id, name: room.host.name, avatar: room.host.avatar },
    guild: room.guild,
    live: Boolean(room.hostSocket),
  };
}
