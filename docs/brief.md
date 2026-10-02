# Briefing técnico e de arte

Jogo web: um samurai sozinho contra hordas de samurais repetidos, num campo de batalha
em preto e branco, com câmera isométrica. Referência visual do personagem:
`assets-src/reference.png` (8 poses, extraídas por `scripts/extract-sprites.mjs` para
`src/assets/sprites/samurai.png` + `.json`).

## Direção de arte

- **Só tons de cinza.** Nenhuma cor. O pós-processamento converte tudo para luminância,
  mas os materiais já devem ser pensados em cinza (hex do tipo `0x8a8a8a`).
- Clima: Kurosawa — batalha na chuva e na lama, neblina, bandeiras rasgadas, fim de tarde nublado.
- **Pixel art em baixa resolução**: a cena é renderizada num buffer de ~480 linhas
  (1 px = 1/32 m) e ampliada em escala inteira, sem suavização. Formas com contorno limpo,
  texturas com `NearestFilter` e sem mipmaps, nada de gradientes suaves de alta frequência
  que virem ruído. Detalhe de textura na escala de 1/32 m no máximo.
- **Legibilidade do combate primeiro**: os samurais são quase pretos. O chão da área jogável
  deve ficar em cinza médio-claro (luminância ~0.45–0.70) para as silhuetas saltarem.
  Nada alto/escuro no meio da arena que esconda inimigos; adereços grandes perto da borda.
- O herói tem contorno branco de 1 texel; inimigos não. Branco puro é reservado para golpes,
  brilhos e avisos de ataque — use com parcimônia no cenário.

## Técnica

- Vite 8 + TypeScript 7 (strict, `noUnusedLocals`) + three r186 (`WebGLRenderer`, WebGL2).
- `THREE.ColorManagement.enabled = false` e `outputColorSpace = LinearSRGBColorSpace`:
  cores e texturas são usadas "como aparecem". **Não** defina `colorSpace` sRGB nas texturas,
  não use tone mapping.
- Câmera: `OrthographicCamera`, yaw 45°, pitch 30° (isométrico 2:1). Eixo "direita da tela"
  no chão = `(cos45, 0, -sin45)`; "para cima na tela" no chão = `(-sin45, 0, -cos45)`.
  A câmera fica em `foco + (0.612, 0.5, 0.612) * 60`.
- A neblina é feita no pós-processamento (radial em volta do jogador, a partir da
  profundidade). **Não** use `scene.fog`. Objetos transparentes sem escrita de profundidade
  recebem a neblina do que está atrás deles.
- Sombras: `renderer.shadowMap` ligado (PCF). A luz direcional principal é do cenário.
- Sprites dos personagens: `src/render/sprites.ts` (billboard vertical instanciado,
  `renderOrder = 1`, `alphaTest` por `discard`). Sombras em bolha: `src/render/view.ts`.
- Coordenadas da simulação: `Vec2 {x, z}` no chão (y = altura no three). Arena circular
  de raio `ARENA.radius` (36 m) centrada na origem; o jogador começa em `env.start` ((0, 0) no campo).
- Obstáculos: círculos (`colliders`) e retângulos girados (`boxes`, construções). A horda contorna
  (sonda à frente, lado escolhido e mantido até passar: `AI.avoidLook`, `AI.avoidHold`) e só surge em
  pontos livres (`AI.spawnClearance`). Quem fica atrás de construção aparece em silhueta quadriculada
  (stencil: `src/render/occlusion.ts`; as construções usam materiais `occluder()`).
- Orçamento: 60 fps em notebook comum. Poucos draw calls (instancing), sem alocação por
  quadro nos laços quentes, pools para partículas.
- Determinismo: a simulação (`src/sim/`) não usa `Math.random`. Cenário e efeitos podem
  usar PRNG próprio (`Rng` em `src/core/math.ts`) semeado.

## Módulos e contratos (não mude as assinaturas exportadas sem combinar)

| Arquivo | Responsável | Exporta |
|---|---|---|
| `src/sim/*` | núcleo | `Sim`, tipos, `SimEvent` |
| `src/render/*` | núcleo | câmera, renderizador, sprites, view |
| `src/game.ts`, `src/main.ts` | núcleo | orquestração |
| `src/world/environment.ts` (+ `src/world/*`) | cenário | `createEnvironment(scene, {arenaRadius, seed, stage}): Environment` (`stage`, `colliders`, `boxes`, `start`, `update`, `lightning`, `onLightning`, `dispose`) |
| `src/fx/effects.ts` (+ `src/fx/*`) | efeitos | `createEffects(scene): Effects` com `feedback {shake, flash, invert}` |
| `src/audio/audio.ts` (+ `src/audio/*`) | áudio | `createAudio(): AudioSystem` (`unlock`, `handle`, `update`, `thunder`, `setMuted`, `muted`) |
| `src/ui/hud.ts` (+ `src/ui/*`, CSS) | interface | `createHud(root, callbacks, input): Hud` (`update`, `input(frame)` — no título, escolha pelo gamepad e confirmar; em partida, ação indisponível apertada vira aviso —, `handle`, `setCharacter(id, picked)`, …) |

Eventos da simulação: ver `SimEvent` em `src/sim/types.ts`. Posições nos eventos são cópias.

### Ganchos para testes
- `window.__game` é a instância de `Game` (`screen`, `sim`, `fps`, `tick(dt)`).
- `?autostart` começa a partida sem a tela de título; `?seed=N` fixa a semente (e com ela o cenário sorteado);
  `?char=tomoe` já abre o título com o personagem escolhido; `?stage=temple` fixa o cenário em todas as partidas.
- A interface deve marcar a tela atual em `document.body.dataset.screen`
  (`loading|title|playing|paused|over`) e usar botões `<button data-action="start|resume|restart|mute">`.

## Controles

| Ação | Teclado | Mouse | Gamepad | Toque |
|---|---|---|---|---|
| Mover | WASD / setas | — | analógico esq. / direcional | joystick virtual |
| Mirar | — | cursor | analógico dir. | — |
| Corte (combo de 3); como leão, Garra | J | botão esq. | X / RB | botão Corte (Garra) |
| Defesa (segurar) / parry (tocar no instante do golpe) | K / I | botão dir. | RT | botão Defesa |
| Esquiva | Espaço / Shift | — | A / LB | botão Esquiva |
| Iaido (segurar e soltar, 40 de Ki); como leão, Rugido (segurar e soltar, sem Ki) | L / E | — | B / LT | botão Iaido (Rugido) |
| Kiai (explosão em volta, Ki cheio) | Q | — | Y | botão Kiai |
| Leão (Fúria cheia; de novo volta a humano) — só o Ronin | R | — | R3 | botão Leão |
| Pausa | Esc / P | — | Start | botão pausa |
| Som | M | — | Select | botão som |

## Animação

Folhas em `assets-src/movement.png`, `assets-src/movement2.png` (locomoção natural, usada nos ciclos de andar/correr), `assets-src/combat.png` e `assets-src/special.png`; da Tomoe, `assets-src/tomoe-*.png`; do leão, `assets-src/lion-transform.png`, `lion-movement.png`, `lion-claw.png` e `lion-roar.png` (npm run sprites; ver "Forma de leão"). Na `movement2.png` os quadros se sobrepõem: o extrator corta por colunas e separa por crescimento de região a partir do tronco de cada personagem. A escolha de quadro fica em
`src/render/pose.ts`: locomoção em 8 direções presa à distância percorrida (metros por quadro em `ANIM`, medidos pelo recuo do pé apoiado na arte) e clipes
com tempo por quadro para golpes, defesa, parry, esquiva e iaido. Quadros de perfil espelham conforme o lado;
frente/costas nunca espelham. (A Tomoe e o leão têm os dois perfis desenhados; os ataques do leão são desenhados
virados para a direita.)
O que fica abaixo da linha do pé num quadro (anel do Kiai, poeira) deita no chão em direção à câmera
(`src/render/sprites.ts`), para não afundar na terra.

## HUD em partida (pedra e tinta)

Adaptado da referência "HUD em pedra e tinta" (barras de laje rachada, ícones de giz). Módulo `src/ui/stone/`:
`art.ts` (lajes, rachaduras, grão, máscara de giz e aros gerados por código, determinísticos), `icons.ts`
(ícones de giz; iaido e pétalas desenhados no mesmo traço), `view.ts` (modelo puro do que aparece, testado em
`tests/unit/stone-view.test.ts`) e `stone-hud.ts` (DOM: só escreve o que mudou).

- **Vitais** (canto superior esquerdo): nome e forma; Vida (laje grossa, rastro do dano, "VIDA CRÍTICA" a 25%),
  Ki (marca do custo do iaido, apagado na forma de leão) e Fúria (só o Ronin: %, "Pronto · R", na forma os
  segundos que restam). Clarão e tremor ao ser ferido.
- **Comandos** (embaixo, no centro; só mostram, não recebem clique — o clique esquerdo é o corte): Mover, Corte,
  Defesa, Esquiva, Iaido, Kiai/Hanafubuki e Leão, com a tecla do último dispositivo (teclado ou gamepad). Estados:
  apagado (indisponível), aceso (pronto), aro (em uso), "SOLTE!" (carga pronta) e anel com segundos (recarga da
  esquiva e do rugido). No toque a barra some: os botões de toque usam os mesmos ícones.
- **Avisos**: apertar uma ação indisponível mostra o motivo embaixo ("Iaido precisa de 40 de Ki", "O leão não
  defende", "Rugido recarregando", "Fúria incompleta"…) e sacode o comando; a Fúria cheia também avisa.

## Menu de título

Limpo, sem instruções de teclas (a tabela de controles fica só na pausa). Módulo `src/ui/title/`: `art.ts` (URLs da
arte, pré-carregamento e o símbolo) e `title.css`; a marcação e a escolha ficam em `src/ui/hud.ts`.

- **Fundo fixo**: a paisagem `assets-src/menu-landscape.png` (em tons de cinza, WebP). Enquanto o título está na
  tela a cena 3D não é desenhada (a paisagem cobre tudo).
- **Título**: só o símbolo, um ensō de pincel com 雨 (chuva) no meio, gerado por código (o 雨 é o contorno do glifo
  da fonte Yuji Boku, OFL). No alto, no centro; com a tela em pé, dentro da lua da paisagem.
- **Samurais**: a arte grande de `assets-src/menu-samurai.png`, recortada do fundo verde (`npm run menu-art`), um
  ao lado do outro no centro. Escolha por clique/toque, ←/→ (A/D) ou direcional/analógico do gamepad (← o da
  esquerda, → o da direita). O escolhido ganha contorno branco e um passo à frente; o outro escurece.
- **Jogar**: só aparece depois da escolha (com o especial do escolhido em cima); Enter, Espaço, J ou A também
  jogam. Sem escolha, confirmar não faz nada. A escolha não é lembrada: o título sempre abre com os dois à espera.
- **Recorde** na lateral (direita; com a tela em pé, no alto à esquerda): pontos e onda mais alta.
- Medidas em `cqw`/`cqh` (a tela de título é o contêiner): a altura dos samurais é o que sobra entre o símbolo e
  o "Jogar", limitada pela largura. Testado de 360×640 a 2560×1080 (`tests/e2e/game.spec.ts`, layout do título).

## Personagens jogáveis

Escolha no título (ver "Menu de título"; `?char=tomoe` na URL já abre com a Tomoe escolhida).
Cada um tem um `AnimSet` em `src/render/pose.ts`; as regras de jogo são as mesmas, exceto a forma de leão,
que é só do Ronin (ver abaixo). A horda usa sempre o Ronin.

| | Ronin (侍) | Tomoe (巴) |
|---|---|---|
| Folhas | movement2 (locomoção), movement, combat, special | tomoe-movement, tomoe-combat, tomoe-special |
| Especial (Q) | Kiai 気合 — explosão de espírito | Hanafubuki 花吹雪 — tempestade de pétalas |
| Perfis | corrida para a direita espelhada | lados esquerdo e direito desenhados (sem espelhar) |
| Diagonais | quadros de três-quartos | corrida de frente/costas levemente virada (tmB), espelhada para o outro lado |

Limitações conhecidas: os perfis da Tomoe só têm a passada aberta; os quadros de passagem (pernas sob o
corpo) são gerados pelo extrator a partir deles. A folha dela não tem três-quartos de verdade: a virada das
diagonais é mais sutil que a do Ronin. Na movement2 do Ronin alguns bonecos se encostam manga com manga na
própria arte; a separação (costura pelo vão entre eles) corta só na linha de contato.

## Cenários

Sorteado a cada partida ("Jogar", "Recomeçar", "Lutar de novo"), pela semente da partida (`stageFor` em
`src/game.ts`: a mesma semente sorteia o mesmo cenário); `?stage=temple` fixa um. O sorteio da primeira partida
sai junto com o título, que não mostra o cenário: jogar não refaz nada.
Cada cenário é um `StageBuilder` (`src/world/field.ts`, `src/world/temple.ts`) que monta chão e construções
dentro de um grupo e devolve obstáculos, ponto de partida, luz e animação; chuva, respingos e relâmpagos são
comuns (`environment.ts`). Trocar de cenário descarta tudo da memória de vídeo (`dispose`).

| | Campo de batalha (野) | Templo (寺) |
|---|---|---|
| Chão | lama e poças, textura presa ao mundo | pintado na grade da tela (32×16 texels/m): lajes, pedrisco, jardim rastelado |
| Construções | nenhuma | salão principal, pagode, torre do sino, torii, pia, poço, muro, cedros, bambuzal |
| Obstáculos | nenhum | 11 retângulos + 31 círculos (lanternas, leões, árvores, pedras, mastros) |
| Luz | sol 1,25 / céu 1,1, sem sombras projetadas | sol fraco 0,7 da frente-esquerda / céu 1,9, sombras suaves |

Planta do templo em `src/world/temple-layout.ts` (u = direita da tela, v = para cima, metros; tudo alinhado à
tela). O chão pintado só fica pixel a pixel porque o buffer de baixa resolução tem dimensões pares
(`renderer.ts`). Peças procedurais: `kit.ts` (caixas, tornos, telhados com cantos levantados) e `textures.ts`.

## Forma de leão (só o Ronin)

- **Fúria**: barra separada do Ki (`LION` em `src/config.ts`). Enche só como humano: acertos (1,5), abates
  (4 × o `ki` do inimigo), parry (10) e dano recebido (0,6 por ponto). As mortes do Kiai não contam.
- **R com a barra cheia**: transformação de 2,2 s, invulnerável (`state 'transform'`). Em `LION.burstAt`
  (1,48 s), no quadro do leão completo rugindo (tf15), sai a onda de choque: empurra e atordoa quem está a
  até 5,5 m, sem matar. A partir daí o corpo é leão (`form 'lion'`, raio 0,6).
- **Na forma**: galopa (7,6 m/s; devagar, anda) e tem dois ataques, nos botões do corte e do iaido:
  - **Garra** (`'claw'`, ataque básico; J / clique / X·RB / botão Corte, que vira Garra 爪): leque à frente de
    45° para cada lado com **alcance de 5 m** a partir do centro do leão (+ raio do inimigo), dano 3 (mata
    ronin e ágil num golpe; o brutamontes, 8 de vida, leva 3), pesado (fura o poise da horda), empurra e avança
    um pouco. Mira assistida para um inimigo a até 5 m num cone de 40° para cada lado (80° no total). Apertar de novo a partir de `cancelAt`
    (0,36 s) emenda outra garra. `LION.claw`; o evento `lionClaw` sai quando a janela ativa abre.
  - **Rugido** (`'roarCharge'` → `'roar'`, ataque carregado **em área**; segurar e soltar o botão do iaido:
    L/E, B/LT, botão Iaido, que vira Rugido 吼): segurando, o leão fica plantado e vira com a mira/direcional;
    com 0,6 s de carga fica pronto (`lionRoarReady`). Soltar pronto ruge: 0,2 s depois, todo inimigo a até
    6 m **em volta** (+ raio) leva 4 de dano, é empurrado para fora (mais forte perto) e atordoado (`lionRoar`).
    Soltar antes desiste (`lionRoarCancel`). Recarga de 2,5 s contada do fim do rugido (`roarCd`). Se a Fúria
    acaba durante a carga, desiste e volta a humano. Não gasta Ki. `LION.roar`.
  - Os golpes do leão não enchem Ki nem Fúria, mas contam pontos, combo, abates e a cura por abate.
  - Esquiva, defesa e Kiai seguem travados (no toque, apagados; o Ki fica parado). Golpes tiram vida, mas o
    leão não cambaleia (não há pose de leão ferido): só pisca e fica invulnerável por um instante, sem
    interromper garra nem rugido. A barra vira o tempo que resta (14 s); R de novo volta antes. Volta em 1 s
    (`'revert'`). Morrer como leão volta a humano antes de cair. R apertado no meio da garra ou do rugido não se
    perde: vale na próxima brecha (`cancelAt` da garra, fim do rugido). Garras emendadas não seguram a forma: com
    a Fúria no fim, a próxima brecha volta a humano.
- **Interface**: na forma, a barra de comandos troca Corte por Garra, Iaido por Rugido (com o anel da recarga e
  "SOLTE!" com a carga pronta) e Leão por Humano; Defesa, Esquiva e Kiai ficam apagados. A primeira forma de
  cada partida troca a dica de controles pelos ataques do leão; o rugido que mata 2 ou mais mostra `吼 ×N`.
- **Arte** (todas as folhas do leão na mesma escala, ver abaixo):
  - `assets-src/lion-transform.png`: 21 quadros tf00-tf20; samurai e homem-fera (tf00-14) na escala do
    samurai, o leão completo (tf15-20) na escala do leão.
  - `assets-src/lion-movement.png`: as **8 direções desenhadas**, em dois blocos (esquerdo | direito): de
    frente e de costas (andar 6 + galope 6: `lwS`/`lrS`, `lwN`/`lrN`), perfil para a esquerda e para a direita
    (andar 5 + galope 5: `lwW`/`lrW`, `lwE`/`lrE`, os dois lados desenhados, sem espelhar), três-quartos de
    costas (`lNW`, `lNE`) e de frente (`lSW`, `lSE`), 6 quadros cada, numa passada só (andar e galope).
  - `assets-src/lion-claw.png`: garra, 18 quadros `lclaw00-17` virados para a direita (00 base, 01-04 agacha e
    ergue a pata, 05-08 o golpe com os arcos brancos das garras, 09-12 o fim rasteiro com riscos no chão,
    13-17 volta à base).
  - `assets-src/lion-roar.png`: rugido, 13 quadros `lroar00-12` virados para a direita (00 base, 01-03 agacha
    juntando fôlego, 04 ergue a cabeça, 05-08 ruge com as ondas de som — a maior em 07 —, 09-10 as ondas
    somem, 11-12 volta à base).
- **Escala única**: `LION_H` em `scripts/extract-sprites.mjs` — 56 texels de altura para o leão andando em
  três-quartos de frente (o samurai de pé tem 64). As folhas geradas por IA mudam de escala entre linhas,
  blocos e até quadros; o extrator mede o tamanho pela raiz da contagem de pixels escuros (quase não depende da
  pose nem dos efeitos brancos) e normaliza: na movimentação, um fator por bloco (blocos da mesma vista ficam do
  mesmo tamanho; vistas diferentes guardam a proporção da folha: de frente ~59 texels de altura, de perfil ~53
  de altura por ~64 de comprimento); na garra, no rugido e em tf15-20, um fator por quadro. Assim o leão tem o
  mesmo tamanho em todos os quadros e cabe melhor na tela (a versão anterior passava de 100 texels de frente
  galopando). `LION_DUMP=1 npm run sprites` mostra a escala e o tamanho de cada quadro. A sombra em bolha do
  leão tem raio 0,7 m (`src/render/view.ts`).
- As folhas do leão não entram no cálculo da paleta: os quadros humanos ficam idênticos aos de antes.
