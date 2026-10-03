# Transmissão de tela

Compartilhe sua tela com os amigos da sua call do Discord. Você cria uma sala, manda o link no chat da call, e quem estiver no servidor do Discord escolhido entra com a própria conta e assiste ao vivo.

A tela vai direto do seu navegador para o de cada amigo (WebRTC). O servidor só faz login, salas e a troca de mensagens para a conexão começar.

## Rodando local

```bash
npm install
cp .env.example .env   # opcional no começo
npm start              # http://localhost:3000
```

Sem `DISCORD_CLIENT_ID` no `.env`, o app roda em **modo de teste**: o login pede só um nome. Dá para testar abrindo duas janelas (uma anônima) na mesma máquina.

## Ligando o login do Discord

1. Crie um app em https://discord.com/developers/applications.
2. Em **OAuth2**, copie o _Client ID_ e gere o _Client Secret_.
3. Em **OAuth2 > Redirects**, adicione `http://localhost:3000/auth/callback` (e depois a URL de produção + `/auth/callback`).
4. Preencha `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` e `SESSION_SECRET` no `.env` e reinicie.

O login pede os escopos `identify` (nome e avatar) e `guilds` (lista de servidores, para checar quem pode assistir).

## Assistir dentro da call (Atividade do Discord)

Quem transmite continua usando o site. Os amigos podem assistir **dentro da call**, pelo botão de Atividades (foguete), sem abrir link. O Discord informa quem está na call, então só aparece a transmissão de quem está nela.

Para ligar, no [Discord Developer Portal](https://discord.com/developers/applications), no mesmo app do login:

1. **Activities > URL Mappings**: em _Root Mapping_ (`/`), coloque `transmissao-tela.onrender.com` (sem `https://`).
2. **Activities > Settings**: marque **Enable Activities**. Em _Supported Platforms_, deixe **Web** (desktop) ligado.
3. **Installation**: deixe **Guild Install** ligado e use o _Install Link_ para adicionar o app ao seu servidor.
4. Numa call do servidor, clique no foguete (Atividades) e escolha o app.

## Como funciona

- `server/auth.js`: login com Discord (OAuth2) e o login de teste.
- `server/rooms.js`: salas em memória; só assiste quem está no servidor do Discord escolhido pelo host.
- `server/signaling.js`: WebSocket que repassa offer/answer/ICE entre host e espectadores, e permite ao host remover alguém.
- `public/room.js`: captura da tela (`getDisplayMedia`) no host e uma conexão WebRTC por espectador.

Limites atuais: funciona bem para 3 a 5 espectadores (cada um consome upload do host). Sessões e salas ficam em memória, então reiniciar o servidor encerra tudo. Para redes mais fechadas é preciso um servidor TURN (`TURN_URL` no `.env`).

## Testes

```bash
npm run check      # lint + formatação + testes do servidor
npm run test:e2e   # transmissão real entre dois Chromium (precisa do Playwright)
```

## CI/CD

- **CI** (GitHub Actions): lint, formatação, testes, auditoria de dependências, teste ponta a ponta e build Docker em todo PR e push na `main`.
- **CD**: quando o CI passa na `main`, o workflow `Deploy` chama o deploy hook do Render.
- **Segurança**: CodeQL semanal e Dependabot.

### Primeiro deploy no Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/danilo-1/transmissao-tela)

1. Clique no botão acima (ou **New > Blueprint** no Render e escolha este repositório). Ele lê o `render.yaml`.
2. As chaves do Discord podem ficar vazias no começo: o app sobe em modo de teste (login só com nome).
3. Para ligar o Discord, preencha as chaves e adicione `<URL do Render>/auth/callback` nos Redirects do Discord Developer Portal.
4. No Render, copie o **Deploy Hook** do serviço e salve no GitHub como secret `RENDER_DEPLOY_HOOK_URL` no environment `production`.

Detalhes do fluxo de trabalho em [CONTRIBUTING.md](CONTRIBUTING.md).
