const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const roomId = location.pathname.split('/').pop();

function setStatus(text) {
  $('status').textContent = text;
}
function setLive(live) {
  $('badge').textContent = live ? 'ao vivo' : 'offline';
  $('badge').classList.toggle('live', live);
}

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

  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${roomId}`);
  const sendWs = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

  ws.addEventListener('close', (e) => {
    const reasons = {
      4401: 'Sua sessão expirou. Recarregue a página.',
      4403: 'Você não tem permissão para assistir esta sala.',
      4404: 'Esta sala não existe mais.',
      4409: 'A sala foi aberta em outra aba.',
      4410: 'A transmissão foi encerrada.',
    };
    setLive(false);
    setStatus(reasons[e.code] || 'Conexão perdida. Recarregue a página para tentar de novo.');
  });

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

function viewerMode(ws, sendWs, iceServers) {
  let pc = null;
  const video = $('video');

  function waiting() {
    pc?.close();
    pc = null;
    video.srcObject = null;
    setLive(false);
    show('unmute', false);
    setStatus('Aguardando o host compartilhar a tela…');
  }

  $('unmute').onclick = () => {
    video.muted = false;
    video.play();
    show('unmute', false);
  };

  ws.addEventListener('message', async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello' || msg.type === 'host-online') {
      waiting();
    } else if (msg.type === 'host-offline') {
      waiting();
      setStatus('O host saiu da sala. Aguardando ele voltar…');
    } else if (msg.type === 'signal') {
      const { description, candidate, stopped } = msg.data;
      if (stopped) return waiting();
      if (description) {
        pc?.close();
        pc = new RTCPeerConnection({ iceServers });
        pc.onicecandidate = (ev) => ev.candidate && sendWs({ type: 'signal', data: { candidate: ev.candidate } });
        pc.ontrack = (ev) => {
          video.srcObject = ev.streams[0];
          setLive(true);
          setStatus('');
          if (ev.streams[0].getAudioTracks().length) show('unmute', video.muted);
        };
        pc.onconnectionstatechange = () => {
          if (pc?.connectionState === 'failed') {
            setStatus('Não deu para conectar direto com o host. Pode ser a rede; um servidor TURN resolve.');
          }
        };
        await pc.setRemoteDescription(description);
        await pc.setLocalDescription(await pc.createAnswer());
        sendWs({ type: 'signal', data: { description: pc.localDescription } });
      } else if (candidate && pc) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
    }
  });
}
