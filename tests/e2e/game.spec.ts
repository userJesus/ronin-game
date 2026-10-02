// Testes ponta a ponta no Chromium: telas, controles, combate, pausa, fim de jogo, layout e estabilidade.
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

// O CI verifica também o fallback offline: o tempo de resposta do Google Fonts não deve bloquear a suíte.
// As capturas de divulgação em scripts/media.mjs continuam usando as fontes originais.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.(googleapis|gstatic)|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(t)) return; // fontes externas offline
    errors.push(`console: ${t}`);
  });
  return errors;
}

// sem `stage` na URL cada partida sorteia o cenário: os testes de mecânica fixam o campo (posições sem obstáculos)
async function boot(page: Page, query = '?autostart&seed=3&stage=field'): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 });
}

/** Desvio padrão da luminância da captura: tela preta/lisa ≈ 0. */
async function screenVariance(page: Page): Promise<number> {
  const png = PNG.sync.read(await page.screenshot());
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 4 * 7) {
    const l = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
    sum += l; sum2 += l * l; n++;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

const screenOf = (page: Page) => page.evaluate(() => window.__game!.screen);

test('abre na tela de título e começa a luta: escolhe o samurai e "Jogar" aparece', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page, '?seed=3');
  await expect.poll(() => screenOf(page)).toBe('title');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'title');
  // o menu é limpo: sem tabela de controles nem cartões de cenário
  await expect(page.locator('.scr-title [data-controls], .scr-title .stage-card')).toHaveCount(0);
  // sem escolha, nada de "Jogar"
  const start = page.locator('button[data-action="start"]');
  await expect(start).toBeHidden();
  expect(await screenVariance(page)).toBeGreaterThan(6);
  await page.locator('.char-card[data-char="ronin"]').click();
  await expect(start).toBeVisible();
  await start.click();
  await expect.poll(() => screenOf(page)).toBe('playing');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'playing');
  // a primeira onda chega sozinha
  await expect.poll(() => page.evaluate(() => window.__game!.sim.wave), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('título: os dois personagens ficam imóveis no menu', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page, '?seed=3');
  await expect.poll(() => screenOf(page)).toBe('title');
  for (const id of ['ronin', 'tomoe', 'ronin']) {
    await page.locator(`.char-card[data-char="${id}"]`).click();
    // 1,5 s de amostras: o Ronin parado "respirava" trocando os pés, o que parecia andar no lugar
    const frames = new Set<string>();
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(100);
      frames.add(String(await page.evaluate(() => window.__game!.view.playerFrame)));
    }
    expect([...frames], id).toHaveLength(1);
  }
  expect(errors).toEqual([]);
});

test('título: sem escolha não joga; clique ou ←/→ escolhem, Enter joga com o escolhido', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page, '?seed=3');
  await expect.poll(() => screenOf(page)).toBe('title');
  const ronin = page.locator('.char-card[data-char="ronin"]'), tomoe = page.locator('.char-card[data-char="tomoe"]');
  const start = page.locator('button[data-action="start"]');
  await expect(ronin).toHaveAttribute('aria-checked', 'false');
  await expect(tomoe).toHaveAttribute('aria-checked', 'false');
  // Enter, Espaço e J (confirmar) sem personagem escolhido não começam
  for (const k of ['Enter', 'Space', 'KeyJ']) await page.keyboard.press(k);
  await page.waitForTimeout(200);
  expect(await screenOf(page)).toBe('title');
  await expect(start).toBeHidden();
  // clique escolhe, mostra "Jogar" e passa o foco para ele
  await tomoe.click();
  await expect(tomoe).toHaveAttribute('aria-checked', 'true');
  await expect(ronin).toHaveAttribute('aria-checked', 'false');
  await expect(start).toBeVisible();
  await expect(start).toBeFocused();
  expect(await page.evaluate(() => window.__game!.character)).toBe('tomoe');
  // ← escolhe o da esquerda, → o da direita (toques rápidos também valem)
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => window.__game!.character)).toBe('ronin');
  await expect(ronin).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('KeyD');
  expect(await page.evaluate(() => window.__game!.character)).toBe('tomoe');
  await page.keyboard.press('Enter');
  await expect.poll(() => screenOf(page)).toBe('playing');
  expect(await page.evaluate(() => window.__game!.character)).toBe('tomoe');
  // recarregar abre o título sem escolha de novo
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  await expect(page.locator('.char-card[aria-checked="true"]')).toHaveCount(0);
  await expect(start).toBeHidden();
  expect(errors).toEqual([]);
});

test('título: com o teclado, Tab chega ao samurai, Enter escolhe e o foco vai para "Jogar"', async ({ page }) => {
  await boot(page, '?seed=3');
  await expect.poll(() => screenOf(page)).toBe('title');
  await page.keyboard.press('Tab');
  await expect(page.locator('.char-card[data-char="ronin"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.char-card[data-char="tomoe"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.char-card[data-char="tomoe"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('button[data-action="start"]')).toBeFocused();
  // J confirma e não vira corte no primeiro quadro da partida
  await page.keyboard.press('KeyJ');
  await expect.poll(() => screenOf(page)).toBe('playing');
  expect(await page.evaluate(() => window.__game!.sim.player.state)).not.toBe('attack');
});

test('"Jogar" sorteia o cenário: a semente decide, cada partida sorteia de novo e ?stage fixa', async ({ page }) => {
  const errors = watchErrors(page);
  // a primeira partida de cada semente: os dois cenários aparecem
  const first = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    await boot(page, `?seed=${seed}`);
    first.add(await page.evaluate(() => window.__game!.stage));
  }
  expect([...first].sort()).toEqual(['field', 'temple']);
  // mesma semente, mesmo sorteio; jogar não refaz o cenário que o título já montou
  await boot(page, '?seed=3');
  const before = await page.evaluate(() => window.__game!.stage);
  await page.locator('.char-card[data-char="ronin"]').click();
  await page.locator('button[data-action="start"]').click();
  await expect.poll(() => screenOf(page)).toBe('playing');
  const run = () => page.evaluate(() => {
    const g = window.__game!;
    return { stage: g.stage, env: g.env.stage, boxes: g.sim.boxes.length, blocked: g.sim.blocked(g.sim.player.pos, 1) };
  });
  const s0 = await run();
  expect(s0.stage).toBe(before);
  // recomeços sorteiam de novo: o cenário montado é o sorteado e o herói começa num lugar livre
  const seen = new Set([s0.stage]);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.__game!.startRun());
    const s = await run();
    expect(s.env).toBe(s.stage);
    expect(s.blocked).toBe(false);
    if (s.stage === 'temple') expect(s.boxes).toBeGreaterThan(5);
    else expect(s.boxes).toBe(0);
    seen.add(s.stage);
  }
  expect([...seen].sort()).toEqual(['field', 'temple']);
  expect(await screenVariance(page)).toBeGreaterThan(6);
  // ?stage=temple vale para todas as partidas
  await boot(page, '?seed=3&stage=temple');
  for (let i = 0; i < 4; i++) {
    expect(await page.evaluate(() => window.__game!.stage)).toBe('temple');
    await page.evaluate(() => window.__game!.startRun());
  }
  expect(errors).toEqual([]);
});

test('título: o layout cabe na tela, sem sobrepor, do celular ao monitor largo', async ({ page }) => {
  const errors = watchErrors(page);
  for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1080], [1366, 768], [1024, 768], [768, 1024], [412, 915], [390, 844], [400, 800], [375, 667], [360, 640], [320, 568], [844, 390], [667, 375]]) {
    await page.setViewportSize({ width: w, height: h });
    await boot(page, '?seed=3');
    await page.locator('.char-card[data-char="tomoe"]').click();
    await expect(page.locator('button[data-action="start"]')).toBeVisible();
    await page.waitForTimeout(350); // transição do "Jogar" e do passo à frente
    const r = await page.evaluate(() => {
      const box = (sel: string) => { const b = document.querySelector(sel)!.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom }; };
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        mark: box('.title-mark'), record: box('.title-record'), mute: box('.scr-title .corner-mute'),
        ronin: box('.char-card[data-char="ronin"]'), tomoe: box('.char-card[data-char="tomoe"]'),
        plateR: box('.char-card[data-char="ronin"] .char-plate'), plateT: box('.char-card[data-char="tomoe"] .char-plate'),
        start: box('button[data-action="start"]'),
      };
    });
    type Box = { x: number; y: number; r: number; b: number };
    const inside = (b: Box) => b.x >= -0.5 && b.y >= -0.5 && b.r <= w + 0.5 && b.b <= h + 0.5;
    const hit = (a: Box, b: Box) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
    // o ensō é redondo: vale o círculo (raio ~0,47 da caixa), não os cantos da caixa
    const hitCircle = (c: Box, b: Box) => {
      const cx = (c.x + c.r) / 2, cy = (c.y + c.b) / 2, rad = (c.r - c.x) * 0.47;
      const nx = Math.max(b.x, Math.min(cx, b.r)), ny = Math.max(b.y, Math.min(cy, b.b));
      return Math.hypot(nx - cx, ny - cy) < rad;
    };
    const size = `${w}×${h}`;
    expect(r.overflow, size).toBeLessThanOrEqual(0);
    for (const k of ['mark', 'record', 'mute', 'ronin', 'tomoe', 'plateR', 'plateT', 'start'] as const) expect(inside(r[k]), `${size} ${k} na tela`).toBe(true);
    for (const [a, b] of [['ronin', 'tomoe'], ['ronin', 'record'], ['tomoe', 'record'], ['tomoe', 'mute'], ['record', 'mute'], ['plateR', 'start'], ['plateT', 'start'], ['plateR', 'plateT']] as const) {
      expect(hit(r[a], r[b]), `${size} ${a} × ${b}`).toBe(false);
    }
    for (const k of ['ronin', 'tomoe', 'record', 'mute', 'plateR', 'plateT'] as const) expect(hitCircle(r.mark, r[k]), `${size} símbolo × ${k}`).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('trocar de cenário várias vezes não acumula memória de vídeo', async ({ page }) => {
  const errors = watchErrors(page);
  // jogando (no título a cena 3D nem é desenhada): cada troca descarta o cenário anterior
  await boot(page);
  await expect.poll(() => screenOf(page)).toBe('playing');
  const mem = () => page.evaluate(() => { const m = window.__game!.renderer.renderer.info.memory; return { g: m.geometries, t: m.textures }; });
  const pick = async (id: string) => { await page.evaluate(s => window.__game!.setStage(s as 'field' | 'temple'), id); await page.waitForTimeout(250); };
  await pick('temple');
  const first = await mem();
  for (let i = 0; i < 3; i++) { await pick('field'); await pick('temple'); }
  const after = await mem();
  expect(after.g).toBeLessThanOrEqual(first.g + 2);
  expect(after.t).toBeLessThanOrEqual(first.t + 2);
  expect(errors).toEqual([]);
});

test('templo: 15 s de luta com entradas aleatórias, ninguém atravessa as construções', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await boot(page, '?autostart&seed=5&stage=temple');
  await page.evaluate(() => { window.__game!.sim.startWave(4); });
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  let s = 777;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  let worst = 0;
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const k = keys[Math.floor(rnd() * 4)];
    await page.keyboard.down(k);
    if (rnd() < 0.6) await page.keyboard.press('KeyJ');
    if (rnd() < 0.15) await page.keyboard.press('Space');
    await page.waitForTimeout(120 + rnd() * 200);
    await page.keyboard.up(k);
    const inside = await page.evaluate(() => {
      const g = window.__game!, p = g.sim.player;
      if (p.hp < 40) p.hp = 100;
      return [p, ...g.sim.enemies.filter(e => e.state !== 'dying')].filter(e => g.sim.blocked(e.pos)).length;
    });
    worst = Math.max(worst, inside);
  }
  const st = await page.evaluate(() => {
    const g = window.__game!;
    const bad = [g.sim.player, ...g.sim.enemies].some(e => !Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.z));
    return { bad, screen: g.screen, stage: g.stage };
  });
  expect(st).toEqual({ bad: false, screen: 'playing', stage: 'temple' });
  expect(worst).toBe(0);
  expect(errors).toEqual([]);
});

test('Ronin: com a Fúria cheia, R vira leão, o leão corre, ataca (garra e rugido) e R volta a humano', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await boot(page, '?autostart&seed=3&char=ronin&stage=field');
  await page.evaluate(() => { const g = window.__game!; g.sim.waveTimer = Infinity; g.sim.player.fury = 100; });
  await page.keyboard.press('KeyR');
  await expect.poll(() => page.evaluate(() => window.__game!.sim.player.state)).toBe('transform');
  await expect.poll(() => page.evaluate(() => { const p = window.__game!.sim.player; return `${p.form}:${p.state}`; }), { timeout: 8000 }).toBe('lion:idle');
  // quadros de locomoção do leão: andar/galope de frente, costas e perfis (lwS, lrE...) ou três-quartos (lNW, lSE...)
  const LION_MOVE = /^l(?:[rw][SNWE]|[SN][WE])\d\d$/;
  expect(await page.evaluate(() => window.__game!.view.playerFrame)).toMatch(LION_MOVE);
  // correndo como leão: mais rápido que o samurai
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  const run = await page.evaluate(() => { const g = window.__game!, p = g.sim.player; return { v: Math.hypot(p.vel.x, p.vel.z), frame: g.view.playerFrame }; });
  await page.keyboard.up('KeyD');
  expect(run.v).toBeGreaterThan(6.5);
  expect(run.frame).toMatch(LION_MOVE);

  const lionState = () => page.evaluate(() => { const g = window.__game!, p = g.sim.player; return { state: p.state, frame: String(g.view.playerFrame) }; });
  /** No estado `st`, o quadro desenhado; fora dele, o nome do estado (para o poll esperar o golpe começar). */
  const frameIn = async (st: string) => { const s = await lionState(); return s.state === st ? s.frame : s.state; };
  // garra (J): alcança um inimigo a 4 m à frente (alcance 5 m), mais longe que qualquer corte do samurai
  const clawTarget = await page.evaluate(() => {
    const s = window.__game!.sim, p = s.player;
    p.fury = 100; // o tempo da forma não acaba no meio do teste
    const e = s.spawnEnemy('ronin', { x: p.pos.x + p.facing.x * 4, z: p.pos.z + p.facing.z * 4 });
    e.state = 'chase'; e.t = 0; e.tokenCd = 99; e.def.speed = 0;
    return e.id;
  });
  await page.keyboard.press('KeyJ');
  await expect.poll(() => frameIn('claw')).toMatch(/^lclaw\d\d$/);
  await expect.poll(() => page.evaluate(i => {
    const e = window.__game!.sim.enemies.find(x => x.id === i);
    return !e || e.state === 'dying' || e.hp < e.def.hp;
  }, clawTarget), { timeout: 3000 }).toBe(true);
  await expect.poll(async () => (await lionState()).state, { timeout: 3000 }).toMatch(/^(idle|run)$/);
  // os golpes do leão não enchem o Ki
  expect(await page.evaluate(() => window.__game!.sim.player.ki)).toBe(0);

  // rugido (segurar L ~0,8 s e soltar): acerta em volta, inclusive atrás
  const roarTargets = await page.evaluate(() => {
    const s = window.__game!.sim, p = s.player;
    p.fury = 100;
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const e = s.spawnEnemy('ronin', { x: p.pos.x + Math.cos(a) * 3.5, z: p.pos.z + Math.sin(a) * 3.5 });
      e.state = 'circle'; e.t = 0; e.tokenCd = 99; e.def.speed = 0;
      ids.push(e.id);
    }
    return ids;
  });
  await page.keyboard.down('KeyL');
  await expect.poll(async () => (await lionState()).state).toBe('roarCharge');
  // segura até a carga ficar pronta no tempo da simulação: com o navegador ainda frio (renderização por CPU),
  // 800 ms de relógio às vezes davam menos que os 0,6 s de carga e o rugido desistia
  await expect.poll(() => page.evaluate(() => window.__game!.sim.player.chargeReady), { timeout: 5000 }).toBe(true);
  await page.keyboard.up('KeyL');
  await expect.poll(() => frameIn('roar')).toMatch(/^lroar\d\d$/);
  await expect.poll(() => page.evaluate(ids => ids.filter(i => {
    const e = window.__game!.sim.enemies.find(x => x.id === i);
    return !e || e.state === 'dying' || e.hp < e.def.hp;
  }).length, roarTargets), { timeout: 3000 }).toBe(4);
  await expect.poll(async () => (await lionState()).state, { timeout: 10_000 }).toMatch(/^(idle|run)$/);
  expect(await page.evaluate(() => window.__game!.sim.player.roarCd)).toBeGreaterThan(0);

  await page.keyboard.press('KeyR');
  await expect.poll(() => page.evaluate(() => { const p = window.__game!.sim.player; return `${p.form}:${p.state}`; }), { timeout: 8000 }).toBe('human:idle');
  expect(errors).toEqual([]);
});

test('Tomoe: R não transforma (a forma de leão é só do Ronin)', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page, '?autostart&seed=3&char=tomoe&stage=field');
  await page.evaluate(() => { const g = window.__game!; g.sim.waveTimer = Infinity; g.sim.player.fury = 100; });
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => { const p = window.__game!.sim.player; return `${p.form}:${p.state}`; })).toBe('human:idle');
  expect(errors).toEqual([]);
});

test('Tomoe: combo, defesa, esquiva e especial funcionam', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page, '?autostart&seed=3&char=tomoe&stage=field');
  await page.evaluate(() => {
    const s = window.__game!.sim, p = s.player;
    s.waveTimer = Infinity;
    p.ki = 100;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const e = s.spawnEnemy('ronin', { x: p.pos.x + Math.cos(a) * 2.6, z: p.pos.z + Math.sin(a) * 2.6 });
      e.state = 'circle'; e.tokenCd = 99; e.def.speed = 0;
    }
  });
  await page.keyboard.press('KeyJ');
  await expect.poll(() => page.evaluate(() => window.__game!.sim.player.state)).toBe('attack');
  await page.waitForTimeout(400);
  await page.keyboard.down('KeyK');
  await expect.poll(() => page.evaluate(() => window.__game!.sim.player.state)).toBe('guard');
  await page.keyboard.up('KeyK');
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyQ');
  await expect.poll(() => page.evaluate(() => window.__game!.sim.kills), { timeout: 5000 }).toBeGreaterThanOrEqual(4);
  await expect.poll(() => page.evaluate(() => window.__game!.sim.player.state), { timeout: 5000 }).toBe('idle');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__game!.sim.player.state)).toMatch(/dash/);
  expect(errors).toEqual([]);
});

test('WASD move o samurai na direção da tela', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => ({ ...window.__game!.sim.player.pos }));
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  const after = await page.evaluate(() => ({ ...window.__game!.sim.player.pos }));
  // direita da tela = (+x, -z) no mundo (câmera a 45°)
  expect(after.x - before.x).toBeGreaterThan(0.8);
  expect(before.z - after.z).toBeGreaterThan(0.8);

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  const up = await page.evaluate(() => ({ ...window.__game!.sim.player.pos }));
  // cima da tela = (-x, -z)
  expect(after.x - up.x).toBeGreaterThan(0.5);
  expect(after.z - up.z).toBeGreaterThan(0.5);
});

test('corte com J acerta um inimigo à frente', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  const id = await page.evaluate(() => {
    const g = window.__game!;
    const p = g.sim.player;
    const e = g.sim.spawnEnemy('ronin', { x: p.pos.x + 1.2, z: p.pos.z + 1.2 });
    e.state = 'chase'; e.t = 0; e.tokenCd = 99; e.def.speed = 0; // parado e sem revidar durante o teste
    return e.id;
  });
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(250);
  await page.keyboard.press('KeyJ');
  await expect.poll(() => page.evaluate(i => {
    const e = window.__game!.sim.enemies.find(x => x.id === i);
    return !e || e.state === 'dying' || e.hp < e.def.hp;
  }, id), { timeout: 3000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('iaido: segurar L e soltar corta em linha e gasta Ki', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.__game!;
    g.sim.player.ki = 100;
    g.sim.player.facing = { x: 0.7071, z: -0.7071 }; // direita da tela
    for (let i = 0; i < 3; i++) {
      const e = g.sim.spawnEnemy('ronin', { x: 1.2 + i * 1.4, z: -(1.2 + i * 1.4) });
      e.state = 'chase'; e.tokenCd = 99; e.def.speed = 0;
    }
  });
  await page.keyboard.down('KeyL');
  // O tempo da simulação pode avançar mais devagar com WebGL por software.
  await expect.poll(() => page.evaluate(() => window.__game!.sim.player.chargeReady), { timeout: 10_000 }).toBe(true);
  await page.keyboard.up('KeyL');
  await expect.poll(() => page.evaluate(() => window.__game!.sim.kills), { timeout: 3000 }).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__game!.sim.player.ki)).toBeLessThan(100);
});

test('defesa: K no tempo certo apara o golpe e contra-ataca', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  // congela o laço e avança quadro a quadro para acertar o tempo
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.waitForTimeout(100);
  const id = await page.evaluate(() => {
    const g = window.__game!, s = g.sim, p = s.player;
    s.waveTimer = Infinity;
    p.facing = { x: 0.7071, z: -0.7071 };
    const e = s.spawnEnemy('brute', { x: p.pos.x + 1.2, z: p.pos.z - 1.2 });
    e.state = 'windup'; e.token = true; e.tokenCd = 99; e.t = e.def.windup - 0.1;
    e.strikeDir = { x: -0.7071, z: 0.7071 }; e.facing = e.strikeDir;
    return e.id;
  });
  await page.keyboard.down('KeyK');
  await page.evaluate(() => window.__game!.tick(1 / 60));
  await page.keyboard.up('KeyK');
  const r = await page.evaluate(i => {
    const g = window.__game!;
    for (let k = 0; k < 30; k++) g.tick(1 / 60);
    const e = g.sim.enemies.find(x => x.id === i);
    return { state: e?.state, hp: e?.hp, max: e?.def.hp, playerHp: g.sim.player.hp };
  }, id);
  expect(r.state).toBe('parried');
  expect(r.hp!).toBeLessThan(r.max!);
  expect(r.playerHp).toBe(100);
  expect(errors).toEqual([]);
});

test('Kiai: Q com Ki cheio mata todos em volta', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  await page.evaluate(() => {
    const s = window.__game!.sim, p = s.player;
    s.waveTimer = Infinity;
    p.ki = 100;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const e = s.spawnEnemy(i === 0 ? 'brute' : 'ronin', { x: p.pos.x + Math.cos(a) * 2.8, z: p.pos.z + Math.sin(a) * 2.8 });
      e.state = 'circle'; e.tokenCd = 99; e.def.speed = 0;
    }
  });
  await page.keyboard.press('KeyQ');
  await expect.poll(() => page.evaluate(() => window.__game!.sim.kills), { timeout: 5000 }).toBe(6);
  expect(await page.evaluate(() => window.__game!.sim.player.ki)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__game!.sim.player.state), { timeout: 5000 }).toBe('idle');
  expect(errors).toEqual([]);
});

test('Esc pausa e congela a simulação', async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await expect.poll(() => screenOf(page)).toBe('paused');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'paused');
  const t0 = await page.evaluate(() => window.__game!.sim.tick);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__game!.sim.tick)).toBe(t0);
  await page.keyboard.press('Escape');
  await expect.poll(() => screenOf(page)).toBe('playing');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game!.sim.tick)).toBeGreaterThan(t0);
});

test('morte leva ao fim de jogo e "lutar de novo" reinicia', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const sim = window.__game!.sim as unknown as { damagePlayer(d: number, dir: { x: number; z: number }): void };
    sim.damagePlayer(999, { x: 1, z: 0 });
  });
  await expect.poll(() => screenOf(page), { timeout: 12_000 }).toBe('over');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'over');
  const restart = page.locator('button[data-action="restart"]:visible');
  await expect(restart).toBeVisible();
  await restart.click();
  await expect.poll(() => screenOf(page)).toBe('playing');
  const p = await page.evaluate(() => ({ hp: window.__game!.sim.player.hp, over: window.__game!.sim.over }));
  expect(p.over).toBe(false);
  expect(p.hp).toBeGreaterThan(90);
  expect(errors).toEqual([]);
});

test('layout de celular: sem rolagem horizontal e cena desenhada', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  const errors = watchErrors(page);
  await boot(page, '?seed=3');
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await screenVariance(page)).toBeGreaterThan(6);
  expect(errors).toEqual([]);
});

test('estabilidade: 25 s de luta com entradas aleatórias', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await boot(page);
  await page.evaluate(() => { window.__game!.sim.startWave(4); });
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const end = Date.now() + 25_000;
  while (Date.now() < end) {
    const k = keys[Math.floor(rnd() * 4)];
    await page.keyboard.down(k);
    if (rnd() < 0.6) await page.keyboard.press('KeyJ');
    if (rnd() < 0.15) await page.keyboard.press('Space');
    await page.waitForTimeout(120 + rnd() * 200);
    await page.keyboard.up(k);
    // mantém o teste vivo: sem morrer
    await page.evaluate(() => { const p = window.__game!.sim.player; if (p.hp < 40) p.hp = 100; });
  }
  const st = await page.evaluate(() => {
    const g = window.__game!;
    const bad = [g.sim.player, ...g.sim.enemies].some(e => !Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.z));
    return { bad, enemies: g.sim.enemies.length, fps: Math.round(g.fps), kills: g.sim.kills, screen: g.screen, calls: g.renderer.renderer.info.render.calls };
  });
  console.log('estabilidade', st);
  expect(st.bad).toBe(false);
  expect(st.enemies).toBeLessThanOrEqual(45);
  expect(st.kills).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
