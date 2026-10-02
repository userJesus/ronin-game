// Utilitários dos testes da simulação: criação do Sim, entradas e avanço de passos.
import { ARENA, type EnemyKind } from '../../src/config';
import type { Vec2 } from '../../src/core/math';
import { Sim } from '../../src/sim/sim';
import { idleInput, type Box, type Circle, type Enemy, type SimEvent, type SimInput } from '../../src/sim/types';

/** Raio de surgimento típico numa tela 16:9 (visibleRadius ~20 m + 1.5). */
export const SPAWN_RADIUS = 21.5;

export interface SimSetup {
  seed?: number;
  colliders?: Circle[];
  boxes?: Box[];
  start?: Vec2;
  /** false = personagem sem a forma de leão (Tomoe). */
  transform?: boolean;
  spawnRadius?: number;
  /** false = sem ondas automáticas (combate isolado). */
  waves?: boolean;
}

export function makeSim(o: SimSetup = {}): Sim {
  const sim = new Sim({
    seed: o.seed ?? 7,
    arenaRadius: ARENA.radius,
    spawnRadius: o.spawnRadius ?? SPAWN_RADIUS,
    colliders: o.colliders ?? [],
    boxes: o.boxes,
    start: o.start,
    transform: o.transform,
  });
  if (o.waves === false) sim.waveTimer = Infinity;
  return sim;
}

export const inp = (o: Partial<SimInput> = {}): SimInput => ({ ...idleInput(), ...o });

export type InputSource = SimInput | ((i: number, sim: Sim) => SimInput);

/** Avança `n` passos e devolve todos os eventos emitidos. */
export function run(sim: Sim, n: number, input: InputSource = idleInput()): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step(typeof input === 'function' ? input(i, sim) : input);
    for (const ev of sim.drainEvents()) out.push(ev);
  }
  return out;
}

/** Avança até `pred` valer (ou `max` passos). Devolve eventos e se a condição foi atingida. */
export function runUntil(sim: Sim, pred: (evs: SimEvent[], sim: Sim) => boolean, max: number, input: InputSource = idleInput()): { events: SimEvent[]; ok: boolean; steps: number } {
  const out: SimEvent[] = [];
  for (let i = 0; i < max; i++) {
    sim.step(typeof input === 'function' ? input(i, sim) : input);
    const evs = sim.drainEvents();
    for (const ev of evs) out.push(ev);
    if (pred(evs, sim)) return { events: out, ok: true, steps: i + 1 };
  }
  return { events: out, ok: false, steps: max };
}

export function ofType<T extends SimEvent['type']>(evs: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** Inimigo já ativo (pula a animação de surgimento). Sem `attack`, nunca pega ficha de ataque. */
export function spawnActive(sim: Sim, kind: EnemyKind, pos: Vec2, attack = false): Enemy {
  const e = sim.spawnEnemy(kind, pos);
  e.state = 'chase';
  e.t = 0;
  e.tokenCd = attack ? 0 : 1e9;
  return e;
}

/** Inimigo imóvel (atordoado indefinidamente): alvo para testes geométricos. */
export function spawnFrozen(sim: Sim, kind: EnemyKind, pos: Vec2): Enemy {
  const e = sim.spawnEnemy(kind, pos);
  e.state = 'stagger';
  e.t = -1e6;
  e.tokenCd = 1e9;
  e.vel = { x: 0, z: 0 };
  return e;
}

/** Coloca o inimigo na preparação, a `stepsLeft` passos de golpear, mirando `dir`. */
export function primeStrike(e: Enemy, dir: Vec2, stepsLeft = 1, dt = 1 / 60): void {
  e.state = 'windup';
  e.token = true;
  e.t = e.def.windup - stepsLeft * dt + 1e-9;
  e.strikeDir = { x: dir.x, z: dir.z };
  e.facing = { x: dir.x, z: dir.z };
  e.vel = { x: 0, z: 0 };
}

/** Obstáculos de exemplo perto da borda (como o cenário faz com adereços grandes). */
export function edgeColliders(n = 10, ring = 30.5, seed = 3): Circle[] {
  const out: Circle[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const jitter = (s / 2147483648 - 0.5) * 0.3;
    const a = (i / n) * Math.PI * 2 + jitter;
    out.push({ x: Math.cos(a) * ring, z: Math.sin(a) * ring, r: 0.8 + (i % 3) * 0.35 });
  }
  return out;
}

export const hasNaN = (v: Vec2): boolean => !Number.isFinite(v.x) || !Number.isFinite(v.z);
