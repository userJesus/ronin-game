# Processo de desenvolvimento

Como o jogo foi feito: em que ordem, com que método, com que ferramentas e quem fez o quê. A ideia é que cada
afirmação possa ser conferida no repositório; o que é reconstrução ou inferência está marcado como tal.
Visão técnica do código: [arquitetura.md](arquitetura.md). Regras de arte, contratos e controles: [brief.md](brief.md).

## Resumo

- O código foi desenvolvido em dois dias, 30 de setembro e 1º de outubro de 2026, com o Claude Code (Anthropic),
  dirigido pelo autor, Jesus C. Oliveira ([@userJesus](https://github.com/userJesus)). Parte do trabalho correu em
  workflows multiagente (vários agentes em paralelo, cada um com seus arquivos, e revisão adversarial); o resto, em
  conversa direta entre o autor e o agente principal de cada sessão.
- Toda a arte de origem ([`assets-src/`](../assets-src/)) foi gerada com o ChatGPT (gpt-image) e transformada nos
  sprites e imagens do jogo por scripts do próprio repositório.
- O som é 100% procedural (Web Audio API): não existe nenhum arquivo de áudio.
- Na preparação pública: cerca de 12,5 mil linhas em `src/` (TypeScript e CSS) e 3,6 mil de testes;
  182 testes de unidade (Vitest) e 20 de ponta a ponta (Playwright). Os números históricos abaixo descrevem cada etapa.

## Fontes e convenções

- **Registros das três sessões de trabalho**: os pedidos do autor (parafraseados aqui, nunca copiados) e os scripts
  dos workflows. Não estão publicados; os nomes dos workflows aparecem abaixo só como exemplos do método.
- **Datas de modificação dos arquivos**: só a última de cada arquivo. Um arquivo mexido dez vezes mostra só a
  décima, então essas datas ordenam as etapas apenas por aproximação.
- **O próprio repositório**: [brief.md](brief.md), os cabeçalhos de [`scripts/`](../scripts/), [`tests/`](../tests/)
  e [`package.json`](../package.json).

Nesses dois dias o projeto não estava sob controle de versão: para revisar uma mudança, o agente principal guardava
uma cópia intacta dos fontes e os revisores comparavam com ela. Por isso o histórico do Git começa na publicação, e a
linha do tempo abaixo é uma reconstrução. Horários em UTC−3 (Brasília). Onde aparece *(inferência)*, não há
registro direto: é uma conclusão tirada dos fatos ao lado.

## Método

### 1. O briefing como fonte da verdade

O [brief.md](brief.md) foi escrito na primeira hora, junto com o núcleo, e reúne o que todo agente precisa
respeitar: direção de arte (só cinza, pixel art, legibilidade do combate), técnica (câmera, gerenciamento de cor,
neblina no pós-processamento, orçamento de desempenho), a tabela de módulos com as assinaturas exportadas, os ganchos
de teste e os controles. Os pedidos aos agentes começavam, em geral, por mandar lê-lo, e quem mudava uma regra
atualizava o briefing no mesmo passo (na forma de leão v2, por exemplo, o agente da interface era dono também de
`docs/brief.md`).

### 2. Núcleo primeiro

Antes de qualquer trabalho em paralelo, o agente principal escreveu o núcleo:

- a simulação ([`src/sim/`](../src/sim/)): TypeScript puro, sem three.js, em passos fixos e sem `Math.random`; tudo o
  que a apresentação precisa saber sai como eventos (`SimEvent`). O motivo registrado para escrevê-la assim foi poder
  testá-la;
- a renderização ([`src/render/`](../src/render/)): buffer de baixa resolução, câmera isométrica ortográfica, sprites
  em billboard e pós-processamento em preto e branco;
- versões provisórias de cenário, efeitos, áudio e interface, já com as assinaturas do contrato, para o jogo rodar
  desde o início e cada módulo ser trocado sem mexer no resto.

### 3. Módulos em paralelo, com contrato e arquivos exclusivos

No `ronin-build-modules` (30/9, manhã), quatro agentes construíram cenário, efeitos, áudio e interface ao mesmo tempo,
e um quinto escreveu os testes. As regras, que voltaram, com variações, nos outros workflows de construção:

- cada agente edita só os arquivos dele (por exemplo, `src/fx/effects.ts` e arquivos novos em `src/fx/`). Se precisa
  de algo fora deles, escreve no relatório, numa lista de pedidos ao núcleo, e o agente principal decide;
- a assinatura exportada do contrato não muda, porque o jogo já chama aquelas funções;
- os arquivos ficam sempre compiláveis (o servidor de desenvolvimento é compartilhado e recarrega sozinho), e
  `npx tsc --noEmit` precisa passar nos próprios arquivos; erro em arquivo alheio é trabalho em andamento de outro;
- no fim, um relatório estruturado: o que foi feito, arquivos, como verificou, limitações, pedidos ao núcleo.

O agente de testes podia corrigir bugs reais de lógica na simulação, mas não as constantes de balanceamento:
recomendava ajustes com números, e o agente principal decidia.

Na forma de leão v1 (30/9) houve uma fase de entendimento antes de qualquer edição: o `lion-understand` pôs três
leitores em paralelo, dois nas folhas novas (linhas, blocos, direção do olhar, quadros encostados, escala) e um
mapeando onde a nova habilidade tocaria o código. Com a simulação pronta, o `lion-periphery` dividiu interface, som e
efeitos entre três agentes, sobre o contrato de eventos da transformação. No 1º/10, o `lion-attacks-implement` seguiu
o mesmo padrão: primeiro o agente principal escreveu o contrato comum (as constantes da garra e do rugido em
`src/config.ts`, os estados e eventos novos em `src/sim/types.ts` e a regra de jogo que todos usam); depois, quatro
agentes com donos disjuntos: simulação, poses, efeitos e áudio, interface e documentação.

### 4. Revisão adversarial

A revisão parte do princípio de que há defeito e exige prova: um cenário de entrada que leva a um efeito errado, com
arquivo e linha. Nos workflows de revisão, cada achado vai para um verificador independente, que tenta refutá-lo
lendo o código, reproduzindo ou escrevendo um teste temporário; na dúvida, o achado cai. Só o que é confirmado vira
correção.

| Workflow | Como revisou |
|---|---|
| `ronin-build-modules` | um revisor por módulo, que vira dono dos arquivos e corrige: contrato, execução com capturas (erro de console é crítico), especificação item a item, direção de arte, desempenho e vazamentos, robustez (reinício, pausa, redimensionar, navegador sem GPU nem áudio) |
| `lion-review` | cinco frentes (simulação, animação, interface, som e efeitos, regressões fora do escopo) e um verificador por achado de severidade média ou alta |
| `lion-verify-fix` | duas inspeções visuais no jogo rodando e três leituras de código; um cético por achado, com a lista das decisões já aceitas para não reabri-las; um corretor por área; checagem final de tipos, testes e build |
| `review-title-menu` | quatro lentes (fluxo, entrada e acessibilidade; layout; arte e build; testes e documentação) e um cético por lente |

Um resultado concreto, do `lion-verify-fix`: 7 achados, 5 confirmados e 2 refutados. O mais grave: emendar garras
mantinha a forma de leão para sempre depois de a Fúria acabar. Hoje a brecha seguinte volta a humano (seção "Forma de
leão" do [briefing](brief.md)). Os outros quatro eram menores: R apertado durante o rugido se perdia; o leão não
piscava ao ser ferido enquanto carregava o rugido; o anel da carga continuava depois de cancelar; e o briefing
descrevia o cone da mira assistida de um jeito diferente do código.

### 5. Verificação visual

Um agente não vê o jogo, só o que captura. Duas ferramentas do repositório fazem isso com o Chromium do Playwright e
WebGL por software (SwiftShader):

- [`scripts/shot.mjs`](../scripts/shot.mjs): abre o jogo, executa passos (`keys`, `tap`, `click`, `eval`, `shot`),
  grava PNGs e imprime os erros de console;
- [`scripts/anim-strip.mjs`](../scripts/anim-strip.mjs): tira de quadros recortada em volta do herói; com `--manual`,
  congela o laço do jogo e avança 1/60 s por vez (`window.__game.tick`), para conferir cada quadro de um golpe.

Os pedidos mandavam abrir e olhar cada PNG e citá-lo como evidência. Os parâmetros de URL (`?autostart`, `?seed=N`,
`?char=`, `?stage=`) e o gancho `window.__game` tornam as cenas reproduzíveis. O som tem o equivalente: como ninguém
ouve, [`src/audio/debug.ts`](../src/audio/debug.ts) renderiza cada efeito num `OfflineAudioContext` e mede pico e RMS;
a mixagem de `src/audio/engine.ts` foi ajustada com essas medições.

### 6. Testes

- **Unidade** (Vitest, em Node, sem three.js; [`tests/unit/`](../tests/unit/)): matemática, poses e escolha de quadro,
  simulação (jogador, defesa e parry, Kiai, horda, obstáculos, leão), o templo e o modelo de visão do HUD. Inclui
  determinismo (mesma semente e mesmas entradas, mesmo estado) e a extração (nenhum quadro com borda reta longa, sinal
  de pedaço de boneco cortado).
- **Robô de balanceamento** ([`tests/unit/bot.ts`](../tests/unit/bot.ts)): um jogador automático simples joga várias
  sementes. O jogo não pode ser impossível (o robô passa da onda 1 na maioria), nem trivial (quem fica parado morre
  antes da onda 3), e 60 s com 40 inimigos têm de simular em menos de 1,5 s. No primeiro dia, o robô mostrou que o
  jogo estava fácil demais; o ajuste fez o inimigo que já está preparando o golpe aguentar um corte leve sem ser
  interrompido, e pela medição da época quem só corta, sem esquivar, passou a cair entre as ondas 8 e 10.
- **Ponta a ponta** (Playwright; [`tests/e2e/game.spec.ts`](../tests/e2e/game.spec.ts)): título e escolha, sorteio do
  cenário, layout do título do celular ao monitor largo, memória de vídeo ao trocar de cenário, cada mecânica (corte,
  iaido, defesa, Kiai, leão, Tomoe), pausa, fim de jogo e estabilidade com entradas aleatórias.

`npm run check` roda, em sequência, auditoria do repositório, tipos, testes de unidade, builds normal e de
arquivo único, e e2e.

### Onde o processo foi encurtado

- A maior parte das iterações com o autor (animação, Tomoe, templo, HUD, menu) foi feita pelo agente principal
  diretamente, com capturas e testes ao longo do caminho, sem workflow.
- O `lion-review` (forma de leão v1) e o `review-title-menu` (menu) foram interrompidos a pedido do autor, que preferiu
  terminar mais rápido, antes de os revisores relatarem. No leão, o agente principal conferiu sozinho os pontos de
  maior risco; o menu ficou com a bateria de testes e as capturas que ele já tinha feito.
- O `stone-hud-build` (HUD) parou antes de o construtor terminar. O HUD foi escrito depois pelo agente principal e
  verificado com capturas em vários estados e com os testes do modelo de visão, sem a rodada de críticos prevista.
  As correções confirmadas pelo `lion-verify-fix` também foram aplicadas por ele, porque a fase de correção do
  workflow não chegou a terminar.
- Na primeira rodada, o autor pediu para pular o cenário, que era o módulo mais atrasado; a chuva entrou à tarde, a
  pedido dele.

## Pipeline da arte

Detalhes técnicos em [arquitetura.md](arquitetura.md#pipeline-de-assets); aqui, o caminho e os problemas.

| Folhas em `assets-src/` | Conteúdo |
|---|---|
| `reference.png` | a primeira referência do personagem (8 poses); usada no primeiro dia, o extrator atual não a lê |
| `movement.png`, `combat.png`, `special.png`, `movement2.png` | Ronin: movimentação; corte, defesa, parry e esquiva; especial Kiai; locomoção mais natural |
| `tomoe-movement.png`, `tomoe-combat.png`, `tomoe-special.png` | Tomoe: movimentação, combate e o especial Hanafubuki |
| `lion-transform.png`, `lion-movement.png`, `lion-claw.png`, `lion-roar.png` | forma de leão: transformação, 8 direções, garra, rugido |
| `menu-landscape.png`, `menu-samurai.png` | menu: a paisagem e os dois samurais em tamanho grande |

As folhas de personagem foram geradas por IA sobre fundo verde (chroma key) e trazidas pelo autor a cada etapa.
[`scripts/extract-sprites.mjs`](../scripts/extract-sprites.mjs) (`npm run sprites`) faz, por folha: chroma key com
alfa suave; componentes conexos, uma pose por componente grande (efeitos brancos soltos vão para a pose mais
próxima); medidas só pelos pixels escuros do corpo (pé na linha mais baixa, eixo na mediana do tronco, com a grade de
redução presa aos dois para as poses não tremerem); tom de cinza casado entre folhas; redução por supersampling;
alfa binário e paleta comum. Sai o atlas `src/assets/sprites/samurai.png` + `.json`, em pixel art.

Problemas reais, quase todos vindos da natureza das folhas geradas:

| Sintoma | Causa | Solução |
|---|---|---|
| Passada lateral parecia deslizar (Ronin e depois Tomoe) | na Tomoe, os perfis só têm a passada aberta, sem quadro com as pernas sob o corpo | locomoção presa à distância percorrida, com metros por quadro medidos pelo recuo do pé apoiado na arte; para a Tomoe, o extrator gera os quadros de passagem (comprime a silhueta do quadril para baixo) |
| Ronin com pedaços "cortados" nas laterais, nos inimigos também | na `movement2` os bonecos se encostam manga com manga; a separação antiga dividia no meio do caminho entre os troncos e arrancava um retângulo do vizinho (4 quadros, até 23 texels de borda reta) | costura de cima a baixo (seam carving) pelo vão entre as figuras, cortando só onde elas se tocam; crescimento de região por dentro da silhueta para as sobrepostas; teste de borda reta |
| Tomoe girava ao correr para a esquerda | os dois quadros de passagem gerados para a esquerda não estavam marcados como desenhados para a esquerda, e o jogo os espelhava | marcação corrigida e teste que confere todos os quadros do ciclo |
| Leão grande demais e mudando de tamanho entre quadros | as folhas mudam de escala entre linhas, blocos e até quadros; o leão da v1 passava de 100 texels galopando de frente (o samurai tem 64) | escala única `LION_H` (56 texels): tamanho medido pela raiz da contagem de pixels escuros, que quase não depende da pose nem dos efeitos brancos; fator por bloco na movimentação, por quadro nos ataques |
| Quadros do leão com duas caudas | a arte desenha a cauda dos dois lados ao mesmo tempo quando ela troca de lado | cinco quadros fora dos ciclos (`lwS02`, `lrS02`, `lwN03`, `lrN03`, `lNE05`) |
| Patas do leão quase paradas | nos perfis, a pata apoiada recua só 2 a 4 texels por quadro; casar o pé exigiria mais de 60 quadros/s | o ciclo segue a cadência (cerca de 3 passadas/s no galope), não o pé |
| Novas folhas mudariam os tons dos quadros antigos | a paleta é comum a todas as folhas | as folhas do leão ficam fora do cálculo da paleta; os quadros humanos não mudaram |

`LION_DUMP=1 npm run sprites` mostra a escala e o tamanho de cada quadro do leão.

[`scripts/menu-art.mjs`](../scripts/menu-art.mjs) (`npm run menu-art`) converte a paisagem para tons de cinza e recorta
os dois samurais do fundo verde: chroma key com alfa suave e "desmistura" do verde (os personagens são cinza puro, então
o verde que sobra na borda é fundo); componentes conexos, em que os dois maiores são o Ronin e a Tomoe e os fiapos
soltos vão para o mais próximo; a mesma faixa vertical para os dois, para ficarem na mesma escala e com os pés na mesma
linha. O WebP é codificado pelo Chromium do Playwright, sem dependência nova.

Não vem de imagem gerada: o símbolo (`emblemSvg()` em [`src/ui/title/art.ts`](../src/ui/title/art.ts), um ensō
desenhado por código com o contorno do 雨 da fonte Yuji Boku, SIL OFL 1.1, no meio); cenários, efeitos e texturas
(canvas e geometria, com gerador pseudoaleatório semeado); e o HUD de pedra e tinta (lajes, rachaduras e giz gerados
por código). Os ícones de giz do HUD vieram do HTML de referência que o autor forneceu; os de iaido e de pétalas
foram desenhados no mesmo traço.

## Linha do tempo

| Quando (UTC−3) | Etapa | Base |
|---|---|---|
| 30/9, 09h20–10h20 | **Base do jogo.** Pedido inicial: jogo web isométrico em preto e branco, um samurai contra hordas de samurais repetidos, com testes e revisões antes da entrega. Primeiro extrator (as 8 poses da referência), núcleo e briefing; depois `ronin-build-modules`. Perto das 10h15, 89 testes passando e a dificuldade ajustada a partir do robô. | pedido; `reference.png` 09:24; workflow 09:48; áudio, efeitos e testes 09:54–10:11 |
| 30/9, 14h45–16h | **Animação do Ronin.** Folhas de combate (corte, defesa, parry, esquiva) e de movimentação; especial Kiai na tecla Q; correções pedidas pelo autor (passada lateral, parry, chuva no cenário); locomoção mais natural (`movement2`). | pedidos 14:46–15:53; folhas 14:47–15:54; `anim-strip.mjs` 15:02 |
| 30/9, 16h15–17h15 | **Tomoe.** Segunda personagem, com escolha no menu. Correções pedidas pelo autor: passada, pétalas do especial, giro para a esquerda, diagonais, quadros cortados do Ronin, defesa sem andar, personagens parados no menu. | pedidos 16:17–17:14; folhas 16:18; testes de defesa e de pose 17:12–17:17 |
| 30/9, 17h20–18h | **Templo.** Segundo cenário, mais detalhado e selecionável: construções, obstáculos retangulares, silhueta de quem fica atrás delas. | pedido 17:20; `src/world/*` e `occlusion.ts` 17:32–18:00 |
| 30/9, 21h20–22h15 | **Forma de leão v1.** Transformação do Ronin na tecla R, com barra própria (Fúria). Escopo pedido: só transformação e movimento, sem mexer na Tomoe nem no Ronin humano. `lion-understand`, `lion-periphery`, `lion-review`. | pedido 21:23; folhas 21:24; workflows 21:24–22:05 |
| 1º/10, 07h10–08h | **Forma de leão v2.** Novas folhas; leão menor e do mesmo tamanho em todos os quadros; garra com alcance 5 e rugido em área. `lion-attacks-implement`, `lion-verify-fix`; antes da verificação, 169 testes de unidade e 18 e2e passando. | pedido 07:11; folhas 07:18; atlas 07:52; workflows 07:32 e 07:57 |
| 1º/10, 08h–12h30 | **HUD de pedra e tinta**, adaptado de um HTML de exemplo do autor, e não copiado inteiro: o painel original cobriria a arena e foi dividido em vitais (canto superior) e barra de comandos (embaixo, só de exibição). Entre 8h10 e 12h10, uma pausa. | pedidos 08:03 e 12:11; workflow 08:10; `src/ui/stone/*` 12:16–12:26 |
| 1º/10, 12h30–13h30 | **Menu de título.** Paisagem fixa, os dois samurais em destaque para a escolha, recorde na lateral, um símbolo no lugar do título, sem instruções de teclas, "Jogar" só depois da escolha e cenário sorteado. | pedido 12:34; arte 12:42; `menu-art.mjs` 13:01; `title.css` 13:13; e2e 13:22 |
| 1º/10, a partir de 13h45 | **Preparação para o código aberto** (esta etapa): identidade sem nome, só o símbolo; marca gerada por código ([`scripts/brand.mjs`](../scripts/brand.mjs)); mídia do README ([`scripts/media.mjs`](../scripts/media.mjs)); documentação; integração contínua. | — |

Os horários dos pedidos vêm dos registros das sessões; os dos arquivos, da última modificação. A divisão em etapas e
os intervalos são reconstrução; a duração de cada etapa entre um pedido e a última modificação é aproximada
*(inferência)*.

## Decisões de design

### Conclusão da preparação pública

A documentação histórica acima foi herdada do trabalho com Claude Code. Seus registros privados de sessão
não fazem parte do repositório; a revisão de publicação não reconstitui nem verifica novamente esses horários.
Com Codex, a preparação foi concluída a partir dos arquivos existentes:

- conclusão de `scripts/media.mjs`, que tinha apenas as cenas de título e campo: templo, leão, Tomoe, celular
  e GIF com conferência dos quadros decodificados;
- README em inglês, guia de identidade, instruções de publicação e instruções específicas para Windows;
- avisos de terceiros e cópias de licenças; revisão de links, arquivos ignorados e identificadores públicos;
- workflows com auditoria do repositório, testes de produção e artefatos de diagnóstico de falhas;
- isolamento do Google Fonts nos testes de navegador e espera pela carga real do iaido, para evitar falhas
  por rede lenta ou renderização por software;
- validação local da instalação com `npm ci`, tipos, simulação, navegador e builds.

Os originais da arte e as decisões de gameplay foram preservados. O identificador técnico continua
`ronin-game`, enquanto a apresentação pública usa o símbolo. O [guia de publicação](publicacao.md)
separa os arquivos versionados das configurações do GitHub.

### Direção do jogo

- **Só tons de cinza.** O pedido inicial já era um campo de batalha em preto e branco; o briefing transformou isso em
  regra (o pós-processamento converte tudo para luminância) com um propósito declarado, a legibilidade: samurais quase
  pretos sobre chão cinza médio-claro (luminância de 0,45 a 0,70), e branco puro reservado para golpes, brilhos e
  avisos de ataque. O clima é o de Kurosawa (chuva, lama, neblina), nanquim sobre papel de arroz. A interface usa a
  mesma paleta (`--ink`, `--paper`, `--mist`, `--ash` em [`src/style.css`](../src/style.css)).
- **Buffer de baixa resolução.** A cena é desenhada em cerca de 480 linhas, com 1 pixel = 1/32 m = 1 texel de sprite,
  e ampliada em escala inteira por vizinho mais próximo, sem suavização; texturas com `NearestFilter` e sem mipmaps.
  Assim cenário 3D e sprites têm a mesma densidade de pixel art.
- **Simulação determinística, separada da apresentação.** Passo fixo, sem `Math.random`, saída só por eventos. O
  motivo registrado é poder testá-la (os testes rodam em Node, sem navegador). É o que sustenta os testes de
  determinismo e o robô de balanceamento; a semente da partida também sorteia o cenário (a mesma semente, o mesmo).
- **Áudio sem arquivos.** Golpes, passos, chuva, vento, trovão, taiko e drone são sintetizados na hora, desde a
  primeira especificação. O motivo não está registrado. *(inferência: dispensa arquivos de som de terceiros e deixa
  variações, como altura aleatória e limite de vozes, num código só.)*
- **Um símbolo no lugar do nome.** O autor pediu um título sem frase, só um símbolo; na preparação para o código
  aberto a decisão foi além, e o jogo ficou sem nome: só o ensō com 雨 (chuva) no meio. Onde um texto é obrigatório,
  usa-se "雨". O pacote e o repositório se chamam `ronin-game`; Ronin é o nome do personagem.

## Limitações conhecidas e próximos passos possíveis

Limitações, segundo o briefing e o código:

- A folha da Tomoe não tem quadros de passagem nem três-quartos de verdade: a passagem é gerada pelo extrator, e a
  virada das diagonais dela é mais sutil que a do Ronin.
- Na `movement2` do Ronin, a separação dos bonecos encostados corta pela linha de contato.
- O leão não tem pose de ferido (só pisca), as patas não ficam presas ao chão (ciclo por cadência) e cinco quadros
  com defeito ficaram fora dos ciclos.
- A horda usa sempre o sprite do Ronin, e são só dois cenários.
- Os testes e2e rodam só no Chromium, com WebGL por software. Os 60 quadros/s do briefing são meta: o que os testes
  medem é o custo da simulação.
- A interface só existe em português do Brasil.
- As revisões da forma de leão v1 e do menu foram encurtadas (ver "Onde o processo foi encurtado"): essas partes
  passaram pelos testes e pela checagem do agente principal, não pelos verificadores independentes.
- Não há histórico de versões anterior à publicação.

Próximos passos possíveis, sem compromisso: folhas novas da Tomoe com três-quartos e passagem; pose de ferido do leão;
mais cenários e variedade na horda; e2e também no Firefox e no WebKit; refazer as revisões encurtadas; publicar no
GitHub Pages; traduzir a interface.

## Uso de IA e transparência

- **Imagens.** As 14 imagens de origem em [`assets-src/`](../assets-src/) foram geradas com o ChatGPT (gpt-image).
  Cada uma carrega um manifesto C2PA, com softwareAgent "ChatGPT" e claim generator "OpenAI Media Service API", que
  qualquer leitor de C2PA mostra. Os arquivos derivados em `src/assets/` são produzidos pelos scripts do repositório
  e não carregam o manifesto; a procedência deles é a destas folhas.
- **Gerado por código, não por imagem de IA**: o símbolo, cenários, efeitos, texturas e o HUD (ver "Pipeline da
  arte"). O contorno do 雨 vem da fonte Yuji Boku e as fontes da interface (Shippori Mincho B1 e DotGothic16) vêm do
  Google Fonts, todas sob a SIL OFL.
- **Som.** Síntese em código (Web Audio API), sem gravações nem amostras.
- **Código.** Desenvolvido com o Claude Code (Anthropic): o agente principal de cada sessão e os agentes que ele
  disparou nos workflows escreveram, revisaram e testaram as mudanças.
- **Papel humano.** O autor definiu o conceito e cada etapa; trouxe as folhas de arte (geradas com o ChatGPT) e a
  referência do HUD; fixou requisitos de jogo (tecla R, barra própria para a transformação, alcance 5 da garra,
  rugido em área, a forma de leão só para o Ronin) e limites de escopo (não mexer na Tomoe nem no Ronin humano);
  jogou para testar e apontou o que estava errado (passada deslizando, quadros cortados, a Tomoe girando, o leão
  grande demais); e decidiu quando encurtar uma revisão para entregar mais rápido.
- **Este documento** foi escrito com o Claude Code a partir das fontes listadas no início. Pode ter imprecisões de
  horário; correções são bem-vindas.
