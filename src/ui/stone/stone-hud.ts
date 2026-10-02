// HUD de pedra e tinta (adaptado da referência "HUD em pedra e tinta"): lajes rachadas para Vida, Ki e Fúria,
// barra de comandos com ícones de giz, anel de recarga, avisos (toast) e o clarão do golpe recebido.
// Só mostra: o estado vem de `StoneView` (view.ts) e a entrada é a do jogo (nada de teclado próprio).
// O DOM só é tocado quando um valor exibido muda (roda a 60 quadros por segundo).
import './stone-hud.css';
import { BAR_W, SLAB_THICK, SLAB_THIN, chalkLine, chalkMask, grainPattern, markerPath, ring, slab } from './art';
import { iconSymbols, iconSvg, type IconId } from './icons';
import { COMMAND_IDS, type CommandId, type CommandView, type FuryState, type StoneView } from './view';

export interface StoneHud {
  /** Bloco de vitais (vai na área "vitals" da grade do HUD). */
  readonly vitals: HTMLElement;
  /** Barra de comandos (embaixo, no centro; escondida no toque). */
  readonly commands: HTMLElement;
  render(v: StoneView): void;
  /** Aviso curto no centro de baixo; o mesmo texto não repete antes de NOTIFY_GAP. */
  notify(text: string): void;
  /** Ação indisponível: mostra o motivo e sacode o comando. */
  deny(id: CommandId, reason: string): void;
  /** Golpe recebido: clarão nas lajes e a vida tremendo. */
  hurt(): void;
  /** Destaque curto num comando (ficou pronto). */
  pop(id: CommandId): void;
  /** Nova partida: esquece o que foi escrito e apaga o aviso. */
  reset(): void;
}

const NOTIFY_MS = 2100;
const NOTIFY_GAP = 1200;
type MeterId = 'hp' | 'ki' | 'fury';
const SLABS: Record<MeterId, { h: number; seed: number }> = {
  hp: { h: SLAB_THICK, seed: 21 },
  ki: { h: SLAB_THIN, seed: 47 },
  fury: { h: SLAB_THIN, seed: 83 },
};

/** <defs> compartilhado: grão, giz, ícones e as três lajes com textura (rachaduras e brilho). */
function defsSvg(): string {
  const slabs = (Object.keys(SLABS) as MeterId[]).map(id => {
    const { h, seed } = SLABS[id];
    const s = slab(h, seed);
    return `<path id="sh-slab-${id}" d="${s.d}"/>`
      + `<clipPath id="sh-slabclip-${id}"><use href="#sh-slab-${id}"/></clipPath>`
      + `<g id="sh-tex-${id}" clip-path="url(#sh-slabclip-${id})"><rect width="${BAR_W}" height="${h}" fill="url(#sh-grain)"/>`
      + `<g fill="none" stroke="#141414" stroke-linejoin="round" opacity=".78"><path d="${s.cracks}" stroke-width="${h > 15 ? 1.1 : 0.8}"/><path d="${s.thin}" stroke-width=".55"/></g>`
      + `<path d="${s.shine}" fill="none" stroke="#fff" stroke-width=".6" opacity=".18"/></g>`;
  }).join('');
  return `<svg class="sh-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${grainPattern('sh-grain')}${chalkMask('sh-chalk')}${iconSymbols()}${slabs}</defs></svg>`;
}

function barSvg(id: MeterId, label: string, max: number, notch?: number): string {
  const h = SLABS[id].h;
  // folga só para o marcador, que passa um pouco da laje
  const top = Math.ceil(h * 0.18) + 1, bot = Math.ceil(h * 1.18) + 1;
  const vb = `-4 ${-top} ${BAR_W + 8} ${top + bot}`;
  const clipBox = `x="0" y="${-top - 2}" width="${BAR_W}" height="${top + bot + 4}"`;
  const notchPath = notch === undefined ? ''
    : `<path class="sh-notch" d="M${BAR_W * notch - 0.8} ${-3} L${BAR_W * notch + 1} ${-4} L${BAR_W * notch + 0.8} ${h + 3} L${BAR_W * notch - 1} ${h + 4}Z" mask="url(#sh-chalk)"/>`;
  return `<svg class="sh-bar" viewBox="${vb}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="0" focusable="false">`
    + `<defs><clipPath id="sh-cf-${id}"><rect class="sh-fill" ${clipBox}/></clipPath><clipPath id="sh-ct-${id}"><rect class="sh-trail" ${clipBox}/></clipPath></defs>`
    + `<use href="#sh-slab-${id}" class="sh-s-base"/><use href="#sh-tex-${id}" opacity=".5"/>`
    + `<g clip-path="url(#sh-ct-${id})"><use href="#sh-slab-${id}" class="sh-s-trail"/></g>`
    + `<g clip-path="url(#sh-cf-${id})"><use href="#sh-slab-${id}" class="sh-s-fill"/><use href="#sh-tex-${id}"/></g>`
    + notchPath
    + `<g class="sh-marker"><path d="${markerPath(h)}" mask="url(#sh-chalk)"/></g>`
    + `</svg>`;
}

function commandHtml(id: CommandId, seed: number): string {
  const seal = id === 'transform'
    ? `<path class="sh-seal" d="${ring(32, 32, 30.5, 27.5, seed + 1, 1.4)}" fill-rule="evenodd" mask="url(#sh-chalk)"/><path class="sh-seal2" d="${ring(32, 32, 25.5, 24.4, seed + 2, 0.9)}" fill-rule="evenodd" mask="url(#sh-chalk)"/>`
    : '';
  return `<div class="sh-cmd" data-cmd="${id}">`
    + `<svg class="sh-cmd-art" viewBox="0 0 64 64" aria-hidden="true" focusable="false">`
    + `<path class="sh-halo" d="${ring(32, 32, 31.5, 29.6, seed, 1.6)}" fill-rule="evenodd" mask="url(#sh-chalk)"/>${seal}`
    + `<circle class="sh-cd" cx="32" cy="32" r="28" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 32 32)"/>`
    + `<svg class="sh-cmd-ico" x="12" y="12" width="40" height="40" viewBox="0 0 64 64"><use href="#sh-move"/></svg>`
    + `</svg><b class="sh-cd-num"></b><span class="sh-cmd-lbl"></span><span class="sh-cmd-key"></span></div>`;
}

const VITALS = `
  <div class="sh-head"><span class="sh-name" data-sh="name">RONIN</span><span class="sh-form" data-sh="form">Forma humana</span></div>
  <svg class="sh-rule" viewBox="0 0 400 8" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${chalkLine(0, 400, 4, 5)}" mask="url(#sh-chalk)"/></svg>
  <div class="sh-meter sh-m-hp" data-sh="hp">
    <div class="sh-row"><span class="sh-lbl">Vida</span><span class="sh-warn">Vida crítica</span><span class="sh-val"><b data-sh="hpNum">100</b><i> / <span data-sh="hpMax">100</span></i></span></div>
    ${barSvg('hp', 'Vida', 100)}
  </div>
  <div class="sh-meter sh-m-ki" data-sh="ki">
    <div class="sh-row"><span class="sh-lbl">Ki</span><span class="sh-val"><b data-sh="kiNum">0</b><i> / <span data-sh="kiMax">100</span></i></span></div>
    ${barSvg('ki', 'Ki', 100, 0.4)}
  </div>
  <div class="sh-meter sh-m-fury" data-sh="fury" data-state="fill">
    <div class="sh-row"><span class="sh-lbl">Fúria</span><span class="sh-val"><b data-sh="furyText">0%</b></span></div>
    ${barSvg('fury', 'Fúria', 100)}
    <div class="sh-row sh-cap"><span>Espírito do leão</span><span class="sh-status" data-sh="furyStatus">Acumulando</span></div>
  </div>
  <i class="sh-flash" data-sh="flash"></i>`;

interface Meter {
  box: HTMLElement;
  bar: SVGSVGElement;
  fill: SVGRectElement;
  trail: SVGRectElement;
  marker: SVGGElement;
  value: number;
  max: number;
}
interface Cmd {
  el: HTMLElement;
  use: SVGUseElement;
  label: HTMLElement;
  key: HTMLElement;
  num: HTMLElement;
  cd: SVGCircleElement;
  // valores escritos (para só tocar no DOM quando mudam)
  c: { label: string; icon: IconId | ''; key: string; pressed: number; enabled: number; ready: number; release: number; cool: number; cdText: string; hidden: number };
}

export function createStoneHud(host: HTMLElement): StoneHud {
  host.insertAdjacentHTML('afterbegin', defsSvg());

  const vitals = document.createElement('div');
  vitals.className = 'sh-vitals';
  vitals.innerHTML = VITALS;
  const commands = document.createElement('div');
  commands.className = 'sh-cmds';
  commands.setAttribute('aria-hidden', 'true');
  commands.innerHTML = COMMAND_IDS.map((id, i) => commandHtml(id, 101 + i * 7)).join('');
  const toast = document.createElement('div');
  toast.className = 'sh-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-atomic', 'true');
  host.append(commands, toast);

  const $ = <T extends Element = HTMLElement>(n: string): T => vitals.querySelector<T>(`[data-sh="${n}"]`) as T;
  const meter = (box: HTMLElement): Meter => {
    const bar = box.querySelector<SVGSVGElement>('.sh-bar')!;
    return {
      box, bar, value: NaN, max: NaN,
      fill: bar.querySelector<SVGRectElement>('.sh-fill')!,
      trail: bar.querySelector<SVGRectElement>('.sh-trail')!,
      marker: bar.querySelector<SVGGElement>('.sh-marker')!,
    };
  };
  const hp = meter($('hp')), ki = meter($('ki')), fury = meter($('fury'));
  const nameEl = $('name'), formEl = $('form'), flash = $('flash');
  const hpNum = $('hpNum'), hpMax = $('hpMax'), kiNum = $('kiNum'), kiMax = $('kiMax');
  const furyText = $('furyText'), furyStatus = $('furyStatus');

  const cmds = new Map<CommandId, Cmd>();
  for (const el of commands.querySelectorAll<HTMLElement>('.sh-cmd')) {
    cmds.set(el.dataset.cmd as CommandId, {
      el,
      use: el.querySelector<SVGUseElement>('.sh-cmd-ico use')!,
      label: el.querySelector<HTMLElement>('.sh-cmd-lbl')!,
      key: el.querySelector<HTMLElement>('.sh-cmd-key')!,
      num: el.querySelector<HTMLElement>('.sh-cd-num')!,
      cd: el.querySelector<SVGCircleElement>('.sh-cd')!,
      c: blankCache(),
    });
  }

  // estados do bloco (cache)
  let cName = '', cForm = '', cLow = -1, cKiLocked = -1, cKiReady = -1, cFuryShow = -1, cFuryState: FuryState | '' = '', cFuryLow = -1;
  let cFuryText = '', cFuryStatus = '', cHp = NaN, cHpMax = NaN, cKi = NaN, cKiMax = NaN;
  let toastTimer = 0, lastText = '', lastAt = -Infinity;

  function setMeter(m: Meter, value: number, max: number): void {
    if (value === m.value && max === m.max) return;
    const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    m.value = value;
    m.max = max;
    m.fill.style.transform = `scaleX(${f})`;
    m.trail.style.transform = `scaleX(${f})`;
    m.marker.style.transform = `translateX(${(BAR_W * f).toFixed(1)}px)`;
    m.marker.style.opacity = f > 0 ? '1' : '0';
    m.bar.setAttribute('aria-valuemax', String(max));
    m.bar.setAttribute('aria-valuenow', String(value));
    m.bar.setAttribute('aria-valuetext', `${value} de ${max}`);
  }

  function renderCommand(cm: Cmd, v: CommandView): void {
    const c = cm.c, el = cm.el;
    if (+v.hidden !== c.hidden) { c.hidden = +v.hidden; el.hidden = v.hidden; }
    if (v.hidden) return;
    if (v.label !== c.label) { c.label = v.label; cm.label.textContent = v.label; }
    if (v.icon !== c.icon) { c.icon = v.icon; cm.use.setAttribute('href', `#${v.icon}`); }
    if (v.key !== c.key) { c.key = v.key; cm.key.textContent = v.key; }
    if (+v.pressed !== c.pressed) { c.pressed = +v.pressed; el.classList.toggle('is-pressed', v.pressed); }
    if (+v.enabled !== c.enabled) { c.enabled = +v.enabled; el.classList.toggle('is-off', !v.enabled); }
    if (+v.ready !== c.ready) {
      const first = c.ready === -1;
      c.ready = +v.ready;
      el.classList.toggle('is-ready', v.ready);
      // ficou pronto durante a partida (não na primeira escrita): destaque curto
      if (v.ready && !first) popEl(el);
    }
    if (+v.release !== c.release) { c.release = +v.release; el.classList.toggle('is-release', v.release); }
    // anel de recarga: 100 passos bastam (só escreve quando o passo muda)
    const cool = v.cooldown > 0 ? Math.max(1, Math.round(v.cooldown * 100)) : 0;
    if (cool !== c.cool) {
      if ((cool > 0) !== (c.cool > 0)) el.classList.toggle('is-cool', cool > 0);
      c.cool = cool;
      cm.cd.style.strokeDashoffset = String(100 - cool);
    }
    if (v.cooldownText !== c.cdText) { c.cdText = v.cooldownText; cm.num.textContent = v.cooldownText; }
  }

  function popEl(el: HTMLElement): void {
    if (typeof el.animate !== 'function' || reduceMotion()) return;
    el.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
  }

  const hud: StoneHud = {
    vitals,
    commands,

    render(v) {
      if (v.name !== cName) { cName = v.name; nameEl.textContent = v.name; }
      if (v.form !== cForm) { cForm = v.form; formEl.textContent = v.form; }
      setMeter(hp, v.hp, v.maxHp);
      if (v.hp !== cHp) { cHp = v.hp; hpNum.textContent = String(v.hp); }
      if (v.maxHp !== cHpMax) { cHpMax = v.maxHp; hpMax.textContent = String(v.maxHp); }
      if (+v.low !== cLow) { cLow = +v.low; hp.box.classList.toggle('is-low', v.low); }
      setMeter(ki, v.ki, v.maxKi);
      if (v.ki !== cKi) { cKi = v.ki; kiNum.textContent = String(v.ki); }
      if (v.maxKi !== cKiMax) { cKiMax = v.maxKi; kiMax.textContent = String(v.maxKi); }
      if (+v.kiLocked !== cKiLocked) { cKiLocked = +v.kiLocked; ki.box.classList.toggle('is-locked', v.kiLocked); }
      if (+v.kiReady !== cKiReady) { cKiReady = +v.kiReady; ki.box.classList.toggle('is-ready', v.kiReady); }

      const f = v.fury;
      if (+f.show !== cFuryShow) { cFuryShow = +f.show; fury.box.hidden = !f.show; }
      if (f.show) {
        setMeter(fury, f.value, f.max);
        if (f.state !== cFuryState) { cFuryState = f.state; fury.box.dataset.state = f.state; }
        if (+f.low !== cFuryLow) { cFuryLow = +f.low; fury.box.classList.toggle('is-low', f.low); }
        if (f.text !== cFuryText) { cFuryText = f.text; furyText.textContent = f.text; }
        if (f.status !== cFuryStatus) { cFuryStatus = f.status; furyStatus.textContent = f.status; }
      }
      for (const c of v.commands) renderCommand(cmds.get(c.id)!, c);
    },

    notify(text) {
      const now = performance.now();
      if (text === lastText && now - lastAt < NOTIFY_GAP && toast.classList.contains('is-on')) return;
      lastText = text;
      lastAt = now;
      toast.textContent = text;
      toast.classList.add('is-on');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('is-on'), NOTIFY_MS);
    },

    deny(id, reason) {
      if (reason) hud.notify(reason);
      const el = cmds.get(id)?.el;
      if (!el || typeof el.animate !== 'function') return;
      el.animate(reduceMotion()
        ? [{ opacity: 0.4 }, { opacity: 1 }]
        : [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
      { duration: 260, easing: 'ease-out' });
    },

    hurt() {
      flash.classList.remove('is-on');
      void flash.offsetWidth; // recomeça a animação
      flash.classList.add('is-on');
      if (typeof hp.box.animate !== 'function' || reduceMotion()) return;
      hp.box.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 280, easing: 'ease-out' });
    },

    pop(id) {
      const el = cmds.get(id)?.el;
      if (el) popEl(el);
    },

    reset() {
      cName = cForm = cFuryText = cFuryStatus = '';
      cLow = cKiLocked = cKiReady = cFuryShow = cFuryLow = -1;
      cFuryState = '';
      cHp = cHpMax = cKi = cKiMax = NaN;
      for (const m of [hp, ki, fury]) { m.value = NaN; m.max = NaN; }
      for (const cm of cmds.values()) cm.c = blankCache();
      clearTimeout(toastTimer);
      toast.classList.remove('is-on');
      lastText = '';
    },
  };
  hud.reset();
  return hud;
}

function blankCache(): Cmd['c'] {
  return { label: '', icon: '', key: '', pressed: -1, enabled: -1, ready: -1, release: -1, cool: -1, cdText: '', hidden: -1 };
}

function reduceMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Ícone de giz para outros pontos da interface (botões de toque). */
export { iconSvg };
