// Tela de quem assiste, aberta dentro da call do Discord como Atividade.
import { DiscordSDK } from '/vendor/discord-sdk.js';
import { $, show, setStatus, connect, viewerMode } from './shared.js';

const config = await fetch('/api/config').then((r) => r.json());
let session = null;

async function init() {
  if (!config.discordClientId) throw new Error('O servidor está sem as chaves do Discord.');
  const sdk = new DiscordSDK(config.discordClientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: config.discordClientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds'],
  });
  const tokenRes = await fetch('/auth/activity-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const auth = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(auth.error);
  await sdk.commands.authenticate({ access_token: auth.access_token });
  session = auth.session;

  if (!sdk.channelId) throw new Error('Abra a Atividade dentro de uma call.');
  return { sdk, me: auth.user };
}

// Quem está na call. Em servidor, o Discord lista o canal de voz inteiro. Em call por mensagem direta
// isso exige permissão especial, então usamos quem abriu a Atividade (o host também precisa abrir).
async function callUserIds(sdk) {
  if (sdk.guildId) {
    try {
      const channel = await sdk.commands.getChannel({ channel_id: sdk.channelId });
      return (channel.voice_states || []).map((v) => v.user.id);
    } catch {
      // cai para os participantes da Atividade
    }
  }
  const { participants } = await sdk.commands.getInstanceConnectedParticipants();
  return participants.map((p) => p.id);
}

async function findRooms(sdk) {
  const voiceUserIds = await callUserIds(sdk);
  const res = await fetch('/api/activity/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
    body: JSON.stringify({ guildId: sdk.guildId || null, voiceUserIds }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body.rooms;
}

function watch(room) {
  $('rooms').replaceChildren();
  $('title').textContent = `Tela de ${room.host.name}`;
  show('stage');
  $('fullscreen').onclick = () => $('video').requestFullscreen?.();
  const { ws, sendWs } = connect(room.id, session);
  viewerMode(ws, sendWs, config.iceServers);
  return ws;
}

// Procura transmissões de quem está na call; com uma só, entra direto.
async function lobby({ sdk, me }) {
  show('stage', false);
  $('title').textContent = 'Transmissões nesta call';
  let current = null;

  function open(room) {
    const ws = watch(room);
    current = ws;
    // Se a sala acabar, volta a procurar transmissões na call.
    ws.addEventListener('close', () => {
      if (current !== ws) return;
      current = null;
      setTimeout(refresh, 3000);
    });
  }

  async function refresh() {
    if (current) return;
    const all = await findRooms(sdk).catch((e) => {
      $('error').textContent = e.message;
      return [];
    });
    const mine = all.some((r) => r.host.id === me.id);
    const rooms = all.filter((r) => r.host.id !== me.id);
    if (rooms.length === 1) return open(rooms[0]);
    $('rooms').replaceChildren(
      ...rooms.map((room) => {
        const li = document.createElement('li');
        const btn = Object.assign(document.createElement('button'), { textContent: `Assistir ${room.host.name}` });
        btn.onclick = () => {
          open(room);
          show('back');
        };
        li.append(btn);
        return li;
      }),
    );
    if (rooms.length) setStatus('Escolha qual tela assistir.');
    else if (mine) setStatus('Você está transmitindo. Seus amigos na call já conseguem assistir por aqui.');
    else {
      setStatus(
        `Ninguém desta call está transmitindo agora. Para transmitir, abra ${config.publicUrl} no navegador` +
          (sdk.guildId ? '.' : ' e deixe esta Atividade aberta também.'),
      );
    }
  }

  $('back').onclick = () => {
    const ws = current;
    current = null;
    ws?.close(1000);
    show('back', false);
    show('stage', false);
    $('title').textContent = 'Transmissões nesta call';
    refresh();
  };

  await refresh();
  setInterval(refresh, 5000);
}

try {
  await lobby(await init());
} catch (err) {
  $('title').textContent = 'Não foi possível abrir';
  $('error').textContent = err.message || String(err);
}
