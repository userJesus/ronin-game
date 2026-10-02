// Jogador: movimento, combo de cortes, ajuda de mira, esquiva e iaido.
import { describe, expect, it } from 'vitest';
import { ARENA, COMBO, DASH, ENEMIES, IAIDO, KI, PLAYER, SIM_DT } from '../../src/config';
import { len } from '../../src/core/math';
import { inp, makeSim, ofType, primeStrike, run, runUntil, spawnActive, spawnFrozen } from './helpers';

const DEG = Math.PI / 180;
const LIM = ARENA.radius - PLAYER.radius;

describe('movimento', () => {
  it('anda na direção do input com a velocidade do config', () => {
    const sim = makeSim({ waves: false });
    const evs = run(sim, 60, inp({ move: { x: 1, z: 0 } }));
    const p = sim.player;
    expect(p.state).toBe('run');
    expect(p.pos.x).toBeGreaterThan(PLAYER.speed * 0.9);
    expect(p.pos.x).toBeLessThan(PLAYER.speed);
    expect(p.pos.z).toBeCloseTo(0, 9);
    expect(len(p.vel)).toBeCloseTo(PLAYER.speed, 6);
    expect(p.facing).toEqual({ x: 1, z: 0 });
    // passos a cada 0.95 m
    expect(ofType(evs, 'footstep').length).toBe(Math.floor(p.stride / 0.95));
  });

  it('input maior que 1 é limitado; input parcial anda mais devagar', () => {
    const a = makeSim({ waves: false });
    run(a, 60, inp({ move: { x: 3, z: 3 } }));
    expect(len(a.player.vel)).toBeCloseTo(PLAYER.speed, 6);
    const b = makeSim({ waves: false });
    run(b, 60, inp({ move: { x: 0, z: -0.5 } }));
    expect(len(b.player.vel)).toBeCloseTo(PLAYER.speed * 0.5, 6);
    expect(b.player.facing).toEqual({ x: 0, z: -1 });
  });

  it('solta o input: desacelera e fica parado', () => {
    const sim = makeSim({ waves: false });
    run(sim, 30, inp({ move: { x: 0, z: 1 } }));
    run(sim, 20);
    expect(sim.player.state).toBe('idle');
    expect(len(sim.player.vel)).toBe(0);
  });

  it('mira sem movimento vira o corpo', () => {
    const sim = makeSim({ waves: false });
    run(sim, 1, inp({ aim: { x: -2, z: 0 } }));
    expect(sim.player.facing).toEqual({ x: -1, z: 0 });
  });

  it('não sai da arena', () => {
    const sim = makeSim({ waves: false });
    run(sim, 60 * 10, inp({ move: { x: 0.6, z: 0.8 } }));
    expect(len(sim.player.pos)).toBeLessThanOrEqual(LIM + 1e-9);
    expect(len(sim.player.pos)).toBeGreaterThan(LIM - 0.01);
  });
});

describe('corte', () => {
  it('emite playerSwing com passo, direção e alcance', () => {
    const sim = makeSim({ waves: false });
    const evs = run(sim, 1, inp({ attack: true }));
    const sw = ofType(evs, 'playerSwing');
    expect(sw).toHaveLength(1);
    expect(sw[0].step).toBe(0);
    expect(sw[0].dir).toEqual({ x: 0, z: 1 });
    expect(sw[0].range).toBe(COMBO[0].range);
    expect(sw[0].halfArc).toBe(COMBO[0].halfArc);
    expect(sim.player.state).toBe('attack');
  });

  it('acerta o inimigo à frente, não o de trás nem o do lado', () => {
    const sim = makeSim({ waves: false });
    const front = spawnFrozen(sim, 'ronin', { x: 0, z: 1.6 });
    const back = spawnFrozen(sim, 'ronin', { x: 0, z: -1.6 });
    const side = spawnFrozen(sim, 'ronin', { x: 1.7, z: 0 });
    const evs = run(sim, 1, inp({ attack: true }));
    evs.push(...run(sim, 40));
    const hits = ofType(evs, 'enemyHit');
    expect(hits.map(h => h.id)).toEqual([front.id]);
    expect(front.hp).toBe(ENEMIES.ronin.hp - COMBO[0].damage);
    expect(back.hp).toBe(ENEMIES.ronin.hp);
    expect(side.hp).toBe(ENEMIES.ronin.hp);
    expect(hits[0].killed).toBe(false);
    // acerto dá ki e congela o quadro um instante
    expect(sim.player.ki).toBe(KI.perHit);
  });

  it('um golpe acerta cada inimigo uma vez só', () => {
    const sim = makeSim({ waves: false });
    const e = spawnFrozen(sim, 'brute', { x: 0, z: 1.5 });
    const evs = run(sim, 1, inp({ attack: true }));
    evs.push(...run(sim, 40));
    expect(ofType(evs, 'enemyHit')).toHaveLength(1);
    expect(e.hp).toBe(ENEMIES.brute.hp - 1);
  });

  it('inimigo surgindo (spawn) é intocável', () => {
    const sim = makeSim({ waves: false });
    const e = sim.spawnEnemy('ronin', { x: 0, z: 1.5 });
    const evs = run(sim, 1, inp({ attack: true }));
    evs.push(...run(sim, 10));
    expect(ofType(evs, 'enemyHit')).toHaveLength(0);
    expect(e.hp).toBe(ENEMIES.ronin.hp);
  });

  it('combo 0 → 1 → 2 e reinicia em 0 (apertando sem parar)', () => {
    const sim = makeSim({ waves: false });
    const evs = run(sim, 150, inp({ attack: true }));
    const steps = ofType(evs, 'playerSwing').map(s => s.step);
    expect(steps.slice(0, 7)).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it('o próximo golpe só sai a partir de cancelAt', () => {
    const sim = makeSim({ waves: false });
    const ticks: number[] = [];
    for (let i = 0; i < 60; i++) {
      sim.step(inp({ attack: true }));
      if (ofType(sim.drainEvents(), 'playerSwing').length) ticks.push(i);
    }
    expect(ticks[0]).toBe(0);
    expect((ticks[1] - ticks[0]) * SIM_DT).toBeGreaterThanOrEqual(COMBO[0].cancelAt - 1e-9);
    expect((ticks[1] - ticks[0]) * SIM_DT).toBeLessThan(COMBO[0].cancelAt + 2 * SIM_DT);
  });

  it('janela de combo: emenda dentro de comboReset, reinicia depois', () => {
    const endOfSwing = Math.ceil(COMBO[0].dur / SIM_DT) + 1;
    const a = makeSim({ waves: false });
    run(a, 1, inp({ attack: true }));
    run(a, endOfSwing);
    expect(a.player.state).toBe('idle');
    run(a, Math.floor((PLAYER.comboReset * 0.5) / SIM_DT));
    const sa = ofType(run(a, 1, inp({ attack: true })), 'playerSwing');
    expect(sa[0].step).toBe(1);

    const b = makeSim({ waves: false });
    run(b, 1, inp({ attack: true }));
    run(b, endOfSwing + Math.ceil(PLAYER.comboReset / SIM_DT) + 2);
    const sb = ofType(run(b, 1, inp({ attack: true })), 'playerSwing');
    expect(sb[0].step).toBe(0);
  });
});

describe('ajuda de mira', () => {
  const at = (deg: number, d: number) => ({ x: Math.sin(deg * DEG) * d, z: Math.cos(deg * DEG) * d });

  it('vira o golpe para inimigo dentro do cone e do alcance', () => {
    const sim = makeSim({ waves: false });
    spawnFrozen(sim, 'ronin', at(40, 3));
    const sw = ofType(run(sim, 1, inp({ attack: true })), 'playerSwing')[0];
    expect(sw.dir.x).toBeCloseTo(Math.sin(40 * DEG), 6);
    expect(sw.dir.z).toBeCloseTo(Math.cos(40 * DEG), 6);
  });

  it('ignora inimigo fora do cone ou longe demais', () => {
    const sim = makeSim({ waves: false });
    spawnFrozen(sim, 'ronin', at(70, 2.5));
    spawnFrozen(sim, 'ronin', at(20, PLAYER.aimAssistRange + 0.5));
    const sw = ofType(run(sim, 1, inp({ attack: true })), 'playerSwing')[0];
    expect(sw.dir).toEqual({ x: 0, z: 1 });
  });

  it('prefere o mais alinhado à mira', () => {
    const sim = makeSim({ waves: false });
    spawnFrozen(sim, 'ronin', at(45, 1.8));
    spawnFrozen(sim, 'ronin', at(5, 2.4));
    const sw = ofType(run(sim, 1, inp({ attack: true })), 'playerSwing')[0];
    expect(sw.dir.x).toBeCloseTo(Math.sin(5 * DEG), 6);
  });

  it('mira explícita (mouse) manda na direção base', () => {
    const sim = makeSim({ waves: false });
    spawnFrozen(sim, 'ronin', { x: 0, z: 2 }); // 90° da mira: fora do cone
    const sw = ofType(run(sim, 1, inp({ attack: true, aim: { x: 1, z: 0 } })), 'playerSwing')[0];
    expect(sw.dir).toEqual({ x: 1, z: 0 });
  });
});

describe('esquiva', () => {
  it('dá invulnerabilidade durante toda a esquiva e entra em recarga', () => {
    const sim = makeSim({ waves: false });
    const evs = run(sim, 1, inp({ dash: true, move: { x: 1, z: 0 } }));
    expect(ofType(evs, 'dash')).toHaveLength(1);
    const p = sim.player;
    let n = 0;
    while (p.state === 'dash' && n < 60) {
      expect(p.invuln).toBeGreaterThan(0);
      run(sim, 1);
      n++;
    }
    expect(n * SIM_DT).toBeGreaterThanOrEqual(DASH.dur - SIM_DT);
    expect(p.pos.x).toBeGreaterThan(DASH.speed * DASH.dur * 0.8);
    // recarga: outra esquiva logo em seguida não sai
    expect(ofType(run(sim, 1, inp({ dash: true, move: { x: 1, z: 0 } })), 'dash')).toHaveLength(0);
    run(sim, Math.ceil(DASH.cooldown / SIM_DT));
    expect(ofType(run(sim, 1, inp({ dash: true, move: { x: 1, z: 0 } })), 'dash')).toHaveLength(1);
  });

  // Jogador encostado na borda esquivando para fora: não sai do lugar,
  // então o que o protege é só a invulnerabilidade.
  const edgeDuel = (dash: boolean) => {
    const sim = makeSim({ waves: false });
    sim.player.pos = { x: 0, z: LIM };
    const e = spawnActive(sim, 'ronin', { x: 0, z: LIM - 1.3 });
    primeStrike(e, { x: 0, z: 1 }, 1);
    const evs = run(sim, 1, inp({ dash, move: dash ? { x: 0, z: 1 } : { x: 0, z: 0 } }));
    evs.push(...run(sim, 40));
    return { sim, evs };
  };

  it('controle: sem esquiva, o golpe acerta', () => {
    const { sim, evs } = edgeDuel(false);
    expect(ofType(evs, 'enemySwing')).toHaveLength(1);
    const hurt = ofType(evs, 'playerHurt');
    expect(hurt).toHaveLength(1);
    expect(sim.player.hp).toBe(PLAYER.maxHp - ENEMIES.ronin.damage);
  });

  it('com esquiva, o mesmo golpe não acerta', () => {
    const { sim, evs } = edgeDuel(true);
    expect(ofType(evs, 'enemySwing')).toHaveLength(1);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
    expect(sim.player.hp).toBe(PLAYER.maxHp);
    expect(len(sim.player.pos)).toBeGreaterThan(LIM - 0.6); // ficou na borda
  });
});

describe('iaido', () => {
  const chargeSteps = Math.ceil(IAIDO.chargeTime / SIM_DT) + 2; // 1 passo para entrar + folga de arredondamento

  it('exige ki >= custo', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = IAIDO.cost - 1;
    const evs = run(sim, 60, inp({ charge: true }));
    expect(ofType(evs, 'chargeStart')).toHaveLength(0);
    expect(sim.player.state).toBe('idle');
  });

  it('carrega: chargeReady depois de chargeTime', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = 100;
    const r = runUntil(sim, evs => ofType(evs, 'chargeReady').length > 0, 120, inp({ charge: true }));
    expect(r.ok).toBe(true);
    expect(ofType(r.events, 'chargeStart')).toHaveLength(1);
    // começa no 1º passo; fica pronto ~chargeTime depois
    expect((r.steps - 1) * SIM_DT).toBeGreaterThanOrEqual(IAIDO.chargeTime - 1e-9);
    expect((r.steps - 1) * SIM_DT).toBeLessThan(IAIDO.chargeTime + 2 * SIM_DT);
    expect(sim.player.chargeReady).toBe(true);
    expect(sim.player.state).toBe('charge');
  });

  it('soltar antes de ficar pronto cancela sem gastar ki', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = 100;
    run(sim, 10, inp({ charge: true }));
    const evs = run(sim, 1);
    expect(ofType(evs, 'chargeCancel')).toHaveLength(1);
    expect(ofType(evs, 'iaidoDash')).toHaveLength(0);
    expect(sim.player.state).toBe('idle');
    expect(sim.player.ki).toBe(100);
  });

  it('ao soltar: corta tudo no caminho, desconta ki e chega ao destino', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = 100;
    const inPath = [2, 4, 6].map(x => spawnFrozen(sim, 'ronin', { x, z: 0 }));
    const off = spawnFrozen(sim, 'ronin', { x: 3, z: 3 });
    run(sim, chargeSteps, inp({ charge: true, aim: { x: 1, z: 0 } }));
    expect(sim.player.chargeReady).toBe(true);
    const evs = run(sim, 1, inp({ aim: { x: 1, z: 0 } }));
    const dash = ofType(evs, 'iaidoDash');
    expect(dash).toHaveLength(1);
    expect(sim.player.ki).toBe(100 - IAIDO.cost);
    expect(dash[0].to.x - dash[0].from.x).toBeCloseTo(IAIDO.distance, 6);
    expect(sim.player.invuln).toBeGreaterThan(IAIDO.dur + IAIDO.recover);
    evs.push(...run(sim, 60));
    const cut = ofType(evs, 'iaidoCut');
    expect(cut).toHaveLength(1);
    expect(cut[0].hits).toBe(3);
    expect(cut[0].kills).toBe(3);
    for (const e of inPath) expect(e.state === 'dying' || !sim.enemies.includes(e)).toBe(true);
    expect(off.hp).toBe(ENEMIES.ronin.hp);
    expect(sim.kills).toBe(3);
    // o jogador termina exatamente no ponto anunciado pelo evento
    expect(sim.player.pos.x).toBeCloseTo(dash[0].to.x, 6);
    expect(sim.player.pos.z).toBeCloseTo(dash[0].to.z, 6);
    expect(sim.player.state).toBe('idle');
  });

  it('para antes de um colisor e não atinge quem está atrás dele', () => {
    const rock = { x: 5, z: 0, r: 1 };
    const sim = makeSim({ waves: false, colliders: [rock] });
    sim.player.ki = 100;
    const behind = spawnFrozen(sim, 'ronin', { x: 6.8, z: 0 });
    run(sim, chargeSteps, inp({ charge: true, aim: { x: 1, z: 0 } }));
    const evs = run(sim, 60, inp({ aim: { x: 1, z: 0 } }));
    const dash = ofType(evs, 'iaidoDash')[0];
    expect(dash.to.x).toBeLessThanOrEqual(rock.x - rock.r - PLAYER.radius + 1e-9);
    expect(dash.to.x).toBeGreaterThan(rock.x - rock.r - PLAYER.radius - 0.2);
    expect(sim.player.pos.x).toBeLessThan(rock.x - rock.r);
    expect(behind.hp).toBe(ENEMIES.ronin.hp);
  });

  it('encostado num colisor, não atravessa ao cortar na direção dele', () => {
    const rock = { x: 2, z: 0, r: 1 };
    const sim = makeSim({ waves: false, colliders: [rock] });
    sim.player.ki = 100;
    sim.player.pos = { x: 1.2, z: 0 }; // dentro: a colisão empurra até encostar
    run(sim, 1);
    expect(sim.player.pos.x).toBeCloseTo(rock.x - rock.r - PLAYER.radius, 9);
    run(sim, chargeSteps, inp({ charge: true, aim: { x: 1, z: 0 } }));
    const evs = run(sim, 60, inp({ aim: { x: 1, z: 0 } }));
    expect(ofType(evs, 'iaidoDash')).toHaveLength(1);
    expect(sim.player.pos.x).toBeLessThan(rock.x);
  });

  it('não sai da arena', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = 100;
    sim.player.pos = { x: 31, z: 0 };
    run(sim, chargeSteps, inp({ charge: true, aim: { x: 1, z: 0 } }));
    const evs = run(sim, 60, inp({ aim: { x: 1, z: 0 } }));
    const dash = ofType(evs, 'iaidoDash')[0];
    expect(len(dash.to)).toBeLessThanOrEqual(LIM + 1e-9);
    expect(len(sim.player.pos)).toBeLessThanOrEqual(LIM + 1e-9);
    expect(sim.player.pos.x).toBeGreaterThan(LIM - 0.2);
  });

  it('esquiva durante a carga cancela sem gastar ki', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = 100;
    run(sim, 10, inp({ charge: true }));
    const evs = run(sim, 1, inp({ charge: true, dash: true, move: { x: 1, z: 0 } }));
    expect(ofType(evs, 'chargeCancel')).toHaveLength(1);
    expect(ofType(evs, 'dash')).toHaveLength(1);
    expect(sim.player.ki).toBe(100);
  });
});
