// Robô de balanceamento: sanidade da partida inteira e números para calibragem.
import { describe, expect, it } from 'vitest';
import { PLAYER, SIM_DT, WAVES } from '../../src/config';
import { idleInput } from '../../src/sim/types';
import { Bot, HUMAN_BOT, MASHER_BOT, playRun, table, type BotOptions, type RunStats } from './bot';
import { hasNaN, makeSim, spawnActive } from './helpers';

const SEEDS = [1, 7, 42, 99, 123, 2024, 31337, 777];
const MAX_TIME = 360;

describe('robô de balanceamento', () => {
  let bot: RunStats[] = [];

  it('robô joga várias seeds sem NaN e sem estourar maxAlive', () => {
    const t0 = performance.now();
    bot = SEEDS.map(seed => { const b = new Bot(undefined, seed); return playRun(seed, s => b.think(s), MAX_TIME); });
    const ms = performance.now() - t0;
    console.log(table(bot, `\nROBÔ (${(ms / 1000).toFixed(1)} s de CPU para ${SEEDS.length} partidas de até ${MAX_TIME} s)  d<n> = dano recebido na onda n`));
    console.log('duração das ondas limpas (s):\n' + bot.map(r => `  seed ${r.seed}: ` + r.waveTime.map((t, i) => (t === undefined ? '' : `o${i}=${t.toFixed(0)}`)).filter(Boolean).join(' ')).join('\n'));
    console.log('máx. de inimigos na lista (vivos + cadáveres): ' + bot.map(r => r.maxEnemies).join(', '));
    for (const r of bot) {
      expect(r.nan).toBe(false);
      expect(r.maxAliveOver).toBeLessThanOrEqual(0);
      // cadáveres ficam AI.deathTime na lista; a view tem 160 sombras e 320 sprites
      expect(r.maxEnemies).toBeLessThanOrEqual(WAVES.maxAlive(99) + 40);
    }
  }, 180_000);

  it('robô passa da onda 1 na maioria das seeds (jogo não é impossível)', () => {
    const passed = bot.filter(r => r.cleared >= 1).length;
    expect(passed).toBeGreaterThan(SEEDS.length / 2);
  });

  it('jogador parado morre antes da onda 3 (jogo não é trivial)', () => {
    const rows = [1, 2, 3, 4, 5, 6].map(seed => playRun(seed, () => idleInput(), MAX_TIME));
    console.log(table(rows, '\nPARADO (sem input)'));
    for (const r of rows) {
      expect(r.died).toBe(true);
      expect(r.wave).toBeLessThan(3);
      expect(r.nan).toBe(false);
    }
  }, 60_000);

  // Perfis extras só para calibragem (sem asserção de dificuldade): o robô pedido reage
  // instantaneamente e vê tudo, o que o torna bem mais forte que uma pessoa.
  const profile = (name: string, o: BotOptions) => it(`calibragem: perfil ${name}`, () => {
    const rows = SEEDS.map(seed => { const b = new Bot(o, seed); return playRun(seed, s => b.think(s), MAX_TIME); });
    console.log(table(rows, `
PERFIL ${name.toUpperCase()} (reação ${o.reaction} s, percebe ${Math.round(o.notice * 100)}% das preparações, iaido com ${o.iaidoMin} alinhados)`));
    for (const r of rows) expect(r.nan).toBe(false);
  }, 180_000);
  profile('humano', HUMAN_BOT);
  profile('só corte', MASHER_BOT);

  it('60 s de simulação com 40 inimigos rodam em < 1.5 s', () => {
    const sim = makeSim({ seed: 5, waves: false });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2, r = 3 + (i % 8) * 1.4;
      spawnActive(sim, i % 7 === 0 ? 'brute' : i % 5 === 0 ? 'swift' : 'ronin', { x: Math.cos(a) * r, z: Math.sin(a) * r }, true);
    }
    const inp = idleInput();
    const steps = Math.round(60 / SIM_DT);
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) {
      sim.player.hp = PLAYER.maxHp;
      inp.move.x = Math.cos(i * 0.01); inp.move.z = Math.sin(i * 0.01);
      sim.step(inp);
      sim.drainEvents();
    }
    const ms = performance.now() - t0;
    console.log(`\ndesempenho: 60 s simulados com ${sim.enemies.length} inimigos em ${ms.toFixed(0)} ms (${((ms * 1000) / steps).toFixed(1)} µs/passo)`);
    expect(sim.enemies.length).toBe(40);
    for (const e of sim.enemies) expect(hasNaN(e.pos)).toBe(false);
    expect(ms).toBeLessThan(1500);
  });
});
