import crypto from 'node:crypto';
import { config } from './config.js';

// Sessões em memória: suficiente para o protótipo (reiniciar o servidor desloga todo mundo).
const sessions = new Map();
const COOKIE = 'sid';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const i = part.indexOf('=');
        return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
      }),
  );
}

// Cria a sessão e devolve o token assinado (usado no cookie ou, dentro do Discord, no lugar dele).
export function createSessionToken(user) {
  const id = crypto.randomBytes(24).toString('base64url');
  sessions.set(id, { user, expires: Date.now() + MAX_AGE_MS });
  return `${id}.${sign(id)}`;
}

export function createSession(res, user) {
  const token = createSessionToken(user);
  const secure = config.baseUrl.startsWith('https://') ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_MS / 1000}${secure}`,
  );
}

export function getUser(cookieHeader) {
  return getUserByToken(parseCookies(cookieHeader)[COOKIE]);
}

export function getUserByToken(raw) {
  if (!raw) return null;
  const [id, mac] = raw.split('.');
  if (!id || !mac || mac.length !== sign(id).length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(id)))) return null;
  const session = sessions.get(id);
  if (!session || session.expires < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session.user;
}

export function destroySession(req, res) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (raw) sessions.delete(raw.split('.')[0]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
