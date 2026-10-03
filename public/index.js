const $ = (id) => document.getElementById(id);

// Aberto pelo Discord como Atividade: vai para a tela de quem assiste dentro da call.
const params = new URLSearchParams(location.search);
if (location.hostname.endsWith('.discordsays.com') || params.has('frame_id') || params.has('instance_id')) {
  location.replace(`/activity.html${location.search}`);
}

const { devMode } = await fetch('/api/config').then((r) => r.json());
$('dev-banner').classList.toggle('hidden', !devMode);

const res = await fetch('/api/me');
if (res.status === 401) {
  $('logged-out').classList.remove('hidden');
} else {
  const { user } = await res.json();
  $('me').innerHTML = '';
  const img = Object.assign(document.createElement('img'), { src: user.avatar, alt: '' });
  $('me').append(img, document.createTextNode(user.name));
  $('me').classList.remove('hidden');

  for (const g of user.guilds) $('guild').append(new Option(g.name, g.id));
  $('logged-in').classList.remove('hidden');

  $('create').onclick = async () => {
    $('error').textContent = '';
    const r = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: $('guild').value }),
    });
    const body = await r.json();
    if (!r.ok) return ($('error').textContent = body.error);
    location.href = `/s/${body.id}`;
  };
}
