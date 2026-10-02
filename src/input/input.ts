// Entrada unificada: teclado, mouse, gamepad (mapeamento padrão) e controles de toque
// (os botões virtuais escrevem em `virtual`). Direções saem em coordenadas de TELA
// (x para a direita, y para cima); o jogo converte para o chão do mundo.

export type Device = 'keyboard' | 'mouse' | 'gamepad' | 'touch';

export interface InputFrame {
  move: { x: number; y: number };
  aim: { x: number; y: number } | null;
  attack: boolean;
  dash: boolean;
  charge: boolean;
  /** Defesa mantida (o aperto abre a janela de parry). */
  guard: boolean;
  /** Golpe especial Kiai (borda). */
  special: boolean;
  /** Forma de leão / voltar a humano (borda). */
  transform: boolean;
  pause: boolean;
  mute: boolean;
  /** Confirmar em menus (Enter, clique, A/Start). */
  confirm: boolean;
  device: Device;
}

/** Estado escrito pelos controles de toque. */
export interface VirtualControls {
  move: { x: number; y: number };
  attack: boolean;
  dash: boolean;
  charge: boolean;
  guard: boolean;
  special: boolean;
  /** Botão da forma de leão (borda). */
  transform: boolean;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const ATTACK_KEYS = new Set(['KeyJ']);
const DASH_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight']);
const GUARD_KEYS = new Set(['KeyK', 'KeyI']);
const SPECIAL_KEYS = new Set(['KeyQ']);
const TRANSFORM_KEYS = new Set(['KeyR']);
const CHARGE_KEYS = new Set(['KeyL', 'KeyE']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);
const CONFIRM_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyJ']);

const DEADZONE = 0.22;

export class Input {
  readonly virtual: VirtualControls = { move: { x: 0, y: 0 }, attack: false, dash: false, charge: false, guard: false, special: false, transform: false };
  private held = new Set<string>();
  private attackEdge = false;
  private dashEdge = false;
  private specialEdge = false;
  private transformEdge = false;
  private pauseEdge = false;
  private muteEdge = false;
  private confirmEdge = false;
  private mouseGuard = false;
  private mouse: { x: number; y: number } | null = null;
  private aimOrigin = { x: 0, y: 0 };
  /** Mira do mouse vale enquanto o mouse foi o último a mirar/atacar. */
  private mouseAims = false;
  private device: Device = 'keyboard';
  private padPrev: boolean[] = [];
  private virtualPrev = { attack: false, dash: false, special: false, transform: false };
  private readonly off: (() => void)[] = [];

  constructor(target: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(el: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', e => {
      if (e.repeat) { if (MOVE_KEYS[e.code] || DASH_KEYS.has(e.code)) e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.held.add(e.code);
      this.device = 'keyboard';
      if (ATTACK_KEYS.has(e.code)) { this.attackEdge = true; this.mouseAims = false; }
      if (DASH_KEYS.has(e.code)) { this.dashEdge = true; }
      if (SPECIAL_KEYS.has(e.code)) this.specialEdge = true;
      if (TRANSFORM_KEYS.has(e.code)) this.transformEdge = true;
      if (CHARGE_KEYS.has(e.code) || GUARD_KEYS.has(e.code)) this.mouseAims = false;
      if (PAUSE_KEYS.has(e.code)) this.pauseEdge = true;
      if (e.code === 'KeyM') this.muteEdge = true;
      if (CONFIRM_KEYS.has(e.code)) this.confirmEdge = true;
      if (MOVE_KEYS[e.code] || DASH_KEYS.has(e.code)) e.preventDefault();
    });
    on(window, 'keyup', e => { this.held.delete(e.code); });
    on(window, 'blur', () => { this.held.clear(); this.mouseGuard = false; });
    on(target, 'pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      this.mouse = { x: e.clientX, y: e.clientY };
      this.mouseAims = true;
    });
    on(target, 'pointerdown', e => {
      if (e.pointerType !== 'mouse') return;
      this.mouse = { x: e.clientX, y: e.clientY };
      this.mouseAims = true;
      this.device = 'mouse';
      if (e.button === 0) { this.attackEdge = true; this.confirmEdge = true; }
      if (e.button === 2) this.mouseGuard = true;
    });
    on(window, 'pointerup', e => { if (e.pointerType === 'mouse' && e.button === 2) this.mouseGuard = false; });
    on(target, 'contextmenu', e => e.preventDefault());
  }

  /** Posição (px de CSS) do jogador na tela, origem da mira do mouse. */
  setAimOrigin(x: number, y: number): void { this.aimOrigin.x = x; this.aimOrigin.y = y; }

  get lastDevice(): Device { return this.device; }

  /** Lê o estado deste quadro e zera as bordas. */
  frame(): InputFrame {
    let mx = 0, my = 0;
    for (const code of this.held) { const m = MOVE_KEYS[code]; if (m) { mx += m[0]; my += m[1]; } }
    let attack = this.attackEdge, dash = this.dashEdge, special = this.specialEdge, transform = this.transformEdge, pause = this.pauseEdge, mute = this.muteEdge, confirm = this.confirmEdge;
    let charge = [...CHARGE_KEYS].some(k => this.held.has(k));
    let guard = this.mouseGuard || [...GUARD_KEYS].some(k => this.held.has(k));
    let aim: { x: number; y: number } | null = null;
    if (this.mouseAims && this.mouse) {
      const dx = this.mouse.x - this.aimOrigin.x, dy = -(this.mouse.y - this.aimOrigin.y);
      const l = Math.hypot(dx, dy);
      if (l > 12) aim = { x: dx / l, y: dy / l };
    }

    // gamepad
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = [...pads].find(p => p && p.connected) ?? null;
    if (pad) {
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const now = pad.buttons.map(x => x.pressed);
      const edge = (i: number) => b(i) && !this.padPrev[i];
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      let px = Math.abs(ax) > DEADZONE ? ax : 0, py = Math.abs(ay) > DEADZONE ? -ay : 0;
      if (b(12)) py = 1; if (b(13)) py = -1; if (b(14)) px = -1; if (b(15)) px = 1;
      const rx = pad.axes[2] ?? 0, ry = pad.axes[3] ?? 0;
      const used = px !== 0 || py !== 0 || now.some(Boolean) || Math.hypot(rx, ry) > 0.4;
      if (used) this.device = 'gamepad';
      if (px || py) { mx += px; my += py; }
      if (Math.hypot(rx, ry) > 0.4) { const l = Math.hypot(rx, ry); aim = { x: rx / l, y: -ry / l }; this.mouseAims = false; }
      if (edge(2) || edge(5)) { attack = true; this.mouseAims = false; }
      if (edge(0) || edge(4)) dash = true;
      if (edge(3)) special = true;
      // R3 (apertar o analógico direito): forma de leão
      if (edge(11)) transform = true;
      if (b(1) || b(6)) charge = true;
      if (b(7)) guard = true;
      if (edge(9)) pause = true;
      if (edge(8)) mute = true;
      if (edge(0) || edge(9)) confirm = true;
      this.padPrev = now;
    }

    // toque
    const v = this.virtual;
    if (v.move.x || v.move.y) { mx += v.move.x; my += v.move.y; this.device = 'touch'; }
    if (v.attack && !this.virtualPrev.attack) { attack = true; this.device = 'touch'; this.mouseAims = false; }
    if (v.dash && !this.virtualPrev.dash) { dash = true; this.device = 'touch'; }
    if (v.charge) charge = true;
    if (v.guard) { guard = true; this.device = 'touch'; }
    if (v.special && !this.virtualPrev.special) { special = true; this.device = 'touch'; }
    if (v.transform && !this.virtualPrev.transform) { transform = true; this.device = 'touch'; }
    this.virtualPrev = { attack: v.attack, dash: v.dash, special: v.special, transform: v.transform };

    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    this.attackEdge = this.dashEdge = this.specialEdge = this.transformEdge = this.pauseEdge = this.muteEdge = this.confirmEdge = false;
    return { move: { x: mx, y: my }, aim, attack, dash, charge, guard, special, transform, pause, mute, confirm, device: this.device };
  }

  dispose(): void { for (const f of this.off) f(); this.off.length = 0; }
}
