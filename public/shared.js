// Peças usadas pela página da sala (navegador) e pela Atividade dentro do Discord.
export const $ = (id) => document.getElementById(id);
export const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

export function setStatus(text) {
  $('status').textContent = text;
}
export function setLive(live) {
  $('badge').textContent = live ? 'ao vivo' : 'offline';
  $('badge').classList.toggle('live', live);
}

const CLOSE_REASONS = {
  4401: 'Sua sessão expirou. Recarregue a página.',
  4403: 'Você não tem permissão para assistir esta sala.',
  4404: 'Esta sala não existe mais.',
  4409: 'A sala foi aberta em outra aba.',
  4410: 'A transmissão foi encerrada.',
};

// Abre o WebSocket da sala. `token` é usado na Atividade, onde não há cookie.
export function connect(roomId, token) {
  const params = new URLSearchParams({ room: roomId });
  if (token) params.set('token', token);
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${params}`);
  const sendWs = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  ws.addEventListener('close', (e) => {
    setLive(false);
    setStatus(CLOSE_REASONS[e.code] || 'Conexão perdida. Recarregue a página para tentar de novo.');
  });
  return { ws, sendWs };
}

export function viewerMode(ws, sendWs, iceServers) {
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
