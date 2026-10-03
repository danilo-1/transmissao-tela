# Como trabalhar neste repositório

## Fluxo

1. Crie uma branch a partir da `main` (`feat/...`, `fix/...`).
2. Antes de abrir o PR, rode `npm run check` (lint, formatação e testes).
3. Abra um Pull Request. O CI roda sozinho e precisa ficar verde.
4. Faça merge na `main`. O deploy em produção acontece automaticamente depois que o CI passa na `main`.

Commits seguem o estilo [Conventional Commits](https://www.conventionalcommits.org/pt-br/) (`feat:`, `fix:`, `chore:`, `docs:`).

## O que o CI verifica (`.github/workflows/ci.yml`)

- ESLint e Prettier
- Testes do servidor em Node 20 e 22
- `npm audit` nas dependências de produção
- Teste ponta a ponta: um Chromium compartilha a tela e outro recebe o vídeo
- Build da imagem Docker e checagem do `/healthz`

Também rodam o CodeQL (análise de segurança) e o Dependabot (atualização de dependências).

## Configuração única no GitHub

Em **Settings > Branches > Add branch ruleset** para a `main`:

- Exigir Pull Request antes do merge
- Exigir os checks do CI passando (`Lint, formatação e testes`, `Transmissão ponta a ponta`, `Build da imagem Docker`)
- Bloquear force push

Em **Settings > Environments**, crie `production` e adicione o secret `RENDER_DEPLOY_HOOK_URL` (veja o README).

## Segredos

Nunca faça commit do `.env`. Chaves do Discord e do TURN ficam só no `.env` local e nas variáveis do Render.
