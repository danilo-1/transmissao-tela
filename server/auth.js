import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { createSession, createSessionToken, destroySession, parseCookies } from './sessions.js';

const DISCORD_API = 'https://discord.com/api/v10';
const redirectUri = () => `${config.baseUrl}/auth/callback`;

// Só aceita voltar para caminhos internos, para o login não virar redirecionamento aberto.
function safeNext(next) {
  return typeof next === 'string' && /^\/[^/\\]/.test(next) ? next : '/';
}

function avatarUrl(user) {
  return user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;
}

async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: 'authorization_code',
    code: String(code),
  });
  if (redirectUri) body.set('redirect_uri', redirectUri);
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).access_token;
}

async function discordProfile(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [me, guilds] = await Promise.all([
    fetch(`${DISCORD_API}/users/@me`, { headers }).then((r) => r.json()),
    fetch(`${DISCORD_API}/users/@me/guilds`, { headers }).then((r) => r.json()),
  ]);
  if (!me.id) throw new Error('perfil do Discord inválido');
  return {
    id: me.id,
    name: me.global_name || me.username,
    avatar: avatarUrl(me),
    guilds: Array.isArray(guilds) ? guilds.map((g) => ({ id: g.id, name: g.name })) : [],
  };
}

export const authRouter = express.Router();

authRouter.get('/login', (req, res) => {
  const next = safeNext(req.query.next);
  if (config.devMode) return res.redirect(`/dev-login.html?next=${encodeURIComponent(next)}`);

  const state = crypto.randomBytes(16).toString('base64url');
  res.setHeader(
    'Set-Cookie',
    `oauth_state=${state}|${encodeURIComponent(next)}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600`,
  );
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    response_type: 'code',
    scope: 'identify guilds',
    redirect_uri: redirectUri(),
    state,
    prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

authRouter.get('/callback', async (req, res) => {
  const [expected, nextEnc] = (parseCookies(req.headers.cookie).oauth_state || '').split('|');
  if (!req.query.code || !expected || req.query.state !== expected) {
    return res.status(400).send('Login inválido ou expirado. <a href="/">Tente de novo</a>.');
  }
  try {
    const accessToken = await exchangeCode(req.query.code, redirectUri());
    createSession(res, await discordProfile(accessToken));
    res.redirect(safeNext(decodeURIComponent(nextEnc || '/')));
  } catch (err) {
    console.error('Falha no login com Discord:', err);
    res.status(502).send('Não deu para falar com o Discord. <a href="/">Tente de novo</a>.');
  }
});

// Atividade do Discord: o SDK entrega um code; trocamos pelo token e devolvemos uma sessão por token,
// porque cookies não funcionam de forma confiável dentro do iframe do Discord.
authRouter.post('/activity-token', express.json(), async (req, res) => {
  if (config.devMode) return res.status(400).json({ error: 'configure as chaves do Discord' });
  if (!req.body?.code) return res.status(400).json({ error: 'code ausente' });
  try {
    const accessToken = await exchangeCode(req.body.code);
    const user = await discordProfile(accessToken);
    res.json({ access_token: accessToken, session: createSessionToken(user), user });
  } catch (err) {
    console.error('Falha no login da Atividade:', err);
    res.status(502).json({ error: 'não deu para falar com o Discord' });
  }
});

// Modo de desenvolvimento: entra só com um nome, todos "no mesmo servidor".
authRouter.post('/dev-login', express.urlencoded({ extended: false }), (req, res) => {
  if (!config.devMode) return res.status(404).end();
  const name =
    String(req.body.name || '')
      .trim()
      .slice(0, 32) || 'Anônimo';
  const id = crypto.randomBytes(8).toString('hex');
  createSession(res, {
    id,
    name,
    avatar: `https://cdn.discordapp.com/embed/avatars/${parseInt(id.slice(0, 2), 16) % 6}.png`,
    guilds: [{ id: 'dev', name: 'Servidor de teste' }],
  });
  res.redirect(safeNext(req.body.next));
});

authRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.redirect('/');
});
