// Captura de tela do jogo rodando (ferramenta de desenvolvimento/revisão visual).
//   node scripts/shot.mjs --url "http://localhost:5173/?autostart&seed=7" --out shot.png --wait 3000 \
//        [--size 1280x720] [--script "keys:KeyD:1500;wait:500;click;eval:window.__game.sim.player.hp=50"]
// Passos do --script (separados por ';'):
//   wait:MS | keys:CODE[+CODE]:MS (segura teclas) | tap:CODE | click | rclick:MS | eval:JS | shot:ARQ.png
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const url = args.url ?? 'http://localhost:5173/?autostart&seed=7';
const [w, h] = String(args.size ?? '1280x720').split('x').map(Number);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
await page.waitForTimeout(Number(args.wait ?? 1500));

for (const step of String(args.script ?? '').split(';').filter(Boolean)) {
  const [cmd, ...rest] = step.split(':');
  const val = rest.join(':');
  if (cmd === 'wait') await page.waitForTimeout(Number(val));
  else if (cmd === 'keys') {
    const [codes, ms] = [rest[0], Number(rest[1] ?? 300)];
    const list = codes.split('+');
    for (const c of list) await page.keyboard.down(c);
    await page.waitForTimeout(ms);
    for (const c of list) await page.keyboard.up(c);
  } else if (cmd === 'tap') await page.keyboard.press(val);
  else if (cmd === 'click') await page.mouse.click(w / 2 + 100, h / 2);
  else if (cmd === 'rclick') { await page.mouse.move(w / 2 + 150, h / 2 - 40); await page.mouse.down({ button: 'right' }); await page.waitForTimeout(Number(val || 600)); await page.mouse.up({ button: 'right' }); }
  else if (cmd === 'eval') logs.push(`[eval] ${JSON.stringify(await page.evaluate(val))}`);
  else if (cmd === 'shot') await page.screenshot({ path: val });
}
if (args.out) await page.screenshot({ path: args.out });
const info = await page.evaluate(() => {
  const g = window.__game;
  if (!g) return null;
  const s = g.sim;
  return { screen: g.screen, fps: Math.round(g.fps), wave: s.wave, enemies: s.enemies.length, hp: s.player.hp, score: s.score, kills: s.kills, state: s.player.state };
});
console.log(JSON.stringify(info));
for (const l of logs) console.log(l);
await browser.close();
