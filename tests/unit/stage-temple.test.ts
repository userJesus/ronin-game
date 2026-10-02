// Cenário do templo: a planta gera obstáculos jogáveis (início livre, ninguém preso, horda chega até o jogador).
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARENA, WAVES } from '../../src/config';
import { dist, len } from '../../src/core/math';
import type { StageContent } from '../../src/world/environment';
import { buildTemple } from '../../src/world/temple';
import { Bot, playRun, table } from './bot';
import { makeSim } from './helpers';

let temple: StageContent;
beforeAll(() => {
  temple = buildTemple(new THREE.Group(), { arenaRadius: ARENA.radius, seed: 11 });
});

describe('templo', () => {
  it('tem construções e o jogador começa num ponto livre, longe delas', () => {
    expect(temple.boxes.length).toBeGreaterThan(5);
    expect(temple.colliders.length).toBeGreaterThan(15);
    const sim = makeSim({ waves: false, colliders: temple.colliders, boxes: temple.boxes, start: temple.start });
    expect(sim.blocked(temple.start, 1.5)).toBe(false);
    expect(len(temple.start)).toBeLessThan(ARENA.radius - 5);
  });

  it('sobra muito espaço livre para lutar (mais de 70% da arena)', () => {
    const sim = makeSim({ waves: false, colliders: temple.colliders, boxes: temple.boxes });
    let free = 0, total = 0;
    for (let x = -ARENA.radius; x <= ARENA.radius; x += 1) for (let z = -ARENA.radius; z <= ARENA.radius; z += 1) {
      if (Math.hypot(x, z) > ARENA.radius - 1) continue;
      total++;
      if (!sim.blocked({ x, z }, 0.5)) free++;
    }
    expect(free / total).toBeGreaterThan(0.7);
  });

  it('robô joga no templo: sem NaN, ninguém dentro das construções, a horda chega e as ondas passam', () => {
    const seeds = [1, 7, 42, 99];
    const runs = seeds.map(seed => {
      const b = new Bot(undefined, seed);
      return playRun(seed, s => b.think(s), 150, temple.colliders, { boxes: temple.boxes, start: temple.start });
    });
    console.log(table(runs, '\nROBÔ NO TEMPLO (150 s)'));
    for (const r of runs) {
      expect(r.nan).toBe(false);
      expect(r.inside).toBe(0);
      expect(r.maxAliveOver).toBeLessThanOrEqual(0);
      // inimigos presos atrás das construções não deixariam a onda acabar
      expect(r.cleared).toBeGreaterThanOrEqual(1);
      expect(r.kills).toBeGreaterThan(10);
    }
    expect(WAVES.maxAlive(1)).toBeGreaterThan(0);
  }, 120_000);

  it('pontos de surgimento ficam fora das construções, de qualquer lugar do pátio', () => {
    const sim = makeSim({ waves: false, colliders: temple.colliders, boxes: temple.boxes, start: temple.start });
    for (let k = 0; k < 40; k++) {
      const a = k * 2.39996, r = Math.sqrt((k + 0.5) / 40) * (ARENA.radius - 2);
      const at = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      if (sim.blocked(at, 0.5)) continue;
      sim.player.pos = at;
      for (let i = 0; i < 30; i++) {
        const q = sim.spawnPoint();
        expect(sim.blocked(q, 0.9), `de (${at.x.toFixed(1)}, ${at.z.toFixed(1)})`).toBe(false);
        expect(dist(q, at)).toBeGreaterThan(5);
      }
    }
  });
});
