// Horda: ataque dos inimigos, limite de atacantes, ondas, surgimento, colisões,
// determinismo, morte do jogador e pontuação.
import { describe, expect, it } from 'vitest';
import { AI, ARENA, ENEMIES, KI, PLAYER, SCORE, SIM_DT, WAVES, type EnemyKind } from '../../src/config';
import { Rng, dist, len } from '../../src/core/math';
import type { Sim } from '../../src/sim/sim';
import { idleInput, type SimEvent, type SimInput } from '../../src/sim/types';
import { SPAWN_RADIUS, edgeColliders, hasNaN, inp, makeSim, ofType, primeStrike, run, runUntil, spawnActive, spawnFrozen } from './helpers';

/** Mantém o jogador vivo e parado (para observar só a horda). */
const immortal = (_i: number, sim: Sim): SimInput => { sim.player.hp = PLAYER.maxHp; return idleInput(); };

/** "Executa" todo inimigo vivo (vira cadáver na hora), sem passar pelo combate. */
function cull(sim: Sim): void {
  for (const e of sim.enemies) if (e.state !== 'dying') { e.state = 'dying'; e.t = 0; e.token = false; }
}

function ringOf(sim: Sim, n: number, r0: number, r1: number, kind: EnemyKind = 'ronin', attack = true) {
  const rng = new Rng(42);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = rng.range(r0, r1);
    out.push(spawnActive(sim, kind, { x: sim.player.pos.x + Math.cos(a) * r, z: sim.player.pos.z + Math.sin(a) * r }, attack));
  }
  return out;
}

describe('ataque inimigo', () => {
  it('com ficha: prepara (windup) → golpeia (strike) → fere no alcance', () => {
    const sim = makeSim({ waves: false });
    const e = spawnActive(sim, 'ronin', { x: 0, z: 1.5 }, true);
    const seq: { type: string; tick: number }[] = [];
    const r = runUntil(sim, evs => {
      for (const ev of evs) if (ev.type === 'enemyWindup' || ev.type === 'enemySwing' || ev.type === 'playerHurt') seq.push({ type: ev.type, tick: sim.tick });
      return evs.some(ev => ev.type === 'playerHurt');
    }, 180);
    expect(r.ok).toBe(true);
    expect(seq.map(s => s.type)).toEqual(['enemyWindup', 'enemySwing', 'playerHurt']);
    const windupTime = (seq[1].tick - seq[0].tick) * SIM_DT;
    expect(windupTime).toBeGreaterThanOrEqual(e.def.windup - 1e-9);
    expect(windupTime).toBeLessThan(e.def.windup + 2 * SIM_DT);
    const w = ofType(r.events, 'enemyWindup')[0];
    expect(w.id).toBe(e.id);
    expect(w.duration).toBe(e.def.windup);
    const hurt = ofType(r.events, 'playerHurt')[0];
    expect(hurt.damage).toBe(ENEMIES.ronin.damage);
    expect(sim.player.hp).toBe(PLAYER.maxHp - ENEMIES.ronin.damage);
    expect(sim.player.state).toBe('hurt');
    expect(sim.player.invuln).toBeGreaterThan(0);
  });

  it('sem ficha, só cerca: não prepara golpe', () => {
    const sim = makeSim({ waves: false });
    spawnActive(sim, 'ronin', { x: 0, z: 1.5 }, false);
    const evs = run(sim, 180);
    expect(ofType(evs, 'enemyWindup')).toHaveLength(0);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
  });

  it('golpe fora do alcance não fere', () => {
    const sim = makeSim({ waves: false });
    const e = spawnActive(sim, 'ronin', { x: 0, z: 3.4 });
    primeStrike(e, { x: 0, z: -1 }, 1);
    const evs = run(sim, 40);
    expect(ofType(evs, 'enemySwing')).toHaveLength(1);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
  });

  it('golpe na direção errada (fora do arco) não fere', () => {
    const sim = makeSim({ waves: false });
    const e = spawnActive(sim, 'ronin', { x: 0, z: 1.4 });
    primeStrike(e, { x: 0, z: 1 }, 1); // de costas para o jogador
    const evs = run(sim, 40);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
  });

  it('um corte leve não interrompe o ronin que já está preparando (postura 1)', () => {
    const sim = makeSim({ waves: false });
    const e = spawnActive(sim, 'ronin', { x: 0, z: 1.5 });
    primeStrike(e, { x: 0, z: -1 }, 20);
    e.poiseLeft = ENEMIES.ronin.poise;
    run(sim, 1, inp({ attack: true }));
    run(sim, 8);
    expect(e.hp).toBe(ENEMIES.ronin.hp - 1);
    expect(e.state).toBe('windup');
    expect(e.poiseLeft).toBe(0);
  });

  it('o segundo corte (sem postura restante) interrompe a preparação', () => {
    const sim = makeSim({ waves: false });
    const e = spawnActive(sim, 'ronin', { x: 0, z: 1.5 });
    primeStrike(e, { x: 0, z: -1 }, 30);
    e.poiseLeft = 0;
    const evs = run(sim, 1, inp({ attack: true }));
    evs.push(...run(sim, 40));
    expect(ofType(evs, 'enemySwing')).toHaveLength(0);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
  });

  it('brutamontes absorve golpes leves na preparação (postura)', () => {
    const sim = makeSim({ waves: false });
    const e = spawnActive(sim, 'brute', { x: 0, z: 1.6 });
    primeStrike(e, { x: 0, z: -1 }, 30);
    e.poiseLeft = ENEMIES.brute.poise;
    run(sim, 1, inp({ attack: true }));
    run(sim, 8);
    expect(e.hp).toBe(ENEMIES.brute.hp - 1);
    expect(e.state).toBe('windup');
    expect(e.poiseLeft).toBe(ENEMIES.brute.poise - 1);
  });
});

describe('limite de atacantes', () => {
  const check = (wave: number) => {
    const sim = makeSim({ waves: false, seed: 5 + wave });
    sim.wave = wave;
    ringOf(sim, 20, 2.2, 5.5);
    const cap = WAVES.maxAttackers(wave);
    expect(sim.maxAttackers).toBe(cap);
    let peak = 0, windups = 0;
    for (let i = 0; i < 60 * 20; i++) {
      immortal(i, sim);
      sim.step(idleInput());
      windups += ofType(sim.drainEvents(), 'enemyWindup').length;
      let tokens = 0, active = 0;
      for (const e of sim.enemies) {
        if (e.token) tokens++;
        if (e.state === 'windup' || e.state === 'strike') active++;
        if (e.state === 'windup' || e.state === 'strike') expect(e.token).toBe(true);
      }
      expect(tokens).toBeLessThanOrEqual(cap);
      expect(active).toBeLessThanOrEqual(cap);
      peak = Math.max(peak, tokens);
    }
    expect(peak).toBe(cap); // o limite é de fato alcançado
    expect(windups).toBeGreaterThan(5);
  };
  it('onda 1 (cap 2)', () => check(1));
  it('onda 9 (cap 5)', () => check(9));
});

describe('ondas', () => {
  it('onda 1 gera exatamente WAVES.size(1) inimigos; limpar cura e agenda a próxima', () => {
    const sim = makeSim({ seed: 11 });
    sim.player.hp = 50;
    const evs: SimEvent[] = [];
    let clearTick = -1;
    for (let i = 0; i < 60 * 90 && clearTick < 0; i++) {
      cull(sim);
      sim.player.invuln = 1;
      sim.step(idleInput());
      const got = sim.drainEvents();
      evs.push(...got);
      if (got.some(e => e.type === 'waveClear')) clearTick = sim.tick;
    }
    expect(clearTick).toBeGreaterThan(0);
    const start = ofType(evs, 'waveStart');
    expect(start).toEqual([{ type: 'waveStart', wave: 1, total: WAVES.size(1) }]);
    const spawns = ofType(evs, 'spawn');
    expect(spawns).toHaveLength(WAVES.size(1));
    expect(new Set(spawns.map(s => s.kind))).toEqual(new Set(['ronin']));
    expect(new Set(spawns.map(s => s.id)).size).toBe(spawns.length);
    const clear = ofType(evs, 'waveClear');
    expect(clear).toEqual([{ type: 'waveClear', wave: 1, heal: PLAYER.healPerWave }]);
    expect(sim.player.hp).toBe(50 + PLAYER.healPerWave);
    expect(sim.waveState).toBe('pre');
    expect(sim.waveTimer).toBeCloseTo(WAVES.intermission, 9);
    // a próxima onda começa depois do intervalo
    const r = runUntil(sim, e => e.some(x => x.type === 'waveStart'), Math.ceil(WAVES.intermission / SIM_DT) + 2);
    expect(r.ok).toBe(true);
    expect(r.steps * SIM_DT).toBeGreaterThanOrEqual(WAVES.intermission - 1e-6);
    expect(ofType(r.events, 'waveStart')[0]).toEqual({ type: 'waveStart', wave: 2, total: WAVES.size(2) });
  });

  it('a primeira onda começa após firstDelay', () => {
    const sim = makeSim();
    const r = runUntil(sim, e => e.some(x => x.type === 'waveStart'), 600);
    expect(r.ok).toBe(true);
    expect(r.steps * SIM_DT).toBeCloseTo(WAVES.firstDelay, 1);
  });

  it('a cura ao limpar não passa do máximo', () => {
    const sim = makeSim({ seed: 2 });
    sim.player.hp = PLAYER.maxHp - 5;
    const r = runUntil(sim, e => e.some(x => x.type === 'waveClear'), 60 * 90, (_i, s) => { cull(s); s.player.invuln = 1; return idleInput(); });
    expect(r.ok).toBe(true);
    expect(ofType(r.events, 'waveClear')[0].heal).toBe(5);
    expect(sim.player.hp).toBe(PLAYER.maxHp);
  });

  it('não limpa a onda enquanto houver inimigos vivos', () => {
    const sim = makeSim({ seed: 4 });
    const evs = run(sim, 60 * 30, immortal);
    expect(ofType(evs, 'waveClear')).toHaveLength(0);
    expect(sim.alive).toBe(WAVES.size(1));
  });

  it('composição da onda 5: brutos, rápidos, resto ronin; abre com ronins', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = makeSim({ seed });
      sim.startWave(5);
      const list = sim.toSpawn;
      expect(list).toHaveLength(WAVES.size(5));
      expect(list.filter(k => k === 'brute')).toHaveLength(WAVES.brutes(5));
      expect(list.filter(k => k === 'swift')).toHaveLength(WAVES.swifts(5));
      expect(list.slice(-4)).toEqual(['ronin', 'ronin', 'ronin', 'ronin']);
    }
  });

  it('respeita maxAlive enquanto surge', () => {
    const sim = makeSim({ seed: 8 });
    sim.startWave(8);
    const cap = WAVES.maxAlive(8);
    let peak = 0;
    for (let i = 0; i < 60 * 40; i++) {
      sim.player.invuln = 1;
      sim.step(idleInput());
      sim.drainEvents();
      expect(sim.alive).toBeLessThanOrEqual(cap);
      peak = Math.max(peak, sim.alive);
    }
    expect(peak).toBe(cap);
  });
});

describe('surgimento', () => {
  it('spawnPoint: dentro da arena e a spawnRadius do jogador (ou mais)', () => {
    const sim = makeSim({ waves: false });
    const lim = ARENA.radius - 1.2;
    const spots = [
      { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 0, z: -30 }, { x: -25, z: 25 },
      { x: ARENA.radius - PLAYER.radius, z: 0 }, { x: 0, z: ARENA.radius - PLAYER.radius },
    ];
    for (const at of spots) {
      sim.player.pos = { ...at };
      for (let i = 0; i < 300; i++) {
        const q = sim.spawnPoint();
        expect(len(q)).toBeLessThanOrEqual(lim + 1e-9);
        expect(dist(q, at)).toBeGreaterThanOrEqual(SPAWN_RADIUS - 1e-6);
      }
    }
  });

  it('inimigos das ondas surgem dentro da arena, fora de colisores e longe do jogador', () => {
    const colliders = edgeColliders();
    for (const seed of [3, 9, 27]) {
      const sim = makeSim({ seed, colliders });
      sim.startWave(8);
      let minD = Infinity;
      for (let i = 0; i < 60 * 40; i++) {
        sim.player.invuln = 1;
        // o jogador passeia por perto da borda
        const a = i * SIM_DT * 0.25;
        sim.step(inp({ move: { x: Math.cos(a), z: Math.sin(a) } }));
        for (const ev of ofType(sim.drainEvents(), 'spawn')) {
          const r = ENEMIES[ev.kind].radius;
          expect(len(ev.pos)).toBeLessThanOrEqual(ARENA.radius - r + 1e-9);
          for (const c of colliders) expect(dist(ev.pos, c)).toBeGreaterThanOrEqual(c.r + r - 1e-6);
          minD = Math.min(minD, dist(ev.pos, sim.player.pos));
        }
      }
      // grupo espalha até 1.6 m e o colisor pode empurrar mais um pouco
      expect(minD).toBeGreaterThan(SPAWN_RADIUS * 0.75);
    }
  });
});

describe('colisões', () => {
  it('inimigos amontoados se separam', () => {
    const sim = makeSim({ waves: false });
    sim.player.pos = { x: -15, z: -15 };
    const rng = new Rng(9);
    const es = Array.from({ length: 16 }, () => spawnFrozen(sim, 'ronin', { x: 5 + rng.range(-0.3, 0.3), z: 5 + rng.range(-0.3, 0.3) }));
    run(sim, 60 * 3);
    let minRatio = Infinity;
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      minRatio = Math.min(minRatio, dist(es[i].pos, es[j].pos) / (es[i].def.radius + es[j].def.radius));
    }
    expect(minRatio).toBeGreaterThan(0.97);
  });

  it('multidão perseguindo o jogador: pouca sobreposição, sempre dentro da arena e fora dos colisores', () => {
    const colliders = [{ x: 0, z: 31, r: 1.5 }, { x: 2.6, z: 33.2, r: 0.9 }];
    const sim = makeSim({ waves: false, colliders });
    sim.player.pos = { x: 0, z: 34.5 }; // perto da borda, entre colisores
    const es = ringOf(sim, 30, 4, 12);
    let worst = Infinity;
    for (let i = 0; i < 60 * 12; i++) {
      immortal(i, sim);
      sim.step(idleInput());
      sim.drainEvents();
      for (const e of sim.enemies) {
        expect(hasNaN(e.pos)).toBe(false);
        expect(len(e.pos)).toBeLessThanOrEqual(ARENA.radius - e.def.radius + 1e-9);
        for (const c of colliders) expect(dist(e.pos, c)).toBeGreaterThanOrEqual(c.r + e.def.radius - 1e-6);
      }
      if (i > 60 * 4) {
        for (let a = 0; a < es.length; a++) for (let b = a + 1; b < es.length; b++) {
          worst = Math.min(worst, dist(es[a].pos, es[b].pos) / (es[a].def.radius + es[b].def.radius));
        }
      }
    }
    expect(len(sim.player.pos)).toBeLessThanOrEqual(ARENA.radius - PLAYER.radius + 1e-9);
    for (const c of colliders) expect(dist(sim.player.pos, c)).toBeGreaterThanOrEqual(c.r + PLAYER.radius - 1e-6);
    // uma iteração de relaxamento por passo: aceita-se sobreposição pequena na multidão
    expect(worst).toBeGreaterThan(0.7);
  });

  it('jogador não atravessa inimigos andando (só esquivando)', () => {
    const sim = makeSim({ waves: false });
    const e = spawnFrozen(sim, 'brute', { x: 2, z: 0 });
    run(sim, 60, inp({ move: { x: 1, z: 0 } }));
    expect(sim.player.pos.x).toBeLessThan(e.pos.x);
    expect(dist(sim.player.pos, e.pos)).toBeGreaterThan((PLAYER.radius + e.def.radius) * 0.9);
  });
});

/** Entradas pseudoaleatórias reproduzíveis (independentes da simulação). */
function scriptedInput(seed: number): (i: number, sim: Sim) => SimInput {
  const r = new Rng(seed);
  let move = { x: 0, z: 0 }, hold = 0;
  return () => {
    if (hold-- <= 0) {
      hold = r.int(10, 50);
      const a = r.range(0, Math.PI * 2);
      move = r.next() < 0.2 ? { x: 0, z: 0 } : { x: Math.cos(a), z: Math.sin(a) };
    }
    return { move, aim: r.next() < 0.3 ? { x: move.z, z: -move.x } : null, attack: r.next() < 0.12, dash: r.next() < 0.015, charge: r.next() < 0.4, guard: r.next() < 0.1, special: r.next() < 0.01, transform: false };
  };
}

function snapshot(sim: Sim): string {
  const p = sim.player;
  return JSON.stringify({
    time: sim.time, tick: sim.tick, score: sim.score, kills: sim.kills, combo: sim.combo, wave: sim.wave, ws: sim.waveState,
    toSpawn: sim.toSpawn, hitstop: sim.hitstop, over: sim.over, rng: sim.rng.next(),
    p: [p.pos, p.vel, p.facing, p.hp, p.ki, p.state, p.t, p.comboStep, p.invuln, p.dashCd],
    e: sim.enemies.map(e => [e.id, e.kind, e.pos, e.vel, e.hp, e.state, e.t, e.token, e.tokenCd, e.def.speed]),
  });
}

describe('determinismo', () => {
  it('mesma semente + mesmas entradas → mesmo estado e mesmos eventos', () => {
    const a = makeSim({ seed: 1234, colliders: edgeColliders() });
    const b = makeSim({ seed: 1234, colliders: edgeColliders() });
    const ia = scriptedInput(77), ib = scriptedInput(77);
    for (let i = 0; i < 60 * 40; i++) {
      a.step(ia(i, a));
      b.step(ib(i, b));
      if (i % 120 === 0) {
        a.player.hp = b.player.hp = Math.max(a.player.hp, 60); // mantém a partida viva
        expect(snapshot(a)).toBe(snapshot(b));
      }
      expect(JSON.stringify(a.drainEvents())).toBe(JSON.stringify(b.drainEvents()));
    }
    expect(snapshot(a)).toBe(snapshot(b));
    expect(a.wave).toBeGreaterThanOrEqual(1);
    expect(a.kills + a.enemies.length).toBeGreaterThan(0);
  });

  it('sementes diferentes divergem', () => {
    const a = makeSim({ seed: 1 }), b = makeSim({ seed: 2 });
    run(a, 60 * 8); run(b, 60 * 8);
    expect(snapshot(a)).not.toBe(snapshot(b));
  });
});

describe('morte do jogador', () => {
  it('over=true, evento playerDeath e a horda para', () => {
    const sim = makeSim({ seed: 21 });
    sim.startWave(2);
    run(sim, 60 * 2); // alguns já surgiram, outros esperam
    expect(sim.toSpawn.length).toBeGreaterThan(0);
    const killer = spawnActive(sim, 'ronin', { x: sim.player.pos.x, z: sim.player.pos.z + 1.4 });
    primeStrike(killer, { x: 0, z: -1 }, 1);
    sim.player.hp = 5;
    sim.player.invuln = 0;
    const r = runUntil(sim, e => e.some(x => x.type === 'playerDeath'), 30);
    expect(r.ok).toBe(true);
    expect(sim.over).toBe(true);
    expect(sim.player.hp).toBe(0);
    expect(sim.player.state).toBe('dead');
    expect(ofType(r.events, 'playerHurt').at(-1)?.hp).toBe(0);
    const pending = sim.toSpawn.length;
    const after = run(sim, 60 * 6, inp({ attack: true, dash: true, move: { x: 1, z: 0 } }));
    for (const t of ['spawn', 'enemyWindup', 'playerHurt', 'waveStart', 'waveClear', 'playerSwing', 'dash'] as const) {
      expect(ofType(after, t)).toHaveLength(0);
    }
    expect(sim.toSpawn.length).toBe(pending);
    expect(sim.player.state).toBe('dead');
    for (const e of sim.enemies) {
      expect(e.token).toBe(false);
      expect(len(e.vel)).toBeLessThan(0.05);
    }
  });
});

describe('pontuação', () => {
  it('multiplicador por faixas de 10 acertos, até 3x', () => {
    expect(SCORE.multiplier(0)).toBe(1);
    expect(SCORE.multiplier(9)).toBe(1);
    expect(SCORE.multiplier(10)).toBe(1.25);
    expect(SCORE.multiplier(39)).toBe(1.75);
    expect(SCORE.multiplier(40)).toBe(2);
    expect(SCORE.multiplier(80)).toBe(3);
    expect(SCORE.multiplier(10_000)).toBe(3);
  });

  it('abate aplica o multiplicador do combo (contando o acerto atual)', () => {
    const sim = makeSim({ waves: false });
    sim.combo = 9;
    sim.comboTimer = SCORE.comboTimeout;
    sim.player.hp = 50;
    spawnFrozen(sim, 'swift', { x: 0, z: 1.5 });
    const evs = run(sim, 1, inp({ attack: true }));
    evs.push(...run(sim, 20));
    const death = ofType(evs, 'enemyDeath');
    expect(death).toHaveLength(1);
    expect(death[0].score).toBe(Math.round(ENEMIES.swift.score * 1.25));
    expect(sim.score).toBe(Math.round(ENEMIES.swift.score * 1.25));
    expect(sim.kills).toBe(1);
    expect(sim.combo).toBe(10);
    expect(sim.multiplier).toBe(1.25);
    expect(sim.player.ki).toBe(KI.perHit + KI.perKill * ENEMIES.swift.ki);
    expect(sim.player.hp).toBe(50 + PLAYER.healPerKill);
  });

  it('combo zera ao levar golpe e depois de comboTimeout sem acertar', () => {
    const sim = makeSim({ waves: false });
    spawnFrozen(sim, 'brute', { x: 0, z: 1.5 });
    run(sim, 1, inp({ attack: true }));
    run(sim, 10);
    expect(sim.combo).toBe(1);
    run(sim, Math.ceil(SCORE.comboTimeout / SIM_DT) + 12);
    expect(sim.combo).toBe(0);
    expect(sim.bestCombo).toBe(1);

    const s2 = makeSim({ waves: false });
    s2.combo = 25;
    s2.comboTimer = SCORE.comboTimeout;
    const e = spawnActive(s2, 'ronin', { x: 0, z: 1.4 });
    primeStrike(e, { x: 0, z: -1 }, 1);
    const evs = run(s2, 20);
    expect(ofType(evs, 'playerHurt')).toHaveLength(1);
    expect(s2.combo).toBe(0);
  });

  it('morto por frames de morte some depois de deathTime', () => {
    const sim = makeSim({ waves: false });
    const e = spawnFrozen(sim, 'swift', { x: 0, z: 1.5 });
    run(sim, 1, inp({ attack: true }));
    run(sim, 10);
    expect(e.state).toBe('dying');
    run(sim, Math.ceil(AI.deathTime / SIM_DT) + 2);
    expect(sim.enemies.includes(e)).toBe(false);
  });
});
