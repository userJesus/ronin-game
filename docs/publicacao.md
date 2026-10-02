# Publicação no GitHub

Destino: [userJesus/ronin-game](https://github.com/userJesus/ronin-game). A identidade pública usa o
símbolo 雨; o nome do repositório é um identificador técnico.

## O que está preparado

- README em português e inglês, capturas e GIF do jogo.
- Documentação de arquitetura, processo, contribuição e [identidade visual](identidade.md).
- Licença MIT, créditos de terceiros, código de conduta e política de segurança.
- Workflows de CI, e2e de produção e GitHub Pages; formulários de issues e PR.
- Auditoria com `npm run check:repo` e `.gitignore` para dependências, builds, logs, credenciais e arquivos locais.

Os assets em `src/assets/`, `assets-src/`, `public/` e `docs/media/` fazem parte dos fontes públicos.
`node_modules/`, `dist/`, `dist-single/`, `test-results/`, `playwright-report/`, prévias e backups ficam fora.
Os arquivos ignorados são preservados no computador. Não envie a pasta inteira por arrastar e soltar;
use o Git para respeitar essas exclusões e incluir `.github/` e os demais arquivos de configuração.

## Validar e enviar

```bash
npm ci
npx playwright install chromium
npm run check
git status --short
git add .
git diff --cached --stat
git commit -m "chore: prepare open-source game release"
git push -u origin main
```

Na preparação inicial, o Git foi configurado na branch `main`, com `origin` apontando para o destino
acima. Os comandos desta seção descrevem o primeiro envio; após a publicação, siga o fluxo de branches
e pull requests do [guia de contribuição](../CONTRIBUTING.md). Confira `git remote -v` antes de publicar.
O envio exige autenticação de uma conta com acesso ao repositório; `gh auth login` pode configurá-la.
Se o remoto receber commits antes do primeiro envio, faça `git fetch origin` e revise o histórico antes
de integrar as mudanças. Não use `--force` para substituir trabalho no remoto.

No PowerShell, use `npm.cmd` e `npx.cmd` se a política do sistema bloquear os arquivos `.ps1`.
Encerre servidores locais deste projeto antes de `npm ci`, para evitar arquivos de dependências bloqueados.

## Configurações do repositório

A descrição, os tópicos e o link de homepage foram configurados no GitHub durante a preparação. O relato
privado de vulnerabilidades também foi habilitado. Essas configurações pertencem ao repositório, não aos arquivos.

- **Descrição:** 雨 · Ação isométrica em pixel art monocromática. Dois samurais, hordas na chuva e áudio procedural. Open source com three.js e TypeScript.
- **Homepage:** `https://userjesus.github.io/ronin-game/`, disponível após o primeiro deploy.
- **Tópicos:** `browser-game`, `open-source`, `threejs`, `typescript`, `pixel-art`, `isometric`, `samurai`, `webgl`, `procedural-audio`, `vite`.
- **Social preview:** em **Settings → General → Social preview**, envie [`public/og-image.png`](../public/og-image.png).
  A imagem está pronta; sua presença no Git não configura automaticamente a prévia do repositório.

## Publicar o jogo com Pages

1. Em **Settings → Pages → Build and deployment → Source**, selecione **GitHub Actions**.
2. Envie a branch `main`. O workflow [Pages](../.github/workflows/pages.yml) audita os arquivos,
   roda os testes de unidade, compila e publica `dist/`.
3. Se o primeiro envio ocorreu antes de habilitar Pages, execute **Actions → Pages → Run workflow**.
4. Aguarde a conclusão e confira o endereço da homepage, incluindo ícones, menu e uma partida.

O build usa caminhos relativos para funcionar sob `/ronin-game/`. Em forks, atualize `homepage`, URLs de
compartilhamento em `index.html` e links dos READMEs para o novo dono e repositório.
Referência: [workflows personalizados do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Verificações automáticas

| Workflow | Quando | Validação |
|---|---|---|
| CI | Push na `main`, PR e execução manual | Links/arquivos, tipos, unidade, build normal e arquivo único |
| E2E | Push na `main`, PR e execução manual | 20 testes contra o build de produção, Chromium com SwiftShader |
| Pages | Push na `main` e execução manual | Auditoria, unidade, build e publicação |

Em falhas e2e, baixe `playwright-results` na execução do workflow para ver capturas, traces e relatório.
O Dependabot abre atualizações mensais de npm e GitHub Actions.

`npm run check:repo` procura padrões comuns de credenciais nos arquivos destinados ao Git. Isso não é uma
auditoria exaustiva de segurança; confira também o conteúdo do commit, inclusive a procedência dos assets.
