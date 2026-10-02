// Defesa, parry e aterrissagem da esquiva.
import { describe, expect, it } from 'vitest';
import { DASH, ENEMIES, GUARD, PARRY, PLAYER } from '../../src/config';
import { inp, makeSim, ofType, primeStrike, run, spawnActive } from './helpers';

/** Ronin 1.5 m à frente (+z) do jogador, a `steps` passos de golpear na direção dele. */
function duel(steps = 20) {
  const sim = makeSim({ waves: false });
  sim.player.facing = { x: 0, z: 1 };
  const e = spawnActive(sim, 'ronin', { x: 0, z: 1.5 });
  primeStrike(e, { x: 0, z: -1 }, steps);
  return { sim, e };
}

describe('defesa', () => {
  it('segurar a defesa entra no estado guard e soltar volta ao normal', () => {
    const sim = makeSim({ waves: false });
    const evs = run(sim, 20, inp({ guard: true }));
    expect(sim.player.state).toBe('guard');
    expect(ofType(evs, 'guardStart')).toHaveLength(1);
    run(sim, 2);
    expect(sim.player.state).toBe('idle');
  });

  it('bloqueio de frente: só passa uma fração do dano, sem ficar ferido', () => {
    const { sim } = duel(30);
    // entra na guarda cedo (fora da janela de parry quando o golpe chega)
    const evs = run(sim, 70, inp({ guard: true }));
    const blocks = ofType(evs, 'block');
    expect(blocks).toHaveLength(1);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
    expect(ofType(evs, 'parry')).toHaveLength(0);
    expect(sim.player.hp).toBe(PLAYER.maxHp - Math.round(ENEMIES.ronin.damage * GUARD.chip));
  });

  it('golpe pelas costas atravessa a guarda', () => {
    const sim = makeSim({ waves: false });
    sim.player.facing = { x: 0, z: -1 }; // de costas para o ronin
    const e = spawnActive(sim, 'ronin', { x: 0, z: 1.5 });
    primeStrike(e, { x: 0, z: -1 }, 30);
    // mira fixa para trás: a guarda não se vira para a ameaça
    const evs = run(sim, 70, inp({ guard: true, aim: { x: 0, z: -1 } }));
    expect(ofType(evs, 'block')).toHaveLength(0);
    expect(ofType(evs, 'playerHurt')).toHaveLength(1);
  });

  it('na guarda o jogador fica parado mesmo com o direcional apertado', () => {
    const sim = makeSim({ waves: false });
    // correndo a toda e então segurando a defesa sem soltar o direcional
    run(sim, 30, inp({ move: { x: 1, z: 0 } }));
    expect(sim.player.state).toBe('run');
    run(sim, 1, inp({ move: { x: 1, z: 0 }, guard: true }));
    expect(sim.player.state).toBe('guard');
    const at = { ...sim.player.pos };
    for (const move of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0.7, z: -0.7 }]) run(sim, 30, inp({ move, guard: true }));
    expect(sim.player.state).toBe('guard');
    expect(Math.hypot(sim.player.pos.x - at.x, sim.player.pos.z - at.z)).toBeLessThan(1e-9);
    // soltou a defesa: volta a andar
    run(sim, 20, inp({ move: { x: 1, z: 0 } }));
    expect(sim.player.pos.x - at.x).toBeGreaterThan(0.5);
  });

  it('bloquear um golpe ainda empurra um pouco para trás (impacto), sem o direcional ajudar', () => {
    const { sim } = duel(30);
    const z0 = sim.player.pos.z;
    // segurando para a frente (na direção do inimigo) durante a guarda inteira
    const evs = run(sim, 70, inp({ guard: true, move: { x: 0, z: 1 } }));
    expect(ofType(evs, 'block')).toHaveLength(1);
    const pushed = z0 - sim.player.pos.z;
    expect(pushed).toBeGreaterThan(0.1);
    expect(pushed).toBeLessThan(0.4);
  });

  it('sem mira, a guarda vira sozinha para quem está preparando o golpe', () => {
    const sim = makeSim({ waves: false });
    sim.player.facing = { x: 1, z: 0 };
    const e = spawnActive(sim, 'ronin', { x: 0, z: 1.5 });
    primeStrike(e, { x: 0, z: -1 }, 30);
    run(sim, 3, inp({ guard: true }));
    expect(sim.player.facing.z).toBeGreaterThan(0.9);
  });
});

describe('parry', () => {
  it('apertar a defesa logo antes do golpe apara, atordoa e contra-ataca', () => {
    const { sim, e } = duel(4);
    const kiBefore = sim.player.ki;
    const evs = run(sim, 40, inp({ guard: true }));
    expect(ofType(evs, 'parry')).toHaveLength(1);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
    expect(ofType(evs, 'block')).toHaveLength(0);
    // o contra-ataque automático fere (ou mata) o aparado
    const hits = ofType(evs, 'enemyHit').filter(h => h.id === e.id);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].damage).toBe(PARRY.riposteDamage);
    expect(sim.player.ki).toBeGreaterThan(kiBefore);
  });

  it('o inimigo aparado fica sem guarda por PARRY.stun', () => {
    const sim = makeSim({ waves: false });
    sim.player.facing = { x: 0, z: 1 };
    const e = spawnActive(sim, 'brute', { x: 0, z: 1.8 }); // brutamontes sobrevive ao contra-ataque
    primeStrike(e, { x: 0, z: -1 }, 4);
    run(sim, 8, inp({ guard: true }));
    expect(e.state).toBe('parried');
    run(sim, Math.round((PARRY.stun - 0.2) * 60));
    expect(e.state).toBe('parried');
    // + os congelamentos de impacto do parry e do contra-ataque
    run(sim, 20 + Math.ceil((PARRY.hitstop + 0.06) * 60));
    expect(e.state).not.toBe('parried');
  });

  it('metralhar a defesa não abre nova janela de parry (recarga)', () => {
    const { sim } = duel(30);
    // aperta e solta rapidamente antes do golpe; o último aperto cai dentro da recarga
    const pattern = (i: number) => inp({ guard: i % 10 < 5 });
    const evs = run(sim, 70, pattern);
    expect(ofType(evs, 'parry')).toHaveLength(0);
  });

  it('um toque rápido na defesa (apertar e soltar) ainda apara', () => {
    const { sim } = duel(5);
    const evs = run(sim, 40, i => inp({ guard: i === 0 }));
    expect(ofType(evs, 'parry')).toHaveLength(1);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
  });

  it('aperto um pouco atrasado (depois do golpe chegar, dentro de GUARD.lateGrace) ainda apara', () => {
    const { sim } = duel(2);
    const evs: ReturnType<typeof run> = [];
    // espera o golpe conectar sem defender
    for (let i = 0; i < 12 && !evs.some(e => e.type === 'enemySwing'); i++) evs.push(...run(sim, 1));
    let hitStep = -1;
    for (let i = 0; i < 12; i++) {
      evs.push(...run(sim, 1));
      const e = sim.enemies[0];
      if (e.strikeHit) { hitStep = i; break; }
    }
    expect(hitStep).toBeGreaterThanOrEqual(0);
    // aperta a defesa 2 passos (~33 ms) depois do acerto
    evs.push(...run(sim, 2));
    evs.push(...run(sim, 30, i => inp({ guard: i < 3 })));
    expect(ofType(evs, 'parry')).toHaveLength(1);
    expect(ofType(evs, 'playerHurt')).toHaveLength(0);
  });

  it('aperto tarde demais (depois da tolerância) não salva', () => {
    const { sim } = duel(2);
    const evs = run(sim, 30);
    // o golpe já feriu; apertar agora só entra na guarda
    evs.push(...run(sim, 10, inp({ guard: true })));
    expect(ofType(evs, 'playerHurt')).toHaveLength(1);
    expect(ofType(evs, 'parry')).toHaveLength(0);
  });

  it('a janela de parry dura GUARD.parryWindow a partir do aperto', () => {
    const late = duel(Math.round((GUARD.parryWindow + 0.1) * 60));
    const evs = run(late.sim, 60, inp({ guard: true }));
    expect(ofType(evs, 'parry')).toHaveLength(0);
    expect(ofType(evs, 'block')).toHaveLength(1);
  });
});

describe('esquiva: aterrissagem', () => {
  it('depois da investida há uma aterrissagem curta antes do parado', () => {
    const sim = makeSim({ waves: false });
    run(sim, 1, inp({ dash: true, move: { x: 1, z: 0 } }));
    run(sim, Math.ceil(DASH.dur * 60) + 1);
    expect(sim.player.state).toBe('dashEnd');
    run(sim, Math.ceil(DASH.land * 60) + 1);
    expect(sim.player.state).toBe('idle');
  });

  it('dá para cortar direto da aterrissagem', () => {
    const sim = makeSim({ waves: false });
    run(sim, 1, inp({ dash: true, move: { x: 1, z: 0 } }));
    run(sim, Math.ceil(DASH.dur * 60) + 1);
    expect(sim.player.state).toBe('dashEnd');
    const evs = run(sim, 1, inp({ attack: true }));
    expect(sim.player.state).toBe('attack');
    expect(ofType(evs, 'playerSwing')).toHaveLength(1);
  });
});
