# Como contribuir

Contribuições são bem-vindas: correções, desempenho, acessibilidade, testes, documentação e ideias que respeitem a identidade do jogo.

## Antes de começar

- Leia o [README](README.md), a [arquitetura](docs/arquitetura.md) e o [briefing técnico e de arte](docs/brief.md). O briefing é a referência para a direção de arte e para os contratos entre módulos.
- Para mudanças grandes (mecânica nova, cenário, personagem), abra uma issue antes para conversar.
- Ao participar, você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md).

## Ambiente

Node.js 22.12 ou mais novo (recomendado: 24 LTS, ver [`.nvmrc`](.nvmrc)) e um navegador com WebGL2.

```bash
git clone https://github.com/userJesus/ronin-game.git
cd ronin-game
npm ci
npm run dev        # http://localhost:5173
```

Para os testes de ponta a ponta, instale o Chromium do Playwright uma vez: `npx playwright install chromium`.

## Fluxo

1. Faça um fork e crie um branch a partir da `main`.
2. Faça a mudança junto com os testes (veja abaixo).
3. Rode `npm run check`: auditoria do repositório, tipos, testes de unidade, os dois builds e e2e. Em todo PR o CI roda a auditoria, tipos, unidade e builds, e um workflow separado roda o e2e de produção.
4. Abra o PR dizendo o que muda e como você testou. Mudança visual pede captura de tela (`node scripts/shot.mjs`, com o jogo rodando).

## Regras do código

- **TypeScript estrito** (`strict`, `noUnusedLocals`, `noUnusedParameters`): `npm run typecheck` sem erros.
- **Comentários e textos de interface em português do Brasil**, curtos, no estilo do código vizinho.
- **Simulação determinística**: `src/sim/` não usa `Math.random` nem three.js; sorteios passam pelo `Rng` semeado de [`src/core/math.ts`](src/core/math.ts). A mesma semente tem de produzir a mesma partida.
- **Desempenho**: a meta é 60 fps num notebook comum. Nada de alocação por quadro nos laços quentes; use pools e instancing.
- **Contratos dos módulos**: evite mudar as assinaturas exportadas de `src/world`, `src/fx`, `src/audio` e `src/ui` (tabela em [docs/brief.md](docs/brief.md)).
- **Ganchos de teste**: preserve `window.__game`, os parâmetros de URL (`?autostart`, `?seed`, `?char`, `?stage`), `document.body.dataset.screen` e os botões `data-action`, porque os testes e2e dependem deles.

## Direção de arte

- **Só tons de cinza.** Nenhuma cor, nem na interface.
- **Pixel art em baixa resolução**: texturas com `NearestFilter`, sem mipmaps, ampliação inteira sem suavização.
- Branco puro fica reservado para golpes, brilhos e avisos de ataque.
- Legibilidade do combate em primeiro lugar: samurais quase pretos sobre chão cinza médio-claro.

## Testes

- `npm test`: testes de unidade (Vitest, ambiente node) da simulação e dos modelos puros. Se a mudança mexe numa regra de jogo, acrescente ou ajuste um teste em `tests/unit/`.
- `npm run test:e2e`: ponta a ponta (Playwright, Chromium com WebGL por software). `E2E_PROD=1 npm run test:e2e` testa o build de produção.
- A suíte de navegador usa as fontes de reserva para não depender da rede do Google Fonts. As capturas de divulgação usam as fontes originais; confira ambas ao alterar tipografia ou layout.
- O robô de balanceamento ([`tests/unit/bot.test.ts`](tests/unit/bot.test.ts)) imprime uma tabela de calibragem. Se a mudança mexe em dano, vida ou ritmo da horda, compare a tabela antes e depois.

No PowerShell, o teste de produção usa `$env:E2E_PROD='1'`, seguido de `npm.cmd run test:e2e`.
Depois, remova a variável com `Remove-Item Env:E2E_PROD`. Falhas geram capturas e traces em `test-results/`
e um relatório em `playwright-report/`; esses arquivos não entram no Git. Feche um preview existente na
porta 4173 antes de testar produção. Instalação bloqueada por `npm.ps1`: use `npm.cmd` / `npx.cmd`.

## Capturas para a documentação

Depois de instalar o Chromium, em um terminal:

```bash
npm run build
npm run preview
```

Em outro:

```bash
npm run media -- --url http://localhost:4173/
```

O script produz título, campo, templo, leão, Tomoe, celular e um GIF de 72 quadros, cuja decodificação é
verificada no Chromium. `--only templo,leao` limita as cenas; `--debug assets-src/preview/media` salva
amostras e metadados fora do Git. As capturas usam estados preparados da simulação para demonstrar as mecânicas.
O Google Fonts precisa estar acessível para preservar a tipografia. Veja também a [identidade visual](docs/identidade.md).

## Arte e assets

- As folhas de origem ficam em `assets-src/`, com fundo verde para recorte. `npm run sprites` gera o atlas (`src/assets/sprites/`) e `npm run menu-art` gera a arte do título (`src/assets/menu/`). Não edite os arquivos gerados à mão.
- `npm run brand` regera o símbolo, o favicon e as imagens de compartilhamento. `npm run media` regera as capturas do README, com o jogo rodando (instruções no cabeçalho de [`scripts/media.mjs`](scripts/media.mjs)).
- A arte atual foi gerada com IA (ChatGPT, gpt-image). Se a sua contribuição trouxer arte, informe a origem no PR (feita à mão, gerada por IA, banco de imagens etc.). Só entra arte que possa ser distribuída sob a licença do projeto.

## Licença

Ao contribuir, você concorda que a sua contribuição seja distribuída sob a [licença MIT](LICENSE) do projeto.
