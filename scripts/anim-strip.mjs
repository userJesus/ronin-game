// Tira de quadros do jogo rodando, recortada em volta do herói (revisão das animações).
//   node scripts/anim-strip.mjs --out strip.png [--url ...] [--frames 12] [--every 50] --setup "JS" --hold "KeyD+KeyJ" --press "KeyJ@0,KeyJ@150"
// --setup: JS executado antes (ex.: criar inimigos); --hold: teclas seguradas durante a captura;
// --press: teclas tocadas em instantes (ms) da captura.
// --manual: congela o laço do jogo e avança 1/60 s por vez (--steps passos entre quadros; --press em passos).
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const url = args.url ?? 'http://localhost:5173/?autostart&seed=11';
const N = Number(args.frames ?? 12), EVERY = Number(args.every ?? 50);
const BOX_W = Number(args.boxw ?? 260), BOX_H = Number(args.boxh ?? 220);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
await page.waitForTimeout(600);
// sem ondas automáticas atrapalhando
await page.evaluate(() => { window.__game.sim.waveTimer = Infinity; });
if (args.manual) {
  // congela o laço antes de montar a cena (senão o tempo real corre entre a montagem e a captura)
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.waitForTimeout(100);
}
if (args.setup) await page.evaluate(args.setup);
if (!args.manual) await page.waitForTimeout(200);

const presses = String(args.press ?? '').split(',').filter(Boolean).map(s => { const [k, t] = s.split('@'); return { k, t: Number(t ?? 0), done: false }; });
const hold = String(args.hold ?? '').split('+').filter(Boolean);
const manual = !!args.manual, STEPS = Number(args.steps ?? 3);
for (const k of hold) await page.keyboard.down(k);
const shots = [];
const t0 = Date.now();
let step = 0;
const grab = async () => {
  const pos = await page.evaluate(() => {
    const g = window.__game, p = g.sim.player;
    const V = g.cam.camera.position.constructor; // THREE.Vector3
    return { ...g.renderer.worldToCss(g.cam, new V(p.pos.x, 0.9, p.pos.z)), state: p.state, t: +p.t.toFixed(2) };
  });
  const buf = await page.screenshot({ clip: { x: Math.max(0, pos.x - BOX_W / 2), y: Math.max(0, pos.y - BOX_H * 0.62), width: BOX_W, height: BOX_H } });
  shots.push({ png: PNG.sync.read(buf), label: `${pos.state} ${pos.t}` });
};
for (let i = 0; i < N; i++) {
  if (manual) {
    for (let k = 0; k < STEPS; k++) {
      const down = presses.filter(p => !p.done && step >= p.t);
      for (const p of down) { p.done = true; await page.keyboard.down(p.k); }
      await page.evaluate(() => window.__game.tick(1 / 60));
      for (const p of down) await page.keyboard.up(p.k);
      step++;
    }
    await grab();
    continue;
  }
  const now = Date.now() - t0;
  for (const p of presses) if (!p.done && now >= p.t) { p.done = true; await page.keyboard.down(p.k); setTimeout(() => page.keyboard.up(p.k).catch(() => {}), 90); }
  await grab();
  const wait = EVERY - ((Date.now() - t0) - i * EVERY);
  if (wait > 0) await page.waitForTimeout(wait);
}
for (const k of hold) await page.keyboard.up(k);

const cols = Math.min(N, Number(args.cols ?? 6)), rows = Math.ceil(N / cols);
const out = new PNG({ width: cols * BOX_W, height: rows * BOX_H });
shots.forEach((s, i) => {
  const ox = (i % cols) * BOX_W, oy = Math.floor(i / cols) * BOX_H;
  for (let y = 0; y < s.png.height; y++) for (let x = 0; x < s.png.width; x++) {
    const a = (y * s.png.width + x) * 4, b = ((oy + y) * out.width + ox + x) * 4;
    for (let k = 0; k < 4; k++) out.data[b + k] = s.png.data[a + k];
  }
  // borda escura entre quadros
  for (let y = 0; y < BOX_H; y++) { const b = ((oy + y) * out.width + ox) * 4; out.data[b] = out.data[b + 1] = out.data[b + 2] = 0; out.data[b + 3] = 255; }
});
fs.writeFileSync(args.out ?? 'strip.png', PNG.sync.write(out));
console.log(shots.map(s => s.label).join(' | '));
if (errors.length) console.log('ERROS:', errors.join(' / '));
await browser.close();
