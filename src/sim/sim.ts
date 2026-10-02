// Simulação determinística do combate (sem three.js): jogador, horda, ondas e pontuação.
// Avança em passos fixos de SIM_DT; tudo que a apresentação precisa saber sai em `events`.
import {
  AI, ANIM, COMBO, DASH, ENEMIES, GUARD, IAIDO, KI, KIAI, LION, PARRY, PLAYER, SCORE, SIM_DT, WAVES,
  type EnemyKind,
} from '../config';
import {
  Rng, add, angleBetween, clamp, dist, distToSegment, dot, fromAngle, len, norm, scale, sub, v2,
  type Vec2,
} from '../core/math';
import type { Box, Circle, Enemy, Player, SimEvent, SimInput, SimOptions, WaveState } from './types';

const copy = (a: Vec2): Vec2 => ({ x: a.x, z: a.z });

function approach(vel: Vec2, target: Vec2, maxDelta: number): Vec2 {
  const dx = target.x - vel.x, dz = target.z - vel.z;
  const l = Math.hypot(dx, dz);
  if (l <= maxDelta || l < 1e-9) return copy(target);
  return { x: vel.x + (dx / l) * maxDelta, z: vel.z + (dz / l) * maxDelta };
}

/** Menor t >= 0 em que o raio o + d*t (d unitário) entra no círculo c (raio já inflado). */
function rayCircle(o: Vec2, d: Vec2, c: Circle, r: number): number {
  const fx = o.x - c.x, fz = o.z - c.z;
  const b = fx * d.x + fz * d.z;
  const cc = fx * fx + fz * fz - r * r;
  // já encostado/dentro (a colisão deixa exatamente na borda, cc ~ 0): bloqueia se o raio
  // avança para o centro; se sai, ignora (a colisão normal empurra para fora)
  if (cc <= 0) return b < 0 ? 0 : Infinity;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** Ponto do mundo -> espaço do retângulo (x ao longo de hw, z ao longo de hd). */
function toBox(b: Box, x: number, z: number): { lx: number; lz: number } {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
  return { lx: c * dx - s * dz, lz: s * dx + c * dz };
}
function fromBox(b: Box, lx: number, lz: number): Vec2 {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { x: b.x + c * lx + s * lz, z: b.z - s * lx + c * lz };
}

/** Como rayCircle, para o retângulo inflado por r (cantos retos: aproximação do disco arrastado). */
function rayBox(o: Vec2, d: Vec2, b: Box, r: number): number {
  const { lx, lz } = toBox(b, o.x, o.z);
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const dx = c * d.x - s * d.z, dz = s * d.x + c * d.z;
  const hw = b.hw + r, hd = b.hd + r;
  if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) return lx * dx + lz * dz < 0 ? 0 : Infinity;
  let t0 = 0, t1 = Infinity;
  const axes: [number, number, number][] = [[lx, dx, hw], [lz, dz, hd]];
  for (const [p, v, h] of axes) {
    if (Math.abs(v) < 1e-12) { if (Math.abs(p) > h) return Infinity; continue; }
    let a = (-h - p) / v, e = (h - p) / v;
    if (a > e) [a, e] = [e, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, e);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

export class Sim {
  readonly rng: Rng;
  readonly opts: SimOptions;
  time = 0;
  tick = 0;
  player: Player;
  enemies: Enemy[] = [];
  private events: SimEvent[] = [];

  wave = 0;
  waveState: WaveState = 'pre';
  waveTimer: number = WAVES.firstDelay;
  toSpawn: EnemyKind[] = [];
  spawnTimer = 0;

  score = 0;
  kills = 0;
  combo = 0;
  bestCombo = 0;
  comboTimer = 0;
  /** Congelamento curto no impacto (segundos restantes). */
  hitstop = 0;
  over = false;
  private nextId = 1;
  /** Espaçamento e fase dos passos (m) — casados com o ciclo lateral do personagem escolhido. */
  footstep = { length: ANIM.strideSide * ANIM.sideFrames, phase: ANIM.strideSide * ANIM.sideContact };
  /** O personagem em jogo tem a forma de leão (só o Ronin). Mutável: o título troca de personagem sem refazer a partida. */
  canTransform: boolean;
  /** Golpes que acabaram de acertar e ainda podem virar parry (tolerância a aperto atrasado). */
  private pendingHits: { id: number; damage: number; dir: Vec2; t: number }[] = [];
  /** Construções (retângulos); os círculos ficam em opts.colliders. */
  readonly boxes: readonly Box[];

  constructor(opts: SimOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    this.boxes = opts.boxes ?? [];
    this.canTransform = opts.transform ?? true;
    const start = opts.start ?? v2(0, 0);
    this.player = {
      pos: copy(start), prev: copy(start), vel: v2(), facing: v2(0, 1), radius: PLAYER.radius,
      hp: PLAYER.maxHp, ki: 0, state: 'idle', t: 0,
      comboStep: 0, comboWindow: 0, attackDir: v2(0, 1), hitIds: new Set(),
      dashDir: v2(0, 1), dashCd: 0, invuln: 0, attackBuf: 0, dashBuf: 0,
      chargeReady: false, iaidoFrom: v2(), iaidoTo: v2(), iaidoTargets: [], iaidoResolved: true,
      stride: 0, parryReady: false, sinceGuard: 99, sinceBlock: 99, parryTarget: -1, riposteDone: true,
      specialBuf: 0, kiaiDone: true,
      form: 'human', fury: 0, transformBuf: 0, burstDone: true, roarCd: 0, roarDone: true,
    };
  }

  /** Eventos acumulados desde a última chamada. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  get multiplier(): number { return SCORE.multiplier(this.combo); }
  get alive(): number { let n = 0; for (const e of this.enemies) if (e.state !== 'dying') n++; return n; }
  get remaining(): number { return this.toSpawn.length + this.alive; }
  get maxAttackers(): number { return WAVES.maxAttackers(Math.max(1, this.wave)); }

  step(input: SimInput): void {
    const dt = SIM_DT;
    const p = this.player;
    this.tick++;
    // entradas de borda ficam no buffer mesmo durante o congelamento
    if (input.attack) p.attackBuf = PLAYER.attackBuffer;
    if (input.dash) p.dashBuf = PLAYER.dashBuffer;
    if (input.special) p.specialBuf = PLAYER.attackBuffer;
    if (input.transform) p.transformBuf = LION.buffer;

    p.prev = copy(p.pos);
    for (const e of this.enemies) e.prev = copy(e.pos);

    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return;
    }
    this.time += dt;

    this.updatePlayer(input, dt);
    this.resolvePendingHits(dt);
    this.assignTokens();
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.enemies = this.enemies.filter(e => !(e.state === 'dying' && e.t >= AI.deathTime));
    this.resolveCollisions();
    if (!this.over) this.updateWaves(dt);

    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  // ------------------------------------------------------------------ jogador
  private updatePlayer(input: SimInput, dt: number): void {
    const p = this.player;
    /** Tempo no estado ao fim do passo anterior (instantes "cruzados" neste passo, sem erro de arredondamento). */
    const tPrev = p.t;
    p.t += dt;
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.roarCd = Math.max(0, p.roarCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.attackBuf = Math.max(0, p.attackBuf - dt);
    p.dashBuf = Math.max(0, p.dashBuf - dt);
    p.specialBuf = Math.max(0, p.specialBuf - dt);
    // no leão, R apertado no meio da garra/rugido espera a próxima brecha (é a única saída da forma)
    if (!(p.form === 'lion' && (p.state === 'claw' || p.state === 'roar'))) p.transformBuf = Math.max(0, p.transformBuf - dt);
    p.comboWindow = Math.max(0, p.comboWindow - dt);
    if (p.state !== 'guard') p.sinceGuard += dt;
    p.sinceBlock += dt;

    const moveLen = Math.min(1, len(input.move));
    const moveDir = moveLen > 0.08 ? norm(input.move) : null;

    // forma de leão: a barra vira o tempo que resta
    if (p.form === 'lion' && p.state !== 'transform' && p.state !== 'revert' && p.state !== 'dead') {
      p.fury = Math.max(0, p.fury - (LION.max / LION.duration) * dt);
    }
    const human = p.form === 'human';
    const canStart = () => this.canTransform && human && p.transformBuf > 0 && p.fury >= LION.max;

    switch (p.state) {
      case 'idle':
      case 'run': {
        if (!human) { this.updateLion(moveDir, moveLen, input, dt); break; }
        if (canStart()) { this.startTransform(); break; }
        if (p.specialBuf > 0 && p.ki >= KIAI.cost) { this.startKiai(); break; }
        if (p.dashBuf > 0 && p.dashCd <= 0) { this.startDash(moveDir ?? input.aim ?? p.facing); break; }
        if (p.attackBuf > 0) { this.startAttack(input, moveDir, p.comboWindow > 0 ? (p.comboStep + 1) % COMBO.length : 0); break; }
        if (input.guard) { this.startGuard(input, moveDir); break; }
        if (input.charge && p.ki >= IAIDO.cost) { this.startCharge(); break; }
        const target = moveDir ? scale(moveDir, PLAYER.speed * moveLen) : v2();
        p.vel = approach(p.vel, target, PLAYER.accel * dt);
        p.state = moveDir ? 'run' : 'idle';
        if (moveDir) p.facing = moveDir;
        else if (input.aim) p.facing = norm(input.aim);
        break;
      }
      case 'attack': {
        const def = COMBO[p.comboStep];
        const lungeT = 0.1;
        p.vel = p.t < lungeT ? scale(p.attackDir, def.lunge * (1 - p.t / lungeT)) : approach(p.vel, v2(), 60 * dt);
        if (p.t >= def.activeFrom && p.t <= def.activeTo) this.playerSwingHits(def.range, def.halfArc, def.damage, def.knock, p.comboStep === 2, def.hitstop);
        if (p.t >= def.cancelAt) {
          if (p.dashBuf > 0 && p.dashCd <= 0) { this.startDash(moveDir ?? p.attackDir); break; }
          if (p.attackBuf > 0 && p.comboStep < COMBO.length - 1) { this.startAttack(input, moveDir, p.comboStep + 1); break; }
          if (input.guard) { this.startGuard(input, moveDir); break; }
        }
        if (p.t >= def.dur) {
          p.state = 'idle';
          p.t = 0;
          p.comboWindow = p.comboStep < COMBO.length - 1 ? PLAYER.comboReset : 0;
        }
        break;
      }
      case 'dash': {
        p.vel = scale(p.dashDir, DASH.speed);
        if (p.t >= DASH.dur) { p.state = 'dashEnd'; p.t = 0; p.vel = scale(p.vel, 0.3); }
        break;
      }
      case 'dashEnd': {
        // aterrissagem: derrapa um pouco; corte e defesa já podem sair daqui
        p.vel = approach(p.vel, v2(), 40 * dt);
        if (canStart()) { this.startTransform(); break; }
        if (p.specialBuf > 0 && p.ki >= KIAI.cost) { this.startKiai(); break; }
        if (p.attackBuf > 0) { this.startAttack(input, moveDir, 0); break; }
        if (input.guard) { this.startGuard(input, moveDir); break; }
        if (p.t >= DASH.land) { p.state = 'idle'; p.t = 0; }
        break;
      }
      case 'guard': {
        if (canStart()) { this.startTransform(); break; }
        if (p.specialBuf > 0 && p.ki >= KIAI.cost) { this.startKiai(); break; }
        if (p.dashBuf > 0 && p.dashCd <= 0) { this.startDash(moveDir ?? p.facing); break; }
        if (p.attackBuf > 0) { this.startAttack(input, moveDir, 0); break; }
        // um toque rápido na defesa mantém a guarda até o fim da janela de parry
        if (!input.guard && p.t >= GUARD.parryWindow) { p.state = 'idle'; p.t = 0; break; }
        // pés plantados: o direcional não move na guarda (só o empurrão do bloqueio, que se esgota)
        p.vel = approach(p.vel, v2(), PLAYER.accel * dt);
        // a guarda acompanha a mira; sem mira, vira para quem está prestes a golpear
        if (input.aim) p.facing = norm(input.aim);
        else {
          const threat = this.nearestThreat(4);
          if (threat) p.facing = norm(sub(threat.pos, p.pos), p.facing);
        }
        break;
      }
      case 'parry': {
        p.vel = approach(p.vel, v2(), 40 * dt);
        if (!p.riposteDone && p.t >= PARRY.riposteAt) this.riposte();
        if (p.t >= PARRY.cancelAt) {
          if (p.dashBuf > 0 && p.dashCd <= 0) { this.startDash(moveDir ?? p.facing); break; }
          if (p.attackBuf > 0) { this.startAttack(input, moveDir, 1); break; }
          if (input.guard && p.t >= PARRY.dur - 0.05) { this.startGuard(input, moveDir); break; }
        }
        if (p.t >= PARRY.dur) { p.state = 'idle'; p.t = 0; }
        break;
      }
      case 'charge': {
        if (p.dashBuf > 0 && p.dashCd <= 0) { this.emit({ type: 'chargeCancel', pos: copy(p.pos) }); this.startDash(moveDir ?? p.facing); break; }
        if (!input.charge) {
          if (p.chargeReady && p.ki >= IAIDO.cost) this.startIaido(input.aim ?? moveDir ?? p.facing);
          else { this.emit({ type: 'chargeCancel', pos: copy(p.pos) }); p.state = 'idle'; p.t = 0; }
          break;
        }
        const target = moveDir ? scale(moveDir, PLAYER.speed * IAIDO.chargeMove * moveLen) : v2();
        p.vel = approach(p.vel, target, PLAYER.accel * dt);
        if (input.aim) p.facing = norm(input.aim);
        else if (moveDir) p.facing = moveDir;
        if (!p.chargeReady && p.t >= IAIDO.chargeTime) {
          p.chargeReady = true;
          this.emit({ type: 'chargeReady', pos: copy(p.pos) });
        }
        break;
      }
      case 'iaido': {
        // o passo em que t chega a dur fecha a investida exatamente em iaidoTo
        if (p.t < IAIDO.dur + dt * 0.5) {
          const k = Math.min(1, p.t / IAIDO.dur);
          const e = 1 - (1 - k) * (1 - k);
          const next = { x: p.iaidoFrom.x + (p.iaidoTo.x - p.iaidoFrom.x) * e, z: p.iaidoFrom.z + (p.iaidoTo.z - p.iaidoFrom.z) * e };
          p.vel = scale(sub(next, p.pos), 1 / dt);
        } else {
          p.vel = v2();
          if (!p.iaidoResolved && p.t >= IAIDO.dur + 0.1) this.resolveIaido();
          if (p.t >= IAIDO.dur + IAIDO.recover) { p.state = 'idle'; p.t = 0; }
        }
        break;
      }
      case 'kiai': {
        p.vel = approach(p.vel, v2(), 40 * dt);
        if (!p.kiaiDone && p.t >= KIAI.gather) this.kiaiBlast();
        if (p.t >= KIAI.dur) { p.state = 'idle'; p.t = 0; }
        break;
      }
      case 'transform': {
        p.vel = approach(p.vel, v2(), 40 * dt);
        if (!p.burstDone && p.t >= LION.burstAt) this.transformBurst();
        if (p.t >= LION.transformDur) {
          p.state = 'idle';
          p.t = 0;
          this.emit({ type: 'transformEnd', pos: copy(p.pos) });
        }
        break;
      }
      case 'revert': {
        p.vel = approach(p.vel, v2(), 40 * dt);
        if (p.t >= LION.revertDur) {
          p.form = 'human';
          p.radius = PLAYER.radius;
          p.state = 'idle';
          p.t = 0;
          // comandos que ficaram no buffer durante a forma não disparam sozinhos ao voltar
          p.specialBuf = 0;
          p.transformBuf = 0;
          this.emit({ type: 'revertEnd', pos: copy(p.pos) });
        }
        break;
      }
      case 'claw': {
        // garra do leão: avanço curto como o corte, leque largo e pesado na janela ativa
        const def = LION.claw;
        const lungeT = 0.1;
        p.vel = p.t < lungeT ? scale(p.attackDir, def.lunge * (1 - p.t / lungeT)) : approach(p.vel, v2(), 60 * dt);
        if (tPrev < def.activeFrom && p.t >= def.activeFrom) {
          this.emit({ type: 'lionClaw', pos: copy(p.pos), dir: copy(p.attackDir), range: def.range, halfArc: def.halfArc });
        }
        if (p.t >= def.activeFrom && p.t <= def.activeTo) this.playerSwingHits(def.range, def.halfArc, def.damage, def.knock, true, def.hitstop, false);
        if (p.t >= def.cancelAt) {
          // mesma prioridade do leão parado: R, fim da Fúria, garra, rugido (garras emendadas não seguram a forma)
          if (p.transformBuf > 0 || p.fury <= 0) { this.startRevert(p.transformBuf > 0 ? 'manual' : 'timeout'); break; }
          if (p.attackBuf > 0) { this.startClaw(input, moveDir); break; }
          if (input.charge && p.roarCd <= 0) { this.startRoarCharge(); break; }
        }
        if (p.t >= def.dur) { p.state = 'idle'; p.t = 0; }
        break;
      }
      case 'roarCharge': {
        // plantado, enchendo o peito: só gira com a mira/direcional
        p.vel = approach(p.vel, v2(), LION.accel * dt);
        if (input.aim) p.facing = norm(input.aim);
        else if (moveDir) p.facing = moveDir;
        if (p.fury <= 0) { this.emit({ type: 'lionRoarCancel', pos: copy(p.pos) }); this.startRevert('timeout'); break; }
        if (p.transformBuf > 0) { this.emit({ type: 'lionRoarCancel', pos: copy(p.pos) }); this.startRevert('manual'); break; }
        if (!input.charge) {
          if (p.chargeReady) this.startRoar(input, moveDir);
          else { this.emit({ type: 'lionRoarCancel', pos: copy(p.pos) }); p.state = 'idle'; p.t = 0; }
          break;
        }
        if (!p.chargeReady && p.t >= LION.roar.chargeTime) {
          p.chargeReady = true;
          this.emit({ type: 'lionRoarReady', pos: copy(p.pos) });
        }
        break;
      }
      case 'roar': {
        p.vel = approach(p.vel, v2(), LION.accel * dt);
        if (!p.roarDone && p.t >= LION.roar.blastAt) this.roarBlast();
        if (p.t >= LION.roar.dur) { p.state = 'idle'; p.t = 0; }
        break;
      }
      case 'hurt': {
        p.vel = approach(p.vel, v2(), 30 * dt);
        if (p.t >= PLAYER.hurtTime) { p.state = 'idle'; p.t = 0; }
        break;
      }
      case 'dead': {
        p.vel = approach(p.vel, v2(), 20 * dt);
        break;
      }
    }

    const speed = len(p.vel);
    p.pos = add(p.pos, scale(p.vel, dt));
    if (p.state === 'run') {
      // um passo por ciclo lateral, no quadro em que o pé pousa: o respingo coincide com o apoio
      const paw = p.form === 'lion';
      const fs = paw ? LION.footstep : this.footstep;
      const step = fs.length, phase = fs.phase;
      const before = Math.floor((p.stride - phase) / step);
      p.stride += speed * dt;
      if (Math.floor((p.stride - phase) / step) !== before) {
        this.emit(paw ? { type: 'footstep', pos: add(p.pos, scale(p.facing, 0.55)), paw } : { type: 'footstep', pos: add(p.pos, scale(p.facing, 0.3)) });
      }
    }
  }

  // ------------------------------------------------------------------ forma de leão
  /**
   * Leão parado/correndo: R volta a humano; corte vira garra; segurar o iaido carrega o rugido (fora da
   * recarga). Esquiva, defesa e Kiai ficam travados.
   */
  private updateLion(moveDir: Vec2 | null, moveLen: number, input: SimInput, dt: number): void {
    const p = this.player;
    // esquiva e Kiai não existem na forma: descarta o que estiver no buffer
    p.dashBuf = 0;
    p.specialBuf = 0;
    if (p.transformBuf > 0) { this.startRevert('manual'); return; }
    if (p.fury <= 0) { this.startRevert('timeout'); return; }
    if (p.attackBuf > 0) { this.startClaw(input, moveDir); return; }
    if (input.charge && p.roarCd <= 0) { this.startRoarCharge(); return; }
    const target = moveDir ? scale(moveDir, LION.speed * moveLen) : v2();
    p.vel = approach(p.vel, target, LION.accel * dt);
    p.state = moveDir ? 'run' : 'idle';
    if (moveDir) p.facing = moveDir;
    else if (input.aim) p.facing = norm(input.aim);
  }

  /** Garra do leão: mira como o corte (com ajuda de mira do alcance da garra); o golpe sai em LION.claw.activeFrom. */
  private startClaw(input: SimInput, moveDir: Vec2 | null): void {
    const p = this.player;
    const base = input.aim ? norm(input.aim) : moveDir ?? p.facing;
    const dir = this.aimAssist(base, LION.claw.range, LION.clawAssistCone);
    p.state = 'claw';
    p.t = 0;
    p.attackDir = dir;
    p.facing = dir;
    p.attackBuf = 0;
    p.hitIds.clear();
  }

  private startRoarCharge(): void {
    const p = this.player;
    p.state = 'roarCharge';
    p.t = 0;
    p.chargeReady = false;
    this.emit({ type: 'lionRoarCharge', pos: copy(p.pos) });
  }

  /** Soltou com a carga pronta: ruge. A recarga conta a partir do fim do rugido. */
  private startRoar(input: SimInput, moveDir: Vec2 | null): void {
    const p = this.player;
    p.state = 'roar';
    p.t = 0;
    p.roarDone = false;
    p.roarCd = LION.roar.dur + LION.roar.cooldown;
    p.facing = input.aim ? norm(input.aim, p.facing) : moveDir ?? p.facing;
  }

  /** Onda do rugido: fere, empurra para fora (mais forte perto) e atordoa todos no raio, em volta toda. */
  private roarBlast(): void {
    const p = this.player;
    const R = LION.roar;
    p.roarDone = true;
    let hits = 0, kills = 0;
    for (const e of this.enemies) {
      if (e.state === 'dying' || e.state === 'spawn') continue;
      const to = sub(e.pos, p.pos);
      const d = len(to);
      const reach = R.radius + e.def.radius;
      if (d > reach) continue;
      const k = 1 - Math.min(1, d / reach);
      const dir = norm(to, fromAngle(e.id));
      hits++;
      // acertos do leão não recarregam Ki nem Fúria (gainKi = false), mas contam pontos e combo
      if (this.damageEnemy(e, R.damage, dir, R.push * (0.4 + 0.6 * k), true, false)) { kills++; continue; }
      if (e.state === 'stagger') {
        // atordoamento um pouco mais longo perto do leão, como a onda da transformação
        e.t = -0.3 * k;
        e.tokenCd = Math.max(e.tokenCd, 0.8);
      }
    }
    this.hitstop = Math.max(this.hitstop, R.hitstop);
    this.emit({ type: 'lionRoar', pos: copy(p.pos), dir: copy(p.facing), radius: R.radius, hits, kills });
  }

  private startTransform(): void {
    const p = this.player;
    p.state = 'transform';
    p.t = 0;
    p.transformBuf = 0;
    p.attackBuf = 0;
    p.dashBuf = 0;
    p.specialBuf = 0;
    p.comboWindow = 0;
    p.burstDone = false;
    p.invuln = Math.max(p.invuln, LION.transformDur + LION.invulnAfter);
    this.emit({ type: 'transformStart', pos: copy(p.pos), dir: copy(p.facing) });
  }

  /** O leão completo surge rugindo: empurra e atordoa quem está em volta (sem matar). */
  private transformBurst(): void {
    const p = this.player;
    p.burstDone = true;
    p.form = 'lion';
    p.radius = LION.radius;
    p.fury = LION.max;
    let pushed = 0;
    for (const e of this.enemies) {
      if (e.state === 'dying') continue;
      const to = sub(e.pos, p.pos);
      const d = len(to);
      if (d > LION.burstRadius + e.def.radius) continue;
      const k = 1 - Math.min(1, d / (LION.burstRadius + e.def.radius));
      const dir = norm(to, fromAngle(e.id));
      e.state = 'stagger';
      e.t = -0.3 * k;
      e.token = false;
      e.tokenCd = Math.max(e.tokenCd, 0.8);
      e.vel = scale(dir, LION.burstPush * (0.4 + 0.6 * k) * (1 - e.def.knockResist));
      pushed++;
    }
    this.hitstop = Math.max(this.hitstop, LION.burstHitstop);
    this.emit({ type: 'transformBurst', pos: copy(p.pos), radius: LION.burstRadius, pushed });
  }

  private startRevert(reason: 'timeout' | 'manual'): void {
    const p = this.player;
    p.state = 'revert';
    p.t = 0;
    p.fury = 0;
    p.transformBuf = 0;
    p.invuln = Math.max(p.invuln, LION.revertDur + LION.invulnAfter);
    this.emit({ type: 'revertStart', pos: copy(p.pos), reason });
  }

  /** Soma Fúria (só humano, só o Ronin); avisa uma vez quando enche. */
  private addFury(amount: number): void {
    const p = this.player;
    if (!this.canTransform || p.form !== 'human' || p.state === 'transform' || amount <= 0) return;
    const was = p.fury;
    p.fury = Math.min(LION.max, p.fury + amount);
    if (was < LION.max && p.fury >= LION.max) this.emit({ type: 'furyReady', pos: copy(p.pos) });
  }

  private startDash(dir: Vec2): void {
    const p = this.player;
    p.state = 'dash';
    p.t = 0;
    p.dashDir = norm(dir, p.facing);
    p.facing = p.dashDir;
    p.dashCd = DASH.cooldown + DASH.dur;
    p.dashBuf = 0;
    p.attackBuf = 0;
    p.invuln = Math.max(p.invuln, DASH.invuln);
    p.comboWindow = 0;
    this.emit({ type: 'dash', pos: copy(p.pos), dir: copy(p.dashDir) });
  }

  private startAttack(input: SimInput, moveDir: Vec2 | null, step: number): void {
    const p = this.player;
    const base = input.aim ? norm(input.aim) : moveDir ?? p.facing;
    const dir = this.aimAssist(base);
    p.state = 'attack';
    p.t = 0;
    p.comboStep = step;
    p.attackDir = dir;
    p.facing = dir;
    p.attackBuf = 0;
    p.comboWindow = 0;
    p.hitIds.clear();
    const def = COMBO[step];
    this.emit({ type: 'playerSwing', step, pos: copy(p.pos), dir: copy(dir), range: def.range, halfArc: def.halfArc });
  }

  private startGuard(input: SimInput, moveDir: Vec2 | null): void {
    const p = this.player;
    p.state = 'guard';
    p.t = 0;
    // para na hora (a pose de guarda não tem passos: qualquer embalo viraria deslize)
    p.vel = v2();
    p.parryReady = p.sinceGuard >= GUARD.parryCooldown;
    p.sinceGuard = 0;
    p.attackBuf = 0;
    p.comboWindow = 0;
    const threat = this.nearestThreat(4);
    p.facing = input.aim ? norm(input.aim) : threat ? norm(sub(threat.pos, p.pos), p.facing) : this.aimAssist(moveDir ?? p.facing, 4, 70 * Math.PI / 180);
    this.emit({ type: 'guardStart', pos: copy(p.pos), parry: p.parryReady });
  }

  /** Inimigo mais próximo que está preparando ou desferindo um golpe. */
  private nearestThreat(range: number): Enemy | null {
    const p = this.player;
    let best: Enemy | null = null, bd = range;
    for (const e of this.enemies) {
      if (e.state !== 'windup' && e.state !== 'strike') continue;
      const d = dist(e.pos, p.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** Contra-ataque automático do parry no inimigo aparado. */
  private riposte(): void {
    const p = this.player;
    p.riposteDone = true;
    const e = this.enemies.find(x => x.id === p.parryTarget);
    if (!e || e.state === 'dying' || dist(e.pos, p.pos) > PARRY.riposteRange) return;
    const d = norm(sub(e.pos, p.pos), p.facing);
    p.facing = d;
    p.attackDir = d;
    p.vel = scale(d, 5);
    this.damageEnemy(e, PARRY.riposteDamage, d, 6, true);
    this.hitstop = Math.max(this.hitstop, 0.06);
  }

  private startKiai(): void {
    const p = this.player;
    p.state = 'kiai';
    p.t = 0;
    p.ki -= KIAI.cost;
    p.specialBuf = 0;
    p.attackBuf = 0;
    p.dashBuf = 0;
    p.comboWindow = 0;
    p.kiaiDone = false;
    p.invuln = Math.max(p.invuln, KIAI.dur + KIAI.invulnAfter);
    this.emit({ type: 'kiaiStart', pos: copy(p.pos) });
  }

  /** Explosão do Kiai: mata tudo no raio; quem está um pouco além é arremessado e atordoado. */
  private kiaiBlast(): void {
    const p = this.player;
    p.kiaiDone = true;
    let kills = 0;
    for (const e of this.enemies) {
      if (e.state === 'dying') continue;
      const to = sub(e.pos, p.pos);
      const d = len(to);
      const dir = norm(to, fromAngle(e.id));
      if (d <= KIAI.radius + e.def.radius) {
        this.damageEnemy(e, e.hp, dir, KIAI.push, true, false);
        kills++;
      } else if (d <= KIAI.pushRadius) {
        const k = 1 - (d - KIAI.radius) / (KIAI.pushRadius - KIAI.radius);
        e.state = 'stagger';
        e.t = -0.3 * k; // atordoamento um pouco mais longo que o normal perto da borda da explosão
        e.token = false;
        e.tokenCd = Math.max(e.tokenCd, 0.8);
        e.vel = scale(dir, KIAI.push * k * (1 - e.def.knockResist));
      }
    }
    this.hitstop = Math.max(this.hitstop, KIAI.hitstop);
    this.emit({ type: 'kiaiBlast', pos: copy(p.pos), radius: KIAI.radius, kills });
  }

  private startCharge(): void {
    const p = this.player;
    p.state = 'charge';
    p.t = 0;
    p.chargeReady = false;
    this.emit({ type: 'chargeStart', pos: copy(p.pos) });
  }

  private startIaido(dirIn: Vec2): void {
    const p = this.player;
    const dir = this.aimAssist(norm(dirIn, p.facing), IAIDO.distance, 35 * Math.PI / 180);
    let d = IAIDO.distance;
    for (const c of this.opts.colliders) d = Math.min(d, rayCircle(p.pos, dir, c, c.r + p.radius) - 0.05);
    for (const b of this.boxes) d = Math.min(d, rayBox(p.pos, dir, b, p.radius) - 0.05);
    // não sair da arena
    const lim = this.opts.arenaRadius - p.radius;
    const b = dot(p.pos, dir), cc = dot(p.pos, p.pos) - lim * lim;
    const tOut = -b + Math.sqrt(Math.max(0, b * b - cc));
    d = clamp(Math.min(d, tOut), 0, IAIDO.distance);

    p.ki -= IAIDO.cost;
    p.state = 'iaido';
    p.t = 0;
    p.vel = v2(); // parte exatamente de iaidoFrom
    p.facing = dir;
    p.attackDir = dir;
    p.iaidoFrom = copy(p.pos);
    p.iaidoTo = add(p.pos, scale(dir, d));
    p.invuln = Math.max(p.invuln, IAIDO.dur + IAIDO.recover + IAIDO.invulnAfter);
    p.iaidoResolved = false;
    p.iaidoTargets = [];
    for (const e of this.enemies) {
      if (e.state === 'dying' || e.state === 'spawn') continue;
      if (distToSegment(e.pos, p.iaidoFrom, p.iaidoTo) <= IAIDO.width / 2 + e.def.radius) p.iaidoTargets.push(e.id);
    }
    this.emit({ type: 'iaidoDash', from: copy(p.iaidoFrom), to: copy(p.iaidoTo), dir: copy(dir) });
  }

  private resolveIaido(): void {
    const p = this.player;
    p.iaidoResolved = true;
    let hits = 0, kills = 0;
    for (const id of p.iaidoTargets) {
      const e = this.enemies.find(x => x.id === id);
      if (!e || e.state === 'dying') continue;
      hits++;
      if (this.damageEnemy(e, IAIDO.damage, p.attackDir, 4, true)) kills++;
    }
    this.hitstop = Math.max(this.hitstop, hits > 0 ? IAIDO.hitstop : 0);
    this.emit({ type: 'iaidoCut', from: copy(p.iaidoFrom), to: copy(p.iaidoTo), dir: copy(p.attackDir), hits, kills });
  }

  /** Vira `dir` para o inimigo mais "óbvio" dentro do cone, se houver. */
  private aimAssist(dir: Vec2, range = PLAYER.aimAssistRange, cone = PLAYER.aimAssistCone): Vec2 {
    const p = this.player;
    let best: Vec2 | null = null, bestScore = Infinity;
    for (const e of this.enemies) {
      if (e.state === 'dying' || e.state === 'spawn') continue;
      const to = sub(e.pos, p.pos);
      const d = len(to);
      if (d > range || d < 1e-4) continue;
      const a = angleBetween(dir, scale(to, 1 / d));
      if (a > cone) continue;
      const s = a * 1.6 + d * 0.25;
      if (s < bestScore) { bestScore = s; best = scale(to, 1 / d); }
    }
    return best ?? dir;
  }

  /** Leque de `range` (+ raio do inimigo) à frente, em `attackDir`. `gainKi` = false na garra do leão. */
  private playerSwingHits(range: number, halfArc: number, damage: number, knock: number, heavy: boolean, hitstop: number, gainKi = true): void {
    const p = this.player;
    let any = false;
    for (const e of this.enemies) {
      if (e.state === 'dying' || e.state === 'spawn' || p.hitIds.has(e.id)) continue;
      const to = sub(e.pos, p.pos);
      const d = len(to);
      if (d > range + e.def.radius) continue;
      // de perto (encostado) qualquer ângulo frontal serve
      if (d > 0.6 && angleBetween(p.attackDir, scale(to, 1 / d)) > halfArc) continue;
      p.hitIds.add(e.id);
      this.damageEnemy(e, damage, norm(to, p.attackDir), knock, heavy, gainKi);
      any = true;
    }
    if (any) this.hitstop = Math.max(this.hitstop, hitstop);
  }

  /** Retorna true se matou. */
  /**
   * `gainKi` = false no Kiai (as mortes da explosão não recarregam a barra que ela acabou de gastar) e nos
   * golpes do leão (não enchem Ki nem Fúria; pontos, combo e cura por abate continuam).
   */
  private damageEnemy(e: Enemy, damage: number, dir: Vec2, knock: number, heavy: boolean, gainKi = true): boolean {
    const p = this.player;
    e.hp -= damage;
    e.flash = 0.12;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTimer = SCORE.comboTimeout;
    if (gainKi) { p.ki = Math.min(PLAYER.maxKi, p.ki + KI.perHit); this.addFury(LION.perHit); }
    const killed = e.hp <= 0;
    this.emit({ type: 'enemyHit', id: e.id, kind: e.kind, pos: copy(e.pos), dir: copy(dir), damage, heavy, killed });
    if (killed) {
      e.state = 'dying';
      e.t = 0;
      e.token = false;
      e.deathDir = copy(dir);
      e.vel = scale(dir, knock * 0.7);
      const gained = Math.round(e.def.score * this.multiplier);
      this.score += gained;
      this.kills++;
      if (gainKi) { p.ki = Math.min(PLAYER.maxKi, p.ki + KI.perKill * e.def.ki); this.addFury(LION.perKill * e.def.ki); }
      if (!this.over) p.hp = Math.min(PLAYER.maxHp, p.hp + PLAYER.healPerKill);
      this.emit({ type: 'enemyDeath', id: e.id, kind: e.kind, pos: copy(e.pos), dir: copy(dir), score: gained });
      return true;
    }
    const armored = (e.state === 'windup' || e.state === 'strike') && e.poiseLeft > 0 && !heavy;
    if (e.state === 'parried') {
      // aparado continua sem guarda até o fim do atordoamento
      e.vel = scale(dir, knock * 0.4 * (1 - e.def.knockResist));
    } else if (armored) {
      e.poiseLeft--;
    } else {
      e.state = 'stagger';
      e.t = 0;
      e.token = false;
      e.tokenCd = Math.max(e.tokenCd, 0.4);
      e.vel = scale(dir, knock * (1 - e.def.knockResist));
    }
    return false;
  }

  private damagePlayer(damage: number, dir: Vec2): void {
    const p = this.player;
    if (p.invuln > 0 || p.state === 'dead') return;
    const dmg = Math.round(damage);
    p.hp = Math.max(0, p.hp - dmg);
    this.combo = 0;
    this.comboTimer = 0;
    p.comboWindow = 0;
    if (p.state === 'charge') this.emit({ type: 'chargeCancel', pos: copy(p.pos) });
    if (p.state === 'guard') p.sinceGuard = 0;
    this.emit({ type: 'playerHurt', pos: copy(p.pos), dir: copy(dir), damage: dmg, hp: p.hp });
    if (p.hp <= 0) { this.killPlayer(dir); return; }
    if (p.form === 'lion') {
      // o leão não tem pose de ferido: sente o golpe (clarão e invulnerabilidade curta) e segue
      p.invuln = PLAYER.hurtInvuln;
      return;
    }
    this.addFury(LION.perHurt * dmg);
    p.state = 'hurt';
    p.t = 0;
    p.invuln = PLAYER.hurtInvuln;
    p.vel = scale(dir, PLAYER.hurtKnock);
  }

  private killPlayer(dir: Vec2): void {
    const p = this.player;
    if (p.state === 'roarCharge') this.emit({ type: 'lionRoarCancel', pos: copy(p.pos) });
    if (p.form === 'lion' || p.state === 'transform') {
      // não há leão caído: volta a humano na hora (a apresentação cobre a troca) e cai como samurai
      p.form = 'human';
      p.radius = PLAYER.radius;
      p.fury = 0;
      this.emit({ type: 'revertStart', pos: copy(p.pos), reason: 'death' });
    }
    p.state = 'dead';
    p.t = 0;
    p.vel = scale(dir, 4);
    this.over = true;
    for (const e of this.enemies) e.token = false;
    this.emit({ type: 'playerDeath', pos: copy(p.pos) });
  }

  /** Golpe inimigo que alcançou o jogador: aparado, bloqueado ou ferimento. */
  private strikePlayer(e: Enemy): void {
    const p = this.player;
    const toE = norm(sub(e.pos, p.pos), p.facing);
    if (p.state === 'guard' && angleBetween(p.facing, toE) <= GUARD.halfArc) {
      if (p.parryReady && p.t <= GUARD.parryWindow) { this.parry(e, toE); return; }
      const chip = Math.round(e.def.damage * (e.kind === 'brute' ? GUARD.chipBrute : GUARD.chip));
      p.hp = Math.max(0, p.hp - chip);
      p.vel = scale(toE, -GUARD.knock);
      p.sinceBlock = 0;
      this.emit({ type: 'block', id: e.id, pos: copy(p.pos), dir: copy(e.strikeDir), damage: chip, hp: p.hp });
      if (p.hp <= 0) this.killPlayer(e.strikeDir);
      return;
    }
    // não estava na guarda: o dano espera GUARD.lateGrace — um aperto de defesa nesse instante ainda apara
    this.pendingHits.push({ id: e.id, damage: e.def.damage, dir: copy(e.strikeDir), t: 0 });
  }

  private resolvePendingHits(dt: number): void {
    if (this.pendingHits.length === 0) return;
    const p = this.player;
    const keep: typeof this.pendingHits = [];
    for (const h of this.pendingHits) {
      h.t += dt;
      if (p.state === 'dead') continue;
      if (p.state === 'guard' && p.parryReady && p.t <= GUARD.parryWindow) {
        const e = this.enemies.find(x => x.id === h.id);
        if (e && e.state !== 'dying') {
          const toE = norm(sub(e.pos, p.pos), p.facing);
          if (angleBetween(p.facing, toE) <= GUARD.halfArc) { this.parry(e, toE); continue; }
        }
      }
      // um parry que acabou de acontecer (de outro golpe) protege com a invulnerabilidade dele
      if (p.state === 'parry') continue;
      if (h.t >= GUARD.lateGrace) { this.damagePlayer(h.damage, h.dir); continue; }
      keep.push(h);
    }
    this.pendingHits = keep;
  }

  private parry(e: Enemy, toE: Vec2): void {
    const p = this.player;
    e.state = 'parried';
    e.t = 0;
    e.token = false;
    e.tokenCd = Math.max(e.tokenCd, PARRY.stun + 0.5);
    e.vel = scale(toE, 3.5 * (1 - e.def.knockResist * 0.5));
    p.state = 'parry';
    p.t = 0;
    p.parryTarget = e.id;
    p.riposteDone = false;
    p.parryReady = false;
    p.facing = toE;
    p.attackDir = toE;
    p.invuln = Math.max(p.invuln, PARRY.invuln);
    p.ki = Math.min(PLAYER.maxKi, p.ki + PARRY.ki);
    this.addFury(LION.perParry);
    this.hitstop = Math.max(this.hitstop, PARRY.hitstop);
    this.emit({ type: 'parry', id: e.id, pos: copy(p.pos), dir: copy(toE), enemyPos: copy(e.pos) });
  }

  // ------------------------------------------------------------------ horda
  /** Só alguns inimigos atacam de cada vez; os demais cercam. Mais perto = prioridade. */
  private assignTokens(): void {
    if (this.over) return;
    const p = this.player;
    let holders = 0;
    for (const e of this.enemies) if (e.token) holders++;
    const free = this.maxAttackers - holders;
    if (free <= 0) return;
    const cands = this.enemies
      .filter(e => !e.token && e.tokenCd <= 0 && (e.state === 'chase' || e.state === 'circle') && dist(e.pos, p.pos) <= AI.engageRadius)
      .sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos));
    for (let i = 0; i < Math.min(free, cands.length); i++) cands[i].token = true;
  }

  private updateEnemy(e: Enemy, dt: number): void {
    const p = this.player;
    e.t += dt;
    e.flash = Math.max(0, e.flash - dt);
    e.tokenCd = Math.max(0, e.tokenCd - dt);
    const toP = sub(p.pos, e.pos);
    const d = len(toP);
    const dirP = norm(toP, e.facing);
    const def = e.def;

    switch (e.state) {
      case 'spawn': {
        e.vel = approach(e.vel, scale(dirP, def.speed * 0.5), AI.accel * dt);
        e.facing = dirP;
        if (e.t >= AI.spawnTime) { e.state = 'chase'; e.t = 0; }
        break;
      }
      case 'chase':
      case 'circle': {
        let desired = v2();
        /** Até onde a sonda de desvio olha: obstáculo depois do alvo não atrapalha. */
        let reachTo = d;
        if (this.over) {
          // jogador caiu: a horda para e observa
          e.facing = dirP;
        } else if (e.token) {
          e.state = 'chase';
          // prepara um pouco antes de encostar: o avanço do golpe cobre o resto da distância
          if (d <= def.reach * 0.8 + 0.3) {
            e.state = 'windup';
            e.t = 0;
            e.strikeDir = dirP;
            e.facing = dirP;
            e.poiseLeft = def.poise;
            this.emit({ type: 'enemyWindup', id: e.id, pos: copy(e.pos), dir: copy(dirP), duration: def.windup, reach: def.reach, halfArc: def.halfArc });
            break;
          }
          desired = scale(dirP, def.speed);
          e.facing = dirP;
        } else if (d <= AI.engageRadius) {
          // cercar: mantém um anel ao redor do jogador girando devagar
          e.state = 'circle';
          const ring = AI.ringRadius + e.ringOffset;
          const ang = Math.atan2(e.pos.z - p.pos.z, e.pos.x - p.pos.x) + e.orbitDir * AI.orbitSpeed;
          const target = add(p.pos, scale(fromAngle(ang), ring));
          const toT = sub(target, e.pos);
          const lt = len(toT);
          if (lt > 0.15) desired = scale(toT, Math.min(def.speed * 0.55, lt * 3) / lt);
          reachTo = lt;
          e.facing = dirP;
        } else {
          e.state = 'chase';
          desired = scale(dirP, def.speed);
          e.facing = dirP;
        }
        e.vel = approach(e.vel, this.avoid(e, desired, dt, reachTo), AI.accel * dt);
        break;
      }
      case 'windup': {
        e.vel = approach(e.vel, v2(), 30 * dt);
        if (e.t < def.windup * AI.trackUntil) { e.strikeDir = dirP; e.facing = dirP; }
        if (e.t >= def.windup) {
          e.state = 'strike';
          e.t = 0;
          e.strikeHit = false;
          this.emit({ type: 'enemySwing', id: e.id, pos: copy(e.pos), dir: copy(e.strikeDir), reach: def.reach, halfArc: def.halfArc });
        }
        break;
      }
      case 'strike': {
        const lungeT = 0.12;
        e.vel = e.t < lungeT ? scale(e.strikeDir, def.lunge * (1 - e.t / lungeT)) : approach(e.vel, v2(), 40 * dt);
        if (!e.strikeHit && e.t >= 0.04 && e.t <= 0.15 && !this.over && p.invuln <= 0) {
          if (d <= def.reach + p.radius && (d < 0.5 || angleBetween(e.strikeDir, dirP) <= def.halfArc)) {
            e.strikeHit = true;
            this.strikePlayer(e);
          }
        }
        if (e.t >= def.strike) { e.state = 'recover'; e.t = 0; }
        break;
      }
      case 'recover': {
        e.vel = approach(e.vel, v2(), 25 * dt);
        if (e.t >= def.recover) {
          e.state = 'chase';
          e.t = 0;
          e.token = false;
          e.tokenCd = this.rng.range(AI.tokenCooldown[0], AI.tokenCooldown[1]);
        }
        break;
      }
      case 'stagger': {
        e.vel = approach(e.vel, v2(), 22 * dt);
        if (e.t >= def.stagger) { e.state = 'chase'; e.t = 0; }
        break;
      }
      case 'parried': {
        e.vel = approach(e.vel, v2(), 14 * dt);
        e.facing = dirP;
        if (e.t >= PARRY.stun) { e.state = 'chase'; e.t = 0; }
        break;
      }
      case 'dying': {
        e.vel = approach(e.vel, v2(), 18 * dt);
        break;
      }
    }
    const speed = len(e.vel);
    e.pos = add(e.pos, scale(e.vel, dt));
    e.stride += speed * dt;
  }

  private resolveCollisions(): void {
    const p = this.player;
    const ghost = p.state === 'dash' || p.state === 'iaido' || p.state === 'dead';
    const solid = this.enemies.filter(e => e.state !== 'dying');
    for (let i = 0; i < solid.length; i++) {
      const a = solid[i];
      for (let j = i + 1; j < solid.length; j++) {
        const b = solid[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.def.radius + b.def.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const push = (min - d) / 2;
        const nx = d2 > 0 ? dx / d : 1, nz = d2 > 0 ? dz / d : 0;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
      }
      if (!ghost) {
        const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
        const min = a.def.radius + p.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 1e-3;
          const push = min - d;
          const nx = d2 > 0 ? dx / d : 1, nz = d2 > 0 ? dz / d : 0;
          a.pos.x += nx * push * 0.8; a.pos.z += nz * push * 0.8;
          p.pos.x -= nx * push * 0.2; p.pos.z -= nz * push * 0.2;
        }
      }
    }
    for (const e of this.enemies) this.confine(e.pos, e.def.radius);
    this.confine(p.pos, p.radius);
  }

  /**
   * Desvio de obstáculos: se a sonda à frente bate num colisor, o inimigo segue rente a ele pelo lado
   * mais curto e mantém esse lado até passar (senão, a cada passo, mirar de novo no jogador o puxa de
   * volta para o meio da parede e ele fica indo e voltando).
   */
  private avoid(e: Enemy, desired: Vec2, dt: number, reachTo: number): Vec2 {
    e.avoidT = Math.max(0, e.avoidT - dt);
    if (e.avoidT <= 0) e.avoidSide = 0;
    const sp = len(desired);
    if (sp < 1e-6 || (this.boxes.length === 0 && this.opts.colliders.length === 0)) return desired;
    const dir = scale(desired, 1 / sp);
    const r = e.def.radius + 0.05;
    let best = Math.min(AI.avoidLook, reachTo), n: Vec2 | null = null, side = 0;
    for (const c of this.opts.colliders) {
      const t = rayCircle(e.pos, dir, c, c.r + r);
      if (t >= best) continue;
      best = t;
      n = norm(sub(add(e.pos, scale(dir, t)), c), scale(dir, -1));
      // círculo: o lado para onde o jogador já está desviado do centro
      side = Math.sign(dot({ x: -n.z, z: n.x }, dir)) || e.orbitDir;
    }
    for (const b of this.boxes) {
      const t = rayBox(e.pos, dir, b, r);
      if (t >= best) continue;
      best = t;
      // face atingida: no espaço do retângulo, o eixo em que o ponto ficou na borda
      const h = add(e.pos, scale(dir, t));
      const { lx, lz } = toBox(b, h.x, h.z);
      const onX = Math.abs(lx) / (b.hw + r) >= Math.abs(lz) / (b.hd + r);
      const w = fromBox(b, onX ? Math.sign(lx) || 1 : 0, onX ? 0 : Math.sign(lz) || 1);
      n = { x: w.x - b.x, z: w.z - b.z };
      // retângulo: rumo à ponta mais próxima da face
      const along = onX ? lz : lx;
      const toEnd = fromBox(b, onX ? 0 : Math.sign(along) || e.orbitDir, onX ? Math.sign(along) || e.orbitDir : 0);
      side = Math.sign(dot({ x: -n.z, z: n.x }, { x: toEnd.x - b.x, z: toEnd.z - b.z })) || e.orbitDir;
    }
    if (!n || dot(dir, n) >= 0) return desired;
    if (e.avoidSide === 0) e.avoidSide = side;
    e.avoidT = AI.avoidHold;
    // rente à face, com um pouco para fora para não raspar
    const tan = scale({ x: -n.z, z: n.x }, e.avoidSide);
    return scale(norm(add(tan, scale(n, 0.15)), dir), sp);
  }

  /** Dentro de algum obstáculo inflado por `margin` (ou a menos de `margin` da borda da arena)? */
  blocked(q: Vec2, margin = 0): boolean {
    if (len(q) > this.opts.arenaRadius - margin) return true;
    for (const c of this.opts.colliders) if (dist(q, c) < c.r + margin) return true;
    for (const b of this.boxes) {
      const { lx, lz } = toBox(b, q.x, q.z);
      const ex = Math.max(0, Math.abs(lx) - b.hw), ez = Math.max(0, Math.abs(lz) - b.hd);
      if ((ex === 0 && ez === 0) || ex * ex + ez * ez < margin * margin) return true;
    }
    return false;
  }

  private confine(pos: Vec2, r: number): void {
    for (const b of this.boxes) {
      let { lx, lz } = toBox(b, pos.x, pos.z);
      const qx = clamp(lx, -b.hw, b.hw), qz = clamp(lz, -b.hd, b.hd);
      const ex = lx - qx, ez = lz - qz, e2 = ex * ex + ez * ez;
      if (e2 >= r * r) continue;
      if (e2 > 1e-12) {
        const e = Math.sqrt(e2);
        lx = qx + (ex / e) * r;
        lz = qz + (ez / e) * r;
      } else if (b.hw - Math.abs(lx) < b.hd - Math.abs(lz)) lx = (lx < 0 ? -1 : 1) * (b.hw + r); // centro dentro: sai pela face mais próxima
      else lz = (lz < 0 ? -1 : 1) * (b.hd + r);
      const w = fromBox(b, lx, lz);
      pos.x = w.x;
      pos.z = w.z;
    }
    for (const c of this.opts.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const min = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-3;
        pos.x = c.x + (d2 > 0 ? dx / d : 1) * min;
        pos.z = c.z + (d2 > 0 ? dz / d : 0) * min;
      }
    }
    const lim = this.opts.arenaRadius - r;
    const l = Math.hypot(pos.x, pos.z);
    if (l > lim) { pos.x *= lim / l; pos.z *= lim / l; }
  }

  // ------------------------------------------------------------------ ondas
  private updateWaves(dt: number): void {
    if (this.waveState === 'pre') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.startWave(this.wave + 1);
      return;
    }
    this.spawnTimer -= dt;
    const n = this.wave;
    if (this.spawnTimer <= 0 && this.toSpawn.length > 0) {
      const room = WAVES.maxAlive(n) - this.alive;
      if (room > 0) {
        const group = Math.min(this.rng.int(1, 3), room, this.toSpawn.length);
        const center = this.spawnPoint();
        for (let i = 0; i < group; i++) {
          const off = i === 0 ? v2() : scale(fromAngle(this.rng.range(0, Math.PI * 2)), this.rng.range(0.9, 1.6));
          this.spawnEnemy(this.toSpawn.pop()!, add(center, off));
        }
      }
      this.spawnTimer = WAVES.spawnEvery(n) * this.rng.range(0.7, 1.3);
    }
    if (this.toSpawn.length === 0 && this.alive === 0) {
      const heal = Math.min(PLAYER.healPerWave, PLAYER.maxHp - this.player.hp);
      this.player.hp += heal;
      this.emit({ type: 'waveClear', wave: n, heal });
      this.waveState = 'pre';
      this.waveTimer = WAVES.intermission;
    }
  }

  startWave(n: number): void {
    this.wave = n;
    this.waveState = 'active';
    this.spawnTimer = 0.2;
    const total = WAVES.size(n);
    const brutes = Math.min(WAVES.brutes(n), total);
    const swifts = Math.min(WAVES.swifts(n), total - brutes);
    const list: EnemyKind[] = [];
    for (let i = 0; i < brutes; i++) list.push('brute');
    for (let i = 0; i < swifts; i++) list.push('swift');
    while (list.length < total) list.push('ronin');
    // embaralha (Fisher-Yates); pop() tira do fim, então os 4 últimos viram ronins
    // para a onda sempre abrir com inimigos comuns
    for (let i = list.length - 1; i > 0; i--) { const j = this.rng.int(0, i); [list[i], list[j]] = [list[j], list[i]]; }
    for (let i = list.length - 1; i >= Math.max(0, list.length - 4); i--) {
      if (list[i] === 'ronin') continue;
      const j = list.findIndex((k, idx) => k === 'ronin' && idx < list.length - 4);
      if (j >= 0) [list[i], list[j]] = [list[j], list[i]];
    }
    this.toSpawn = list;
    this.emit({ type: 'waveStart', wave: n, total });
  }

  /** Ponto no anel de surgimento, dentro da arena e longe do jogador. */
  spawnPoint(): Vec2 {
    const p = this.player;
    const lim = this.opts.arenaRadius - 1.2;
    const free = (q: Vec2) => len(q) <= lim && !this.blocked(q, AI.spawnClearance);
    for (let i = 0; i < 12; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const q = add(p.pos, scale(fromAngle(a), this.opts.spawnRadius));
      if (free(q)) return q;
    }
    // jogador encostado na borda: surge do lado oposto da arena
    const away = norm(scale(p.pos, -1), v2(1, 0));
    const far = scale(away, lim);
    if (free(far)) return far;
    // construção no caminho: o ponto livre mais longe do jogador entre alguns sorteados na arena
    let best = far, bd = -1;
    for (let i = 0; i < 24; i++) {
      const q = scale(fromAngle(this.rng.range(0, Math.PI * 2)), lim * Math.sqrt(this.rng.next()));
      const d = dist(q, p.pos);
      if (free(q) && d > bd) { bd = d; best = q; }
    }
    return best;
  }

  spawnEnemy(kind: EnemyKind, pos: Vec2): Enemy {
    const n = Math.max(1, this.wave);
    const base = ENEMIES[kind];
    const def = {
      ...base,
      speed: base.speed * WAVES.speedMul(n) * this.rng.range(0.94, 1.06),
      windup: base.windup * WAVES.windupMul(n),
      damage: base.damage * WAVES.damageMul(n),
    };
    const toP = norm(sub(this.player.pos, pos));
    const e: Enemy = {
      id: this.nextId++, kind, def, pos: copy(pos), prev: copy(pos), vel: v2(), facing: toP,
      hp: def.hp, state: 'spawn', t: 0, token: false, tokenCd: this.rng.range(0.2, 1.0),
      strikeDir: toP, strikeHit: false, poiseLeft: def.poise,
      orbitDir: this.rng.sign(), ringOffset: this.rng.range(0, AI.ringJitter), avoidSide: 0, avoidT: 0,
      flash: 0, stride: this.rng.range(0, 2), deathDir: toP,
    };
    this.confine(e.pos, def.radius);
    e.prev = copy(e.pos);
    this.enemies.push(e);
    this.emit({ type: 'spawn', id: e.id, kind, pos: copy(e.pos) });
    return e;
  }

  private emit(e: SimEvent): void { this.events.push(e); }
}
