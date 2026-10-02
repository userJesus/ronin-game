// Jogador automático simples para calibrar o balanceamento (não faz parte do jogo).
// Regras: anda até o inimigo mais próximo que não está preparando golpe, corta a <= 2 m,
// esquiva para o lado quando um inimigo perto está no fim da preparação e usa o iaido
// quando há ki e 3+ inimigos alinhados.
import { ARENA, IAIDO, SIM_DT, WAVES } from '../../src/config';
import { Rng, dist, distToSegment, norm, sub, type Vec2 } from '../../src/core/math';
import type { Sim } from '../../src/sim/sim';
import { idleInput, type Box, type Circle, type Enemy, type SimInput } from '../../src/sim/types';
import { edgeColliders, hasNaN, makeSim } from './helpers';

export interface BotOptions {
  /** Esquiva quando faltar até isto (s) para o golpe inimigo sair. */
  dodgeLead: number;
  /** Só esquiva de quem está a esta distância (m) ou menos. */
  dodgeRange: number;
  /** Corta quando o inimigo mais próximo está a esta distância (m) ou menos. */
  attackRange: number;
  /** Alvos alinhados para valer o iaido (Infinity = nunca usa). */
  iaidoMin: number;
  /** Tempo de reação (s): não esquiva antes de a preparação durar isto. */
  reaction: number;
  /** Chance de perceber cada preparação (0 = nunca esquiva). */
  notice: number;
}

/** O robô pedido: reação instantânea, percebe tudo. */
export const DEFAULT_BOT: BotOptions = { dodgeLead: 0.15, dodgeRange: 2.6, attackRange: 2, iaidoMin: 3, reaction: 0, notice: 1 };
/** Aproximação de um jogador humano razoável: ~0.25 s de reação e distrações. */
export const HUMAN_BOT: BotOptions = { ...DEFAULT_BOT, reaction: 0.25, notice: 0.7 };
/** Só aperta o corte: sem esquiva nem iaido. */
export const MASHER_BOT: BotOptions = { ...DEFAULT_BOT, notice: 0, iaidoMin: Infinity };

const hittable = (e: Enemy) => e.state !== 'dying' && e.state !== 'spawn';

export class Bot {
  /** Preparação percebida ou não, por inimigo (sorteada uma vez por preparação). */
  private seen = new Map<number, boolean>();
  private readonly rng: Rng;

  constructor(readonly o: BotOptions = DEFAULT_BOT, seed = 1) { this.rng = new Rng(seed * 7919 + 13); }

  think(sim: Sim): SimInput {
    const p = sim.player;
    const inp = idleInput();
    if (sim.over) return inp;

    // 1) esquiva lateral do golpe que está para sair
    let threat: Enemy | null = null, threatD = Infinity;
    for (const e of sim.enemies) {
      if (e.state !== 'windup') { if (this.seen.size) this.seen.delete(e.id); continue; }
      let noticed = this.seen.get(e.id);
      if (noticed === undefined) { noticed = this.o.notice >= 1 || this.rng.next() < this.o.notice; this.seen.set(e.id, noticed); }
      if (!noticed || e.t < this.o.reaction) continue;
      const d = dist(e.pos, p.pos);
      if (d <= this.o.dodgeRange && e.def.windup - e.t <= this.o.dodgeLead && d < threatD) { threat = e; threatD = d; }
    }
    if (threat && p.dashCd <= 0 && p.state !== 'dash' && p.state !== 'iaido') {
      inp.move = this.sideStep(sim, threat);
      inp.dash = true;
      return inp;
    }

    // 2) iaido: segura até ficar pronto e solta na melhor linha
    if (p.state === 'charge') {
      if (p.chargeReady) inp.aim = this.bestLine(sim)?.dir ?? p.facing;
      else inp.charge = true;
      return inp;
    }
    if (p.ki >= IAIDO.cost && (p.state === 'idle' || p.state === 'run')) {
      const line = this.bestLine(sim);
      if (line && line.count >= this.o.iaidoMin) { inp.charge = true; inp.aim = line.dir; return inp; }
    }

    // 3) corte no mais próximo ao alcance
    let near: Enemy | null = null, nearD = Infinity;
    let goal: Enemy | null = null, goalD = Infinity;
    for (const e of sim.enemies) {
      if (e.state === 'dying') continue;
      const d = dist(e.pos, p.pos);
      if (hittable(e) && d < nearD) { near = e; nearD = d; }
      if (e.state !== 'windup' && d < goalD) { goal = e; goalD = d; }
    }
    if (near && nearD <= this.o.attackRange) {
      inp.attack = true;
      inp.aim = norm(sub(near.pos, p.pos));
      return inp;
    }

    // 4) aproxima do mais próximo que não está preparando golpe
    if (goal && goalD > 1.2) inp.move = norm(sub(goal.pos, p.pos));
    return inp;
  }

  /** Perpendicular ao golpe, para o lado com menos inimigos (e puxando para o centro). */
  private sideStep(sim: Sim, threat: Enemy): Vec2 {
    const p = sim.player;
    const a = { x: -threat.strikeDir.z, z: threat.strikeDir.x };
    let score = 0;
    for (const e of sim.enemies) {
      if (e === threat || e.state === 'dying') continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 25) continue;
      score += (dx * a.x + dz * a.z) / (d2 + 1);
    }
    score += (p.pos.x * a.x + p.pos.z * a.z) / ARENA.radius; // lado de fora pesa contra
    return score > 0 ? { x: -a.x, z: -a.z } : a;
  }

  /** Direção do iaido que atravessa mais inimigos. */
  bestLine(sim: Sim): { dir: Vec2; count: number } | null {
    const p = sim.player;
    let best: { dir: Vec2; count: number } | null = null;
    for (const t of sim.enemies) {
      if (!hittable(t)) continue;
      const d = dist(t.pos, p.pos);
      if (d > IAIDO.distance || d < 1e-3) continue;
      const dir = norm(sub(t.pos, p.pos));
      const end = { x: p.pos.x + dir.x * IAIDO.distance, z: p.pos.z + dir.z * IAIDO.distance };
      let count = 0;
      for (const e of sim.enemies) if (hittable(e) && distToSegment(e.pos, p.pos, end) <= IAIDO.width / 2 + e.def.radius) count++;
      if (!best || count > best.count) best = { dir, count };
    }
    return best;
  }
}

export interface RunStats {
  seed: number;
  /** Onda em que a partida terminou (ou onde estava ao esgotar o tempo). */
  wave: number;
  /** Última onda limpa. */
  cleared: number;
  time: number;
  kills: number;
  score: number;
  died: boolean;
  /** Dano recebido por onda (índice = onda). */
  dmg: number[];
  /** Duração de cada onda limpa (s, índice = onda). */
  waveTime: number[];
  iaidos: number;
  dashes: number;
  hitsTaken: number;
  minHp: number;
  maxEnemies: number;
  maxAliveOver: number;
  nan: boolean;
  /** Passos com alguém dentro de um obstáculo (deve ser 0). */
  inside: number;
}

export function playRun(
  seed: number, think: (sim: Sim) => SimInput, maxSeconds = 360, colliders: Circle[] = edgeColliders(),
  world: { boxes?: Box[]; start?: Vec2 } = {},
): RunStats {
  const sim = makeSim({ seed, colliders, boxes: world.boxes, start: world.start });
  const st: RunStats = { seed, wave: 0, cleared: 0, time: 0, kills: 0, score: 0, died: false, dmg: [], waveTime: [], iaidos: 0, dashes: 0, hitsTaken: 0, minHp: Infinity, maxEnemies: 0, maxAliveOver: 0, nan: false, inside: 0 };
  const maxSteps = Math.round(maxSeconds / SIM_DT);
  let waveStartStep = 0, step = 0;
  for (; step < maxSteps && !sim.over; step++) {
    sim.step(think(sim));
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'playerHurt') { st.dmg[sim.wave] = (st.dmg[sim.wave] ?? 0) + ev.damage; st.hitsTaken++; st.minHp = Math.min(st.minHp, ev.hp); }
      else if (ev.type === 'waveStart') waveStartStep = step;
      else if (ev.type === 'waveClear') { st.cleared = ev.wave; st.waveTime[ev.wave] = (step - waveStartStep) * SIM_DT; }
      else if (ev.type === 'iaidoDash') st.iaidos++;
      else if (ev.type === 'dash') st.dashes++;
    }
    const p = sim.player;
    if (hasNaN(p.pos) || hasNaN(p.vel) || !Number.isFinite(p.hp) || !Number.isFinite(p.ki)) st.nan = true;
    for (const e of sim.enemies) if (hasNaN(e.pos) || hasNaN(e.vel) || !Number.isFinite(e.hp)) st.nan = true;
    if (sim.blocked(p.pos) || sim.enemies.some(e => e.state !== 'dying' && sim.blocked(e.pos))) st.inside++;
    st.maxEnemies = Math.max(st.maxEnemies, sim.enemies.length);
    st.maxAliveOver = Math.max(st.maxAliveOver, sim.alive - WAVES.maxAlive(Math.max(1, sim.wave)));
  }
  st.wave = sim.wave;
  st.time = step * SIM_DT;
  st.kills = sim.kills;
  st.score = sim.score;
  st.died = sim.over;
  return st;
}

/** Tabela de texto para o console (calibragem). */
export function table(rows: RunStats[], title: string): string {
  const waves = Math.max(1, ...rows.map(r => r.dmg.length - 1), ...rows.map(r => r.wave));
  const head = ['seed', 'onda', 'limpas', 'tempo', 'abates', 'fim', 'golpes', 'hp mín', 'iaido', 'esq.', ...Array.from({ length: waves }, (_, i) => `d${i + 1}`)];
  const lines = rows.map(r => [
    String(r.seed), String(r.wave), String(r.cleared), `${r.time.toFixed(0)}s`, String(r.kills), r.died ? 'morreu' : 'vivo',
    String(r.hitsTaken), r.minHp === Infinity ? '-' : String(r.minHp), String(r.iaidos), String(r.dashes),
    ...Array.from({ length: waves }, (_, i) => (i + 1 <= r.wave ? String(r.dmg[i + 1] ?? 0) : '-')),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...lines.map(l => l[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padStart(w[i])).join(' | ');
  return [title, fmt(head), w.map(n => '-'.repeat(n)).join('-+-'), ...lines.map(fmt)].join('\n');
}
