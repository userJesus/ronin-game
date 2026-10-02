// Forma de leão do Ronin: barra de Fúria, transformação (R), movimento do leão e a volta a humano.
import { describe, expect, it } from 'vitest';
import { DEG, ENEMIES, KIAI, LION, PLAYER, SIM_DT } from '../../src/config';
import { add, dist, dot, fromAngle, len, scale, sub, type Vec2 } from '../../src/core/math';
import type { Sim } from '../../src/sim/sim';
import { inp, makeSim, ofType, primeStrike, run, runUntil, spawnActive, spawnFrozen } from './helpers';

const steps = (s: number) => Math.ceil(s / SIM_DT);

/** Ronin com a Fúria cheia, já transformado em leão (passa pela transformação inteira). */
function lion(sim: Sim = makeSim({ waves: false })): Sim {
  sim.player.fury = LION.max;
  run(sim, 1, inp({ transform: true }));
  run(sim, steps(LION.transformDur) + 12);
  expect(sim.player.form).toBe('lion');
  return sim;
}

describe('Fúria e transformação', () => {
  it('com a barra incompleta, R não faz nada', () => {
    const sim = makeSim({ waves: false });
    sim.player.fury = LION.max - 1;
    sim.player.ki = 100;
    const evs = run(sim, 30, inp({ transform: true }));
    expect(ofType(evs, 'transformStart')).toHaveLength(0);
    expect(sim.player.state).toBe('idle');
    expect(sim.player.ki).toBe(100);
  });

  it('com a barra cheia, R transforma: invulnerável, não gasta Ki, rugido no meio e leão no fim', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    p.fury = LION.max;
    p.ki = 60;
    const near = spawnActive(sim, 'ronin', { x: 2, z: 0 }, true);
    const far = spawnFrozen(sim, 'ronin', { x: LION.burstRadius + 4, z: 0 });
    primeStrike(near, { x: -1, z: 0 }, 20);
    const evs = run(sim, 1, inp({ transform: true }));
    expect(ofType(evs, 'transformStart')).toHaveLength(1);
    expect(p.state).toBe('transform');
    expect(p.ki).toBe(60);
    // o golpe preparado chega no meio da transformação e não fere
    const mid = run(sim, steps(LION.burstAt) - 5);
    expect(ofType(mid, 'playerHurt')).toHaveLength(0);
    expect(p.form).toBe('human');
    const burst = runUntil(sim, evs2 => ofType(evs2, 'transformBurst').length > 0, 30);
    expect(burst.ok).toBe(true);
    const b = ofType(burst.events, 'transformBurst')[0];
    expect(b.pushed).toBeGreaterThanOrEqual(1);
    expect(p.form).toBe('lion');
    expect(p.radius).toBe(LION.radius);
    // empurra e atordoa sem matar; quem está longe não é afetado
    expect(near.state).toBe('stagger');
    expect(near.hp).toBe(ENEMIES.ronin.hp);
    // empurrado para longe do leão (a velocidade aponta para fora)
    const out = { x: near.pos.x - p.pos.x, z: near.pos.z - p.pos.z };
    expect(near.vel.x * out.x + near.vel.z * out.z).toBeGreaterThan(0);
    const d0 = dist(near.pos, p.pos);
    run(sim, steps(0.3));
    expect(dist(near.pos, p.pos)).toBeGreaterThan(d0 + 0.5);
    expect(far.state).toBe('stagger'); // continua congelado como estava (spawnFrozen)
    expect(far.vel).toEqual({ x: 0, z: 0 });
    const end = runUntil(sim, e => ofType(e, 'transformEnd').length > 0, steps(LION.transformDur));
    expect(end.ok).toBe(true);
    expect(p.state).toBe('idle');
    expect(p.fury).toBeGreaterThan(LION.max * 0.9);
  });

  it('o rugido sai no instante em que o leão completo aparece (LION.burstAt)', () => {
    const sim = makeSim({ waves: false });
    sim.player.fury = LION.max;
    const r = runUntil(sim, e => ofType(e, 'transformBurst').length > 0, steps(LION.transformDur), (i) => inp({ transform: i === 0 }));
    expect(r.ok).toBe(true);
    // o primeiro passo processa o R; a hora do rugido conta a partir daí
    expect(Math.abs((r.steps - 1) * SIM_DT - LION.burstAt)).toBeLessThan(SIM_DT * 1.5);
  });

  it('R apertado durante o congelamento de impacto fica guardado e transforma quando ele acaba', () => {
    const sim = makeSim({ waves: false });
    sim.player.fury = LION.max;
    sim.hitstop = 0.1;
    run(sim, 1, inp({ transform: true }));
    expect(sim.player.state).toBe('idle');
    run(sim, steps(0.1) + 1);
    expect(sim.player.state).toBe('transform');
  });
});

describe('forma de leão', () => {
  it('corre mais que o humano; esquiva, defesa e Kiai ficam travados; corte vira garra e iaido vira rugido', () => {
    const sim = lion();
    const p = sim.player;
    p.ki = 100;
    run(sim, 60, inp({ move: { x: 1, z: 0 } }));
    expect(p.state).toBe('run');
    expect(len(p.vel)).toBeCloseTo(LION.speed, 3);
    expect(LION.speed).toBeGreaterThan(PLAYER.speed);
    run(sim, 30); // para
    const locked = [
      ...run(sim, 10, inp({ dash: true })),
      ...run(sim, 10, inp({ guard: true })),
      ...run(sim, 10, inp({ special: true })),
    ];
    for (const t of ['dash', 'guardStart', 'kiaiStart'] as const) expect(ofType(locked, t), t).toHaveLength(0);
    expect(p.state).toBe('idle');
    // corte: garra do leão (nada do combo humano)
    const claw = run(sim, steps(LION.claw.dur) + 2, i => inp({ attack: i === 0 }));
    expect(ofType(claw, 'lionClaw')).toHaveLength(1);
    expect(ofType(claw, 'playerSwing')).toHaveLength(0);
    expect(p.state).toBe('idle');
    // segurar o iaido: carga do rugido (nada do iaido humano)
    const charge = run(sim, 10, inp({ charge: true }));
    expect(ofType(charge, 'lionRoarCharge')).toHaveLength(1);
    expect(ofType(charge, 'chargeStart')).toHaveLength(0);
    expect(p.state).toBe('roarCharge');
    expect(p.form).toBe('lion');
    expect(p.ki).toBe(100);
  });

  it('as patas soltam respingos marcados como passada de leão', () => {
    const sim = lion();
    const evs = run(sim, 120, inp({ move: { x: 0, z: 1 } }));
    const steps = ofType(evs, 'footstep');
    expect(steps.length).toBeGreaterThan(5);
    expect(steps.every(s => s.paw === true)).toBe(true);
  });

  it('a barra esvazia em LION.duration e ele volta a humano sozinho', () => {
    const sim = lion();
    const p = sim.player;
    const start = p.fury;
    run(sim, steps(LION.duration / 2));
    expect(p.fury).toBeLessThan(start * 0.6);
    expect(p.form).toBe('lion');
    const back = runUntil(sim, e => ofType(e, 'revertStart').length > 0, steps(LION.duration));
    expect(back.ok).toBe(true);
    expect(ofType(back.events, 'revertStart')[0].reason).toBe('timeout');
    expect(p.state).toBe('revert');
    const end = runUntil(sim, e => ofType(e, 'revertEnd').length > 0, steps(LION.revertDur) + 5);
    expect(end.ok).toBe(true);
    expect(p.form).toBe('human');
    expect(p.radius).toBe(PLAYER.radius);
    expect(p.state).toBe('idle');
    expect(p.fury).toBe(0);
  });

  it('R na forma de leão volta a humano antes da hora', () => {
    const sim = lion();
    const evs = run(sim, 1, inp({ transform: true }));
    expect(ofType(evs, 'revertStart')[0]?.reason).toBe('manual');
    run(sim, steps(LION.revertDur) + 2);
    expect(sim.player.form).toBe('human');
    expect(sim.player.fury).toBe(0);
  });

  it('um Q apertado no fim da forma não dispara o Kiai sozinho ao voltar', () => {
    const sim = lion();
    sim.player.ki = KIAI.cost;
    sim.player.fury = 0.01;
    const evs = run(sim, 2, inp({ special: true }));
    expect(sim.player.state).toBe('revert');
    evs.push(...run(sim, steps(LION.revertDur) + 20));
    expect(ofType(evs, 'kiaiStart')).toHaveLength(0);
    expect(sim.player.state).toBe('idle');
  });

  it('golpeado na forma: perde vida mas não cambaleia (não há pose de leão ferido)', () => {
    const sim = lion();
    const p = sim.player;
    p.invuln = 0;
    const e = spawnActive(sim, 'ronin', { x: p.pos.x + 1.4, z: p.pos.z }, true);
    primeStrike(e, { x: -1, z: 0 }, 1);
    const evs = run(sim, 30);
    expect(ofType(evs, 'playerHurt')).toHaveLength(1);
    expect(p.hp).toBeLessThan(PLAYER.maxHp);
    expect(p.form).toBe('lion');
    expect(p.state).not.toBe('hurt');
  });

  it('morrer como leão volta a humano antes de cair (o samurai é quem tomba)', () => {
    const sim = lion();
    const p = sim.player;
    p.invuln = 0;
    p.hp = 1;
    const e = spawnActive(sim, 'ronin', { x: p.pos.x + 1.4, z: p.pos.z }, true);
    primeStrike(e, { x: -1, z: 0 }, 1);
    const evs = run(sim, 30);
    const types = evs.map(x => x.type);
    expect(types.indexOf('revertStart')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('revertStart')).toBeLessThan(types.indexOf('playerDeath'));
    expect(ofType(evs, 'revertStart')[0].reason).toBe('death');
    expect(p.state).toBe('dead');
    expect(p.form).toBe('human');
    expect(sim.over).toBe(true);
  });
});

/** Ponto a `d` metros do leão na direção `deg` (graus no chão, 0 = +x). */
const around = (sim: Sim, deg: number, d: number): Vec2 => add(sim.player.pos, scale(fromAngle(deg * DEG), d));

/** O inimigo está se afastando do leão (velocidade apontando para fora). */
const movingAway = (sim: Sim, pos: Vec2, vel: Vec2): boolean => dot(vel, sub(pos, sim.player.pos)) > 0;

describe('garra do leão (corte)', () => {
  it('leque de 5 m à frente: mata o ronin a 4,8 m, não alcança o de 5,6 m, o de trás nem o de fora do arco', () => {
    const sim = lion();
    const p = sim.player;
    run(sim, 1, inp({ attack: true, aim: { x: 1, z: 0 } }));
    expect(p.state).toBe('claw');
    // o bote curto termina antes da janela ativa: as distâncias contam do centro do leão no instante do golpe
    run(sim, steps(LION.claw.activeFrom) - 3);
    expect(p.t).toBeLessThan(LION.claw.activeFrom);
    expect(len(p.vel)).toBeLessThan(1e-9);
    const near = spawnFrozen(sim, 'ronin', around(sim, 0, 4.8));
    const far = spawnFrozen(sim, 'ronin', around(sim, -20, 5.6));
    const behind = spawnFrozen(sim, 'ronin', around(sim, 180, 2));
    const wide = spawnFrozen(sim, 'ronin', around(sim, 55, 3));
    const evs = run(sim, steps(LION.claw.dur));
    const hits = ofType(evs, 'enemyHit');
    expect(hits.map(h => h.id)).toEqual([near.id]);
    expect(hits[0].heavy).toBe(true);
    expect(hits[0].damage).toBe(LION.claw.damage);
    expect(near.state).toBe('dying');
    for (const e of [far, behind, wide]) expect(e.hp).toBe(ENEMIES.ronin.hp);
    expect(p.state).toBe('idle');
  });

  it('pesada e com ajuda de mira: no brutamontes tira 3, quebra o golpe preparado e empurra', () => {
    const sim = lion();
    const p = sim.player;
    const brute = spawnActive(sim, 'brute', around(sim, 0, 3), true);
    primeStrike(brute, { x: -1, z: 0 }, 40);
    expect(brute.poiseLeft).toBeGreaterThan(0);
    // mirando 30° ao lado: a garra vira para o brutamontes (cone de 40°)
    run(sim, 1, inp({ attack: true, aim: fromAngle(30 * DEG) }));
    expect(p.attackDir.x).toBeCloseTo(1, 6);
    const r = runUntil(sim, e => ofType(e, 'enemyHit').length > 0, steps(LION.claw.activeTo) + 2);
    expect(r.ok).toBe(true);
    expect(brute.hp).toBe(ENEMIES.brute.hp - LION.claw.damage);
    expect(brute.state).toBe('stagger');
    expect(movingAway(sim, brute.pos, brute.vel)).toBe(true);
    const rest = run(sim, 60);
    expect(ofType(rest, 'enemySwing')).toHaveLength(0);
    expect(ofType([...r.events, ...rest], 'playerHurt')).toHaveLength(0);
  });

  it('lionClaw sai uma vez por garra, quando a janela ativa abre', () => {
    const sim = lion();
    const p = sim.player;
    const r = runUntil(sim, e => ofType(e, 'lionClaw').length > 0, 60, i => inp({ attack: i === 0, aim: { x: 0, z: -1 } }));
    expect(r.ok).toBe(true);
    // o primeiro passo processa o aperto; a janela conta a partir daí
    const t = (r.steps - 1) * SIM_DT;
    expect(t).toBeGreaterThanOrEqual(LION.claw.activeFrom - 1e-9);
    expect(t - SIM_DT).toBeLessThan(LION.claw.activeFrom);
    const c = ofType(r.events, 'lionClaw')[0];
    expect(c.dir).toEqual(p.attackDir);
    expect(c.dir.z).toBeCloseTo(-1, 9);
    expect(c.range).toBe(LION.claw.range);
    expect(c.halfArc).toBe(LION.claw.halfArc);
    const rest = run(sim, steps(LION.claw.dur));
    expect(ofType(rest, 'lionClaw')).toHaveLength(0);
    expect(p.state).toBe('idle');
  });

  it('apertar de novo emenda outra garra em cancelAt; depois de cancelAt, segurar o iaido emenda o rugido', () => {
    const sim = lion();
    const p = sim.player;
    const evs = run(sim, 1, inp({ attack: true }));
    evs.push(...run(sim, 18));
    // aperto antes de cancelAt fica no buffer: o primeiro golpe não é cortado antes da hora
    evs.push(...run(sim, 1, inp({ attack: true })));
    expect(p.t).toBeLessThan(LION.claw.cancelAt);
    const chain = runUntil(sim, (_, s) => s.player.t === 0, 20);
    expect(chain.ok).toBe(true);
    expect(p.state).toBe('claw');
    const tFirst = (19 + chain.steps) * SIM_DT;
    expect(tFirst).toBeGreaterThanOrEqual(LION.claw.cancelAt);
    expect(tFirst).toBeLessThan(LION.claw.cancelAt + SIM_DT);
    expect(tFirst).toBeLessThan(LION.claw.dur);
    evs.push(...chain.events, ...run(sim, steps(LION.claw.dur) + 2));
    expect(ofType(evs, 'lionClaw')).toHaveLength(2);
    expect(p.state).toBe('idle');
    // garra seguida do rugido: a carga começa em cancelAt
    run(sim, 1, inp({ attack: true }));
    const toRoar = runUntil(sim, e => ofType(e, 'lionRoarCharge').length > 0, steps(LION.claw.dur), inp({ charge: true }));
    expect(toRoar.ok).toBe(true);
    expect(toRoar.steps * SIM_DT).toBeGreaterThanOrEqual(LION.claw.cancelAt);
    expect(toRoar.steps * SIM_DT).toBeLessThan(LION.claw.dur);
    expect(p.state).toBe('roarCharge');
  });

  it('os golpes do leão não dão Ki nem Fúria, mas contam pontos, combo, abates e cura', () => {
    const sim = lion();
    const p = sim.player;
    p.ki = 10;
    p.hp = 50;
    const fury0 = p.fury;
    const e = spawnFrozen(sim, 'ronin', around(sim, 0, 3));
    const evs = run(sim, steps(LION.claw.dur) + 2, i => inp({ attack: i === 0, aim: { x: 1, z: 0 } }));
    expect(ofType(evs, 'enemyDeath').map(d => d.id)).toEqual([e.id]);
    expect(p.ki).toBe(10);
    expect(p.fury).toBeLessThan(fury0); // só esvazia com o tempo
    expect(sim.kills).toBe(1);
    expect(sim.combo).toBe(1);
    expect(sim.score).toBe(ENEMIES.ronin.score);
    expect(p.hp).toBe(50 + PLAYER.healPerKill);
  });

  it('garras emendadas não seguram a forma: a Fúria acaba e ele volta a humano no cancelAt', () => {
    const sim = lion();
    const p = sim.player;
    // garra a cada 0,4 s até bem depois do fim da forma
    const every = steps(0.4);
    const evs = run(sim, steps(LION.duration + 2), i => inp({ attack: i % every === 0 }));
    const rev = ofType(evs, 'revertStart');
    expect(rev.map(r => r.reason)).toEqual(['timeout']);
    expect(p.form).toBe('human');
  });

  it('R no começo da garra espera a brecha (cancelAt) e vence a garra emendada no buffer', () => {
    const sim = lion();
    run(sim, 1, inp({ attack: true }));
    expect(sim.player.state).toBe('claw');
    // R logo no início (o buffer do R duraria só LION.buffer) e um ataque no buffer perto do cancelAt
    run(sim, 1, inp({ transform: true }));
    const evs = run(sim, steps(LION.claw.dur), i => inp({ attack: i === steps(LION.claw.cancelAt) - 4 }));
    expect(ofType(evs, 'revertStart').map(r => r.reason)).toEqual(['manual']);
    expect(ofType(evs, 'lionClaw')).toHaveLength(1);
  });

  it('golpeado no meio da garra: perde vida e segue golpeando (sem pose de ferido)', () => {
    const sim = lion();
    const p = sim.player;
    p.invuln = 0;
    const e = spawnActive(sim, 'ronin', around(sim, 180, 1.4), true);
    primeStrike(e, { x: 1, z: 0 }, 1);
    const evs = run(sim, 14, i => inp({ attack: i === 0, aim: { x: 0, z: 1 } }));
    expect(ofType(evs, 'playerHurt')).toHaveLength(1);
    expect(p.state).toBe('claw');
    expect(p.t).toBeCloseTo(13 * SIM_DT, 9);
  });
});

describe('rugido do leão (iaido carregado)', () => {
  it('segurar e soltar com a carga pronta: onda em volta toda que fere, empurra e atordoa até 6 m', () => {
    const sim = lion();
    const p = sim.player;
    p.ki = 10;
    const ring = [0, 90, 180, 270].map(a => spawnFrozen(sim, 'ronin', around(sim, a, 3)));
    const edge = spawnFrozen(sim, 'ronin', around(sim, 45, 5.9));
    const brute = spawnFrozen(sim, 'brute', around(sim, 225, 4));
    const out = spawnFrozen(sim, 'ronin', around(sim, 135, 6.8));
    const charge = run(sim, steps(LION.roar.chargeTime) + 5, inp({ charge: true }));
    expect(ofType(charge, 'lionRoarCharge')).toHaveLength(1);
    expect(ofType(charge, 'lionRoarReady')).toHaveLength(1);
    expect(p.state).toBe('roarCharge');
    expect(p.chargeReady).toBe(true);
    expect(ofType(charge, 'enemyHit')).toHaveLength(0);
    // soltou: ruge (e a recarga já conta o rugido inteiro)
    const rel = run(sim, 1);
    expect(ofType(rel, 'lionRoarCancel')).toHaveLength(0);
    expect(p.state).toBe('roar');
    expect(p.roarCd).toBe(LION.roar.dur + LION.roar.cooldown);
    const blast = runUntil(sim, e => ofType(e, 'lionRoar').length > 0, steps(LION.roar.dur));
    expect(blast.ok).toBe(true);
    expect(Math.abs(blast.steps * SIM_DT - LION.roar.blastAt)).toBeLessThanOrEqual(SIM_DT);
    const r = ofType(blast.events, 'lionRoar')[0];
    expect(r.radius).toBe(LION.roar.radius);
    expect(r.hits).toBe(6);
    expect(r.kills).toBe(5);
    for (const e of [...ring, edge]) expect(e.state).toBe('dying');
    // brutamontes: tira 4, empurrado para fora e atordoado
    expect(brute.hp).toBe(ENEMIES.brute.hp - LION.roar.damage);
    expect(brute.state).toBe('stagger');
    expect(brute.t).toBeLessThan(0);
    expect(movingAway(sim, brute.pos, brute.vel)).toBe(true);
    const d0 = dist(brute.pos, p.pos);
    // fora do raio: intocado (continua congelado como estava)
    expect(out.hp).toBe(ENEMIES.ronin.hp);
    expect(out.vel).toEqual({ x: 0, z: 0 });
    expect(p.ki).toBe(10);
    run(sim, steps(0.3));
    expect(brute.state).toBe('stagger');
    expect(dist(brute.pos, p.pos)).toBeGreaterThan(d0 + 0.1);
    const end = runUntil(sim, (_, s) => s.player.state === 'idle', steps(LION.roar.dur));
    expect(end.ok).toBe(true);
    expect(sim.player.form).toBe('lion');
  });

  it('o mais perto é empurrado com mais força', () => {
    const sim = lion();
    const close = spawnFrozen(sim, 'brute', around(sim, 0, 1.5));
    const far = spawnFrozen(sim, 'brute', around(sim, 180, 5));
    run(sim, steps(LION.roar.chargeTime) + 2, inp({ charge: true }));
    runUntil(sim, e => ofType(e, 'lionRoar').length > 0, steps(LION.roar.dur));
    expect(len(close.vel)).toBeGreaterThan(len(far.vel) * 1.5);
    expect(close.t).toBeLessThan(far.t); // e atordoado por mais tempo
  });

  it('soltar antes da carga pronta desiste: sem rugido e sem recarga', () => {
    const sim = lion();
    const p = sim.player;
    const e = spawnFrozen(sim, 'ronin', around(sim, 0, 2));
    const evs = [...run(sim, 10, inp({ charge: true })), ...run(sim, 30)];
    expect(ofType(evs, 'lionRoarCharge')).toHaveLength(1);
    expect(ofType(evs, 'lionRoarCancel')).toHaveLength(1);
    expect(ofType(evs, 'lionRoarReady')).toHaveLength(0);
    expect(ofType(evs, 'lionRoar')).toHaveLength(0);
    expect(p.state).toBe('idle');
    expect(p.roarCd).toBe(0);
    expect(e.hp).toBe(ENEMIES.ronin.hp);
    // pode carregar de novo na hora
    expect(ofType(run(sim, 1, inp({ charge: true })), 'lionRoarCharge')).toHaveLength(1);
  });

  it('a recarga impede outra carga até acabar (conta do fim do rugido)', () => {
    const sim = lion();
    const p = sim.player;
    run(sim, steps(LION.roar.chargeTime) + 2, inp({ charge: true }));
    run(sim, 1);
    expect(p.state).toBe('roar');
    // segurando direto durante o rugido e quase toda a recarga: nada
    const wait = run(sim, steps(LION.roar.dur + LION.roar.cooldown) - 10, inp({ charge: true }));
    expect(ofType(wait, 'lionRoar')).toHaveLength(1);
    expect(ofType(wait, 'lionRoarCharge')).toHaveLength(0);
    expect(p.state).toBe('idle');
    expect(p.roarCd).toBeGreaterThan(0);
    const again = runUntil(sim, e => ofType(e, 'lionRoarCharge').length > 0, 30, inp({ charge: true }));
    expect(again.ok).toBe(true);
    expect(p.roarCd).toBe(0);
    expect(p.state).toBe('roarCharge');
  });

  it('a Fúria acabando no meio da carga desiste do rugido e volta a humano', () => {
    const sim = lion();
    const p = sim.player;
    run(sim, 5, inp({ charge: true }));
    expect(p.state).toBe('roarCharge');
    p.fury = 0.01;
    const evs = run(sim, 3, inp({ charge: true }));
    expect(ofType(evs, 'lionRoarCancel')).toHaveLength(1);
    expect(ofType(evs, 'revertStart').map(r => r.reason)).toEqual(['timeout']);
    expect(p.state).toBe('revert');
    evs.push(...run(sim, steps(LION.revertDur) + 5, inp({ charge: true })));
    expect(ofType(evs, 'lionRoar')).toHaveLength(0);
    expect(p.form).toBe('human');
    expect(p.state).toBe('idle'); // humano sem Ki: segurar o iaido não faz nada
  });

  it('R durante o rugido não se perde: volta a humano quando o rugido acaba', () => {
    const sim = lion();
    run(sim, steps(LION.roar.chargeTime) + 2, inp({ charge: true }));
    run(sim, 1);
    expect(sim.player.state).toBe('roar');
    run(sim, 3);
    // folga para o congelamento do impacto (hitstop) do rugido
    const evs = run(sim, steps(LION.roar.dur + LION.roar.hitstop) + 4, i => inp({ transform: i === 0 }));
    expect(ofType(evs, 'lionRoar')).toHaveLength(1);
    expect(ofType(evs, 'revertStart').map(r => r.reason)).toEqual(['manual']);
  });

  it('R durante a carga desiste do rugido e volta a humano', () => {
    const sim = lion();
    run(sim, 5, inp({ charge: true }));
    const evs = run(sim, 1, inp({ charge: true, transform: true }));
    expect(ofType(evs, 'lionRoarCancel')).toHaveLength(1);
    expect(ofType(evs, 'revertStart').map(r => r.reason)).toEqual(['manual']);
    expect(sim.player.state).toBe('revert');
  });

  it('golpeado carregando segue carregando; morrer carregando desiste e cai como samurai', () => {
    const sim = lion();
    const p = sim.player;
    p.invuln = 0;
    const e = spawnActive(sim, 'ronin', around(sim, 0, 1.4), true);
    primeStrike(e, { x: -1, z: 0 }, 1);
    const hurt = run(sim, 14, inp({ charge: true }));
    expect(ofType(hurt, 'playerHurt')).toHaveLength(1);
    expect(p.state).toBe('roarCharge');
    p.invuln = 0;
    p.hp = 1;
    const e2 = spawnActive(sim, 'ronin', around(sim, 180, 1.4), true);
    primeStrike(e2, { x: 1, z: 0 }, 1);
    const evs = run(sim, 14, inp({ charge: true }));
    const types = evs.map(x => x.type);
    expect(types).toContain('lionRoarCancel');
    expect(types.indexOf('lionRoarCancel')).toBeLessThan(types.indexOf('playerDeath'));
    expect(ofType(evs, 'revertStart')[0].reason).toBe('death');
    expect(p.state).toBe('dead');
    expect(p.form).toBe('human');
  });

  it('o humano nunca entra na garra nem no rugido', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    // sem Ki: segurar o iaido não faz nada
    const none = run(sim, 60, inp({ charge: true }));
    expect(p.state).toBe('idle');
    // com Ki: é o iaido humano
    p.ki = 100;
    const iaido = run(sim, 60, inp({ charge: true }));
    expect(p.state).toBe('charge');
    expect(ofType(iaido, 'chargeStart')).toHaveLength(1);
    const swing = [...run(sim, 1), ...run(sim, 40), ...run(sim, 1, inp({ attack: true }))];
    expect(p.state).toBe('attack');
    expect(ofType(swing, 'playerSwing')).toHaveLength(1);
    for (const t of ['lionRoarCharge', 'lionRoarReady', 'lionRoar', 'lionClaw'] as const) expect(ofType([...none, ...iaido, ...swing], t), t).toHaveLength(0);
  });
});

describe('carga da Fúria', () => {
  it('enche com acertos e abates (e avisa uma vez), sem mexer no ganho de Ki', () => {
    const sim = makeSim({ waves: false });
    const p = sim.player;
    const e = spawnFrozen(sim, 'ronin', { x: 1.2, z: 0 });
    p.facing = { x: 1, z: 0 };
    const evs = run(sim, 40, i => inp({ attack: i % 20 === 0, aim: { x: 1, z: 0 } }));
    expect(ofType(evs, 'enemyHit').length).toBeGreaterThan(0);
    expect(p.fury).toBeGreaterThan(0);
    expect(p.ki).toBeGreaterThan(0);
    void e;
    p.fury = LION.max - 0.5;
    const e2 = spawnFrozen(sim, 'ronin', { x: 1.2, z: 0.3 });
    e2.hp = 1;
    const more = run(sim, 40, i => inp({ attack: i % 20 === 0, aim: { x: 1, z: 0 } }));
    expect(ofType(more, 'furyReady')).toHaveLength(1);
    expect(p.fury).toBe(LION.max);
  });

  it('dano recebido como humano também enche', () => {
    const sim = makeSim({ waves: false });
    const e = spawnActive(sim, 'ronin', { x: 1.4, z: 0 }, true);
    primeStrike(e, { x: -1, z: 0 }, 1);
    const evs = run(sim, 30);
    const hurt = ofType(evs, 'playerHurt')[0];
    expect(hurt).toBeDefined();
    expect(sim.player.fury).toBeCloseTo(LION.perHurt * hurt.damage, 6);
  });

  it('a Tomoe não tem a forma: a barra não enche e R não faz nada (e dá para ligar depois, como no título)', () => {
    const sim = makeSim({ waves: false, transform: false });
    const p = sim.player;
    const e = spawnFrozen(sim, 'ronin', { x: 1.2, z: 0 });
    void e;
    run(sim, 40, i => inp({ attack: i % 20 === 0, aim: { x: 1, z: 0 } }));
    expect(p.fury).toBe(0);
    p.fury = LION.max;
    const evs = run(sim, 10, inp({ transform: true }));
    expect(ofType(evs, 'transformStart')).toHaveLength(0);
    sim.canTransform = true;
    const evs2 = run(sim, 2, inp({ transform: true }));
    expect(ofType(evs2, 'transformStart')).toHaveLength(1);
  });
});
