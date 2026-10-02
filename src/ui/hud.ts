// HUD e telas (título, pausa, fim de jogo) em DOM sobre o canvas: papel de arroz e nanquim.
// O DOM só é tocado quando um valor exibido muda; textos flutuantes vêm de um pool fixo.
import './hud.css';
import './title/title.css';
import { IAIDO, SCORE, KIAI } from '../config';
import type { Input, InputFrame } from '../input/input';
import type { Sim } from '../sim/sim';
import type { SimEvent } from '../sim/types';
import { createStoneHud } from './stone/stone-hud';
import { createStoneView, fillStoneView, furyStateOf, type CommandId, type StoneDevice } from './stone/view';
import { TITLE_ART, emblemSvg } from './title/art';
import { createTouchControls, type LionButton } from './touch';

export type Screen = 'loading' | 'title' | 'playing' | 'paused' | 'over';

export interface RunStats {
  score: number;
  kills: number;
  wave: number;
  bestCombo: number;
  /** Segundos de partida. */
  time: number;
  best: { score: number; wave: number };
  newBest: boolean;
}

export type CharacterChoice = 'ronin' | 'tomoe';

/** Nome e golpe especial de cada personagem (menu, HUD e textos flutuantes). */
const CHARACTERS: Record<CharacterChoice, { name: string; kanji: string; special: string; specialKanji: string; blurb: string }> = {
  ronin: { name: 'Ronin', kanji: '侍', special: 'Kiai', specialKanji: '気合', blurb: 'Kiai · explosão de espírito' },
  tomoe: { name: 'Tomoe', kanji: '巴', special: 'Hanafubuki', specialKanji: '花吹雪', blurb: 'Hanafubuki · tempestade de pétalas' },
};
/** Ordem na tela de título (da esquerda para a direita): ← escolhe o primeiro, → o segundo. */
const CHAR_IDS = Object.keys(CHARACTERS) as CharacterChoice[];

export interface HudCallbacks {
  /** "Jogar" no título (só aparece depois de escolher o personagem). */
  onStart(): void;
  /** Personagem escolhido no título. */
  onSelectCharacter?(id: CharacterChoice): void;
  onResume(): void;
  onRestart(): void;
  onToggleMute(): void;
  /** Botão de pausa do HUD. Sem ele, o botão simula a tecla P. */
  onPause?(): void;
}

/** Mundo (x, y, z) -> px de CSS; para textos que flutuam sobre a cena. */
export type Projector = (x: number, y: number, z: number) => { x: number; y: number };

export interface Hud {
  setScreen(screen: Screen, stats?: RunStats): void;
  update(sim: Sim, dt: number): void;
  /** Entrada do quadro (antes da simulação): ação indisponível apertada vira aviso no HUD. */
  input(f: InputFrame): void;
  handle(ev: SimEvent, sim: Sim): void;
  setMuted(muted: boolean): void;
  setProjector(fn: Projector): void;
  /**
   * Personagem da partida (nome do especial, Fúria e botões de toque no HUD). `picked`: foi escolhido no
   * título — marca o samurai e mostra "Jogar"; sem escolha, o título abre com os dois à espera.
   */
  setCharacter(id: CharacterChoice, picked: boolean): void;
}

const BEST_KEY = 'ronin-game:best';
const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const HINT_FROM = 0.6;
const HINT_TO = 15;
const FLOAT_POOL = 24;
const FLOAT_DUR = 0.95;
/** Altura (m) dos textos flutuantes sobre o inimigo. */
const FLOAT_Y = 2.1;
/** Passos do traço que mostra o tempo restante do combo. */
const COMBO_STEPS = 48;

const fmt = new Intl.NumberFormat('pt-BR');
const fmtMul = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const numeral = (n: number): string => (n >= 1 && n <= 10 ? KANJI[n - 1] : String(n));
const mmss = (t: number): string => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function readBest(): { score: number; wave: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null');
    if (v && typeof v.score === 'number' && typeof v.wave === 'number') return v;
  } catch { /* armazenamento indisponível */ }
  return null;
}

// ------------------------------------------------------------------ conteúdo estático

const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 5.3c1.3-.7 2.8-.7 4 0v13.4c-1.2.7-2.7.7-4 0z"/><path d="M13.4 5.3c1.3-.7 2.8-.7 4 0v13.4c-1.2.7-2.7.7-4 0z"/></svg>';
const SPEAKER = '<path d="M3.2 9.1h3.7L12 4.8v14.4l-5.1-4.3H3.2z"/>';
const ICON_SOUND = `<svg viewBox="0 0 24 24" aria-hidden="true"><g class="ic-on">${SPEAKER}<path d="M15.2 8.7c1.5 1.8 1.5 4.8 0 6.6M17.8 6.2c2.9 3.3 2.9 8.3 0 11.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></g><g class="ic-off">${SPEAKER}<path d="M15.6 9.4l5 5.2M20.6 9.4l-5 5.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></g></svg>`;

type Tab = 'kb' | 'pad' | 'touch';
const TABS: [Tab, string][] = [['kb', 'Teclado e mouse'], ['pad', 'Gamepad'], ['touch', 'Toque']];
// ACTIONS e as listas de BINDS são paralelas (mesmo índice = mesma linha em todas as abas)
const ACTIONS: [string, string][] = [
  ['Mover', ''], ['Mirar', ''], ['Corte', 'combo de 3 · leão: garra'], ['Defesa', 'segure · aperte no golpe para aparar'], ['Esquiva', ''],
  ['Iaido', `segure e solte · ${IAIDO.cost}&nbsp;de&nbsp;Ki · leão: rugido`], ['Especial', 'explosão em volta · Ki cheio'],
  ['Leão', 'fúria cheia · só o Ronin'], ['Pausa', ''], ['Som', ''],
];
const k = (s: string) => `<kbd>${s}</kbd>`;
const or = '<i>ou</i>';
const BINDS: Record<Tab, string[]> = {
  kb: [
    `${k('W')}${k('A')}${k('S')}${k('D')} ${or} setas`, 'cursor do mouse', `${k('J')} ${or} botão esq.`,
    `${k('K')} ${or} botão dir.`, `${k('Espaço')} ${k('Shift')}`, `${k('L')} ${k('E')}`, k('Q'), k('R'), `${k('Esc')} ${k('P')}`, k('M'),
  ],
  pad: [
    `analógico esq. ${or} direcional`, 'analógico dir.', `${k('X')} ${k('RB')}`, k('RT'), `${k('A')} ${k('LB')}`,
    `${k('B')} ${k('LT')}`, k('Y'), k('R3'), k('Start'), k('Select'),
  ],
  touch: [
    'joystick à esquerda', 'segue o movimento', 'botão Corte', 'segure o botão Defesa', 'botão Esquiva',
    'segure o botão Iaido', 'botão Kiai', 'botão Leão', 'botão de pausa', 'botão de som',
  ],
};
// cada trecho não quebra por dentro; a linha quebra entre trechos
const hintHtml = (parts: string[]) => parts.map(p => `<span>${p}</span>`).join('<span class="sep">·</span> ');
const HINTS: Record<Tab, string[]> = {
  kb: [`${k('W')}${k('A')}${k('S')}${k('D')} mover`, `${k('J')} ou clique: corte`, `${k('K')} ou botão dir.: defesa (no tempo certo, apara)`, `${k('Espaço')} esquiva`, `segure ${k('L')}: iaido`, `${k('Q')} com Ki cheio: especial`],
  pad: ['analógico: mover', `${k('X')} corte`, `${k('RT')} defesa`, `${k('A')} esquiva`, `segure ${k('B')}: iaido`, `${k('Y')}: especial`],
  touch: ['arraste à esquerda para mover', 'Corte, Defesa, Esquiva, Iaido e Kiai à direita'],
};
/** Dica quando o personagem tem a forma de leão (só o Ronin): um trecho a mais; no toque, o botão entra na lista. */
const HINTS_LION: Record<Tab, string[]> = {
  kb: [...HINTS.kb, `${k('R')} com fúria cheia: leão`],
  pad: [...HINTS.pad, `${k('R3')} com fúria cheia: leão`],
  touch: ['arraste à esquerda para mover', 'Corte, Defesa, Esquiva, Iaido, Kiai e Leão à direita'],
};
/** Dica na forma de leão (a primeira transformação da partida): os ataques do leão e como voltar. */
const HINTS_IN_LION: Record<Tab, string[]> = {
  kb: [`${k('J')} ou clique: garra`, `segure ${k('L')} e solte: rugido em volta`, `${k('R')}: volta a humano`],
  pad: [`${k('X')} garra`, `segure ${k('B')} e solte: rugido em volta`, `${k('R3')}: volta a humano`],
  touch: ['Garra: ataque à frente', 'segure e solte o Rugido: acerta em volta', '獅 volta a humano'],
};
/** Quanto tempo (s) a dica da forma de leão fica na tela. */
const HINT_LION_DUR = 7;
let specialKanji = '気合';

const controlsHtml = (id: string) => `
  <div class="controls" data-controls>
    <div class="ctl-tabs" role="tablist" aria-label="Controles">
      ${TABS.map(([t, label]) => `<button type="button" class="ctl-tab" role="tab" id="${id}-${t}" data-tab="${t}" aria-controls="${id}-list" aria-selected="false" tabindex="-1">${label}</button>`).join('')}
    </div>
    <dl class="ctl-list" id="${id}-list" role="tabpanel" data-ctl-list></dl>
  </div>`;

const TEMPLATE = `
<div class="play" data-el="play">
  <div class="wave">
    <span class="seal" data-el="waveK" aria-hidden="true">一</span>
    <span class="wave-txt"><b data-el="waveT">Onda 1</b><span data-el="waveSub">prepare-se</span></span>
  </div>
  <div class="tally">
    <div class="hud-btns">
      <button type="button" class="icon-btn" data-action="pause" aria-label="Pausar" title="Pausa (Esc)">${ICON_PAUSE}</button>
      <button type="button" class="icon-btn" data-action="mute" aria-label="Som" aria-pressed="true" title="Som ligado (M)">${ICON_SOUND}</button>
    </div>
    <div class="score"><span class="score-num" data-el="score">0</span><span class="score-mul" data-el="mul" title="Multiplicador">×1</span></div>
    <div class="combo" data-el="combo" aria-hidden="true">
      <span class="combo-num" data-el="comboNum">0</span><span class="combo-lbl">golpes</span>
      <span class="combo-timer"><i data-el="comboBar"></i></span>
    </div>
  </div>
</div>
<div class="banner" aria-hidden="true">
  <div class="band" data-el="band"><span class="band-k" data-el="bandK">一</span><span class="band-txt"><b data-el="bandT"></b><span data-el="bandS"></span></span></div>
</div>
<div class="floats" data-el="floats" aria-hidden="true"></div>
<div class="hud-sr" role="status" aria-live="polite" data-el="announce"></div>
<div class="hint" data-el="hint" aria-hidden="true"></div>

<section class="screen scr-title" data-el="title" aria-labelledby="hud-title-h">
  <img class="title-bg" src="${TITLE_ART.landscape.src}" width="${TITLE_ART.landscape.w}" height="${TITLE_ART.landscape.h}" alt="" draggable="false">
  <h1 class="title-mark" id="hud-title-h"><span class="hud-sr">Ensō com o kanji 雨 (chuva)</span>${emblemSvg()}</h1>
  <aside class="title-record" data-el="best" aria-label="Recorde"></aside>
  <div class="char-pick" role="radiogroup" aria-label="Escolha o personagem" data-el="charPick">
    ${CHAR_IDS.map(id => `
    <button type="button" class="char-card" role="radio" aria-checked="false" data-char="${id}" aria-label="${CHARACTERS[id].name}: ${CHARACTERS[id].blurb}">
      <img class="char-art" src="${TITLE_ART[id].src}" width="${TITLE_ART[id].w}" height="${TITLE_ART[id].h}" alt="" draggable="false">
      <span class="char-plate" aria-hidden="true"><span class="char-kanji">${CHARACTERS[id].kanji}</span><span class="char-name">${CHARACTERS[id].name}</span></span>
    </button>`).join('')}
  </div>
  <div class="title-cta">
    <p class="cta-sub" data-el="pickSub" aria-hidden="true"></p>
    <button type="button" class="btn btn-paper btn-lg" data-action="start" data-el="startBtn">Jogar</button>
  </div>
  <button type="button" class="icon-btn corner-mute" data-action="mute" aria-label="Som" aria-pressed="true" title="Som ligado (M)">${ICON_SOUND}</button>
</section>

<section class="screen scr-pause" data-el="pause" role="dialog" aria-modal="true" aria-labelledby="hud-pause-h">
  <div class="card">
    <span class="seal card-seal" aria-hidden="true">止</span>
    <h2 class="card-h" id="hud-pause-h">Pausa</h2>
    <p class="card-sub">A chuva espera por você.</p>
    <div class="menu">
      <button type="button" class="btn btn-ink" data-action="resume" data-el="resumeBtn">Continuar</button>
      <button type="button" class="btn btn-line" data-action="restart">Recomeçar</button>
      <button type="button" class="btn btn-line" data-action="mute" data-el="muteText" aria-pressed="true">Som: ligado</button>
    </div>
    ${controlsHtml('hud-ctl-p')}
  </div>
</section>

<section class="screen scr-over" data-el="over" role="dialog" aria-modal="true" aria-labelledby="hud-over-h">
  <div class="card card-over">
    <span class="seal card-seal" aria-hidden="true">終</span>
    <h2 class="card-h" id="hud-over-h">O ronin tombou</h2>
    <div class="over-score"><span class="over-score-num" data-el="oScore">0</span><span class="over-score-lbl">pontos</span></div>
    <p class="over-new" data-el="oNew" hidden><b aria-hidden="true">新</b>Novo recorde</p>
    <dl class="over-stats">
      <div><dt>Abates</dt><dd data-el="oKills">0</dd></div>
      <div><dt>Onda alcançada</dt><dd data-el="oWave">0</dd></div>
      <div><dt>Maior combo</dt><dd data-el="oCombo">0</dd></div>
      <div><dt>Tempo</dt><dd data-el="oTime">00:00</dd></div>
    </dl>
    <p class="over-best" data-el="oBest"></p>
    <button type="button" class="btn btn-ink btn-lg" data-action="restart" data-el="againBtn">Lutar de novo</button>
  </div>
</section>`;

interface Float {
  el: HTMLElement;
  on: boolean;
  t: number;
  /** Deslocamento em px do ponto do mundo em relação à projeção da origem (câmera ortográfica). */
  ox: number;
  oy: number;
}

export function createHud(root: HTMLElement, cb: HudCallbacks, input: Input): Hud {
  const reduce = matchMediaSafe('(prefers-reduced-motion: reduce)');
  const el = document.createElement('div');
  el.id = 'hud';
  el.innerHTML = TEMPLATE;
  root.appendChild(el);
  const $ = <T extends HTMLElement = HTMLElement>(n: string): T => el.querySelector<T>(`[data-el="${n}"]`)!;

  const play = $('play');
  const waveK = $('waveK'), waveT = $('waveT'), waveSub = $('waveSub');
  const scoreEl = $('score'), mulEl = $('mul'), comboEl = $('combo'), comboNum = $('comboNum'), comboBar = $('comboBar');
  const floatsEl = $('floats');
  const band = $('band'), bandK = $('bandK'), bandT = $('bandT'), bandS = $('bandS'), announce = $('announce');
  const hint = $('hint');
  const screens: Partial<Record<Screen, HTMLElement>> = { title: $('title'), paused: $('pause'), over: $('over') };
  const bestEl = $('best'), charPick = $('charPick'), startBtn = $<HTMLButtonElement>('startBtn'), pickSub = $('pickSub');
  const resumeBtn = $<HTMLButtonElement>('resumeBtn'), againBtn = $<HTMLButtonElement>('againBtn'), muteText = $('muteText');
  const oScore = $('oScore'), oNew = $('oNew'), oKills = $('oKills'), oWave = $('oWave'), oCombo = $('oCombo'), oTime = $('oTime'), oBest = $('oBest');

  const touch = createTouchControls(el, input);
  touch.onEnable = () => { el.classList.add('is-touch'); if (!tabChosen) setTab('touch'); };
  if (touch.enabled) el.classList.add('is-touch');
  el.classList.add('has-fury');

  // vida, Ki, Fúria e a barra de comandos: HUD de pedra e tinta (src/ui/stone)
  const stone = createStoneHud(el);
  play.prepend(stone.vitals);
  const view = createStoneView();
  let character: CharacterChoice = 'ronin';
  /** Último dispositivo de jogo (teclas mostradas na barra de comandos; no toque ela some). */
  const deviceOf = (): StoneDevice => (touch.enabled ? 'touch' : input.lastDevice === 'gamepad' ? 'pad' : 'kb');
  /** Bordas do que é segurado (iaido/rugido e defesa), para avisar só no aperto. */
  let prevCharge = false, prevGuard = false;
  /** Avisa o motivo se o comando apertado está indisponível (o modelo é o do último quadro desenhado). */
  const tryDeny = (id: CommandId) => {
    const c = view.byId[id];
    if (!c.hidden && !c.enabled && c.reason) stone.deny(id, c.reason);
  };

  let screen: Screen = 'loading';
  let shownAt = 0;
  let project: Projector | null = null;

  // valores exibidos (NaN força a primeira escrita)
  let cWave = -1, cWaveSub = NaN, cScore = NaN, cMul = NaN, cCombo = -1, cComboBar = -1;
  let scoreShown = 0;
  let hintT = -1, hintOn = false, hintKey = '';
  /** A dica na tela é a da forma de leão (não a do começo); `lionHinted`: já apareceu nesta partida. */
  let hintLion = false, lionHinted = false;
  const hintEnd = () => (hintLion ? HINT_FROM + HINT_LION_DUR : HINT_TO);
  // forma de leão: só o Ronin tem (a Tomoe não tem barra de Fúria nem comando Leão)
  let hasLion = true;

  const floats: Float[] = [];
  for (let i = 0; i < FLOAT_POOL; i++) {
    const f = document.createElement('div');
    f.className = 'float';
    floatsEl.appendChild(f);
    floats.push({ el: f, on: false, t: 0, ox: 0, oy: 0 });
  }
  let floatsOn = 0;
  let bandAnim: Animation | null = null;

  // ---------------------------------------------------------------- abas de controles
  let tab: Tab = touch.enabled ? 'touch' : padConnected() ? 'pad' : 'kb';
  let tabChosen = false;
  const ctlBlocks = [...el.querySelectorAll<HTMLElement>('[data-controls]')];
  function setTab(t: Tab): void {
    tab = t;
    const i = TABS.findIndex(x => x[0] === t);
    const rows = ACTIONS.map(([a, note], j) => `<div class="ctl-row"><dt>${a}${note ? `<small>${note}</small>` : ''}</dt><dd>${BINDS[t][j]}</dd></div>`).join('');
    for (const b of ctlBlocks) {
      b.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn, j) => {
        btn.setAttribute('aria-selected', String(j === i));
        btn.tabIndex = j === i ? 0 : -1;
      });
      const list = b.querySelector<HTMLElement>('[data-ctl-list]')!;
      list.innerHTML = rows;
      list.setAttribute('aria-labelledby', b.querySelector<HTMLElement>(`[data-tab="${t}"]`)!.id);
    }
  }
  setTab(tab);

  // ---------------------------------------------------------------- ações
  const actions: Record<string, () => void> = {
    start: () => { if (screen === 'title') cb.onStart(); },
    resume: () => { if (screen === 'paused') cb.onResume(); },
    restart: () => {
      // no fim de jogo, ignora cliques logo que a tela aparece (dedo ainda martelando o ataque)
      if (screen === 'paused' || (screen === 'over' && performance.now() - shownAt > 600)) cb.onRestart();
    },
    mute: () => cb.onToggleMute(),
    pause: () => {
      if (screen !== 'playing') return;
      if (cb.onPause) { cb.onPause(); return; }
      // sem callback de pausa: a entrada trata P no próximo quadro
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyP', key: 'p' }));
    },
  };
  // ---------------------------------------------------------------- escolha de personagem (título)
  // clique/toque no samurai, ←/→ (A/D) no teclado ou direcional/analógico do gamepad (pela entrada do jogo);
  // com um escolhido aparece "Jogar", que Enter/Espaço/J/A também acionam. O cenário é sorteado ao jogar (game.ts).
  const charCards = [...el.querySelectorAll<HTMLButtonElement>('.char-card')];
  /** Já escolheu nesta visita ao título (sem escolha, "Jogar" fica escondido e confirmar não faz nada). */
  let picked = false;
  /** Direção do analógico/direcional do gamepad no quadro anterior (só a borda escolhe). */
  let prevNav = 0;
  const choose = (id: CharacterChoice) => cb.onSelectCharacter?.(id);
  /** ← escolhe o samurai da esquerda, → o da direita; o foco, se está num samurai, acompanha (Enter nele não volta para o outro). */
  const chooseSide = (dir: number) => {
    choose(CHAR_IDS[dir < 0 ? 0 : CHAR_IDS.length - 1]);
    if (charPick.contains(document.activeElement)) charCards.find(c => c.getAttribute('aria-checked') === 'true')?.focus({ preventScroll: true });
  };
  // teclado pelo evento (um toque rápido cabe entre dois quadros e a entrada do jogo não o veria segurado)
  window.addEventListener('keydown', e => {
    if (screen !== 'title' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    if (dir) chooseSide(dir);
  });

  el.addEventListener('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    const card = t?.closest<HTMLButtonElement>('.char-card');
    if (card) {
      choose(card.dataset.char as CharacterChoice);
      // próximo passo à mão: Enter/Espaço depois do clique (ou de Tab + Enter no samurai) já jogam
      if (picked) startBtn.focus({ preventScroll: true });
      return;
    }
    const tabBtn = t?.closest<HTMLElement>('[data-tab]');
    if (tabBtn) { tabChosen = true; setTab(tabBtn.dataset.tab as Tab); return; }
    const btn = t?.closest<HTMLButtonElement>('button[data-action]');
    if (!btn) return;
    actions[btn.dataset.action ?? '']?.();
    // botões do HUD em partida não guardam foco (Espaço é esquiva, não clique)
    if (btn.closest('.play')) btn.blur();
  });
  // Enter/Espaço num botão focado é do botão: não deixa a entrada do jogo ver (evita ação dupla)
  el.addEventListener('keydown', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t?.closest('button')) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { e.stopPropagation(); return; }
    const tabBtn = t.closest<HTMLElement>('[data-tab]');
    if (tabBtn && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.stopPropagation();
      e.preventDefault();
      const i = TABS.findIndex(x => x[0] === tab);
      const n = TABS[(i + (e.code === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
      tabChosen = true;
      setTab(n);
      tabBtn.closest('[data-controls]')?.querySelector<HTMLElement>(`[data-tab="${n}"]`)?.focus();
    }
  });

  // ---------------------------------------------------------------- efeitos pontuais
  const animate = (target: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null => {
    if (typeof target.animate !== 'function') return null;
    return target.animate(frames, opts);
  };
  const pop = (target: HTMLElement, s = 1.4) => {
    if (reduce()) return;
    animate(target, [{ transform: `scale(${s})` }, { transform: 'scale(1)' }], { duration: 200, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
  };

  function showBand(kanji: string, title: string, sub: string, small: boolean, dur: number): void {
    bandAnim?.cancel();
    bandK.textContent = kanji;
    bandK.classList.toggle('is-arabic', kanji.length > 1);
    bandT.textContent = title;
    bandS.textContent = sub;
    bandS.hidden = !sub;
    band.classList.toggle('band--small', small);
    const frames: Keyframe[] = reduce()
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }]
      : [
        { opacity: 1, clipPath: 'inset(0 100% 0 0)', transform: 'translateX(-10px)', easing: 'cubic-bezier(.3,.8,.3,1)' },
        { opacity: 1, clipPath: 'inset(0 0% 0 0)', transform: 'translateX(0)', offset: 0.14 },
        { opacity: 1, clipPath: 'inset(0 0% 0 0)', transform: 'translateX(0)', offset: 0.8, easing: 'ease-in' },
        { opacity: 0, clipPath: 'inset(0 0% 0 0)', transform: 'translateX(10px)' },
      ];
    bandAnim = animate(band, frames, { duration: dur, fill: 'both' });
  }

  function spawnFloat(x: number, y: number, z: number, text: string, cls: string): void {
    if (!project) return;
    let f = floats[0];
    for (const c of floats) {
      if (!c.on) { f = c; break; }
      if (c.t > f.t) f = c; // pool cheio: recicla o mais antigo
    }
    const a = project(x, y, z), o = project(0, 0, 0);
    if (!f.on) floatsOn++;
    f.on = true;
    f.t = 0;
    f.ox = a.x - o.x;
    f.oy = a.y - o.y;
    f.el.textContent = text;
    f.el.className = cls ? `float ${cls}` : 'float';
    placeFloat(f, o.x, o.y);
  }

  function placeFloat(f: Float, bx: number, by: number): void {
    const u = Math.min(1, f.t / FLOAT_DUR);
    const rise = (1 - (1 - u) * (1 - u)) * 34;
    const s = u < 0.12 ? 1 + (1 - u / 0.12) * 0.45 : 1;
    f.el.style.transform = `translate3d(${(bx + f.ox).toFixed(1)}px, ${(by + f.oy - rise).toFixed(1)}px, 0) translate(-50%, -100%) scale(${s.toFixed(3)})`;
    f.el.style.opacity = u < 0.7 ? '1' : ((1 - u) / 0.3).toFixed(3);
  }

  function clearFloats(): void {
    for (const f of floats) { if (f.on) { f.on = false; f.el.style.opacity = '0'; } }
    floatsOn = 0;
  }

  function resetRun(): void {
    cWaveSub = cScore = cMul = NaN;
    cWave = cCombo = cComboBar = -1;
    stone.reset();
    prevCharge = prevGuard = false;
    scoreShown = 0;
    hintT = 0;
    hintLion = lionHinted = false;
    hintOn = false;
    hint.classList.remove('is-on');
    clearFloats();
    bandAnim?.cancel();
    bandAnim = null;
  }

  /** Recorde na lateral do título: pontos e a onda mais alta (ou o convite, sem partida ainda). */
  function fillTitle(): void {
    const b = readBest();
    const head = '<span class="rec-head"><span class="seal rec-seal" aria-hidden="true">記</span><b>Recorde</b></span>';
    bestEl.innerHTML = b && b.score > 0
      ? `${head}<span class="rec-score">${fmt.format(b.score)}</span><span class="rec-unit">pontos</span>`
        + `<span class="rec-wave"><span class="rec-unit">onda</span><b>${b.wave}</b></span>`
      : `${head}<span class="rec-none">nenhum ainda</span><span class="rec-unit">o primeiro é seu</span>`;
  }

  function fillOver(st?: RunStats): void {
    const s = st ?? { score: 0, kills: 0, wave: 0, bestCombo: 0, time: 0, best: { score: 0, wave: 0 }, newBest: false };
    oScore.textContent = fmt.format(s.score);
    oKills.textContent = fmt.format(s.kills);
    oWave.textContent = String(s.wave);
    oCombo.textContent = fmt.format(s.bestCombo);
    oTime.textContent = mmss(s.time);
    oNew.hidden = !s.newBest;
    oBest.textContent = s.best.score > 0 ? `Recorde: ${fmt.format(s.best.score)} pontos · onda ${s.best.wave}` : '';
    announce.textContent = `Fim de jogo. ${fmt.format(s.score)} pontos, ${s.kills} abates, onda ${s.wave}.${s.newBest ? ' Novo recorde.' : ''}`;
  }

  function blurInside(): void {
    const a = document.activeElement;
    if (a instanceof HTMLElement && el.contains(a)) a.blur();
  }

  // ---------------------------------------------------------------- contrato
  const hud: Hud = {
    setScreen(s, stats) {
      const prev = screen;
      screen = s;
      shownAt = performance.now();
      el.dataset.screen = s;
      document.body.dataset.screen = s;
      for (const key of Object.keys(screens) as Screen[]) screens[key]!.classList.toggle('is-on', key === s);
      play.inert = s !== 'playing';
      touch.setActive(s === 'playing');

      if (s === 'playing') {
        if (prev !== 'paused') resetRun();
        else if (hintT >= HINT_FROM && hintT < hintEnd()) { hintOn = true; hint.classList.add('is-on'); }
        blurInside();
      } else {
        hintOn = false;
        hint.classList.remove('is-on');
      }
      if (s === 'title' || s === 'over') { clearFloats(); bandAnim?.cancel(); bandAnim = null; }
      // a faixa congela junto com a partida
      if (bandAnim && bandAnim.playState !== 'finished') { if (s === 'paused') bandAnim.pause(); else if (s === 'playing') bandAnim.play(); }
      if (s === 'title') {
        fillTitle();
        prevNav = 0;
      }
      if (s === 'paused') {
        if (!tabChosen) setTab(touch.enabled ? 'touch' : input.lastDevice === 'gamepad' ? 'pad' : 'kb');
        resumeBtn.focus({ preventScroll: true });
      }
      if (s === 'over') {
        fillOver(stats);
        againBtn.focus({ preventScroll: true });
      }
    },

    update(sim, dt) {
      const p = sim.player;
      const lion = p.form === 'lion';
      // virando leão e voltando: tudo travado. Na forma, corte e iaido viram garra e rugido; esquiva, defesa
      // e Kiai ficam travados, e o Ki não é usado nem ganho
      const busy = p.state === 'transform' || p.state === 'revert';
      const locked = lion || busy;
      const roarReady = lion && !busy && p.roarCd <= 0 && p.state !== 'roar' && p.state !== 'dead';
      const fs = furyStateOf(p);
      const lionBtn: LionButton = !hasLion ? 'idle' : fs === 'lion' || fs === 'transform' ? 'active' : fs === 'ready' ? 'ready' : 'idle';
      touch.update(lion ? roarReady : !locked && p.ki >= IAIDO.cost, p.state === 'charge' || p.state === 'roarCharge',
        !locked && p.ki >= KIAI.cost, lionBtn, busy ? 'busy' : lion ? 'lion' : 'human');
      if (screen !== 'playing' && screen !== 'paused') return;

      // vida, Ki, Fúria e comandos (HUD de pedra): o modelo é recalculado e só o que mudou vai para o DOM
      stone.render(fillStoneView(view, p, character, deviceOf()));

      // onda
      if (sim.wave !== cWave) {
        cWave = sim.wave;
        const n = Math.max(1, sim.wave);
        waveK.textContent = numeral(n);
        waveK.classList.toggle('is-arabic', n > 10);
        waveT.textContent = `Onda ${n}`;
      }
      const code = sim.waveState === 'active' ? sim.remaining : sim.wave === 0 ? -1 : -2 - Math.ceil(sim.waveTimer);
      if (code !== cWaveSub) {
        cWaveSub = code;
        waveSub.textContent = code >= 0 ? (code === 1 ? 'resta 1' : `restam ${code}`)
          : code === -1 ? 'prepare-se' : `próxima em ${-2 - code} s`;
      }

      // pontuação (conta até o valor novo)
      if (scoreShown !== sim.score) {
        const d = sim.score - scoreShown;
        scoreShown = Math.abs(d) < 2 ? sim.score : scoreShown + d * Math.min(1, dt * 12);
      }
      const sc = Math.round(scoreShown);
      if (sc !== cScore) { cScore = sc; scoreEl.textContent = fmt.format(sc); }

      const mul = sim.multiplier;
      if (mul !== cMul) {
        const up = mul > cMul;
        cMul = mul;
        mulEl.textContent = `×${fmtMul.format(mul)}`;
        mulEl.classList.toggle('is-hot', mul > 1);
        if (up && mul > 1) pop(mulEl, 1.6);
      }

      // combo
      const combo = sim.combo;
      if (combo !== cCombo) {
        const up = combo > cCombo;
        cCombo = combo;
        comboEl.classList.toggle('is-on', combo >= 2);
        if (combo >= 2) {
          comboNum.textContent = String(combo);
          if (up) pop(comboNum);
        }
      }
      const cbar = combo >= 2 ? Math.round((Math.max(0, sim.comboTimer) / SCORE.comboTimeout) * COMBO_STEPS) : 0;
      if (cbar !== cComboBar) { cComboBar = cbar; comboBar.style.transform = `scaleX(${cbar / COMBO_STEPS})`; }

      if (screen !== 'playing') return;

      // textos flutuantes: uma projeção por quadro (origem) + deslocamento fixo de cada texto
      if (floatsOn > 0 && project) {
        const o = project(0, 0, 0);
        for (const f of floats) {
          if (!f.on) continue;
          f.t += dt;
          if (f.t >= FLOAT_DUR) { f.on = false; floatsOn--; f.el.style.opacity = '0'; continue; }
          placeFloat(f, o.x, o.y);
        }
      }

      // dica de controles nos primeiros segundos (e na primeira forma de leão, os ataques do leão)
      if (hintT >= 0) {
        hintT += dt;
        const t: Tab = touch.enabled ? 'touch' : input.lastDevice === 'gamepad' ? 'pad' : 'kb';
        const hk = hintLion ? `${t}+inLion` : hasLion ? `${t}+lion` : t;
        if (hk !== hintKey) { hintKey = hk; hint.innerHTML = hintHtml((hintLion ? HINTS_IN_LION : hasLion ? HINTS_LION : HINTS)[t]); }
        // a do leão some antes se ele volta a humano
        const end = hintT >= hintEnd() || (hintLion && !lion);
        if (!hintOn && hintT >= HINT_FROM && !end) { hintOn = true; hint.classList.add('is-on'); }
        if (end) { hintOn = false; hint.classList.remove('is-on'); hintT = -1; }
      }
    },

    input(f) {
      if (screen === 'title') {
        // gamepad: direcional/analógico escolhem (o teclado vem pelo keydown); confirmar joga com o escolhido
        const nav = f.device !== 'gamepad' ? 0 : f.move.x < -0.5 ? -1 : f.move.x > 0.5 ? 1 : 0;
        if (nav && nav !== prevNav) chooseSide(nav);
        prevNav = nav;
        if (f.confirm && !f.pause && picked) cb.onStart();
        return;
      }
      if (screen !== 'playing') { prevCharge = prevGuard = false; return; }
      if (f.attack) tryDeny('attack');
      if (f.dash) tryDeny('dash');
      if (f.special) tryDeny('special');
      if (f.transform) tryDeny('transform');
      if (f.charge && !prevCharge) tryDeny('charge');
      if (f.guard && !prevGuard) tryDeny('guard');
      prevCharge = f.charge;
      prevGuard = f.guard;
    },

    handle(ev) {
      switch (ev.type) {
        case 'waveStart': {
          const sub = `${ev.total} samurais`;
          showBand(numeral(ev.wave), `Onda ${ev.wave}`, sub, false, 2700);
          announce.textContent = `Onda ${ev.wave}: ${sub}.`;
          break;
        }
        case 'waveClear': {
          const txt = ev.heal > 0 ? `Onda vencida · +${Math.round(ev.heal)} de vida` : 'Onda vencida';
          showBand('勝', txt, '', true, 2300);
          announce.textContent = `${txt}.`;
          break;
        }
        case 'enemyDeath':
          spawnFloat(ev.pos.x, FLOAT_Y, ev.pos.z, `+${fmt.format(ev.score)}`, ev.kind === 'brute' ? 'is-big' : '');
          break;
        case 'iaidoCut':
          if (ev.kills >= 2) spawnFloat(ev.to.x, FLOAT_Y + 0.9, ev.to.z, `居合 ×${ev.kills}`, 'is-iaido');
          break;
        case 'playerHurt':
          stone.hurt();
          break;
        case 'parry':
          spawnFloat(ev.enemyPos.x, FLOAT_Y, ev.enemyPos.z, 'Aparado', 'is-iaido');
          break;
        case 'kiaiBlast':
          if (ev.kills > 0) spawnFloat(ev.pos.x, FLOAT_Y + 1.2, ev.pos.z, `${specialKanji} ×${ev.kills}`, 'is-iaido');
          break;
        case 'chargeReady':
          stone.pop('charge');
          break;
        case 'furyReady': {
          if (!hasLion) break;
          const d = deviceOf();
          stone.notify(d === 'touch' ? 'Fúria cheia · toque no Leão' : `Fúria cheia · ${d === 'pad' ? 'R3' : 'R'} desperta o leão`);
          announce.textContent = 'Fúria cheia: leão pronto.';
          break;
        }
        case 'transformStart':
          // curta: termina antes do leão completo surgir rugindo
          showBand('獅', 'Forma de leão', '', true, 1500);
          announce.textContent = 'Forma de leão: o corte vira garra e o iaido, rugido.';
          break;
        case 'transformEnd':
          // na primeira forma da partida, a dica troca para os ataques do leão
          if (!hasLion || lionHinted) break;
          lionHinted = hintLion = true;
          hintT = 0;
          hintOn = false;
          hint.classList.remove('is-on');
          break;
        case 'lionRoarReady':
          stone.pop('charge');
          break;
        case 'lionRoar':
          if (ev.kills >= 2) spawnFloat(ev.pos.x, FLOAT_Y + 1.2, ev.pos.z, `吼 ×${ev.kills}`, 'is-iaido');
          break;
        case 'revertStart':
          // na morte quem fala é a tela de fim de jogo
          if (ev.reason !== 'death') announce.textContent = ev.reason === 'timeout' ? 'A fúria se esgotou: de volta a humano.' : 'De volta a humano.';
          break;
        default:
          break;
      }
    },

    setCharacter(id, pick) {
      picked = pick;
      for (const c of charCards) c.setAttribute('aria-checked', String(pick && c.dataset.char === id));
      screens.title!.classList.toggle('has-pick', pick);
      pickSub.textContent = CHARACTERS[id].blurb;
      character = id;
      specialKanji = CHARACTERS[id].specialKanji;
      // só o Ronin vira leão: a Tomoe não tem barra de Fúria nem botão Leão (o modelo esconde os dois)
      hasLion = id === 'ronin';
      el.classList.toggle('has-fury', hasLion);
      touch.setLion(hasLion);
      touch.setSpecial(id === 'tomoe' ? 'sh-petals' : 'sh-fire', CHARACTERS[id].special);
      stone.reset();
      hintKey = '';
    },
    setMuted(m) {
      el.querySelectorAll<HTMLButtonElement>('button[data-action="mute"]').forEach(b => {
        b.setAttribute('aria-pressed', String(!m));
        if (b.classList.contains('icon-btn')) {
          b.classList.toggle('is-muted', m);
          b.title = m ? 'Som desligado (M)' : 'Som ligado (M)';
        }
      });
      muteText.textContent = m ? 'Som: desligado' : 'Som: ligado';
    },

    setProjector(fn) { project = fn; },
  };

  el.dataset.screen = 'loading';
  document.body.dataset.screen = 'loading';
  fillTitle();
  return hud;
}

function matchMediaSafe(q: string): () => boolean {
  try {
    const m = window.matchMedia(q);
    return () => m.matches;
  } catch {
    return () => false;
  }
}

function padConnected(): boolean {
  try {
    return typeof navigator.getGamepads === 'function' && [...navigator.getGamepads()].some(p => !!p && p.connected);
  } catch {
    return false;
  }
}
