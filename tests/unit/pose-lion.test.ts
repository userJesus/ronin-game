// Animação da forma de leão: quadros, clipes casados com a simulação (transformação, garra, rugido) e ciclos
// nas 8 direções.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { LION, SIM_DT } from '../../src/config';
import {
  ANIM_SETS, DIRS, LION_CLAW_CLIP, LION_GAITS, LION_IDLE, LION_ROAR_CHARGE_CLIP, LION_ROAR_CLIP, REVERT_CLIP, TRANSFORM_CLIP,
  dir8, fromScreen, playerPose, type Dir8, type PoseMemory,
} from '../../src/render/pose';
import atlas from '../../src/assets/sprites/samurai.json';
import { inp, makeSim, run, runUntil } from './helpers';

type Clip = readonly (readonly [string, number])[];
const FRAMES = atlas.frames as Record<string, { x: number; y: number; w: number; h: number; ax: number; ay: number }>;
const DEG = Math.PI / 180;
const screenDir = (deg: number) => fromScreen(Math.cos(deg * DEG), Math.sin(deg * DEG));
const DIR_DEG: Record<Dir8, number> = { E: 0, NE: 45, N: 90, NW: 135, W: 180, SW: -135, S: -90, SE: -45 };
const isLion = (f: string) => /^(l[wr][SNWE]\d\d|l(NW|NE|SW|SE)\d\d|lclaw\d\d|lroar\d\d|tf\d\d)$/.test(f);
const isMove = (f: string) => /^(l[wr][SNWE]\d\d|l(NW|NE|SW|SE)\d\d)$/.test(f);
const frameAt = (clip: Clip, t: number) => (clip.find(([, until]) => t < until) ?? clip[clip.length - 1])[0];
const steps = (s: number) => Math.ceil(s / SIM_DT);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const GAIT_FRAMES = Object.values(LION_GAITS).flatMap(g => Object.values(g.frames).flat());
const CLIPS = { claw: LION_CLAW_CLIP, roarCharge: LION_ROAR_CHARGE_CLIP, roar: LION_ROAR_CLIP, transform: TRANSFORM_CLIP, revert: REVERT_CLIP };
const USED = new Set<string>([...GAIT_FRAMES, ...Object.values(LION_IDLE), ...Object.values(CLIPS).flatMap(c => c.map(([f]) => f))]);

const png = PNG.sync.read(fs.readFileSync(new URL('../../src/assets/sprites/samurai.png', import.meta.url)));
const opaque = (f: { x: number; y: number }, x: number, y: number) => png.data[((f.y + y) * png.width + f.x + x) * 4 + 3] > 128;
/** Altura que aparece na tela: do chão (âncora) até o pixel mais alto, em texels. */
function height(name: string): number {
  const f = FRAMES[name];
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (opaque(f, x, y)) return f.ay - y;
  return 0;
}

function lionSim() {
  const sim = makeSim({ waves: false });
  const p = sim.player;
  p.form = 'lion';
  p.fury = LION.max;
  return { sim, p };
}

describe('leão: quadros e clipes', () => {
  it('todos os quadros usados existem no atlas e são do leão', () => {
    for (const f of USED) {
      expect(FRAMES[f], f).toBeDefined();
      expect(isLion(f), f).toBe(true);
    }
    // os quadros com duas caudas ficam de fora dos ciclos
    for (const f of ['lwS02', 'lrS02', 'lwN03', 'lrN03', 'lNE05']) expect(GAIT_FRAMES, f).not.toContain(f);
  });

  it('cada direção usa os próprios desenhos, com o mesmo ciclo em todas as vistas', () => {
    const own: Record<Dir8, RegExp> = {
      S: /^l[wr]S/, N: /^l[wr]N/, W: /^l[wr]W/, E: /^l[wr]E/, NW: /^lNW/, NE: /^lNE/, SW: /^lSW/, SE: /^lSE/,
    };
    for (const d of DIRS) {
      for (const [gait, g] of Object.entries(LION_GAITS)) {
        const frames = g.frames[d];
        expect(frames.length, `${gait} ${d}`).toBeGreaterThanOrEqual(5);
        for (const f of frames) expect(f, `${gait} ${d}`).toMatch(own[d]);
        if (d === 'S' || d === 'N' || d === 'W' || d === 'E') for (const f of frames) expect(f[1], f).toBe(gait === 'run' ? 'r' : 'w');
      }
      expect(LION_IDLE[d]).toMatch(own[d]);
    }
  });

  it('cadência: galopando a LION.speed toca 10-22 quadros/s; os respingos caem duas vezes por ciclo', () => {
    const cps = LION.speed / LION_GAITS.run.cycle;
    for (const frames of Object.values(LION_GAITS.run.frames)) {
      const fps = cps * frames.length;
      expect(fps).toBeGreaterThanOrEqual(10);
      expect(fps).toBeLessThanOrEqual(22);
    }
    // andando no limite (LION.walkBelow) também não dispara
    for (const frames of Object.values(LION_GAITS.walk.frames)) expect(LION.walkBelow / LION_GAITS.walk.cycle * frames.length).toBeLessThanOrEqual(22);
    expect(LION.footstep.length * 2).toBeCloseTo(LION_GAITS.run.cycle, 9);
  });

  it('a transformação cobre LION.transformDur e o leão completo (tf15) aparece no instante do rugido', () => {
    expect(TRANSFORM_CLIP.at(-1)![1]).toBeCloseTo(LION.transformDur, 9);
    expect(REVERT_CLIP.at(-1)![1]).toBeCloseTo(LION.revertDur, 9);
    expect(TRANSFORM_CLIP[0][0]).toBe('tf00');
    expect(TRANSFORM_CLIP.at(-1)![0]).toBe('tf20');
    // um passo de simulação de folga em volta de burstAt
    expect(frameAt(TRANSFORM_CLIP, LION.burstAt + 1 / 60)).toBe('tf15');
    expect(frameAt(TRANSFORM_CLIP, LION.burstAt - 1 / 30)).not.toBe('tf15');
  });

  it('garra: arma a pata, o arco (lclaw05-08) cobre a janela ativa e volta à guarda em LION.claw.dur', () => {
    const c = LION.claw;
    const isArc = (f: string) => /^lclaw0[5-8]$/.test(f);
    expect(LION_CLAW_CLIP.at(-1)![1]).toBeCloseTo(c.dur, 9);
    expect(LION_CLAW_CLIP.at(-1)![0]).toBe('lclaw17');
    // em ordem na folha
    const idx = LION_CLAW_CLIP.map(([f]) => Number(f.slice(-2)));
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    for (let t = 0; t < c.activeFrom - 1e-9; t += 0.005) expect(isArc(frameAt(LION_CLAW_CLIP, t)), `t=${t}`).toBe(false);
    for (let t = c.activeFrom; t <= c.activeTo + 1e-9; t += 0.005) expect(isArc(frameAt(LION_CLAW_CLIP, t)), `t=${t}`).toBe(true);
    expect(frameAt(LION_CLAW_CLIP, c.activeFrom)).toBe('lclaw05');
    // depois do golpe, o acompanhamento rente ao chão aparece antes de emendar outra garra (cancelAt)
    expect(LION_CLAW_CLIP.some(([f, until]) => f === 'lclaw09' && until <= c.cancelAt + 0.02)).toBe(true);
  });

  it('rugido: agacha na carga, a primeira onda (lroar05) aparece no estouro e a maior (07) fica mais tempo', () => {
    const r = LION.roar;
    expect(LION_ROAR_CHARGE_CLIP[0][0]).toBe('lroar00');
    expect(frameAt(LION_ROAR_CHARGE_CLIP, r.chargeTime)).toBe('lroar03');
    expect(frameAt(LION_ROAR_CHARGE_CLIP, r.chargeTime * 5)).toBe('lroar03');
    expect(LION_ROAR_CLIP.at(-1)![1]).toBeCloseTo(r.dur, 9);
    expect(LION_ROAR_CLIP.at(-1)![0]).toBe('lroar12');
    expect(frameAt(LION_ROAR_CLIP, 0)).toBe('lroar04');
    expect(frameAt(LION_ROAR_CLIP, r.blastAt + 1 / 60)).toBe('lroar05');
    expect(frameAt(LION_ROAR_CLIP, r.blastAt - 1 / 30)).toBe('lroar04');
    const held = LION_ROAR_CLIP.map(([f, until], i) => [f, until - (i ? LION_ROAR_CLIP[i - 1][1] : 0)] as const);
    const longest = held.slice(1).reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(longest[0]).toBe('lroar07');
  });

  it('o mesmo tamanho em todos os quadros: vistas, golpes e o fim da transformação', () => {
    // cada vista com o mesmo tamanho em todos os quadros de cada andadura; andar e galope perto um do outro
    // (o galope de perfil se estica e baixa um pouco o corpo)
    const medians: number[] = [];
    for (const d of DIRS) {
      const gait = (fs: readonly string[]) => fs.map(height);
      const walk = gait([...LION_GAITS.walk.frames[d], LION_IDLE[d]]), run = gait(LION_GAITS.run.frames[d]);
      for (const hs of [walk, run]) expect(Math.max(...hs) / Math.min(...hs), d).toBeLessThan(1.12);
      expect(Math.max(median(walk), median(run)) / Math.min(median(walk), median(run)), d).toBeLessThan(1.12);
      medians.push(median([...walk, ...run]));
    }
    // vistas diferentes só diferem pela perspectiva (de frente/costas o corpo comprido sobe na tela)
    expect(Math.max(...medians) / Math.min(...medians)).toBeLessThan(1.25);
    // a postura dos golpes (desenhada de lado) do tamanho do perfil da movimentação
    const side = median([...LION_GAITS.run.frames.E, ...LION_GAITS.run.frames.W, ...LION_GAITS.walk.frames.E, ...LION_GAITS.walk.frames.W].map(height));
    for (const f of ['lclaw00', 'lclaw17', 'lroar00', 'lroar12']) expect(Math.abs(height(f) / side - 1), f).toBeLessThan(0.1);
    // nenhum quadro de golpe cresce (o arco e as ondas são largos, não altos)
    for (const [f] of [...LION_CLAW_CLIP, ...LION_ROAR_CLIP]) expect(height(f) / side, f).toBeLessThan(1.12);
    // começa do tamanho do Ronin de pé e termina perto do leão parado (a aura passa um pouco)
    expect(Math.abs(height('tf00') - height('front'))).toBeLessThanOrEqual(3);
    const idle = median(Object.values(LION_IDLE).map(height));
    expect(height('tf20') / idle).toBeLessThan(1.2);
    // não maior que o samurai de pé na tela
    for (const f of USED) if (isMove(f) || /^l(claw|roar)/.test(f)) expect(height(f), f).toBeLessThanOrEqual(height('front'));
  });
});

describe('leão: extração', () => {
  it('quadros do leão não têm borda reta longa (pedaço cortado na separação dos bonecos encostados)', () => {
    const edgeRun = (f: { x: number; y: number; h: number }, x: number) => {
      let best = 0, run = 0;
      for (let y = 0; y < f.h; y++) { run = opaque(f, x, y) ? run + 1 : 0; best = Math.max(best, run); }
      return best;
    };
    for (const n of USED) {
      if (!isMove(n) && !/^l(claw|roar)/.test(n)) continue;
      const f = FRAMES[n];
      expect(Math.max(edgeRun(f, 0), edgeRun(f, f.w - 1)), n).toBeLessThan(16);
    }
  });
});

describe('leão: pose por estado e direção', () => {
  it('nas 8 direções, parado e correndo, só quadros de movimentação da própria direção e sem espelho', () => {
    const { p } = lionSim();
    for (const d of DIRS) {
      p.facing = screenDir(DIR_DEG[d]);
      for (const state of ['idle', 'run'] as const) {
        p.state = state;
        for (const speed of state === 'run' ? [2, LION.speed] : [0]) {
          p.vel = { x: p.facing.x * speed, z: p.facing.z * speed };
          const mem: PoseMemory = { left: false };
          const own = state === 'idle' ? [LION_IDLE[d]] : [...LION_GAITS.run.frames[d], ...LION_GAITS.walk.frames[d]];
          for (let s = 0; s < 6; s += 0.13) {
            p.stride = s;
            const pose = playerPose(p, mem, 0, 1 / 60, ANIM_SETS.ronin);
            expect(isMove(pose.frame), `${d} ${state} ${pose.frame}`).toBe(true);
            expect(own, `${d} ${state}`).toContain(pose.frame);
            expect(pose.flip, `${d} ${state} ${pose.frame}`).toBe(false);
          }
        }
      }
    }
  });

  it('o galope percorre todos os quadros com a distância e virar não reinicia o ciclo', () => {
    const { p } = lionSim();
    p.state = 'run';
    p.facing = screenDir(180);
    p.vel = { x: p.facing.x * LION.speed, z: p.facing.z * LION.speed };
    const mem: PoseMemory = { left: false };
    const frames = LION_GAITS.run.frames.W;
    const seen: string[] = [];
    for (let s = 0; s < LION.strideRun - 1e-9; s += LION.strideRun / frames.length / 3) {
      p.stride = s;
      const f = playerPose(p, mem, 0, 1 / 60, ANIM_SETS.ronin).frame;
      if (seen.at(-1) !== f) seen.push(f);
    }
    expect(seen).toEqual(frames); // um ciclo por LION.strideRun, na ordem da folha
    // vira de W (5 quadros) para SE (6 quadros) no meio do ciclo: a fase continua de onde estava
    p.stride = LION.strideRun * 7.4;
    playerPose(p, mem, 0, 1 / 60, ANIM_SETS.ronin);
    const phase = mem.phase!;
    p.facing = screenDir(-45);
    p.vel = { x: p.facing.x * LION.speed, z: p.facing.z * LION.speed };
    p.stride += 0.01;
    const pose = playerPose(p, mem, 0, 1 / 60, ANIM_SETS.ronin);
    expect(dir8(p.facing)).toBe('SE');
    expect(Math.abs(mem.phase! - phase)).toBeLessThan(0.01);
    const s = LION_GAITS.run.frames.SE;
    expect(pose.frame).toBe(s[Math.floor(mem.phase! * s.length) % s.length]);
  });

  it('os respingos das patas (simulação) caem sempre na mesma fase do ciclo, também depois de parar e voltar', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    p.form = 'lion';
    p.radius = LION.radius;
    p.fury = LION.max;
    const mem: PoseMemory = { left: false };
    const phases = new Set<number>();
    for (let lap = 0; lap < 4; lap++) {
      for (let i = 0; i < 70; i++) {
        sim.step(inp({ move: { x: lap % 2 ? 1 : -1, z: 0.3 } }));
        const paw = sim.drainEvents().some(e => e.type === 'footstep');
        playerPose(p, mem, 0, SIM_DT, ANIM_SETS.ronin);
        if (paw && mem.gait === 'run') phases.add(Math.round((mem.phase! * 2 % 1) * 20) % 20);
      }
      run(sim, 30); // para (o leão anda um pouco ao frear e ao arrancar)
    }
    // duas batidas por ciclo, sempre no mesmo ponto (a menos de um passo de simulação)
    expect(phases.size).toBeGreaterThan(0);
    const spread = (LION.speed * SIM_DT) / LION.footstep.length * 20;
    const vals = [...phases].sort((a, b) => a - b);
    expect(Math.min(vals.at(-1)! - vals[0], 20 - vals.at(-1)! + vals[0])).toBeLessThanOrEqual(Math.ceil(spread) + 1);
  });

  it('devagar (analógico pela metade) anda; rápido galopa, com histerese', () => {
    const { p } = lionSim();
    p.state = 'run';
    p.facing = screenDir(180);
    const mem: PoseMemory = { left: false };
    const at = (speed: number) => { p.vel = { x: p.facing.x * speed, z: p.facing.z * speed }; p.stride += 0.05; return playerPose(p, mem, 0, 1 / 60, ANIM_SETS.ronin).frame; };
    expect(at(2)).toMatch(/^lwW/);
    expect(at(LION.walkBelow * 0.95)).toMatch(/^lwW/);
    expect(at(LION.speed)).toMatch(/^lrW/);
    expect(at(LION.walkBelow * 0.95)).toMatch(/^lrW/); // histerese: não volta a andar logo abaixo do limite
    expect(at(1)).toMatch(/^lwW/);
  });

  it('garra e rugido: desenhados para a direita, espelham virados para a esquerda; carga pronta treme', () => {
    const { p } = lionSim();
    p.vel = { x: 0, z: 0 };
    for (const [deg, left] of [[0, false], [180, true], [30, false], [-150, true]] as const) {
      const dir = screenDir(deg);
      p.state = 'claw';
      p.attackDir = dir;
      p.facing = dir;
      for (const [f, until] of LION_CLAW_CLIP) {
        p.t = until - 0.005;
        const pose = playerPose(p, { left: !left }, 0, 0, ANIM_SETS.ronin);
        expect(pose.frame).toBe(f);
        expect(pose.flip, `${deg} ${f}`).toBe(left);
      }
      p.state = 'roarCharge';
      p.chargeReady = false;
      p.t = 0.2;
      let pose = playerPose(p, { left: !left }, 0, 0, ANIM_SETS.ronin);
      expect(pose.frame).toMatch(/^lroar0[0-3]$/);
      expect(pose.flip).toBe(left);
      p.state = 'roar';
      p.t = LION.roar.blastAt + 0.01;
      pose = playerPose(p, { left: !left }, 0, 0, ANIM_SETS.ronin);
      expect(pose.frame).toBe('lroar05');
      expect(pose.flip).toBe(left);
    }
    // garra para cima: mantém o lado em que estava
    p.state = 'claw';
    p.attackDir = screenDir(90);
    p.t = LION.claw.activeFrom;
    expect(playerPose(p, { left: true }, 0, 0, ANIM_SETS.ronin).flip).toBe(true);
    expect(playerPose(p, { left: false }, 0, 0, ANIM_SETS.ronin).flip).toBe(false);
    // carga: parada no agachado; pronta, sobe e desce 1 texel
    p.state = 'roarCharge';
    p.facing = screenDir(0);
    const lifts = new Set<number>();
    for (const ready of [false, true]) {
      p.chargeReady = ready;
      for (let t = LION.roar.chargeTime; t < LION.roar.chargeTime + 0.5; t += 0.01) {
        p.t = t;
        const pose = playerPose(p, { left: false }, 0, 0, ANIM_SETS.ronin);
        expect(pose.frame).toBe('lroar03');
        if (!ready) expect(pose.lift ?? 0).toBe(0);
        else lifts.add(pose.lift ?? 0);
      }
    }
    expect(lifts).toEqual(new Set([0, 1]));
  });

  it('com a simulação: o arco da garra está na tela quando ela acerta e a onda quando o rugido estoura', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    p.fury = LION.max;
    run(sim, 1, inp({ transform: true }));
    run(sim, steps(LION.transformDur) + 12);
    expect(p.form).toBe('lion');
    const mem: PoseMemory = { left: false };
    // garra
    const claw = runUntil(sim, evs => evs.some(e => e.type === 'lionClaw'), 60, i => inp({ attack: i === 0, aim: { x: 1, z: 0 } }));
    expect(claw.ok).toBe(true);
    expect(p.state).toBe('claw');
    expect(playerPose(p, mem, 0, SIM_DT, ANIM_SETS.ronin).frame).toMatch(/^lclaw0[5-8]$/);
    run(sim, steps(LION.claw.dur) + 4);
    expect(p.state).toBe('idle');
    // rugido: segura até ficar pronto, solta, estoura
    const ready = runUntil(sim, evs => evs.some(e => e.type === 'lionRoarReady'), 120, inp({ charge: true }));
    expect(ready.ok).toBe(true);
    expect(playerPose(p, mem, 0, SIM_DT, ANIM_SETS.ronin).frame).toBe('lroar03');
    const blast = runUntil(sim, evs => evs.some(e => e.type === 'lionRoar'), 60);
    expect(blast.ok).toBe(true);
    expect(playerPose(p, mem, 0, SIM_DT, ANIM_SETS.ronin).frame).toBe('lroar05');
    run(sim, steps(LION.roar.dur));
    expect(isMove(playerPose(p, mem, 0, SIM_DT, ANIM_SETS.ronin).frame)).toBe(true);
  });

  it('transformação e volta usam os próprios clipes; humanos (Ronin e Tomoe) nunca mostram o leão', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    p.state = 'transform';
    p.t = LION.burstAt + 0.05;
    expect(playerPose(p, { left: false }, 0, 0, ANIM_SETS.ronin).frame).toBe('tf15');
    p.state = 'revert';
    p.t = 0;
    expect(playerPose(p, { left: false }, 0, 0, ANIM_SETS.ronin).frame).toBe('tf20');
    for (const set of Object.values(ANIM_SETS)) {
      for (const state of ['idle', 'run', 'attack', 'charge', 'iaido', 'kiai'] as const) {
        p.state = state;
        p.t = 0.1;
        for (const d of DIRS) {
          p.facing = screenDir(DIR_DEG[d]);
          p.attackDir = p.facing;
          const mem: PoseMemory = { left: false };
          for (let s = 0; s < 3; s += 0.2) { p.stride = s; expect(isLion(playerPose(p, mem, 0, 0, set).frame), `${set.id} ${state} ${d}`).toBe(false); }
        }
      }
    }
  });
});
