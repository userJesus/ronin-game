// Kiai (tecla Q): exige Ki cheio, mata tudo no raio, empurra quem está além, não recarrega o Ki.
import { describe, expect, it } from 'vitest';
import { KIAI, PLAYER } from '../../src/config';
import { inp, makeSim, ofType, primeStrike, run, spawnActive } from './helpers';

const STEPS_TO_BLAST = Math.ceil(KIAI.gather * 60) + 2;

describe('Kiai', () => {
  it('sem Ki cheio, Q não faz nada', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = KIAI.cost - 1;
    const evs = run(sim, 5, i => inp({ special: i === 0 }));
    expect(ofType(evs, 'kiaiStart')).toHaveLength(0);
    expect(sim.player.state).not.toBe('kiai');
  });

  it('com Ki cheio: mata todos no raio (inclusive brutamontes) e esvazia a barra', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = PLAYER.maxKi;
    const near = [
      spawnActive(sim, 'ronin', { x: 2, z: 0 }),
      spawnActive(sim, 'brute', { x: -3, z: 1.5 }),
      spawnActive(sim, 'swift', { x: 0, z: -KIAI.radius + 0.2 }),
    ];
    const far = spawnActive(sim, 'ronin', { x: KIAI.pushRadius + 3, z: 0 });
    for (const e of [...near, far]) e.def.speed = 0;
    const evs = run(sim, STEPS_TO_BLAST + 12, i => inp({ special: i === 0 }));
    const blast = ofType(evs, 'kiaiBlast');
    expect(blast).toHaveLength(1);
    expect(blast[0].kills).toBe(3);
    for (const e of near) expect(sim.enemies.find(x => x.id === e.id)?.state ?? 'dying').toBe('dying');
    expect(far.state).not.toBe('dying');
    // as mortes da explosão não devolvem o Ki gasto
    expect(sim.player.ki).toBe(0);
  });

  it('quem está logo além do raio é arremessado e atordoado', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = PLAYER.maxKi;
    const e = spawnActive(sim, 'ronin', { x: KIAI.radius + 1.2, z: 0 });
    e.def.speed = 0;
    run(sim, STEPS_TO_BLAST, i => inp({ special: i === 0 }));
    expect(e.state).toBe('stagger');
    expect(e.vel.x).toBeGreaterThan(1);
  });

  it('invulnerável durante a animação: golpe inimigo não fere', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = PLAYER.maxKi;
    sim.player.facing = { x: 0, z: 1 };
    run(sim, 1, inp({ special: true }));
    // inimigo já fora do raio, golpeando antes da explosão
    const e = spawnActive(sim, 'brute', { x: 0, z: 2.2 });
    primeStrike(e, { x: 0, z: -1 }, 2);
    const evs = run(sim, 20);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
    expect(sim.player.hp).toBe(PLAYER.maxHp);
  });

  it('a animação termina e o jogador volta ao controle', () => {
    const sim = makeSim({ waves: false });
    sim.player.ki = PLAYER.maxKi;
    run(sim, 1, inp({ special: true }));
    expect(sim.player.state).toBe('kiai');
    run(sim, Math.ceil(KIAI.dur * 60) + Math.ceil(KIAI.hitstop * 60) + 2);
    expect(sim.player.state).toBe('idle');
    run(sim, 10, inp({ move: { x: 1, z: 0 } }));
    expect(sim.player.state).toBe('run');
  });
});
