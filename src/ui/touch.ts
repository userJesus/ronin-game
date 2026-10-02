// Controles de toque: joystick flutuante na metade esquerda e botões Corte/Defesa/Esquiva/Iaido/Kiai à direita
// (mais o botão Leão, só do Ronin, no alto da coluna da direita). Na forma de leão, Corte vira Garra e
// Iaido vira Rugido (segurar e soltar); Esquiva, Defesa e Kiai ficam travados.
// Escrevem em `input.virtual` (coordenadas de TELA: x para a direita, y para cima, comprimento <= 1).
// Só aparecem com ponteiro grosso ou depois do primeiro toque; fora dos botões a tela segue livre
// (o joystick escuta a janela, sem camada que cubra o canvas).
import './touch.css';
import type { Input, VirtualControls } from '../input/input';
import { iconSvg, type IconId } from './stone/icons';

type ButtonKey = 'attack' | 'dash' | 'charge' | 'guard' | 'special' | 'transform';

/** Botão Leão: apagado (Fúria enchendo), pronto (Fúria cheia) ou ativo (na forma; apertar volta a humano). */
export type LionButton = 'idle' | 'ready' | 'active';

/**
 * Botões conforme o corpo: humano; leão (Garra e Rugido no lugar de Corte e Iaido; esquiva, defesa e Kiai
 * travados); ou ocupado (virando leão ou voltando: tudo travado, já com os nomes do leão).
 */
export type TouchMode = 'human' | 'lion' | 'busy';

export interface TouchControls {
  /** Modo toque ligado (ponteiro grosso ou já houve um toque). */
  readonly enabled: boolean;
  /** Chamado uma vez quando o modo toque liga. */
  onEnable: (() => void) | null;
  /** Mostra/esconde conforme a tela (só em partida); ao esconder, solta tudo. */
  setActive(on: boolean): void;
  /**
   * Por quadro, depois de `input.frame()`: solta toques curtos e reflete o estado do iaido (do rugido, na
   * forma de leão), do Kiai e da forma de leão. `mode`: quais botões ficam travados e com que nome.
   */
  update(iaidoReady: boolean, charging: boolean, kiaiReady: boolean, lion?: LionButton, mode?: TouchMode): void;
  /** Mostra o botão Leão (só o Ronin tem a forma); ao esconder, solta o botão. */
  setLion(on: boolean): void;
  /** Ícone e nome do golpe especial (Kiai do Ronin, Hanafubuki da Tomoe). */
  setSpecial(icon: IconId, name: string): void;
}

interface Btn {
  key: ButtonKey;
  el: HTMLButtonElement;
  ids: Set<number>;
  down: boolean;
  /** Quadros lidos pela entrada desde que foi pressionado (toque curto não se perde). */
  seen: number;
  /** Ícone de giz e nome (humano); `lion`: os da forma de leão, se o botão muda. */
  label: [IconId, string];
  lion?: [IconId, string];
}

/** Raio útil do joystick (px de CSS). */
const STICK_R = 54;
const DEAD = 0.12;

const BUTTONS: [ButtonKey, string, IconId, string][] = [
  ['attack', 'cut', 'sh-sword', 'Corte'],
  ['dash', 'dash', 'sh-dash', 'Esquiva'],
  ['charge', 'iaido', 'sh-iaido', 'Iaido'],
  ['guard', 'guard', 'sh-guard', 'Defesa'],
  ['special', 'kiai', 'sh-fire', 'Kiai'],
  // sempre no fim: os índices acima são usados abaixo
  ['transform', 'lion', 'sh-lion', 'Leão'],
];
/** Na forma de leão: o corte é a garra e o iaido é o rugido (a entrada continua a mesma); o Leão vira Humano. */
const LION_LABELS: Partial<Record<ButtonKey, [IconId, string]>> = {
  attack: ['sh-paw', 'Garra'], charge: ['sh-roar', 'Rugido'], transform: ['sh-samurai', 'Humano'],
};
/** Travados na forma de leão (o leão não esquiva, não defende e não tem Kiai). */
const LION_LOCKED = new Set<ButtonKey>(['dash', 'guard', 'special']);

export function createTouchControls(parent: HTMLElement, input: Input): TouchControls {
  const v: VirtualControls = input.virtual;
  const el = document.createElement('div');
  el.className = 'touch';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="touch-stick"><i class="touch-knob"></i></div>
    <div class="touch-btns">
      ${BUTTONS.map(([, cls, icon, label]) => `<button type="button" tabindex="-1" class="tbtn tbtn-${cls}" aria-label="${label}">${iconSvg(icon)}<span>${label}</span></button>`).join('')}
    </div>`;
  parent.appendChild(el);
  const stick = el.querySelector<HTMLElement>('.touch-stick')!;
  const knob = el.querySelector<HTMLElement>('.touch-knob')!;
  const btns: Btn[] = [...el.querySelectorAll<HTMLButtonElement>('.tbtn')].map((b, i) => ({
    key: BUTTONS[i][0], el: b, ids: new Set<number>(), down: false, seen: 0,
    label: [BUTTONS[i][2], BUTTONS[i][3]], lion: LION_LABELS[BUTTONS[i][0]],
  }));
  const iaidoBtn = btns[2].el;
  const kiaiBtn = btns[4].el;
  const lionB = btns[5];
  let cKiai = false;
  let cLion: LionButton = 'idle', cMode: TouchMode = 'human', lionOn = true;

  /** Troca ícone, nome e rótulo acessível (o botão e o que ele escreve na entrada continuam os mesmos). */
  function setLabel(b: Btn, [icon, name]: [IconId, string]): void {
    b.el.querySelector('use')!.setAttribute('href', `#${icon}`);
    b.el.querySelector('span')!.textContent = name;
    b.el.setAttribute('aria-label', name);
  }

  let enabled = false;
  let active = false;
  let stickId = -1;
  let ox = 0, oy = 0;
  let cReady = false, cCharging = false;

  const api: TouchControls = {
    get enabled() { return enabled; },
    onEnable: null,
    setActive(on) {
      if (on === active) return;
      active = on;
      if (!on) releaseAll();
      refresh();
    },
    update(iaidoReady, charging, kiaiReady, lion = 'idle', mode = 'human') {
      if (kiaiReady !== cKiai) { cKiai = kiaiReady; kiaiBtn.classList.toggle('is-ready', kiaiReady); }
      for (const b of btns) {
        if (!v[b.key]) continue;
        b.seen++;
        if (!b.down && b.seen >= 1) v[b.key] = false;
      }
      if (iaidoReady !== cReady) { cReady = iaidoReady; iaidoBtn.classList.toggle('is-ready', iaidoReady); }
      if (charging !== cCharging) { cCharging = charging; iaidoBtn.classList.toggle('is-charging', charging); }
      if (lion !== cLion) {
        if ((lion === 'active') !== (cLion === 'active')) setLabel(lionB, lion === 'active' ? lionB.lion! : lionB.label);
        cLion = lion;
        lionB.el.classList.toggle('is-ready', lion === 'ready');
        lionB.el.classList.toggle('is-active', lion === 'active');
      }
      if (mode !== cMode) {
        const wasLion = cMode !== 'human';
        cMode = mode;
        for (const b of btns) {
          if (b === lionB) continue;
          b.el.classList.toggle('is-locked', mode === 'busy' || (mode === 'lion' && LION_LOCKED.has(b.key)));
          if (b.lion && wasLion !== (mode !== 'human')) setLabel(b, mode !== 'human' ? b.lion : b.label);
        }
      }
    },
    setLion(on) {
      if (on === lionOn) return;
      lionOn = on;
      lionB.el.hidden = !on;
      el.classList.toggle('has-lion', on);
      if (!on) { lionB.ids.clear(); lionB.down = false; lionB.el.classList.remove('is-down'); v.transform = false; }
    },
    setSpecial(icon, name) {
      const kiai = btns[4];
      kiai.label = [icon, name];
      setLabel(kiai, kiai.label);
    },
  };
  el.classList.add('has-lion');

  function refresh(): void {
    el.classList.toggle('is-on', enabled && active);
    if (enabled && active && stickId < 0) restStick();
  }

  function enable(): void {
    if (enabled) return;
    enabled = true;
    refresh();
    api.onEnable?.();
  }

  // ---------------------------------------------------------------- joystick
  function placeStick(): void {
    stick.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
  }

  /** Posição de descanso, canto inferior esquerdo (mostra onde tocar). */
  function restStick(): void {
    const cs = getComputedStyle(el); // padding de .touch = margem segura do aparelho (entalhe)
    ox = Math.max(16, parseFloat(cs.paddingLeft) || 0) + STICK_R + 20;
    oy = window.innerHeight - Math.max(16, parseFloat(cs.paddingBottom) || 0) - STICK_R - 28;
    placeStick();
    knob.style.transform = 'translate3d(0, 0, 0)';
    stick.classList.remove('is-held');
  }

  function moveStick(x: number, y: number): void {
    let dx = x - ox, dy = y - oy;
    let l = Math.hypot(dx, dy);
    if (l > STICK_R * 1.35) {
      // o dedo foi longe: a base acompanha, mantendo a direção responsiva
      const k = 1 - (STICK_R * 1.35) / l;
      ox += dx * k; oy += dy * k;
      dx = x - ox; dy = y - oy; l = Math.hypot(dx, dy);
      placeStick();
    }
    const kl = l > STICK_R ? STICK_R / l : 1;
    knob.style.transform = `translate3d(${dx * kl}px, ${dy * kl}px, 0)`;
    const m = Math.min(1, l / STICK_R);
    if (m < DEAD || l < 1e-3) { v.move.x = 0; v.move.y = 0; return; }
    const s = (m - DEAD) / (1 - DEAD) / l;
    v.move.x = dx * s;
    v.move.y = -dy * s; // tela: y para cima
  }

  function endStick(): void {
    stickId = -1;
    v.move.x = 0; v.move.y = 0;
    if (enabled && active) restStick();
  }

  window.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' && !enabled) enable();
    if (!active || !enabled || e.pointerType === 'mouse' || stickId >= 0) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest('button, a, input, select, [role="dialog"]')) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (e.clientX > w * 0.5 || e.clientY < h * 0.2) return;
    stickId = e.pointerId;
    try { t?.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
    ox = clamp(e.clientX, STICK_R + 8, w - STICK_R - 8);
    oy = clamp(e.clientY, STICK_R + 8, h - STICK_R - 8);
    placeStick();
    stick.classList.add('is-held');
    moveStick(e.clientX, e.clientY);
  }, { passive: true });
  window.addEventListener('pointermove', e => { if (e.pointerId === stickId) moveStick(e.clientX, e.clientY); }, { passive: true });
  const stickUp = (e: PointerEvent) => { if (e.pointerId === stickId) endStick(); };
  window.addEventListener('pointerup', stickUp, { passive: true });
  window.addEventListener('pointercancel', stickUp, { passive: true });
  window.addEventListener('blur', () => releaseAll());
  window.addEventListener('resize', () => { if (stickId < 0 && enabled && active) restStick(); });

  // ---------------------------------------------------------------- botões
  function press(b: Btn): void {
    if (b.down) return;
    b.down = true;
    b.seen = 0;
    v[b.key] = true;
    b.el.classList.add('is-down');
  }
  function release(b: Btn): void {
    if (!b.down) return;
    b.down = false;
    b.el.classList.remove('is-down');
    // se a entrada ainda não leu este toque, `update` solta no próximo quadro
    if (b.seen >= 1) v[b.key] = false;
  }
  function releaseAll(): void {
    for (const b of btns) { b.ids.clear(); b.down = false; b.el.classList.remove('is-down'); v[b.key] = false; }
    if (stickId >= 0) endStick();
    v.move.x = 0; v.move.y = 0;
  }

  for (const b of btns) {
    b.el.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (e.pointerType === 'touch') enable();
      if (!active) return;
      try { b.el.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
      b.ids.add(e.pointerId);
      press(b);
    });
    const up = (e: PointerEvent) => { if (b.ids.delete(e.pointerId) && b.ids.size === 0) release(b); };
    b.el.addEventListener('pointerup', up);
    b.el.addEventListener('pointercancel', up);
    b.el.addEventListener('lostpointercapture', up);
    b.el.addEventListener('contextmenu', e => e.preventDefault());
  }

  try {
    if (window.matchMedia('(pointer: coarse)').matches) enabled = true;
  } catch { /* matchMedia indisponível */ }
  refresh();
  return api;
}

function clamp(x: number, a: number, b: number): number {
  return b < a ? (a + b) / 2 : Math.min(b, Math.max(a, x));
}
