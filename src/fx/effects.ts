// Efeitos de combate: arcos de corte, aviso de ataque inimigo, tinta (sangue em nanquim),
// manchas no chão, brilhos, poeira/respingos e o retorno de tela (tremor, clarão, negativo).
// Tudo em pools fixos e lotes instanciados (5 draw calls no total); formas em pixel art.
import type * as THREE from 'three';
import { AI, IAIDO, type EnemyKind, KIAI, LION } from '../config';
import { Rng } from '../core/math';
import type { Sim } from '../sim/sim';
import type { Enemy, SimEvent } from '../sim/types';
import { GroundBatch, SlashBatch } from './arcs';
import { CAM_RIGHT, SCREEN_UP_Y } from './common';
import { Decals } from './decals';
import { LineBatch } from './lines';
import { PF, Particles, SHAPE } from './particles';

/** Retorno visual que o jogo aplica na câmera e no pós-processamento (decai sozinho). */
export interface Feedback {
  /** Tremor de câmera, 0..~1.5. */
  shake: number;
  /** Clarão branco em tela cheia, 0..1. */
  flash: number;
  /** Negativo da imagem, 0..1 (momento do iaido). */
  invert: number;
}

/** Estilo do golpe especial: fogo espiritual (Ronin) ou tempestade de pétalas (Tomoe). */
export type SpecialStyle = 'kiai' | 'sakura';

export interface Effects {
  readonly feedback: Feedback;
  handle(ev: SimEvent, sim: Sim): void;
  update(dt: number, time: number, sim: Sim): void;
  /** Troca o visual do golpe especial conforme o personagem escolhido. */
  setStyle(style: SpecialStyle): void;
  /** Remove tudo (reinício de partida). */
  clear(): void;
}

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

interface SwingFx {
  /** `t` < 0: ainda esperando para começar (escalonamento). */
  on: boolean; t: number; dur: number;
  /** -1 = herói; senão o id do inimigo que o arco acompanha. */
  owner: number;
  x: number; y: number; z: number; yaw: number;
  radius: number; halfArc: number; width: number; tilt: number;
  gray: number; inner: number; sign: number; echo: boolean;
  /** Raio inicial em fração de `radius` (1 = fixo): o arco é lançado para fora (garra do leão). */
  grow: number;
}

interface WarnFx { on: boolean; id: number; radius: number; halfArc: number }

interface LineFx {
  on: boolean; t: number; delay: number; inT: number; hold: number; outT: number;
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  width: number; gray: number;
  /** Rastro do iaido: a ponta acompanha o avanço do herói. */
  path: boolean;
  /** Reforço temporário da largura (corte do iaido). */
  boost: number;
}

interface RingFx {
  /** `t` < 0: ainda esperando para começar. */
  on: boolean; t: number; dur: number;
  x: number; y: number; z: number; r0: number; r1: number;
  gray: number; thick: number;
  /** Acompanha o herói. */
  follow: boolean;
  /** > 0: chega a `r1` inteiro e fica parado esse tempo enquanto some (marca o alcance de verdade). */
  hold: number;
}

/** Onda do rugido varrendo o chão: levanta poeira por onde a frente passa e pinta a pressão logo atrás. */
interface RoarWave {
  on: boolean; t: number; dur: number;
  x: number; z: number; r0: number; r1: number;
  /** Fração de partícula acumulada. */
  acc: number;
}

/** Tamanho (m) da mancha de morte por tipo. */
const DEATH_STAIN: Record<EnemyKind, number> = { ronin: 1.85, brute: 2.35, swift: 1.6 };

/** Instantes (s) da transformação em que um anel se fecha sobre o Ronin (batidas antes do leão surgir). */
const AURA_PULSES = [0.6, 1.05];

/** Garra do leão: distância (m) entre as três unhas, atraso (s) de uma para a outra e duração de cada arco. */
const CLAW_GAP = 0.42, CLAW_STAGGER = 0.028, CLAW_DUR = 0.24;
/** Rugido: tempo da frente da onda até o raio inteiro e quanto o anel fica parado lá. */
const ROAR_FRONT = 0.3, ROAR_HOLD = 0.22;

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const easeIn = (k: number) => k * k;
const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);

function pool<T>(n: number, make: () => T): T[] {
  const a: T[] = [];
  for (let i = 0; i < n; i++) a.push(make());
  return a;
}

/** Primeiro livre do pool; cheio, recicla em rodízio. */
function take<T extends { on: boolean }>(list: T[], cursor: { i: number }): T {
  for (const it of list) if (!it.on) return it;
  cursor.i = (cursor.i + 1) % list.length;
  return list[cursor.i];
}

function findEnemy(sim: Sim, id: number): Enemy | null {
  const list = sim.enemies;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

export function createEffects(scene: THREE.Scene): Effects {
  const feedback: Feedback = { shake: 0, flash: 0, invert: 0 };
  const rng = new Rng(0x9e3779b9);
  const decals = new Decals(scene);
  const ground = new GroundBatch(scene);
  const slashes = new SlashBatch(scene);
  const particles = new Particles(scene);
  const lines = new LineBatch(scene);

  const swings = pool<SwingFx>(40, () => ({
    on: false, t: 0, dur: 0, owner: -1, x: 0, y: 0, z: 0, yaw: 0, radius: 1, halfArc: 1, width: 0.3, tilt: 0,
    gray: 1, inner: 0.8, sign: 1, echo: false, grow: 1,
  }));
  const warns = pool<WarnFx>(24, () => ({ on: false, id: 0, radius: 1, halfArc: 1 }));
  const lineFx = pool<LineFx>(72, () => ({
    on: false, t: 0, delay: 0, inT: 0.05, hold: 0, outT: 0.1, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,
    width: 2, gray: 1, path: false, boost: 0,
  }));
  const rings = pool<RingFx>(48, () => ({
    on: false, t: 0, dur: 0.3, x: 0, y: 0, z: 0, r0: 0, r1: 1, gray: 1, thick: 1, follow: false, hold: 0,
  }));
  const wave: RoarWave = { on: false, t: 0, dur: ROAR_FRONT, x: 0, z: 0, r0: 0, r1: 1, acc: 0 };
  const cur = { swing: { i: 0 }, warn: { i: 0 }, line: { i: 0 }, ring: { i: 0 } };

  let invertT = 0;
  let pendingFlash = 0;
  let style: SpecialStyle = 'kiai';
  let petalAcc = 0;
  let chargeAcc = 0;
  /** Aura da transformação em leão: fração de partícula acumulada e batidas de anel já disparadas. */
  let auraAcc = 0;
  let auraPulses = 0;
  /** Cortes do iaido já desenhados nesta resolução (escalonamento). */
  let iaidoCuts = 0;
  /** Carga do rugido do leão: fração de partícula acumulada. */
  let roarAcc = 0;

  // pingos de tinta que tocam o chão viram pintas
  particles.onLand = (x, z, size) => {
    if (rng.next() < 0.45) decals.add('small', x, z, rng.range(0, Math.PI * 2), 0.26 + size * 0.09, rng.range(16, 26));
  };

  const shake = (v: number) => { feedback.shake = Math.max(feedback.shake, v); };

  // ---------------------------------------------------------------- construtores de efeito

  function line(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    width: number, gray: number, delay: number, inT: number, hold: number, outT: number,
  ): LineFx {
    const l = take(lineFx, cur.line);
    l.on = true; l.t = 0; l.delay = delay; l.inT = inT; l.hold = hold; l.outT = outT;
    l.ax = ax; l.ay = ay; l.az = az; l.bx = bx; l.by = by; l.bz = bz;
    l.width = width; l.gray = gray; l.path = false; l.boost = 0;
    return l;
  }

  /** Corte reto na tela passando por (x, y, z): ângulo em relação à horizontal da tela. */
  function cut(x: number, y: number, z: number, screenAngle: number, halfLen: number, width: number, delay: number, hold = 0.05): void {
    const cx = Math.cos(screenAngle) * halfLen, cy = Math.sin(screenAngle) * halfLen * SCREEN_UP_Y;
    line(
      x - CAM_RIGHT.x * cx, y - cy, z - CAM_RIGHT.z * cx,
      x + CAM_RIGHT.x * cx, y + cy, z + CAM_RIGHT.z * cx,
      width, 1, delay, 0.035, hold, 0.11,
    );
  }

  function ring(
    x: number, y: number, z: number, r0: number, r1: number, dur: number, gray: number, thick: number,
    follow = false, delay = 0, hold = 0,
  ): void {
    const r = take(rings, cur.ring);
    r.on = true; r.t = -delay; r.dur = dur; r.x = x; r.y = y; r.z = z; r.r0 = r0; r.r1 = r1;
    r.gray = gray; r.thick = thick; r.follow = follow; r.hold = hold;
  }

  /** Três riscos paralelos (unhas) cruzando (x, y, z) na tela, em sequência rápida. */
  function rake(x: number, y: number, z: number, screenAngle: number, halfLen: number, width: number, delay: number): void {
    const nx = -Math.sin(screenAngle), ny = Math.cos(screenAngle);
    for (let i = -1; i <= 1; i++) {
      const o = i * 0.17;
      cut(
        x + CAM_RIGHT.x * nx * o, y + ny * o * SCREEN_UP_Y, z + CAM_RIGHT.z * nx * o,
        screenAngle, halfLen * (i === 0 ? 1 : 0.84), width, delay + (i + 1) * 0.016, 0.06,
      );
    }
  }

  /** Gotas de tinta em leque (`spread` rad em volta de `dir`) que caem e mancham o chão. */
  function ink(
    x: number, y: number, z: number, dx: number, dz: number, count: number, spread: number,
    speed0: number, speed1: number, up0: number, up1: number, size0: number, size1: number, gray: number,
  ): void {
    const base = Math.atan2(dz, dx);
    for (let i = 0; i < count; i++) {
      const a = base + rng.range(-spread, spread);
      const sp = rng.range(speed0, speed1);
      const t = particles.reset();
      t.x = x + rng.range(-0.12, 0.12); t.y = y + rng.range(-0.18, 0.18); t.z = z + rng.range(-0.12, 0.12);
      t.vx = Math.cos(a) * sp; t.vz = Math.sin(a) * sp; t.vy = rng.range(up0, up1);
      t.grav = -17; t.drag = 0.5; t.life = 2.5;
      t.size0 = t.size1 = rng.int(size0, size1);
      t.shape = t.size0 >= 3 ? SHAPE.disc : SHAPE.square;
      t.gray = gray; t.flags = PF.land;
      particles.emit();
    }
  }

  /** Nuvem de tinta: discos pretos que incham e encolhem. */
  function inkPuff(x: number, y: number, z: number, dx: number, dz: number, count: number, s0: number, s1: number, gray: number): void {
    for (let i = 0; i < count; i++) {
      const t = particles.reset();
      t.x = x + rng.range(-0.15, 0.15); t.y = y + rng.range(-0.2, 0.25); t.z = z + rng.range(-0.15, 0.15);
      const sp = rng.range(0.6, 1.8);
      t.vx = dx * sp + rng.range(-0.4, 0.4); t.vz = dz * sp + rng.range(-0.4, 0.4); t.vy = rng.range(0.3, 1.2);
      t.drag = 5; t.life = rng.range(0.16, 0.26);
      t.size0 = s0; t.size1 = s1 * rng.range(0.8, 1.2);
      t.shape = SHAPE.disc; t.gray = gray; t.flags = PF.swell;
      particles.emit();
    }
  }

  /**
   * Pétalas de cerejeira: discos claros e florzinhas (estrela) que se espalham a partir de (x, z)
   * e caem devagar. Ficam no ar depois da explosão para as flores do golpe serem vistas.
   */
  function petals(x: number, z: number, count: number, r0: number, r1: number, speed: number, life: number): void {
    for (let i = 0; i < count; i++) {
      const t = particles.reset();
      const a = rng.range(0, Math.PI * 2), r = rng.range(r0, r1), sp = rng.range(speed * 0.4, speed);
      t.x = x + Math.cos(a) * r; t.z = z + Math.sin(a) * r; t.y = rng.range(0.3, 2.4);
      t.vx = Math.cos(a) * sp; t.vz = Math.sin(a) * sp; t.vy = rng.range(0.6, 2.6);
      t.grav = -1.1; t.drag = 1.5; t.life = rng.range(life * 0.6, life); t.fadeAt = 0.72;
      const flower = rng.next() < 0.3;
      t.shape = flower ? SHAPE.star : SHAPE.disc;
      t.size0 = t.size1 = flower ? rng.int(3, 4) : rng.int(2, 3);
      t.gray = rng.range(0.9, 1);
      particles.emit();
    }
  }

  /** Faísca branca: estrela que pisca e some + estilhaços. */
  function spark(x: number, y: number, z: number, size: number, bits: number): void {
    let t = particles.reset();
    t.x = x; t.y = y; t.z = z; t.life = 0.1; t.size0 = size; t.size1 = 1; t.shape = SHAPE.star; t.gray = 1;
    particles.emit();
    for (let i = 0; i < bits; i++) {
      t = particles.reset();
      const a = rng.range(0, Math.PI * 2), sp = rng.range(3, 6);
      t.x = x; t.y = y; t.z = z;
      t.vx = Math.cos(a) * sp; t.vz = Math.sin(a) * sp; t.vy = rng.range(-1, 3);
      t.drag = 9; t.life = rng.range(0.08, 0.14); t.gray = 1;
      particles.emit();
    }
  }

  /** Terra/lama chutada + um pouco de névoa baixa. */
  function dust(x: number, z: number, dx: number, dz: number, mud: number, mist: number, strength: number): void {
    const back = Math.atan2(-dz, -dx);
    for (let i = 0; i < mud; i++) {
      const t = particles.reset();
      const a = back + rng.range(-0.9, 0.9), sp = rng.range(1, 3.2) * strength;
      t.x = x + rng.range(-0.15, 0.15); t.y = 0.05; t.z = z + rng.range(-0.15, 0.15);
      t.vx = Math.cos(a) * sp; t.vz = Math.sin(a) * sp; t.vy = rng.range(0.8, 2.4) * strength;
      t.grav = -14; t.drag = 1; t.life = rng.range(0.35, 0.55); t.fadeAt = 0.7;
      t.size0 = t.size1 = rng.int(1, 2); t.gray = rng.range(0.24, 0.4);
      particles.emit();
    }
    for (let i = 0; i < mist; i++) {
      const t = particles.reset();
      const a = back + rng.range(-0.7, 0.7), sp = rng.range(0.4, 1.3) * strength;
      t.x = x + rng.range(-0.25, 0.25); t.y = rng.range(0.08, 0.3); t.z = z + rng.range(-0.25, 0.25);
      t.vx = Math.cos(a) * sp; t.vz = Math.sin(a) * sp; t.vy = rng.range(0.15, 0.5);
      t.drag = 2.5; t.life = rng.range(0.35, 0.5); t.flags = PF.swell;
      t.size0 = 2; t.size1 = rng.range(7, 11); t.shape = SHAPE.disc; t.gray = rng.range(0.66, 0.76);
      particles.emit();
    }
  }

  // ---------------------------------------------------------------- reações aos eventos

  function onPlayerSwing(ev: Ev<'playerSwing'>): void {
    // os quadros do sprite já trazem o rastro da lâmina: aqui só um eco fino no chão marcando o alcance
    const heavy = ev.step === 2;
    const s = take(swings, cur.swing);
    s.on = true; s.t = 0; s.owner = -1;
    s.x = ev.pos.x; s.y = 0.05; s.z = ev.pos.z; s.yaw = Math.atan2(ev.dir.z, ev.dir.x);
    s.dur = heavy ? 0.14 : 0.1;
    s.radius = ev.range * 0.9;
    s.halfArc = ev.halfArc * 0.9;
    s.width = heavy ? 0.2 : 0.14;
    s.tilt = 0;
    s.sign = ev.step === 1 ? -1 : 1;
    s.gray = 0.66; s.inner = 0.5; s.echo = false; s.grow = 1;
    if (heavy) dust(ev.pos.x, ev.pos.z, ev.dir.x, ev.dir.z, 5, 2, 0.8);
  }

  function onWindup(ev: Ev<'enemyWindup'>, sim: Sim): void {
    let w: WarnFx | null = null;
    for (const it of warns) if (it.on && it.id === ev.id) { w = it; break; }
    if (!w) w = take(warns, cur.warn);
    const e = findEnemy(sim, ev.id);
    // o inimigo avança no golpe: o setor mostra onde o corpo do herói (sombra) é atingido
    const lunge = e ? e.def.lunge * 0.06 : 0.35;
    w.on = true; w.id = ev.id; w.radius = ev.reach + lunge; w.halfArc = ev.halfArc;
  }

  function onEnemySwing(ev: Ev<'enemySwing'>): void {
    const s = take(swings, cur.swing);
    s.on = true; s.t = 0; s.owner = ev.id;
    s.x = ev.pos.x; s.y = 0.05; s.z = ev.pos.z; s.yaw = Math.atan2(ev.dir.z, ev.dir.x);
    s.dur = 0.12; s.radius = ev.reach * 0.8; s.halfArc = ev.halfArc * 0.9;
    s.width = 0.12; s.tilt = 0; s.sign = rng.sign();
    s.gray = 0.58; s.inner = 0.5; s.echo = false; s.grow = 1;
  }

  function onEnemyHit(ev: Ev<'enemyHit'>, sim: Sim): void {
    const { x, z } = ev.pos;
    const heavy = ev.heavy;
    const st = sim.player.state;
    if (st === 'kiai' || st === 'roar') {
      // explosão do especial / onda do rugido: só a tinta; riscos e faíscas brancas tapariam o desenho do golpe
      ink(x, 0.95, z, ev.dir.x, ev.dir.z, 8, 0.85, 1.6, 4, 1.2, 3.4, 1, 3, 0.03);
      // o rugido empurra: lama chutada para fora
      if (st === 'roar') dust(x, z, -ev.dir.x, -ev.dir.z, 4, 1, 0.9);
      return;
    }
    if (st === 'claw') {
      // garra: três unhas descendo na diagonal, do lado de onde a pata vem
      const sx = ev.dir.x * CAM_RIGHT.x + ev.dir.z * CAM_RIGHT.z;
      rake(x, 0.95, z, (sx >= 0 ? -1 : 1) * rng.range(0.75, 1.0), 0.8, 2, 0);
    } else if (st === 'iaido') {
      // corte horizontal do iaido em cada alvo, em sequência rápida
      cut(x, 0.95, z, 0, 1.05, 3, iaidoCuts * 0.03, 0.1);
      cut(x, 0.62, z, 0, 0.6, 1, iaidoCuts * 0.03 + 0.02, 0.08);
      iaidoCuts++;
    } else {
      const a = rng.sign() * rng.range(0.3, 0.7);
      cut(x, 0.9, z, a, heavy ? 0.95 : 0.7, heavy ? 3 : 2, 0);
      if (heavy) cut(x, 0.9, z, -a * rng.range(0.7, 1.2), 0.8, 2, 0.03);
    }
    spark(x - ev.dir.x * 0.25, 0.95, z - ev.dir.z * 0.25, heavy ? 13 : 9, heavy ? 5 : 3);
    ink(x, 0.95, z, ev.dir.x, ev.dir.z, heavy ? 16 : 9, 0.85, 1.6, heavy ? 5 : 4, 1.2, 3.4, 1, heavy ? 4 : 3, 0.03);
    inkPuff(x, 0.9, z, ev.dir.x, ev.dir.z, heavy ? 4 : 2, 2, 8, 0.03);
    if (heavy && !ev.killed) decals.add('medium', x + ev.dir.x * 0.45, z + ev.dir.z * 0.45, Math.atan2(ev.dir.z, ev.dir.x), 0.95, 24, 0.2);
    shake(heavy ? 0.42 : 0.3);
  }

  function onEnemyDeath(ev: Ev<'enemyDeath'>): void {
    const { x, z } = ev.pos;
    const dx = ev.dir.x, dz = ev.dir.z;
    ink(x, 0.9, z, dx, dz, 22, 1.2, 1.8, 5, 1.8, 4.2, 2, 4, 0.02);
    ink(x, 0.7, z, dx, dz, 8, Math.PI, 0.8, 2.5, 1, 2.6, 1, 2, 0.02);
    inkPuff(x, 0.75, z, dx, dz, 5, 3, 13, 0.02);
    decals.add('big', x + dx * 0.55, z + dz * 0.55, Math.atan2(dz, dx), DEATH_STAIN[ev.kind] * rng.range(0.9, 1.1), 25, 0.35);
    shake(0.5);
  }

  function onPlayerHurt(ev: Ev<'playerHurt'>): void {
    const { x, z } = ev.pos;
    // corte escuro com borda clara: lê tanto no herói (quase preto) quanto no chão
    const a = rng.sign() * rng.range(0.4, 0.8);
    const cx = Math.cos(a) * 0.55, cy = Math.sin(a) * 0.55 * SCREEN_UP_Y;
    const ax = x - CAM_RIGHT.x * cx, az = z - CAM_RIGHT.z * cx, bx = x + CAM_RIGHT.x * cx, bz = z + CAM_RIGHT.z * cx;
    line(ax, 0.95 - cy, az, bx, 0.95 + cy, bz, 5, 0.95, 0, 0.04, 0.1, 0.14);
    line(ax, 0.95 - cy, az, bx, 0.95 + cy, bz, 2.5, 0.02, 0, 0.04, 0.1, 0.14);
    ink(x, 1.0, z, ev.dir.x, ev.dir.z, 10, 0.9, 1.5, 3.8, 1, 3, 2, 3, 0.08);
    ink(x, 0.9, z, ev.dir.x, ev.dir.z, 8, Math.PI, 0.8, 2.2, 1.5, 3, 1, 2, 0.08);
    inkPuff(x, 0.95, z, ev.dir.x, ev.dir.z, 3, 2, 10, 0.06);
    decals.add('medium', x + ev.dir.x * 0.4, z + ev.dir.z * 0.4, Math.atan2(ev.dir.z, ev.dir.x), 0.85, 20, 0.2);
    shake(0.95);
  }

  function onPlayerDeath(ev: Ev<'playerDeath'>, sim: Sim): void {
    const { x, z } = ev.pos;
    const f = sim.player.facing;
    ink(x, 0.9, z, -f.x, -f.z, 22, Math.PI, 1, 4, 1.5, 4, 1, 4, 0.05);
    inkPuff(x, 0.8, z, 0, 0, 5, 3, 14, 0.04);
    decals.add('big', x, z, rng.range(0, Math.PI * 2), 2.4, 60, 0.6);
    shake(1.2);
  }

  function onChargeReady(ev: Ev<'chargeReady'>): void {
    ring(ev.pos.x, 0.03, ev.pos.z, 0.3, 1.7, 0.3, 1, 2, true);
    const t = particles.reset();
    t.x = ev.pos.x; t.y = 0.95; t.z = ev.pos.z; t.life = 0.22; t.size0 = 19; t.size1 = 3; t.shape = SHAPE.star; t.gray = 1;
    particles.emit();
  }

  function onIaidoDash(ev: Ev<'iaidoDash'>): void {
    particles.killFlag(PF.charge);
    iaidoCuts = 0;
    const l = line(ev.from.x, 0.85, ev.from.z, ev.to.x, 0.85, ev.to.z, 2, 1, 0, IAIDO.dur, 0.5, 0.16);
    l.path = true;
    // riscos de vento paralelos ao caminho, surgindo conforme o herói passa
    const dx = ev.to.x - ev.from.x, dz = ev.to.z - ev.from.z;
    const nx = -ev.dir.z, nz = ev.dir.x;
    for (let i = 0; i < 8; i++) {
      const u0 = rng.range(0, 0.7), u1 = Math.min(1, u0 + rng.range(0.15, 0.4));
      const off = rng.sign() * rng.range(0.25, 0.7), y = rng.range(0.25, 1.55);
      line(
        ev.from.x + dx * u0 + nx * off, y, ev.from.z + dz * u0 + nz * off,
        ev.from.x + dx * u1 + nx * off, y, ev.from.z + dz * u1 + nz * off,
        1, rng.range(0.82, 1), easeOut(u0) * IAIDO.dur * 0.8, 0.05, rng.range(0.03, 0.12), 0.12,
      );
    }
    dust(ev.from.x, ev.from.z, ev.dir.x, ev.dir.z, 10, 4, 1.3);
  }

  function onIaidoCut(ev: Ev<'iaidoCut'>): void {
    // o rastro fica mais um instante e se recolhe
    for (const l of lineFx) {
      if (!l.on || !l.path) continue;
      l.hold = Math.min(l.hold, Math.max(0, l.t - l.delay - l.inT) + 0.1);
      l.boost = ev.hits > 0 ? 1 : 0.25;
    }
    if (ev.hits > 0) {
      invertT = 0.1;
      pendingFlash = 0.5;
      shake(1.15);
    }
  }

  function onSpawn(ev: Ev<'spawn'>): void {
    const { x, z } = ev.pos;
    for (let i = 0; i < 5; i++) {
      const t = particles.reset();
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.1, 0.55);
      t.x = x + Math.cos(a) * r; t.y = rng.range(0.1, 0.9); t.z = z + Math.sin(a) * r;
      t.vx = Math.cos(a) * 0.35; t.vz = Math.sin(a) * 0.35; t.vy = rng.range(0.3, 0.7);
      t.drag = 1.2; t.life = rng.range(0.6, 0.9); t.flags = PF.swell;
      t.size0 = 2; t.size1 = rng.range(10, 15); t.shape = SHAPE.disc; t.gray = rng.range(0.7, 0.78);
      particles.emit();
    }
    ring(x, 0.03, z, 0.2, 1.1, 0.45, 0.78, 1);
  }

  function onFootstep(ev: Ev<'footstep'>): void {
    const { x, z } = ev.pos;
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const t = particles.reset();
      const a = rng.range(0, Math.PI * 2), sp = rng.range(0.3, 0.9);
      t.x = x + rng.range(-0.1, 0.1); t.y = 0.04; t.z = z + rng.range(-0.1, 0.1);
      t.vx = Math.cos(a) * sp; t.vz = Math.sin(a) * sp; t.vy = rng.range(1, 1.8);
      t.grav = -12; t.life = 0.3;
      const water = rng.next() < 0.6;
      t.shape = water ? SHAPE.vline : SHAPE.square;
      t.size0 = t.size1 = water ? 2 : 1;
      t.gray = water ? 0.82 : 0.3;
      particles.emit();
    }
    ring(x, 0.03, z, 0.06, 0.34, 0.32, 0.8, 1);
  }

  function onWaveClear(sim: Sim): void {
    // sopro de vento com cinzas e folhas secas
    const p = sim.player.pos;
    for (let i = 0; i < 36; i++) {
      const t = particles.reset();
      const a = rng.range(0, Math.PI * 2), r = rng.range(1, 7.5);
      t.x = p.x + Math.cos(a) * r - CAM_RIGHT.x * 2.5; t.y = rng.range(0.2, 2.2); t.z = p.z + Math.sin(a) * r - CAM_RIGHT.z * 2.5;
      const sp = rng.range(2, 3.6);
      t.vx = CAM_RIGHT.x * sp + rng.range(-0.4, 0.4); t.vz = CAM_RIGHT.z * sp + rng.range(-0.4, 0.4); t.vy = rng.range(-0.2, 0.5);
      t.grav = -0.3; t.life = rng.range(1.4, 2.4); t.fadeAt = 0.7;
      t.size0 = t.size1 = rng.next() < 0.3 ? 2 : 1;
      t.gray = rng.next() < 0.5 ? 0.12 : 0.9;
      particles.emit();
    }
  }

  /** Passada do leão: respingo mais largo e alto que o do humano, aberto para os lados do corpo. */
  function onPawstep(x: number, z: number, sim: Sim): void {
    const f = sim.player.facing;
    const nx = -f.z, nz = f.x;
    const n = rng.int(4, 6);
    for (let i = 0; i < n; i++) {
      const t = particles.reset();
      const side = rng.range(-0.22, 0.22);
      const a = rng.range(0, Math.PI * 2), sp = rng.range(0.5, 1.3);
      t.x = x + nx * side + rng.range(-0.08, 0.08); t.y = 0.04; t.z = z + nz * side + rng.range(-0.08, 0.08);
      t.vx = Math.cos(a) * sp + nx * side * 2.5; t.vz = Math.sin(a) * sp + nz * side * 2.5; t.vy = rng.range(1.2, 2.2);
      t.grav = -12; t.life = 0.34;
      const water = rng.next() < 0.6;
      t.shape = water ? SHAPE.vline : SHAPE.square;
      t.size0 = t.size1 = water ? rng.int(2, 3) : rng.int(1, 2);
      t.gray = water ? 0.82 : 0.3;
      particles.emit();
    }
    ring(x, 0.03, z, 0.1, 0.5, 0.36, 0.8, 1);
  }

  /** Discos brancos que incham em volta do corpo do leão (deitado na direção `f`). */
  function lionPuff(
    x: number, z: number, fx: number, fz: number, count: number,
    s0: number, s1: number, life0: number, life1: number, gray0: number, gray1: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const t = particles.reset();
      const u = rng.range(-0.8, 1), side = rng.range(-0.35, 0.35);
      t.x = x + fx * u - fz * side; t.y = rng.range(0.2, 1.15); t.z = z + fz * u + fx * side;
      const a = rng.range(0, Math.PI * 2), sp = rng.range(0.4, 1.2);
      t.vx = Math.cos(a) * sp; t.vz = Math.sin(a) * sp; t.vy = rng.range(0.2, 0.8);
      t.drag = 4; t.life = rng.range(life0, life1); t.flags = PF.swell;
      t.size0 = s0 * rng.range(0.85, 1.15); t.size1 = s1 * rng.range(0.85, 1.15);
      t.shape = SHAPE.disc; t.gray = rng.range(gray0, gray1);
      particles.emit();
    }
  }

  function onTransformStart(ev: Ev<'transformStart'>): void {
    auraAcc = 0;
    auraPulses = 0;
    // anel largo e grosso que se fecha (o do Kiai é menor e fino); as batidas seguintes saem no quadro
    ring(ev.pos.x, 0.03, ev.pos.z, 3.2, 0.5, 0.6, 0.85, 2, true);
  }

  function onTransformBurst(ev: Ev<'transformBurst'>): void {
    const { x, z } = ev.pos;
    // a aura que ainda convergia já virou o leão
    particles.killFlag(PF.home);
    // onda de choque do rugido até o raio real do empurrão e um segundo anel, maior e mais lento
    ring(x, 0.03, z, 0.6, ev.radius, 0.38, 1, 2);
    ring(x, 0.03, z, 1, ev.radius * 1.45, 0.7, 0.72, 1);
    // ondas do rugido (círculos na tela) e riscos de vento saindo do corpo: o Kiai não tem nenhum dos dois
    for (let i = 0; i < 3; i++) {
      const t = particles.reset();
      t.x = x; t.y = 1; t.z = z;
      t.life = 0.24 + i * 0.06; t.fadeAt = 0.55;
      t.size0 = 4 + i * 10; t.size1 = 46 + i * 20; t.shape = SHAPE.ring; t.gray = 1;
      particles.emit();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rng.range(-0.18, 0.18);
      const c = Math.cos(a), s = Math.sin(a);
      const r0 = rng.range(0.9, 1.3), r1 = r0 + rng.range(1.2, 2.2), y = rng.range(0.2, 1.4);
      line(x + c * r0, y, z + s * r0, x + c * r1, y, z + s * r1, rng.next() < 0.4 ? 2 : 1, rng.range(0.85, 1), rng.range(0, 0.04), 0.06, rng.range(0.04, 0.1), 0.12);
    }
    // poeira para os dois lados da tela
    dust(x, z, CAM_RIGHT.x, CAM_RIGHT.z, 14, 9, 1.6);
    dust(x, z, -CAM_RIGHT.x, -CAM_RIGHT.z, 14, 9, 1.6);
    // clarão curto e direto, sem o negativo do Kiai
    shake(1.2);
    feedback.flash = Math.max(feedback.flash, 0.5);
  }

  function onTransformEnd(ev: Ev<'transformEnd'>, sim: Sim): void {
    const { x, z } = ev.pos;
    const f = sim.player.facing;
    // sopro branco em volta do leão: já nasce grande para cobrir a troca do último quadro da
    // transformação pelos de movimento e se desfaz em ~0,35 s
    lionPuff(x, z, f.x, f.z, 12, 10, 20, 0.3, 0.4, 0.92, 1);
    ring(x, 0.03, z, 0.4, 1.8, 0.32, 0.9, 1);
    feedback.flash = Math.max(feedback.flash, 0.2);
  }

  function onRevertStart(ev: Ev<'revertStart'>, sim: Sim): void {
    const { x, z } = ev.pos;
    const f = sim.player.facing;
    if (ev.reason === 'death') {
      // não há leão caído: nuvem de tinta com borda de aura cobre a troca pelo samurai caído
      // (a tinta da morte vem logo depois, no evento playerDeath)
      particles.killFlag(PF.home);
      lionPuff(x, z, f.x, f.z, 10, 12, 24, 0.5, 0.7, 0.03, 0.08);
      lionPuff(x, z, f.x, f.z, 8, 9, 18, 0.4, 0.55, 0.82, 0.92);
      shake(0.6);
      feedback.flash = Math.max(feedback.flash, 0.3);
      return;
    }
    // a aura se desfaz: fagulhas brancas sobem do corpo e um sopro de tinta em volta
    for (let i = 0; i < 18; i++) {
      const t = particles.reset();
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.2, 0.8), sp = rng.range(0.8, 2.2);
      t.x = x + Math.cos(a) * r; t.y = rng.range(0.2, 1.2); t.z = z + Math.sin(a) * r;
      t.vx = Math.cos(a) * sp; t.vz = Math.sin(a) * sp; t.vy = rng.range(0.6, 1.8);
      t.grav = 0.8; t.drag = 2.2; t.life = rng.range(0.45, 0.75); t.fadeAt = 0.6;
      t.size0 = t.size1 = rng.next() < 0.3 ? 2 : 1; t.gray = rng.range(0.9, 1);
      particles.emit();
    }
    lionPuff(x, z, f.x, f.z, 6, 6, 14, 0.35, 0.5, 0.86, 0.95);
    inkPuff(x, 0.7, z, 0, 0, 6, 3, 14, 0.05);
    ring(x, 0.03, z, 0.3, 1.6, 0.4, 0.85, 1);
    shake(0.35);
  }

  /**
   * Garra do leão (abre a janela ativa): três unhas brancas lançadas do corpo até o alcance (a de fora no raio
   * exato), varrendo o leque de cima para baixo na tela como a pata da arte; sulcos no chão e um pouco de lama.
   */
  function onLionClaw(ev: Ev<'lionClaw'>): void {
    const { x, z } = ev.pos;
    const dx = ev.dir.x, dz = ev.dir.z;
    const yaw = Math.atan2(dz, dx);
    // o lado +L do arco (no shader) fica embaixo na tela quando dz - dx < 0: aí a varredura começa pelo -L
    const sign = dz - dx > 0 ? -1 : 1;
    for (let i = 0; i < 3; i++) {
      const s = take(swings, cur.swing);
      s.on = true; s.t = -i * CLAW_STAGGER; s.owner = -1;
      s.x = x; s.y = 0.1; s.z = z; s.yaw = yaw;
      s.dur = CLAW_DUR;
      s.radius = ev.range - i * CLAW_GAP;
      s.grow = 0.3;
      s.halfArc = ev.halfArc * (1 - i * 0.05);
      s.width = 0.26 - i * 0.03;
      s.tilt = 0; s.sign = sign;
      s.gray = 1; s.inner = 0.8; s.echo = i === 0;
    }
    // sulcos da pata rasgando a lama para a frente (abrem enquanto as unhas passam)
    const mid = ev.range * 0.52;
    decals.add('scratch', x + dx * mid, z + dz * mid, yaw + rng.range(-0.08, 0.08), ev.range * 0.56, 14, 0.12);
    // lama jogada para a frente da pata e uma névoa baixa ao longo dos sulcos
    dust(x + dx * 1.1, z + dz * 1.1, -dx, -dz, 7, 2, 1);
    for (let i = 0; i < 4; i++) {
      const t = particles.reset();
      const d = rng.range(1.4, ev.range * 0.8);
      t.x = x + dx * d + rng.range(-0.3, 0.3); t.y = rng.range(0.06, 0.2); t.z = z + dz * d + rng.range(-0.3, 0.3);
      t.vx = dx * rng.range(0.6, 1.4); t.vz = dz * rng.range(0.6, 1.4); t.vy = rng.range(0.1, 0.4);
      t.drag = 2.5; t.life = rng.range(0.3, 0.45); t.flags = PF.swell;
      t.size0 = 2; t.size1 = rng.range(6, 9); t.shape = SHAPE.disc; t.gray = rng.range(0.66, 0.76);
      particles.emit();
    }
    shake(0.38);
  }

  function onLionRoarReady(ev: Ev<'lionRoarReady'>, sim: Sim): void {
    const { x, z } = ev.pos;
    // brilho na cabeça (agachada) e a borda da área piscando branca: pronto para soltar
    const f = sim.player.facing;
    const side = f.x * CAM_RIGHT.x + f.z * CAM_RIGHT.z >= 0 ? 1 : -1;
    const t = particles.reset();
    t.x = x + CAM_RIGHT.x * side * 0.6; t.y = 0.8; t.z = z + CAM_RIGHT.z * side * 0.6;
    t.life = 0.24; t.size0 = 21; t.size1 = 3; t.shape = SHAPE.star; t.gray = 1;
    particles.emit();
    ring(x, 0.03, z, LION.roar.radius * 0.9, LION.roar.radius, 0.12, 1, 2, true, 0, 0.14);
  }

  function onLionRoarCancel(ev: Ev<'lionRoarCancel'>): void {
    particles.killFlag(PF.charge);
    // o fôlego se desfaz: um sopro baixo em volta
    for (let i = 0; i < 5; i++) {
      const t = particles.reset();
      const a = rng.range(0, Math.PI * 2), sp = rng.range(0.5, 1.2);
      t.x = ev.pos.x + Math.cos(a) * 0.4; t.y = rng.range(0.1, 0.4); t.z = ev.pos.z + Math.sin(a) * 0.4;
      t.vx = Math.cos(a) * sp; t.vz = Math.sin(a) * sp; t.vy = rng.range(0.1, 0.4);
      t.drag = 2.5; t.life = rng.range(0.3, 0.42); t.flags = PF.swell;
      t.size0 = 2; t.size1 = rng.range(6, 9); t.shape = SHAPE.disc; t.gray = rng.range(0.68, 0.76);
      particles.emit();
    }
  }

  /**
   * Rugido (ataque em área): parente da onda da transformação, mas lido como ÁREA — a frente branca grossa
   * chega ao raio exato e fica parada lá um instante, duas ondas sonoras menores vêm atrás, a pressão
   * pontilhada varre o chão e a lama levanta por onde a frente passa até formar a parede de poeira na borda.
   * Sem os riscos de vento nem os anéis na tela da transformação.
   */
  function onLionRoar(ev: Ev<'lionRoar'>): void {
    const { x, z } = ev.pos;
    const R = ev.radius;
    particles.killFlag(PF.charge);
    ring(x, 0.03, z, 0.6, R, ROAR_FRONT, 1, 3, false, 0, ROAR_HOLD);
    ring(x, 0.03, z, 0.5, R * 0.86, ROAR_FRONT, 0.86, 2, false, 0.07);
    ring(x, 0.03, z, 0.4, R * 0.7, ROAR_FRONT, 0.74, 1, false, 0.14);
    wave.on = true; wave.t = 0; wave.dur = ROAR_FRONT; wave.x = x; wave.z = z; wave.r0 = 0.6; wave.r1 = R; wave.acc = 0;
    // sopro da boca: lama baixa saindo do corpo para todos os lados
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, Math.PI * 2);
      dust(x + Math.cos(a) * 0.5, z + Math.sin(a) * 0.5, -Math.cos(a), -Math.sin(a), 1, 1, 1.5);
    }
    shake(ev.hits > 0 ? 1.35 : 1.15);
    feedback.flash = Math.max(feedback.flash, 0.32);
  }

  /** Poeira e lama levantadas pela frente da onda do rugido (antes da física do quadro). */
  function emitWave(dt: number): void {
    wave.t += dt;
    const k = clamp01(wave.t / wave.dur);
    const front = wave.r0 + (wave.r1 - wave.r0) * easeOut(k);
    wave.acc += dt * 380;
    while (wave.acc >= 1) {
      wave.acc -= 1;
      const a = rng.range(0, Math.PI * 2), c = Math.cos(a), s = Math.sin(a);
      const r = front + rng.range(-0.25, 0.1);
      const t = particles.reset();
      t.x = wave.x + c * r; t.z = wave.z + s * r;
      if (rng.next() < 0.6) {
        const sp = rng.range(1.2, 2.6);
        t.y = rng.range(0.06, 0.3);
        t.vx = c * sp; t.vz = s * sp; t.vy = rng.range(0.2, 0.7);
        t.drag = 2.6; t.life = rng.range(0.32, 0.48); t.flags = PF.swell;
        t.size0 = 2; t.size1 = rng.range(6, 10); t.shape = SHAPE.disc; t.gray = rng.range(0.66, 0.78);
      } else {
        const sp = rng.range(1.5, 3.5);
        t.y = 0.05;
        t.vx = c * sp; t.vz = s * sp; t.vy = rng.range(1, 2.6);
        t.grav = -14; t.drag = 1; t.life = rng.range(0.35, 0.55); t.fadeAt = 0.7;
        t.size0 = t.size1 = rng.int(1, 2); t.gray = rng.range(0.24, 0.4);
      }
      particles.emit();
    }
    if (k >= 1) {
      // parede de poeira na borda: marca o raio que o rugido alcançou
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + rng.range(-0.08, 0.08), c = Math.cos(a), s = Math.sin(a);
        const t = particles.reset();
        t.x = wave.x + c * wave.r1; t.y = rng.range(0.08, 0.4); t.z = wave.z + s * wave.r1;
        const sp = rng.range(0.5, 1.3);
        t.vx = c * sp; t.vz = s * sp; t.vy = rng.range(0.25, 0.7);
        t.drag = 1.8; t.life = rng.range(0.5, 0.7); t.flags = PF.swell;
        t.size0 = 3; t.size1 = rng.range(10, 14); t.shape = SHAPE.disc; t.gray = rng.range(0.7, 0.8);
        particles.emit();
      }
      wave.on = false;
    }
  }

  // ---------------------------------------------------------------- quadro

  function emitChargeMote(): void {
    const t = particles.reset();
    const a = rng.range(0, Math.PI * 2), r = rng.range(1, 1.7);
    t.vx = Math.cos(a) * r; t.vz = Math.sin(a) * r; t.vy = rng.range(-0.55, 0.8);
    t.life = rng.range(0.28, 0.42);
    t.size0 = t.size1 = rng.next() < 0.25 ? 2 : 1;
    t.gray = rng.range(0.9, 1); t.flags = PF.home | PF.charge; t.spin = rng.range(-2.2, 2.2);
    particles.emit();
  }

  /**
   * Carga do rugido: a lama do chão em volta é puxada em espiral para o leão (vem de mais longe e mais de baixo
   * que as fagulhas do iaido), algumas fagulhas brancas e névoa rasteira escorrendo para dentro.
   */
  function emitRoarMote(x: number, z: number): void {
    const t = particles.reset();
    const u = rng.next();
    if (u < 0.16) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(1.6, 2.8), sp = rng.range(2.2, 3.4);
      t.x = x + Math.cos(a) * r; t.y = rng.range(0.06, 0.22); t.z = z + Math.sin(a) * r;
      t.vx = -Math.cos(a) * sp; t.vz = -Math.sin(a) * sp; t.vy = rng.range(0, 0.2);
      t.drag = 1.6; t.life = rng.range(0.4, 0.55); t.flags = PF.swell | PF.charge;
      t.size0 = 2; t.size1 = rng.range(6, 9); t.shape = SHAPE.disc; t.gray = rng.range(0.66, 0.76);
    } else {
      const mud = u < 0.72;
      const a = rng.range(0, Math.PI * 2), r = mud ? rng.range(1.8, 3.4) : rng.range(1.2, 2.2);
      // deslocamento a partir do alvo (0,85 m): a lama sai rente ao chão
      t.vx = Math.cos(a) * r; t.vz = Math.sin(a) * r;
      t.vy = mud ? rng.range(-0.8, -0.45) : rng.range(-0.5, 0.7);
      t.life = rng.range(0.38, 0.55);
      t.size0 = t.size1 = rng.next() < 0.3 ? 2 : 1;
      t.gray = mud ? rng.range(0.26, 0.42) : rng.range(0.9, 1);
      t.flags = PF.home | PF.charge; t.spin = rng.range(-1.4, 1.4);
    }
    particles.emit();
  }

  /**
   * Aura da transformação (`k` = progresso até o leão surgir): na maioria fagulhas que vêm de mais longe
   * que as do Kiai e convergem em espiral; às vezes uma chama vertical subindo rente ao corpo.
   */
  function emitAuraMote(x: number, z: number, k: number): void {
    const t = particles.reset();
    if (rng.next() < 0.22) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.3, 0.7);
      t.x = x + Math.cos(a) * r; t.y = rng.range(0.1, 1.1); t.z = z + Math.sin(a) * r;
      t.vy = rng.range(1.6, 3); t.drag = 1.5; t.life = rng.range(0.22, 0.36); t.fadeAt = 0.6;
      t.size0 = rng.int(3, 5); t.size1 = 1; t.shape = SHAPE.vline; t.gray = 1;
      particles.emit();
      return;
    }
    const a = rng.range(0, Math.PI * 2), r = rng.range(1.4, 2.6);
    t.vx = Math.cos(a) * r; t.vz = Math.sin(a) * r; t.vy = rng.range(-0.8, 1.1);
    t.life = rng.range(0.4, 0.6);
    t.size0 = t.size1 = rng.next() < 0.15 + 0.35 * k ? 2 : 1;
    t.gray = rng.range(0.9, 1); t.flags = PF.home; t.spin = rng.range(-1.6, 1.6);
    particles.emit();
  }

  function drawSwings(dt: number, sim: Sim): void {
    const p = sim.player;
    for (const s of swings) {
      if (!s.on) continue;
      s.t += dt;
      if (s.t < 0) continue;
      if (s.t >= s.dur) { s.on = false; continue; }
      if (s.owner < 0) {
        if (p.state === 'attack' || p.state === 'claw') { s.x = p.pos.x; s.z = p.pos.z; }
      } else {
        const e = findEnemy(sim, s.owner);
        if (e && e.state === 'strike') { s.x = e.pos.x; s.z = e.pos.z; }
      }
      const k = s.t / s.dur;
      const head = easeOut(clamp01(k / 0.45));
      const tail = easeIn(clamp01((k - 0.2) / 0.8));
      const width = s.width * (1 - 0.5 * clamp01((k - 0.5) / 0.5));
      const radius = s.grow < 1 ? s.radius * (s.grow + (1 - s.grow) * easeOut(clamp01(k / 0.4))) : s.radius;
      slashes.push(s.x, s.y, s.z, s.yaw, radius, s.halfArc, width, s.tilt, head, tail, s.gray, s.sign, s.echo, s.inner);
    }
  }

  function drawWarns(time: number, sim: Sim): void {
    for (const w of warns) {
      if (!w.on) continue;
      const e = findEnemy(sim, w.id);
      if (!e || (e.state !== 'windup' && e.state !== 'strike')) { w.on = false; continue; }
      const yaw = Math.atan2(e.strikeDir.z, e.strikeDir.x);
      if (e.state === 'windup') {
        const prog = clamp01(e.t / e.def.windup);
        const locked = prog >= AI.trackUntil;
        // surge em pontilhado; depois de travar a direção o contorno fica branco puro
        const alpha = clamp01(0.3 + e.t / 0.08);
        ground.warn(e.pos.x, e.pos.z, yaw, w.radius, w.halfArc, prog, locked ? 1 : 0.8, alpha, 0);
        const cueAt = Math.max(0, e.def.windup - AI.cueLead);
        if (e.t >= cueAt) {
          // brilho na lâmina: cresce e some no instante do golpe (mesma pista do contorno branco)
          const g = clamp01((e.t - cueAt) / Math.max(0.05, e.def.windup - cueAt));
          const size = Math.round(3 + 12 * Math.sin(Math.PI * g));
          const sx = e.strikeDir.x * CAM_RIGHT.x + e.strikeDir.z * CAM_RIGHT.z;
          const side = sx >= 0 ? 1 : -1;
          const twinkle = Math.floor(time * 20) % 2 === 0 ? 1 : 0.75;
          particles.stamp(e.pos.x + CAM_RIGHT.x * side * 0.3, 0.98, e.pos.z + CAM_RIGHT.z * side * 0.3, size * twinkle, 1, SHAPE.star);
        }
      } else if (e.t < 0.11) {
        // golpe: o setor inteiro pisca sólido e some (sem esmaecer em pontilhado)
        ground.warn(e.pos.x, e.pos.z, yaw, w.radius, w.halfArc, 1, 1, 1, e.t < 0.05 ? 1 : 0);
      }
    }
  }

  function drawLines(dt: number, sim: Sim): void {
    const p = sim.player;
    for (const l of lineFx) {
      if (!l.on) continue;
      l.t += dt;
      const te = l.t - l.delay;
      if (te < 0) continue;
      let head: number;
      if (l.path) head = p.state === 'iaido' && p.t < IAIDO.dur ? easeOut(p.t / IAIDO.dur) : 1;
      else head = easeOut(clamp01(te / l.inT));
      const outStart = l.inT + l.hold;
      const tail = te <= outStart ? 0 : easeIn(clamp01((te - outStart) / l.outT));
      if (te > outStart + l.outT) { l.on = false; continue; }
      const width = l.width * (1 + l.boost) * (1 - 0.5 * tail);
      l.boost = Math.max(0, l.boost - dt * 5);
      lines.push(l.ax, l.ay, l.az, l.bx, l.by, l.bz, width, l.gray, head, tail);
    }
  }

  function drawRings(dt: number, sim: Sim): void {
    const p = sim.player.pos;
    for (const r of rings) {
      if (!r.on) continue;
      r.t += dt;
      if (r.t < 0) continue;
      if (r.t >= r.dur + r.hold) { r.on = false; continue; }
      if (r.follow) { r.x = p.x; r.z = p.z; }
      let rad: number, alpha: number;
      if (r.hold <= 0) {
        const k = r.t / r.dur;
        rad = r.r0 + (r.r1 - r.r0) * easeOut(k);
        alpha = 1 - k * k;
      } else if (r.t < r.dur) {
        // vai inteira até a borda e só some depois de parar lá
        rad = r.r0 + (r.r1 - r.r0) * easeOut(r.t / r.dur);
        alpha = 1;
      } else {
        const h = (r.t - r.dur) / r.hold;
        rad = r.r1;
        alpha = 1 - h * h;
      }
      ground.ring(r.x, r.y, r.z, rad, r.gray, alpha, r.thick);
    }
  }

  /** Borda da área do rugido durante a carga e a pressão pontilhada atrás da frente da onda. */
  function drawRoar(time: number, sim: Sim): void {
    const p = sim.player;
    const R = LION.roar.radius;
    if (p.state === 'roarCharge' || (p.state === 'roar' && !p.roarDone)) {
      if (p.state === 'roar' || p.chargeReady) {
        // pronto (ou já soltou): borda firme, piscando enquanto segura
        const thick = p.state === 'roar' || Math.floor(time * 8) % 2 === 0 ? 2 : 1;
        ground.ring(p.pos.x, 0.03, p.pos.z, R, 0.9, 1, thick);
        if (p.state === 'roarCharge') {
          // brilho piscando na cabeça agachada (como o da empunhadura no iaido)
          const side = p.facing.x * CAM_RIGHT.x + p.facing.z * CAM_RIGHT.z >= 0 ? 1 : -1;
          const size = Math.floor(time * 12) % 2 === 0 ? 7 : 4;
          particles.stamp(p.pos.x + CAM_RIGHT.x * side * 0.6, 0.8, p.pos.z + CAM_RIGHT.z * side * 0.6, size, 1, SHAPE.star);
        }
      } else {
        // carregando: a borda surge em pontilhado conforme a carga enche
        const k = clamp01(p.t / LION.roar.chargeTime);
        ground.ring(p.pos.x, 0.03, p.pos.z, R, 0.8, 0.2 + 0.5 * k, 1);
        // anel que vem da borda e se fecha no leão (preso ao estado: some junto quando a carga é desfeita)
        ground.ring(p.pos.x, 0.03, p.pos.z, R + (0.6 - R) * easeOut(k), 0.8, 1 - k * k, 1);
      }
    }
    if (wave.on) {
      const k = clamp01(wave.t / wave.dur);
      const front = wave.r0 + (wave.r1 - wave.r0) * easeOut(k);
      ground.band(wave.x, 0.03, wave.z, front - 1.3, front - 0.05, 0.92, 0.36 * (1 - k * k));
    }
  }

  return {
    feedback,

    handle(ev, sim) {
      switch (ev.type) {
        case 'playerSwing': onPlayerSwing(ev); break;
        case 'enemyWindup': onWindup(ev, sim); break;
        case 'enemySwing': onEnemySwing(ev); break;
        case 'enemyHit': onEnemyHit(ev, sim); break;
        case 'enemyDeath': onEnemyDeath(ev); break;
        case 'playerHurt': onPlayerHurt(ev); break;
        case 'playerDeath': onPlayerDeath(ev, sim); break;
        case 'dash': dust(ev.pos.x, ev.pos.z, ev.dir.x, ev.dir.z, 9, 4, 1); ring(ev.pos.x, 0.03, ev.pos.z, 0.15, 0.7, 0.3, 0.82, 1); break;
        case 'chargeStart': chargeAcc = 0; break;
        case 'chargeReady': onChargeReady(ev); break;
        case 'chargeCancel': particles.killFlag(PF.charge); break;
        case 'iaidoDash': onIaidoDash(ev); break;
        case 'iaidoCut': onIaidoCut(ev); break;
        case 'spawn': onSpawn(ev); break;
        case 'footstep': if (ev.paw) onPawstep(ev.pos.x, ev.pos.z, sim); else onFootstep(ev); break;
        case 'waveClear': onWaveClear(sim); break;
        case 'waveStart': break;
        case 'block': {
          // faísca no ponto de contato (entre o herói e quem golpeou) e o herói empurrado para trás
          const bx = ev.pos.x - ev.dir.x * 0.45, bz = ev.pos.z - ev.dir.z * 0.45;
          spark(bx, 1.15, bz, 0.9, 8);
          dust(ev.pos.x, ev.pos.z, -ev.dir.x, -ev.dir.z, 5, 2, 0.6);
          shake(0.35);
          break;
        }
        case 'parry': {
          const mx = (ev.pos.x + ev.enemyPos.x) / 2, mz = (ev.pos.z + ev.enemyPos.z) / 2;
          spark(mx, 1.2, mz, 1.6, 16);
          ring(mx, 0.03, mz, 0.2, 1.8, 0.24, 0.95, 1);
          shake(0.7);
          feedback.flash = Math.max(feedback.flash, 0.28);
          break;
        }
        case 'guardStart': break;
        case 'kiaiStart':
          chargeAcc = 0;
          ring(ev.pos.x, 0.03, ev.pos.z, 2.2, 0.4, 0.5, 0.8, 1);
          break;
        case 'kiaiBlast': {
          if (style === 'sakura') {
            // tempestade de pétalas: sem negativo e com clarão leve, para as flores continuarem visíveis
            petals(ev.pos.x, ev.pos.z, 90, 0.2, 1.6, 7, 2.6);
            petals(ev.pos.x, ev.pos.z, 40, ev.radius * 0.5, ev.radius, 2.5, 2.2);
            ring(ev.pos.x, 0.03, ev.pos.z, 0.5, ev.radius, 0.45, 0.85, 1);
            shake(0.9);
            pendingFlash = 0.12;
            break;
          }
          // os quadros do sprite já trazem a explosão; aqui a onda de choque no chão até o raio real
          ring(ev.pos.x, 0.03, ev.pos.z, 0.5, ev.radius, 0.34, 1, 2);
          ring(ev.pos.x, 0.03, ev.pos.z, 0.8, ev.radius * 1.55, 0.6, 0.7, 1);
          dust(ev.pos.x, ev.pos.z, 1, 0, 12, 8, 1.4);
          dust(ev.pos.x, ev.pos.z, -1, 0, 12, 8, 1.4);
          shake(1.5);
          invertT = 0.12;
          pendingFlash = 0.6;
          break;
        }
        case 'furyReady': break;
        case 'transformStart': onTransformStart(ev); break;
        case 'transformBurst': onTransformBurst(ev); break;
        case 'transformEnd': onTransformEnd(ev, sim); break;
        case 'revertStart': onRevertStart(ev, sim); break;
        case 'revertEnd': break;
        case 'lionClaw': onLionClaw(ev); break;
        // o anel da carga é desenhado por estado (drawRoar): some junto se a carga é desfeita
        case 'lionRoarCharge': roarAcc = 0; break;
        case 'lionRoarReady': onLionRoarReady(ev, sim); break;
        case 'lionRoarCancel': onLionRoarCancel(ev); break;
        case 'lionRoar': onLionRoar(ev); break;
        default: ev satisfies never;
      }
    },

    update(dt, time, sim) {
      // retorno de tela: o negativo é binário (quadro de mangá) e o clarão vem logo depois
      feedback.shake = Math.max(0, feedback.shake - dt * 6);
      feedback.flash = Math.max(0, feedback.flash - dt * 3.2);
      if (invertT > 0) {
        invertT -= dt;
        feedback.invert = 1;
        if (invertT <= 0) {
          feedback.invert = 0;
          feedback.flash = Math.max(feedback.flash, pendingFlash);
          pendingFlash = 0;
        }
      } else feedback.invert = 0;

      const p = sim.player;
      if (dt > 0) {
        if (style === 'sakura' && p.state === 'kiai' && p.t < KIAI.gather) {
          petalAcc += dt * 40;
          while (petalAcc >= 1) { petalAcc -= 1; petals(p.pos.x, p.pos.z, 1, 0.8, 1.8, 0.8, 1.4); }
        } else if (p.state === 'charge' || (p.state === 'kiai' && p.t < KIAI.gather)) {
          chargeAcc += dt * (p.state === 'kiai' ? 60 : p.chargeReady ? 16 : 44);
          while (chargeAcc >= 1) { chargeAcc -= 1; emitChargeMote(); }
        } else if (p.state === 'roarCharge') {
          // a lama em volta é puxada para o leão; depois de pronta, mais rala
          roarAcc += dt * (p.chargeReady ? 20 : 56);
          while (roarAcc >= 1) { roarAcc -= 1; emitRoarMote(p.pos.x, p.pos.z); }
        } else if (p.state === 'transform' && !p.burstDone) {
          // aura branca convergindo até o leão surgir: fica mais densa e o anel bate cada vez mais perto
          const k = clamp01(p.t / LION.burstAt);
          auraAcc += dt * (30 + 55 * k);
          while (auraAcc >= 1) { auraAcc -= 1; emitAuraMote(p.pos.x, p.pos.z, k); }
          while (auraPulses < AURA_PULSES.length && p.t >= AURA_PULSES[auraPulses]) {
            ring(p.pos.x, 0.03, p.pos.z, 2.6, 0.45, 0.42, auraPulses ? 1 : 0.9, auraPulses ? 2 : 1, true);
            auraPulses++;
          }
        }
        if (wave.on) emitWave(dt);
      }

      particles.simulate(dt, p.pos.x, 0.85, p.pos.z);
      decals.update(dt);
      slashes.begin();
      ground.begin();
      lines.begin();
      drawSwings(dt, sim);
      drawWarns(time, sim);
      drawLines(dt, sim);
      drawRings(dt, sim);
      drawRoar(time, sim);
      if (p.state === 'charge' && p.chargeReady) {
        // lâmina pronta: brilho piscando na empunhadura
        const sx = p.facing.x * CAM_RIGHT.x + p.facing.z * CAM_RIGHT.z;
        const side = sx >= 0 ? 1 : -1;
        const size = Math.floor(time * 12) % 2 === 0 ? 9 : 5;
        particles.stamp(p.pos.x + CAM_RIGHT.x * side * 0.28, 0.72, p.pos.z + CAM_RIGHT.z * side * 0.28, size, 1, SHAPE.star);
      }
      slashes.end();
      ground.end();
      lines.end();
      particles.end();
    },

    setStyle(st) { style = st; },
    clear() {
      for (const s of swings) s.on = false;
      for (const w of warns) w.on = false;
      for (const l of lineFx) l.on = false;
      for (const r of rings) r.on = false;
      particles.clear();
      decals.clear();
      slashes.begin(); slashes.end();
      ground.begin(); ground.end();
      lines.begin(); lines.end();
      feedback.shake = feedback.flash = feedback.invert = 0;
      invertT = pendingFlash = chargeAcc = 0;
      auraAcc = auraPulses = 0;
      iaidoCuts = 0;
      roarAcc = 0;
      wave.on = false;
    },
  };
}
