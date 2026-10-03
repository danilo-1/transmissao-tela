import { $, show, setStatus, setLive, connect, viewerMode } from './shared.js';

const roomId = location.pathname.split('/').pop();

const roomRes = await fetch(`/api/rooms/${roomId}`);
const room = await roomRes.json();
if (roomRes.status === 401) {
  $('title').textContent = 'Entre para assistir';
  $('login').href = `/auth/login?next=${encodeURIComponent(location.pathname)}`;
  show('login');
} else if (!roomRes.ok) {
  $('title').textContent = 'Não foi possível entrar';
  $('error').textContent = room.error;
} else {
  start(room);
}

async function start(room) {
  const { iceServers } = await fetch('/api/config').then((r) => r.json());
  $('title').textContent = room.isHost ? 'Sua transmissão' : `Tela de ${room.host.name}`;
  $('guild').textContent = `· servidor ${room.guild.name}`;
  show('stage');
  $('fullscreen').onclick = () => $('video').requestFullscreen?.();

  const { ws, sendWs } = connect(roomId);

  if (room.isHost) hostMode(room, ws, sendWs, iceServers);
  else viewerMode(ws, sendWs, iceServers);
}

function hostMode(room, ws, sendWs, iceServers) {
  const peers = new Map(); // peerId -> RTCPeerConnection
  const viewers = new Map(); // peerId -> user
  let stream = null;

  $('link').textContent = `${location.origin}/s/${room.id}`;
  $('copy').onclick = async () => {
    await navigator.clipboard.writeText($('link').textContent);
    $('copy').textContent = 'Copiado!';
    setTimeout(() => ($('copy').textContent = 'Copiar'), 1500);
  };
  show('host-panel');
  show('share');
  show('end');
  setStatus('Clique em "Compartilhar tela" para começar.');

  function renderViewers() {
    $('count').textContent = viewers.size;
    $('viewers').replaceChildren(
      ...[...viewers].map(([peerId, user]) => {
        const li = document.createElement('li');
        const who = document.createElement('span');
        who.className = 'user';
        who.append(Object.assign(document.createElement('img'), { src: user.avatar, alt: '' }), user.name);
        const kick = Object.assign(document.createElement('button'), {
          textContent: 'Remover',
          className: 'secondary',
        });
        kick.onclick = () => sendWs({ type: 'kick', peerId });
        li.append(who, kick);
        return li;
      }),
    );
  }

  async function connectViewer(peerId) {
    if (!stream) return;
    peers.get(peerId)?.close();
    const pc = new RTCPeerConnection({ iceServers });
    peers.set(peerId, pc);
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.onicecandidate = (e) => e.candidate && sendWs({ type: 'signal', to: peerId, data: { candidate: e.candidate } });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendWs({ type: 'signal', to: peerId, data: { description: pc.localDescription } });
  }

  function disconnectAll() {
    for (const [peerId, pc] of peers) {
      pc.close();
      sendWs({ type: 'signal', to: peerId, data: { stopped: true } });
    }
    peers.clear();
  }

  async function startSharing() {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
    } catch {
      setStatus('Compartilhamento cancelado.');
      return;
    }
    $('video').srcObject = stream;
    stream.getVideoTracks()[0].contentHint = 'detail';
    stream.getVideoTracks()[0].onended = stopSharing;
    show('share', false);
    show('stop');
    setLive(true);
    setStatus('Você está ao vivo.');
    for (const peerId of viewers.keys()) connectViewer(peerId);
  }

  function stopSharing() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    $('video').srcObject = null;
    disconnectAll();
    show('stop', false);
    show('share');
    setLive(false);
    setStatus('Transmissão pausada. Os amigos continuam na sala.');
  }

  $('share').onclick = startSharing;
  $('stop').onclick = stopSharing;
  $('end').onclick = () => {
    stopSharing();
    sendWs({ type: 'end' });
  };

  ws.addEventListener('message', async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') {
      msg.viewers.forEach((v) => viewers.set(v.peerId, v));
      renderViewers();
    } else if (msg.type === 'viewer-joined') {
      viewers.set(msg.peerId, msg.user);
      renderViewers();
      connectViewer(msg.peerId);
    } else if (msg.type === 'viewer-left') {
      viewers.delete(msg.peerId);
      peers.get(msg.peerId)?.close();
      peers.delete(msg.peerId);
      renderViewers();
    } else if (msg.type === 'signal') {
      const pc = peers.get(msg.from);
      if (!pc) return;
      if (msg.data.description) await pc.setRemoteDescription(msg.data.description);
      else if (msg.data.candidate) await pc.addIceCandidate(msg.data.candidate).catch(() => {});
    }
  });
}
