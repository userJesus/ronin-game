// Capturas de tela e animação do README, gravadas em docs/media/: título, Campo de batalha, templo, forma de
// leão, Hanafubuki da Tomoe, celular e gameplay.gif.
//   npm run dev                          (em outro terminal: o jogo em http://localhost:5173/)
//   npm run media                        (grava em docs/media/)
// Ou contra o build de produção:
//   npm run build && npm run preview     (em outro terminal: http://localhost:4173/)
//   npm run media -- --url http://localhost:4173/
// Opções: --url URL (padrão http://localhost:5173/) · --out PASTA (padrão docs/media)
//         --only titulo,campo,templo,leao,tomoe,celular,gameplay · --debug PASTA (quadros do GIF decodificados)
// Determinístico: semente, cenário e personagem fixos; o laço do jogo fica congelado desde o carregamento e anda
// 1/60 s por vez com window.__game.tick. As entradas são eventos de teclado no window (o mesmo caminho das teclas
// de verdade), decididas a cada passo por um robô simples; inimigos, Ki e Fúria são preparados pelos ganchos do
// sim. Tudo sai em cinza puro: PNG de 8 bits e GIF de paleta cinza, sem dependência nova.
// As cenas de divulgação preparam o estado da partida; não são uma medição de dificuldade ou desempenho.
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const BASE = String(args.url ?? 'http://localhost:5173/');
const OUT = path.resolve(String(args.out ?? 'docs/media'));
const DEBUG = typeof args.debug === 'string' ? path.resolve(args.debug) : null;
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
/** --strip (com --debug): em vez da captura final, tiras de quadros em volta do herói para escolher o instante. */
const STRIP = !!(DEBUG && args.strip);
/** Avisos de console que não são do jogo: fontes do Google sem rede. */
const BENIGN = /fonts\.(googleapis|gstatic)|ERR_INTERNET_DISCONNECTED/;

// ---------------------------------------------------------------- dentro da página
/** Roda antes do jogo: congela o laço e expõe `window.__media` (teclado, robô de luta, passos de 1/60 s). */
function inPage() {
  // o jogo só anda quando o script manda: o laço de requestAnimationFrame nunca roda
  window.requestAnimationFrame = () => 0;
  const DT = 1 / 60;
  const held = new Set();
  const key = (code, down) => {
    if (down === held.has(code)) return;
    if (down) held.add(code); else held.delete(code);
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
  };
  const tap = code => { key(code, true); key(code, false); };
  // direção no chão -> WASD (inverso de fromScreen com a câmera a 45°)
  const steer = (dx, dz) => {
    let sx = dx - dz, sy = -(dx + dz);
    const l = Math.hypot(sx, sy);
    if (l > 1e-6) { sx /= l; sy /= l; } else sx = sy = 0;
    key('KeyD', sx > 0.38); key('KeyA', sx < -0.38); key('KeyW', sy > 0.38); key('KeyS', sy < -0.38);
  };
  const live = e => e.state !== 'dying' && e.state !== 'spawn';
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  /** Inimigos preparando ou soltando o golpe (contorno branco e marca no chão). */
  const cues = () => window.__game.sim.enemies.filter(e => e.state === 'windup' || e.state === 'strike').length;
  const near = r => { const s = window.__game.sim; return s.enemies.filter(e => live(e) && dist(e.pos, s.player.pos) <= r).length; };
  let guardT = 0;
  /**
   * Robô de luta: vai até o inimigo vivo mais próximo e corta em combo de perto (apontando para ele); com `hold`,
   * fica no lugar e só corta quem chega (a horda se junta em volta); com `parry`, segura a defesa quando o golpe
   * de alguém perto está para sair.
   */
  const fight = (o = {}) => {
    const s = window.__game.sim, p = s.player;
    if (guardT > 0) { if (--guardT === 0) key('KeyK', false); return; }
    if (o.parry && (p.state === 'idle' || p.state === 'run')) {
      const th = s.enemies.find(e => e.state === 'windup' && e.def.windup - e.t <= 0.1 && dist(e.pos, p.pos) <= e.def.reach + 0.6);
      if (th) { steer(0, 0); key('KeyK', true); guardT = 14; return; }
    }
    let best = null, bd = Infinity;
    for (const e of s.enemies) if (live(e)) { const d = dist(e.pos, p.pos); if (d < bd) { bd = d; best = e; } }
    const close = best && bd <= (o.reach ?? 2);
    if (!best || (o.hold && !close)) { steer(0, 0); return; }
    steer(best.pos.x - p.pos.x, best.pos.z - p.pos.z);
    if (close && s.tick % (o.every ?? 10) === 0) tap('KeyJ');
  };
  const tick = () => { const g = window.__game; g.time += DT; g.tick(DT); };
  const info = () => {
    const g = window.__game, s = g.sim, p = s.player;
    return {
      tick: s.tick, state: p.state, t: +p.t.toFixed(3), form: p.form, combo: p.comboStep, hp: Math.round(p.hp), ki: Math.round(p.ki),
      fury: Math.round(p.fury), wave: s.wave, enemies: s.enemies.filter(live).length, near: near(6), kills: s.kills,
      frame: String(g.view.playerFrame), screen: g.screen, toast: !!document.querySelector('.sh-toast.is-on'),
    };
  };
  /** Inimigos em volta do jogador (ângulos regulares a partir de `a0`, distâncias entre r0 e r1). */
  const ring = (n, r0, r1, kinds = ['ronin'], a0 = 0) => {
    const s = window.__game.sim, p = s.player;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2, r = r0 + (r1 - r0) * ((i * 0.618) % 1);
      s.spawnEnemy(kinds[i % kinds.length], { x: p.pos.x + Math.cos(a) * r, z: p.pos.z + Math.sin(a) * r });
    }
  };
  /**
   * `ticks` passos de 1/60 s. `each`: JS por passo (g, s, p, m); `fight`: opções do robô; `until`: expressão que
   * encerra antes (checada a partir do passo `min`); `dark`: sem desenhar (só simula; bem mais rápido).
   */
  const run = (o = {}) => {
    const g = window.__game;
    const each = o.each ? new Function('g', 's', 'p', 'm', o.each) : null;
    const until = o.until ? new Function('g', 's', 'p', 'm', `return (${o.until});`) : null;
    const render = g.renderer.render;
    if (o.dark) g.renderer.render = () => {};
    try {
      const n = o.ticks ?? 1;
      for (let i = 0; i < n; i++) {
        if (until && i >= (o.min ?? 0) && until(g, g.sim, g.sim.player, api)) return { ok: true, ...info() };
        if (each) each(g, g.sim, g.sim.player, api);
        if (o.fight) fight(o.fight);
        tick();
      }
      return { ok: !until, ...info() };
    } finally { if (o.dark) g.renderer.render = render; }
  };
  const release = () => { for (const k of [...held]) key(k, false); guardT = 0; };
  const api = { key, tap, steer, near, cues, ring, run, info, release };
  window.__media = api;
}

// ---------------------------------------------------------------- navegador
// texto com suavização em cinza (a subpixel do Windows franja as letras de cor) e cores em sRGB fixo
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text', '--force-color-profile=srgb'],
});
const problems = [];

/** Abre o jogo com `query` e espera o jogo e as fontes (o laço já nasce congelado). */
async function openGame(query, { width = 1280, height = 720, mobile = false, dpr = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(inPage);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error' || BENIGN.test(m.text())) return;
    if (BENIGN.test(m.location()?.url ?? '')) return;
    errors.push(`console: ${m.text()} ${m.location()?.url ?? ''}`.trim());
  });
  await page.goto(new URL(query, BASE).href);
  // (sondagem por intervalo: a por requestAnimationFrame pararia junto com o laço congelado)
  await page.waitForFunction(() => !!window.__game && !document.getElementById('boot'), null, { timeout: 60_000, polling: 100 });
  // as fontes do Google entram por faixas de caracteres: carrega as faixas do texto que está na página
  const fonts = await page.evaluate(async () => {
    const text = document.body.innerText + ' 0123456789 侍巴野寺獅気合花吹雪爪吼居合勝';
    const faces = ['16px "DotGothic16"', '600 32px "Shippori Mincho B1"', '800 32px "Shippori Mincho B1"'];
    await Promise.all(faces.map(f => document.fonts.load(f, text).catch(() => []))).catch(() => {});
    await document.fonts.ready;
    return faces.every(f => document.fonts.check(f));
  });
  if (!fonts) problems.push(`${query}: fontes do Google não carregaram (sem rede?) — a interface saiu com a fonte reserva`);
  return { ctx, page, errors, query };
}

async function closeGame(g) {
  for (const e of g.errors) problems.push(`${g.query}: ${e}`);
  await g.ctx.close();
}

const step = (page, o) => page.evaluate(o => window.__media.run(o), o);

/** Captura da janela inteira em cinza (animações de CSS levadas ao fim: nada depende do relógio). */
async function shot(page) {
  return gray(await page.screenshot({ animations: 'disabled', caret: 'hide' }));
}

// ---------------------------------------------------------------- imagens
/** PNG -> cinza (1 byte por pixel); `dev` = maior desvio de um canal em relação à média (0 = cinza estrito). */
function gray(buf) {
  const png = PNG.sync.read(buf);
  const { width: w, height: h, data } = png;
  const px = new Uint8Array(w * h);
  let dev = 0;
  for (let i = 0, j = 0; j < px.length; i += 4, j++) {
    const v = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
    dev = Math.max(dev, Math.abs(data[i] - v), Math.abs(data[i + 1] - v), Math.abs(data[i + 2] - v));
    px[j] = v;
  }
  return { w, h, px, dev };
}

/** Redução por fator inteiro, vizinho mais próximo (a pixel art não borra). */
function shrink(img, k) {
  if (k === 1) return img;
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k), px = new Uint8Array(w * h), o = k >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = img.px[(y * k + o) * img.w + x * k + o];
  return { w, h, px, dev: img.dev };
}

function pngGray(img) {
  const png = new PNG({ width: img.w, height: img.h });
  for (let j = 0, i = 0; j < img.px.length; j++, i += 4) {
    png.data[i] = png.data[i + 1] = png.data[i + 2] = img.px[j];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png, { colorType: 0, deflateLevel: 9 });
}

/** Página vazia num endereço local (contexto seguro, para o ImageDecoder), sem servidor. */
async function blankPage(page) {
  await page.route('http://localhost:4179/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>media</title>' }));
  await page.goto('http://localhost:4179/');
}

const results = [];
const kb = n => `${(n / 1024).toFixed(0)} KB`;
const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);

/** PNG cinza com extensão estável, para não quebrar os links do README ao regenerar. */
async function save(name, img, what) {
  // o papel da paleta (#e9e7e2) já desvia 7 níveis do cinza neutro: acima disso é cor de verdade
  if (img.dev > 8) problems.push(`${name}: pixels fora do cinza (desvio de até ${img.dev} níveis por canal)`);
  const file = `${name}.png`, data = pngGray(img);
  fs.writeFileSync(path.join(OUT, file), data);
  results.push({ file, size: `${img.w}×${img.h}`, bytes: data.length, sha: sha(data), dev: img.dev, what });
  console.log(`${file}  ${img.w}×${img.h}  ${kb(data.length)}  sha ${sha(data)}  (desvio do cinza antes da conversão: ${img.dev})`);
}

// ---------------------------------------------------------------- GIF (89a, paleta cinza, LZW)
const DICT = new Int16Array(1 << 20), STAMP = new Int32Array(1 << 20);
let GEN = 0;

/** Compressão LZW do GIF (códigos de tamanho variável até 12 bits; tabela cheia = código de limpar). */
function lzw(idx, minSize) {
  const clear = 1 << minSize, eoi = clear + 1;
  const buf = new Uint8Array(idx.length * 2 + 64);
  let p = 0, cur = 0, shift = 0, size = minSize + 1, next = eoi + 1;
  const emit = c => { cur |= c << shift; shift += size; while (shift >= 8) { buf[p++] = cur & 255; cur >>>= 8; shift -= 8; } };
  GEN++;
  emit(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], at = (prefix << 8) | k;
    if (STAMP[at] === GEN) { prefix = DICT[at]; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); next = eoi + 1; size = minSize + 1; GEN++; }
    else { if (next >= 1 << size) size++; DICT[at] = next++; STAMP[at] = GEN; }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) buf[p++] = cur & 255;
  // sub-blocos de até 255 bytes, terminados por um bloco vazio
  const out = [Buffer.from([minSize])];
  for (let o = 0; o < p; o += 255) { const n = Math.min(255, p - o); out.push(Buffer.from([n]), Buffer.from(buf.subarray(o, o + n))); }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

/**
 * GIF animado em laço infinito a partir de quadros em cinza (`delays` em centésimos de segundo). A paleta são os
 * níveis de cinza usados (até 255; o índice seguinte é o transparente). Depois do primeiro, cada quadro grava só o
 * retângulo que mudou, com os pixels iguais aos do anterior transparentes; quadros idênticos somam a duração.
 */
function encodeGif(frames, w, h, delays) {
  const used = new Float64Array(256);
  for (const f of frames) for (let i = 0; i < f.length; i++) used[f[i]]++;
  const rep = Array.from({ length: 256 }, (_, v) => v);
  const levels = [];
  for (let v = 0; v < 256; v++) if (used[v]) levels.push(v);
  // mais de 255 níveis: o menos usado vai para o vizinho mais próximo
  let merged = 0;
  while (levels.length > 255) {
    let k = 0;
    for (let i = 1; i < levels.length; i++) if (used[levels[i]] < used[levels[k]]) k = i;
    const v = levels[k];
    const to = k === 0 ? levels[1] : k === levels.length - 1 ? levels[k - 1] : v - levels[k - 1] <= levels[k + 1] - v ? levels[k - 1] : levels[k + 1];
    for (let u = 0; u < 256; u++) if (rep[u] === v) rep[u] = to;
    used[to] += used[v]; merged += used[v]; used[v] = 0;
    levels.splice(k, 1);
  }
  const index = new Uint8Array(256);
  levels.forEach((v, i) => { index[v] = i; });
  const lut = Uint8Array.from(rep, v => index[v]);
  const TRANSP = levels.length;
  const u16 = n => [n & 255, (n >> 8) & 255];
  const pal = Buffer.alloc(256 * 3);
  levels.forEach((v, i) => { pal[i * 3] = pal[i * 3 + 1] = pal[i * 3 + 2] = v; });

  const recs = [];
  let prev = null;
  for (let f = 0; f < frames.length; f++) {
    const cur = frames[f];
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (prev) {
      x0 = w; y0 = h; x1 = -1; y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0, i = y * w; x < w; x++, i++) {
        if (lut[cur[i]] === lut[prev[i]]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) { recs[recs.length - 1].delay += delays[f]; continue; }
    }
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1, idx = new Uint8Array(fw * fh);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const i = (y0 + y) * w + x0 + x, a = lut[cur[i]];
      idx[y * fw + x] = prev && lut[prev[i]] === a ? TRANSP : a;
    }
    recs.push({ x0, y0, fw, fh, delay: delays[f], data: lzw(idx, 8), src: f });
    prev = cur;
  }
  const parts = [
    Buffer.from('GIF89a', 'ascii'),
    Buffer.from([...u16(w), ...u16(h), 0xf7, 0, 0]), pal,
    Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0, 0, 0]),
  ];
  for (const r of recs) {
    parts.push(Buffer.from([0x21, 0xf9, 0x04, (1 << 2) | 1, ...u16(r.delay), TRANSP, 0]));
    parts.push(Buffer.from([0x2c, ...u16(r.x0), ...u16(r.y0), ...u16(r.fw), ...u16(r.fh), 0]), r.data);
  }
  parts.push(Buffer.from([0x3b]));
  // o que cada quadro gravado deve mostrar depois de decodificado (níveis já juntados)
  const expect = recs.map(r => fnv(Uint8Array.from(frames[r.src], v => levels[lut[v]])));
  return { gif: Buffer.concat(parts), frames: recs.length, levels: levels.length, merged, expect };
}

function fnv(px) {
  let h = 2166136261;
  for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Abre o GIF no Chromium: <img> -> canvas (dimensões) e ImageDecoder (quadros, laço, conteúdo de cada quadro). */
async function verifyGif(file, exp, dump = []) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await blankPage(page);
  const r = await page.evaluate(async ({ b64, dump }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const out = { w: img.naturalWidth, h: img.naturalHeight, frames: -1, loop: '', hashes: [], gray: true, shots: {} };
    if (typeof ImageDecoder === 'undefined') return out;
    const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
    await dec.tracks.ready;
    const tr = dec.tracks.selectedTrack;
    out.frames = tr.frameCount;
    out.loop = String(tr.repetitionCount);
    for (let i = 0; i < tr.frameCount; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(image, 0, 0);
      image.close();
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k] !== d[k + 1] || d[k] !== d[k + 2] || d[k + 3] !== 255) out.gray = false;
        h ^= d[k]; h = Math.imul(h, 16777619);
      }
      out.hashes.push(h >>> 0);
      if (dump.includes(i)) out.shots[i] = c.toDataURL('image/png');
    }
    return out;
  }, { b64: fs.readFileSync(file).toString('base64'), dump });
  await ctx.close();
  const same = r.hashes.length === exp.length && r.hashes.every((h, i) => h === exp[i]);
  return { ...r, same };
}

// ---------------------------------------------------------------- cenas
/** Robô das capturas: fica no lugar (a horda cerca), corta em combo quem chega e apara. */
const FIGHT = { hold: true, parry: true, reach: 2.2, every: 10 };
/** Sem morte nem aviso de Fúria cheia no meio da preparação (o aviso some por relógio, não por passo). */
const CALM = 'if (p.hp < 60) p.hp = 60; if (p.fury > 60) p.fury = 60;';

/** Recorte (cinza) de `w`×`h` centrado em (cx, cy), preso dentro da imagem. */
function crop(img, cx, cy, w, h) {
  const x0 = Math.max(0, Math.min(img.w - w, Math.round(cx - w / 2))), y0 = Math.max(0, Math.min(img.h - h, Math.round(cy - h / 2)));
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) px.set(img.px.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x0 + w), y * w);
  return { w, h, px, dev: img.dev };
}

/** --debug: tira com `n` recortes em volta do herói, um a cada `every` passos de `plan` (para escolher o instante). */
async function strip(g, name, n, every, plan = {}) {
  const cw = 420, ch = 300, cols = Math.min(n, 4), rows = Math.ceil(n / cols);
  const out = { w: cols * cw, h: rows * ch, px: new Uint8Array(cols * cw * rows * ch), dev: 0 };
  const labels = [];
  for (let i = 0; i < n; i++) {
    const r = await step(g.page, { ...plan, ticks: every });
    const o = await g.page.evaluate(() => {
      const g = window.__game, p = g.sim.player, V = g.cam.camera.position.constructor;
      return g.renderer.worldToCss(g.cam, new V(p.pos.x, 0.9, p.pos.z));
    });
    const c = crop(await shot(g.page), o.x, o.y, cw, ch);
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
    for (let y = 0; y < ch; y++) out.px.set(c.px.subarray(y * cw, y * cw + cw), (oy + y) * out.w + ox);
    labels.push(`${i}:${r.tick} ${r.state} ${r.t}`);
  }
  fs.writeFileSync(path.join(DEBUG, `${name}-strip.png`), pngGray(out));
  console.log(`  tira ${name}: ${labels.join(' | ')}`);
}

/** Partida já começada: onda `wave` e o robô lutando `secs` s sem desenhar (a dica de controles dos 15 s sai). */
async function match(query, { wave = 3, secs = 15.5, fight = FIGHT, ...view } = {}) {
  const g = await openGame(`?autostart&${query}`, view);
  await g.page.evaluate(w => window.__game.sim.startWave(w), wave);
  const r = await step(g.page, { ticks: Math.round(secs * 60), dark: true, fight, each: CALM });
  return Object.assign(g, { warm: r });
}

const SCENES = {
  async titulo() {
    const g = await openGame('?seed=7&char=ronin', { width: 1600, height: 900 });
    await step(g.page, { ticks: 3 });
    await save('titulo', await shot(g.page), 'tela de título');
    await closeGame(g);
  },

  async campo() {
    const g = await match('seed=7&stage=field&char=ronin', { wave: 2 });
    console.log('  aquecido', g.warm);
    // mais uma leva em volta; depois, o terceiro corte do combo (o mais largo) com a horda cercando, no instante
    // em que o arco do corte está inteiro e no máximo um inimigo marca o golpe (contornos brancos poluem a cena)
    await g.page.evaluate(() => window.__media.ring(14, 3.4, 6.5, ['ronin', 'ronin', 'swift', 'ronin', 'brute'], 0.4));
    const at = "p.state === 'attack' && p.comboStep === 2 && m.near(6) >= 10 && m.cues() <= 1";
    if (STRIP) {
      await step(g.page, { ticks: 900, min: 60, fight: FIGHT, each: CALM, until: at + ' && p.t < 0.02' });
      await strip(g, 'campo', 12, 2, { fight: FIGHT, each: CALM });
      return closeGame(g);
    }
    const r = await step(g.page, { ticks: 900, min: 60, fight: FIGHT, each: CALM, until: at + ' && p.t >= 0.18 && p.t <= 0.23' });
    console.log('  captura', r);
    await save('campo', await shot(g.page), 'Campo de batalha');
    await closeGame(g);
  },

  async templo() {
    const g = await match('seed=11&stage=temple&char=ronin', { wave: 3 });
    // Afasta o combate do incensário central, para mostrar a silhueta inteira junto da arquitetura.
    await g.page.evaluate(() => {
      const p = window.__game.sim.player, k = Math.SQRT1_2;
      p.pos.x = (6 - 11) * k; p.pos.z = (-6 - 11) * k;
      Object.assign(p.prev, p.pos);
      window.__media.ring(8, 2.5, 4.5);
    });
    await step(g.page, { ticks: 100, fight: FIGHT, each: CALM });
    await save('templo', await shot(g.page), 'combate no templo');
    await closeGame(g);
  },

  async leao() {
    const g = await match('seed=7&stage=field&char=ronin', { wave: 2 });
    await g.page.evaluate(() => window.__media.release());
    await step(g.page, { ticks: 120, until: "p.state === 'idle'" });
    await g.page.evaluate(() => { window.__game.sim.player.fury = 100; });
    await step(g.page, { ticks: 1 });
    await g.page.evaluate(() => window.__media.tap('KeyR'));
    const transformed = await step(g.page, { ticks: 240, min: 1, until: "p.form === 'lion' && p.state === 'idle'" });
    if (!transformed.ok) throw new Error('A forma de leão não ficou pronta.');
    await g.page.evaluate(() => window.__media.ring(8, 4.2, 6.2));
    await step(g.page, { ticks: 70 });
    await g.page.evaluate(() => window.__media.tap('KeyJ'));
    const attack = await step(g.page, { ticks: 90, min: 1, until: "p.state === 'claw' && p.t >= 0.3" });
    if (!attack.ok) throw new Error('A garra não foi capturada.');
    await save('leao', await shot(g.page), 'forma de leão: garra');
    await closeGame(g);
  },

  async tomoe() {
    const g = await match('seed=9&stage=field&char=tomoe', { wave: 2 });
    await g.page.evaluate(() => window.__media.release());
    await step(g.page, { ticks: 120, until: "p.state === 'idle'" });
    await g.page.evaluate(() => {
      window.__game.sim.player.ki = 100;
      window.__media.ring(10, 3, 5.5);
      window.__media.tap('KeyQ');
    });
    const special = await step(g.page, { ticks: 150, min: 1, until: "p.state === 'kiai' && p.t >= 0.85" });
    if (!special.ok) throw new Error('O Hanafubuki não foi capturado.');
    await save('tomoe', await shot(g.page), 'Hanafubuki: tempestade de pétalas');
    await closeGame(g);
  },

  async celular() {
    const g = await match('seed=7&stage=field&char=ronin', { wave: 2, width: 400, height: 800, mobile: true });
    await step(g.page, { ticks: 30, fight: FIGHT, each: CALM });
    await save('celular', await shot(g.page), 'controles de toque em tela vertical');
    await closeGame(g);
  },

  async gameplay() {
    const g = await match('seed=7&stage=field&char=ronin', { wave: 3 });
    await g.page.evaluate(() => window.__media.ring(12, 4, 7));
    const frames = [], delays = [];
    let w = 0, h = 0;
    // 7,2 s a 10 fps: simula seis passos por quadro, desenhando só o último.
    for (let i = 0; i < 72; i++) {
      await step(g.page, { ticks: 5, dark: true, fight: FIGHT, each: CALM });
      await step(g.page, { ticks: 1, fight: FIGHT, each: CALM });
      const frame = shrink(await shot(g.page), 2);
      w = frame.w; h = frame.h;
      frames.push(frame.px); delays.push(10);
    }
    await closeGame(g);
    const encoded = encodeGif(frames, w, h, delays);
    const file = path.join(OUT, 'gameplay.gif');
    fs.writeFileSync(file, encoded.gif);
    const decoded = await verifyGif(file, encoded.expect, DEBUG ? [0, 35, 71] : []);
    if (!decoded.same || !decoded.gray || decoded.loop !== 'Infinity') throw new Error('O GIF não passou na verificação de quadros, paleta e repetição.');
    if (DEBUG) for (const [i, data] of Object.entries(decoded.shots)) {
      fs.writeFileSync(path.join(DEBUG, `gameplay-${i}.png`), Buffer.from(data.split(',')[1], 'base64'));
    }
    results.push({ file: 'gameplay.gif', size: `${w}×${h}`, bytes: encoded.gif.length, frames: encoded.frames, sha: sha(encoded.gif) });
    console.log(`gameplay.gif  ${w}×${h}  ${kb(encoded.gif.length)}  ${encoded.frames} quadros verificados`);
  },
};

// ---------------------------------------------------------------- execução
fs.mkdirSync(OUT, { recursive: true });
if (DEBUG) fs.mkdirSync(DEBUG, { recursive: true });
try {
  if (ONLY) for (const name of ONLY) if (!(name in SCENES)) throw new Error(`Cena desconhecida: ${name}`);
  for (const [name, fn] of Object.entries(SCENES)) {
    if (ONLY && !ONLY.has(name)) continue;
    const t0 = Date.now();
    await fn();
    console.log(`  ${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
}
if (problems.length) { console.error('\nPROBLEMAS:'); for (const p of problems) console.error(`  ${p}`); process.exitCode = 1; }
if (DEBUG) fs.writeFileSync(path.join(DEBUG, 'media.json'), JSON.stringify(results, null, 2));
