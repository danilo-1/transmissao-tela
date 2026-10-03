import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  discord: {
    clientId: env.DISCORD_CLIENT_ID || '',
    clientSecret: env.DISCORD_CLIENT_SECRET || '',
  },
  sessionSecret: env.SESSION_SECRET || 'dev-secret-troque-isto',
  turn: env.TURN_URL ? { urls: env.TURN_URL, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL } : null,
};

// Sem credenciais do Discord, o app roda em modo de desenvolvimento (login só com nome).
config.devMode = !config.discord.clientId;

export function iceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (config.turn) servers.push(config.turn);
  return servers;
}
