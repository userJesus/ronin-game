// Construções (retângulos girados): colisão, desvio da horda, surgimento e iaido.
import { describe, expect, it } from 'vitest';
import { AI, IAIDO, PLAYER } from '../../src/config';
import { dist, type Vec2 } from '../../src/core/math';
import type { Box } from '../../src/sim/types';
import { inp, makeSim, ofType, run, spawnActive } from './helpers';

/** Distância de q até a borda do retângulo (0 dentro). */
function boxDist(b: Box, q: Vec2): number {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = q.x - b.x, dz = q.z - b.z;
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  return Math.hypot(Math.max(0, Math.abs(lx) - b.hw), Math.max(0, Math.abs(lz) - b.hd));
}

const immortal = (sim: ReturnType<typeof makeSim>) => { sim.player.invuln = 1; sim.player.hp = PLAYER.maxHp; };

describe('construções', () => {
  it('o jogador começa em opts.start', () => {
    const sim = makeSim({ waves: false, start: { x: 3, z: -8 } });
    expect(sim.player.pos).toEqual({ x: 3, z: -8 });
    expect(sim.player.prev).toEqual({ x: 3, z: -8 });
  });

  it('correndo contra uma parede girada, o jogador encosta, escorrega rente à face e não entra', () => {
    const wall: Box = { x: 0, z: 5, hw: 4, hd: 0.6, rot: 0.6 };
    const sim = makeSim({ waves: false, boxes: [wall] });
    let minD = Infinity, touching = 0;
    for (let i = 0; i < 60 * 3; i++) {
      sim.step(inp({ move: { x: 0, z: 1 } }));
      const d = boxDist(wall, sim.player.pos);
      minD = Math.min(minD, d);
      if (d < PLAYER.radius + 0.02) touching++;
    }
    expect(minD).toBeGreaterThanOrEqual(PLAYER.radius - 1e-6);
    expect(touching).toBeGreaterThan(10);
    // passou da ponta da parede escorregando (não ficou preso nela)
    expect(sim.player.pos.z).toBeGreaterThan(wall.z + 1);
  });

  it('quem aparece dentro de um retângulo sai pela face mais próxima', () => {
    const b: Box = { x: 0, z: 0, hw: 3, hd: 1, rot: 0 };
    const sim = makeSim({ waves: false, boxes: [b], start: { x: 0.5, z: 0.7 } });
    run(sim, 1);
    expect(sim.player.pos.z).toBeCloseTo(b.hd + PLAYER.radius, 9);
    expect(sim.player.pos.x).toBeCloseTo(0.5, 9);
  });

  for (const rot of [0, Math.PI / 4]) {
    it(`inimigo atrás de um muro (giro ${rot.toFixed(2)}) contorna e chega perto do jogador`, () => {
      // muro largo exatamente entre os dois: sem desvio, o inimigo empurra a parede para sempre
      const wall: Box = { x: 0, z: 6, hw: 5, hd: 0.5, rot };
      const sim = makeSim({ waves: false, boxes: [wall] });
      const e = spawnActive(sim, 'ronin', { x: 0, z: 13 });
      let reached = -1;
      for (let i = 0; i < 60 * 10; i++) {
        immortal(sim);
        sim.step(inp());
        sim.drainEvents();
        expect(boxDist(wall, e.pos)).toBeGreaterThanOrEqual(e.def.radius - 1e-6);
        if (reached < 0 && dist(e.pos, sim.player.pos) <= AI.ringRadius + AI.ringJitter + 1) reached = i;
      }
      expect(reached).toBeGreaterThan(0);
    });
  }

  it('inimigos das ondas nunca surgem dentro de construções', () => {
    const boxes: Box[] = [
      { x: 0, z: -22, hw: 10, hd: 8, rot: 0.785 },
      { x: 18, z: 10, hw: 4, hd: 12, rot: 0 },
      { x: -20, z: 8, hw: 6, hd: 6, rot: 0.3 },
    ];
    const sim = makeSim({ waves: false, boxes });
    for (const at of [{ x: 0, z: 0 }, { x: 0, z: -10 }, { x: 10, z: 22 }, { x: -30, z: -10 }, { x: 25, z: 20 }]) {
      sim.player.pos = { ...at };
      for (let i = 0; i < 200; i++) {
        const q = sim.spawnPoint();
        for (const b of boxes) expect(boxDist(b, q)).toBeGreaterThanOrEqual(AI.spawnClearance - 1e-6);
      }
    }
  });

  it('iaido para antes de uma parede e não atinge quem está atrás', () => {
    const wall: Box = { x: 5, z: 0, hw: 0.5, hd: 4, rot: 0 };
    const sim = makeSim({ waves: false, boxes: [wall] });
    sim.player.ki = 100;
    const behind = spawnActive(sim, 'ronin', { x: 7, z: 0 });
    behind.state = 'stagger';
    behind.t = -1e6;
    run(sim, Math.ceil(IAIDO.chargeTime * 60) + 2, inp({ charge: true, aim: { x: 1, z: 0 } }));
    const evs = run(sim, 60, inp({ aim: { x: 1, z: 0 } }));
    const dash = ofType(evs, 'iaidoDash')[0];
    expect(dash.to.x).toBeLessThanOrEqual(wall.x - wall.hw - PLAYER.radius + 1e-9);
    expect(sim.player.pos.x).toBeLessThan(wall.x - wall.hw);
    expect(behind.hp).toBe(behind.def.hp);
  });
});
