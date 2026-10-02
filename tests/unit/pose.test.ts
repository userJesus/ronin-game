// Animação dos sprites: conversão mundo <-> tela, 8 direções com histerese, ciclos e clipes.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { KIAI } from '../../src/config';
import { Rng } from '../../src/core/math';
import {
  ANIM_SETS, ATTACK_CLIPS, DASH_CLIP, GUARD_CLIP, IAIDO_CLIP, IDLE, LOCOMOTION, PARRY_CLIP, STRIDE, TOMOE_ANIM,
  dir8, enemyPose, faced, fromScreen, playerPose, sideLeft, toScreen, type Dir8, type PoseMemory,
} from '../../src/render/pose';
import atlas from '../../src/assets/sprites/samurai.json';
import { makeSim, spawnActive } from './helpers';

const DEG = Math.PI / 180;
const FRAMES = atlas.frames;
type FrameName = Parameters<typeof faced>[0];
/** Direção no chão que aparece na tela com ângulo `deg` (0 = direita, 90 = cima, -90 = baixo). */
const screenDir = (deg: number) => fromScreen(Math.cos(deg * DEG), Math.sin(deg * DEG));

describe('toScreen / fromScreen', () => {
  it('bate com os eixos do briefing (câmera yaw 45°)', () => {
    const c = Math.cos(45 * DEG), s = Math.sin(45 * DEG);
    // "direita da tela" no chão = (cos45, -sin45); "para cima" = (-sin45, -cos45)
    const right = toScreen({ x: c, z: -s });
    expect(right.sx).toBeCloseTo(1, 12);
    expect(right.sy).toBeCloseTo(0, 12);
    const up = toScreen({ x: -s, z: -c });
    expect(up.sx).toBeCloseTo(0, 12);
    expect(up.sy).toBeCloseTo(1, 12);
    // olhar para a câmera (que fica em +x,+z) = para baixo na tela
    const toCam = toScreen({ x: c, z: s });
    expect(toCam.sx).toBeCloseTo(0, 12);
    expect(toCam.sy).toBeCloseTo(-1, 12);
  });

  it('são inversas uma da outra', () => {
    const r = new Rng(3);
    for (let i = 0; i < 500; i++) {
      const d = { x: r.range(-5, 5), z: r.range(-5, 5) };
      const s = toScreen(d);
      const back = fromScreen(s.sx, s.sy);
      expect(back.x).toBeCloseTo(d.x, 10);
      expect(back.z).toBeCloseTo(d.z, 10);
      const sx = r.range(-1, 1), sy = r.range(-1, 1);
      const w = toScreen(fromScreen(sx, sy));
      expect(w.sx).toBeCloseTo(sx, 10);
      expect(w.sy).toBeCloseTo(sy, 10);
    }
  });

  it('preservam o comprimento (rotação pura)', () => {
    const s = toScreen({ x: 3, z: 4 });
    expect(Math.hypot(s.sx, s.sy)).toBeCloseTo(5, 12);
  });
});

describe('dir8 (8 direções na tela)', () => {
  it('cada setor de 45° cai na direção certa', () => {
    const cases: [number, Dir8][] = [[0, 'E'], [45, 'NE'], [90, 'N'], [135, 'NW'], [180, 'W'], [-135, 'SW'], [-90, 'S'], [-45, 'SE']];
    for (const [deg, d] of cases) {
      expect(dir8(screenDir(deg))).toBe(d);
      expect(dir8(screenDir(deg + 20))).toBe(d);
      expect(dir8(screenDir(deg - 20))).toBe(d);
    }
  });

  it('histerese: perto da fronteira mantém a direção anterior', () => {
    expect(dir8(screenDir(26), 'E')).toBe('E');
    expect(dir8(screenDir(26), 'NE')).toBe('NE');
    expect(dir8(screenDir(40), 'E')).toBe('NE');
  });

  it('sideLeft mantém o lado perto da vertical', () => {
    expect(sideLeft(screenDir(180), false)).toBe(true);
    expect(sideLeft(screenDir(0), true)).toBe(false);
    expect(sideLeft(screenDir(88), true)).toBe(true);
    expect(sideLeft(screenDir(88), false)).toBe(false);
  });
});

describe('quadros', () => {
  const all = new Set(Object.keys(FRAMES));
  it('todos os ciclos e clipes usam quadros que existem no atlas', () => {
    const used: string[] = [];
    for (const c of [...Object.values(LOCOMOTION), ...Object.values(IDLE)]) used.push(...c.frames);
    for (const clip of [...ATTACK_CLIPS, DASH_CLIP, GUARD_CLIP, PARRY_CLIP, IAIDO_CLIP]) used.push(...clip.map(([f]) => f));
    for (const f of used) expect(all.has(f)).toBe(true);
  });

  it('cada personagem jogável tem um conjunto completo com quadros do atlas', () => {
    for (const set of Object.values(ANIM_SETS)) {
      const used: string[] = [set.dashLand, set.guardBlock, set.guardExit, set.parryFinish, set.charge, set.hurt, set.dead];
      for (const c of [...Object.values(set.locomotion), ...Object.values(set.idle)]) used.push(...c.frames);
      for (const clip of [...set.attack, set.dash, set.guard, set.parry, set.iaido, set.special]) used.push(...clip.map(([f]) => f));
      expect(set.attack).toHaveLength(3);
      for (const f of used) expect(all.has(f), `${set.id}: ${f}`).toBe(true);
      // o golpe especial precisa cobrir concentração + explosão até o fim da animação
      expect(set.special.at(-2)![1]).toBeLessThan(KIAI.dur + 1e-9);
    }
  });

  it('quadros gerados pelo extrator olham para o mesmo lado do quadro de origem', () => {
    // um derivado com o lado nativo errado espelha a cada passo e o personagem "gira"
    const derived = Object.entries(FRAMES).filter(([, f]) => 'from' in f) as [FrameName, { from: FrameName }][];
    expect(derived.length).toBeGreaterThan(0);
    for (const [name, f] of derived) {
      for (const left of [false, true]) expect(faced(name, left).flip, `${name} (de ${f.from})`).toBe(faced(f.from, left).flip);
    }
  });

  it('Tomoe: perfis usam os quadros desenhados de cada lado, sem espelhar, no ciclo inteiro', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    for (const [deg, cycle] of [[180, TOMOE_ANIM.locomotion.W], [0, TOMOE_ANIM.locomotion.E]] as const) {
      const mem: PoseMemory = { left: false };
      p.state = 'run';
      p.facing = screenDir(deg);
      const seen = new Set<string>();
      for (let d = 0; d < 2.2; d += 0.05) {
        p.stride = d;
        const pose = playerPose(p, mem, 0, 0, TOMOE_ANIM);
        expect(cycle.frames).toContain(pose.frame);
        expect(pose.flip, `${deg}° ${pose.frame}`).toBe(false);
        seen.add(pose.frame);
      }
      expect(seen.size).toBe(cycle.frames.length);
    }
  });

  it('diagonais usam três-quartos próprios (como o Ronin), nunca o ciclo de perfil', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    for (const set of Object.values(ANIM_SETS)) {
      const L = set.locomotion;
      const side = new Set([...L.E.frames, ...L.W.frames]);
      for (const d of ['NE', 'NW', 'SE', 'SW'] as const) {
        for (const f of L[d].frames) expect(side.has(f), `${set.id} ${d}: ${f}`).toBe(false);
      }
      // de frente para baixo, de costas para cima; esquerda = espelho da direita
      expect(L.SE.frames).toEqual(L.SW.frames);
      expect(L.NE.frames).toEqual(L.NW.frames);
      expect(L.SE.frames).not.toEqual(L.NE.frames);
      const flipAt = (deg: number) => {
        p.state = 'run';
        p.facing = screenDir(deg);
        p.stride = 0.1;
        const pose = playerPose(p, { left: false }, 0, 0, set);
        expect(L[dir8(p.facing)].frames).toContain(pose.frame);
        return pose.flip;
      };
      expect(flipAt(-45), `${set.id} SE x SW`).not.toBe(flipAt(-135));
      expect(flipAt(45), `${set.id} NE x NW`).not.toBe(flipAt(135));
    }
  });

  it('Tomoe começa de lado (postura de perfil, como o Ronin), não de frente', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player; // direção inicial da partida (e do fundo do título)
    expect(p.state).toBe('idle');
    const pose = playerPose(p, { left: false }, 0, 0, TOMOE_ANIM);
    expect([...TOMOE_ANIM.idle.W.frames, ...TOMOE_ANIM.idle.E.frames]).toContain(pose.frame);
    expect([...TOMOE_ANIM.locomotion.S.frames, ...TOMOE_ANIM.locomotion.SE.frames, ...TOMOE_ANIM.locomotion.N.frames]).not.toContain(pose.frame);
  });

  it('quadros de locomoção não têm borda reta longa (pedaço do boneco cortado na extração)', () => {
    // folhas com bonecos encostados: uma separação ruim arrancava um retângulo da manga (19-23 texels de borda reta)
    const png = PNG.sync.read(fs.readFileSync(new URL('../../src/assets/sprites/samurai.png', import.meta.url)));
    const edgeRun = (f: { x: number; y: number; h: number }, x: number) => {
      let best = 0, run = 0;
      for (let y = 0; y < f.h; y++) {
        run = png.data[((f.y + y) * png.width + f.x + x) * 4 + 3] > 128 ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best;
    };
    const used = new Set<FrameName>();
    for (const set of Object.values(ANIM_SETS)) for (const c of [...Object.values(set.locomotion), ...Object.values(set.idle)]) c.frames.forEach(f => used.add(f));
    for (const name of used) {
      const f = FRAMES[name];
      expect(Math.max(edgeRun(f, 0), edgeRun(f, f.w - 1)), name).toBeLessThan(16);
    }
  });

  it('faced: perfis espelham conforme o lado; frente/costas nunca espelham', () => {
    expect(faced('runE0', false).flip).toBe(false);
    expect(faced('runE0', true).flip).toBe(true);
    expect(faced('slash', true).flip).toBe(false); // desenho original olha para a esquerda
    expect(faced('slash', false).flip).toBe(true);
    expect(faced('front', true).flip).toBe(false);
    expect(faced('walkN2', true).flip).toBe(false);
  });
});

describe('playerPose / enemyPose', () => {
  it('corrida avança o ciclo com a distância percorrida e espelha para a esquerda', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    const mem: PoseMemory = { left: false };
    p.state = 'run';
    p.facing = screenDir(0);
    const frames = new Set<string>();
    for (let i = 0; i < 6; i++) { p.stride = i * STRIDE + 0.01; frames.add(playerPose(p, mem).frame); }
    expect(frames).toEqual(new Set(LOCOMOTION.E.frames));
    expect(playerPose(p, mem).flip).toBe(false);
    p.facing = screenDir(180);
    expect(playerPose(p, mem).flip).toBe(true);
    expect(mem.left).toBe(true);
  });

  it('andar para baixo/cima usa os ciclos de frente/costas', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    const mem: PoseMemory = { left: false };
    p.state = 'run';
    p.facing = screenDir(-90);
    expect(LOCOMOTION.S.frames).toContain(playerPose(p, mem).frame);
    p.facing = screenDir(90);
    expect(LOCOMOTION.N.frames).toContain(playerPose(p, mem).frame);
  });

  it('o combo percorre os quadros do clipe na ordem', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    const mem: PoseMemory = { left: false };
    p.state = 'attack';
    p.comboStep = 0;
    p.attackDir = screenDir(0);
    const seq: string[] = [];
    for (let t = 0; t < 0.3; t += 1 / 60) { p.t = t; const f = playerPose(p, mem).frame; if (seq.at(-1) !== f) seq.push(f); }
    expect(seq).toEqual(ATTACK_CLIPS[0].map(([f]) => f));
  });

  it('defesa: erguer -> guarda; bloqueio recente mostra o impacto; soltar passa pela saída', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    const mem: PoseMemory = { left: false };
    p.state = 'guard';
    p.t = 0;
    p.sinceBlock = 99;
    expect(playerPose(p, mem).frame).toBe('guardRaise');
    p.t = 0.2;
    expect(playerPose(p, mem).frame).toBe('guardHold');
    p.sinceBlock = 0.05;
    expect(playerPose(p, mem).frame).toBe('guardBlock');
    p.state = 'idle';
    expect(playerPose(p, mem, 0, 0).frame).toBe('guardExit');
    expect(playerPose(p, mem, 0, 0.2).frame).not.toBe('guardExit');
  });

  it('inimigo: preparação ergue a espada e o golpe corta, virados para strikeDir', () => {
    const sim = makeSim({ waves: false });
    const e = spawnActive(sim, 'ronin', { x: 3, z: 0 });
    const mem: PoseMemory = { left: false };
    e.state = 'windup';
    e.t = e.def.windup * 0.5;
    e.strikeDir = screenDir(180);
    expect(enemyPose(e, mem).frame).toBe('atkRaise');
    expect(mem.left).toBe(true);
    e.state = 'strike';
    e.t = 0;
    expect(enemyPose(e, mem).frame).toBe('atkSlash');
    e.state = 'parried';
    expect(enemyPose(e, mem).frame).toBe('crouch');
  });
});
