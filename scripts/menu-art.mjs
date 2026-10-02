// Arte do menu de título (npm run menu-art):
//   assets-src/menu-landscape.png -> src/assets/menu/landscape.webp   (paisagem em tons de cinza, fundo fixo)
//   assets-src/menu-samurai.png   -> src/assets/menu/ronin.webp, tomoe.webp (recortados do fundo verde)
//   src/assets/menu/menu.json     -> largura e altura de cada imagem
// A posição da lua (onde o símbolo do título entra, na tela em pé) está no CSS: src/ui/title/title.css.
// Recorte: chroma key com alfa suave e cor "desmisturada" do verde (os personagens são cinza puro: o que
// sobra de verde na borda é fundo) -> componentes conexos -> os dois maiores são os personagens; fiapos soltos
// (pontas de cabelo, franjas) vão para o mais próximo, sujeira longe de todos some. Os dois saem com a mesma
// faixa vertical, então na mesma altura ficam na mesma escala e com os pés na mesma linha.
// O WebP é codificado pelo Chromium do Playwright (canvas.toDataURL), sem dependência nova.
// --preview grava assets-src/preview/menu-*.png (recortes sobre xadrez e sobre a paisagem) para conferência.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OUT_DIR = path.join(ROOT, 'src/assets/menu');
const PREVIEW = process.argv.includes('--preview');
/** Qualidade do WebP: a paisagem tem ruído de pixel art (o fino se perde pouco); os personagens, contorno nítido. */
const Q_LANDSCAPE = 0.82;
const Q_CHAR = 0.9;
/** Distância (px) até um personagem para um pedaço solto contar como dele. */
const STRAY_DIST = 18;
/** Folga (px) em volta do recorte. */
const PAD = 4;

const read = file => PNG.sync.read(fs.readFileSync(path.join(ROOT, file)));
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---------------------------------------------------------------- paisagem
function landscape() {
  const src = read('assets-src/menu-landscape.png');
  const { width: W, height: H, data } = src;
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    const l = Math.round(luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]));
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = l;
    out.data[i * 4 + 3] = 255;
  }
  return { png: out };
}

// ---------------------------------------------------------------- personagens
function keyed() {
  const src = read('assets-src/menu-samurai.png');
  const { width: W, height: H, data } = src;
  // cor de fundo: mediana da borda
  const border = [];
  for (let x = 0; x < W; x += 7) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 7) border.push(y * W, y * W + W - 1);
  const bg = [0, 1, 2].map(k => border.map(i => data[i * 4 + k]).sort((a, b) => a - b)[border.length >> 1]);
  const bgSpan = bg[1] - (bg[0] + bg[2]) / 2;
  const alpha = new Float32Array(W * H), gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    // quanto o verde passa do vermelho/azul, comparado ao fundo; perto de 0 = personagem (cinza)
    const raw = 1 - (g - (r + b) / 2) / bgSpan;
    const a = Math.max(0, Math.min(1, (raw - 0.08) / 0.84));
    alpha[i] = a;
    if (a <= 0) continue;
    if (a >= 1) {
      // verde que vaza no cinza (borda do desenho): o verde não passa do maior entre vermelho e azul
      gray[i] = luma(r, Math.min(g, Math.max(r, b)), b);
    } else {
      // borda: tira a parte do fundo dos canais vermelho e azul (os que o verde quase não tem)
      const k = 1 - raw;
      const c = ((r - k * bg[0]) + (b - k * bg[2])) / (2 * Math.max(0.05, raw));
      gray[i] = Math.max(0, Math.min(255, c));
    }
  }
  return { W, H, alpha, gray };
}

function components(s, min) {
  const { W, H, alpha } = s;
  const label = new Int32Array(W * H).fill(-1);
  const comps = [];
  for (let st = 0; st < W * H; st++) {
    if (alpha[st] < min || label[st] >= 0) continue;
    const id = comps.length, stack = [st];
    label[st] = id;
    let n = 0, sx = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p / W) | 0;
      n++; sx += x; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (label[q] < 0 && alpha[q] >= min) { label[q] = id; stack.push(q); }
      }
    }
    comps.push({ id, n, cx: sx / n, x0, y0, x1, y1 });
  }
  return { label, comps };
}

/** Dono (personagem mais próximo) e distância em px (8-vizinhança) de cada pixel, por BFS a partir dos dois corpos. */
function owners(s, label, bodies) {
  const { W, H } = s;
  const owner = new Int8Array(W * H).fill(-1);
  const dist = new Uint16Array(W * H).fill(65535);
  const queue = new Int32Array(W * H);
  let qh = 0, qt = 0;
  for (let i = 0; i < W * H; i++) {
    const f = bodies.findIndex(b => b.id === label[i]);
    if (f >= 0) { owner[i] = f; dist[i] = 0; queue[qt++] = i; }
  }
  while (qh < qt) {
    const p = queue[qh++], x = p % W, y = (p / W) | 0;
    if (dist[p] >= STRAY_DIST) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (owner[q] < 0) { owner[q] = owner[p]; dist[q] = dist[p] + 1; queue[qt++] = q; }
    }
  }
  return owner;
}

function characters() {
  const s = keyed();
  const { W, H, alpha, gray } = s;
  const { label, comps } = components(s, 0.35);
  // os dois maiores, da esquerda para a direita: Ronin, Tomoe
  const bodies = [...comps].sort((a, b) => b.n - a.n).slice(0, 2).sort((a, b) => a.cx - b.cx);
  const owner = owners(s, label, bodies);
  const boxes = bodies.map(() => ({ x0: W, y0: H, x1: -1, y1: -1 }));
  for (let i = 0; i < W * H; i++) {
    if (alpha[i] <= 0.02 || owner[i] < 0) continue;
    const b = boxes[owner[i]], x = i % W, y = (i / W) | 0;
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
  }
  // mesma faixa vertical para os dois (mesma escala e chão na mesma altura)
  const top = Math.max(0, Math.min(...boxes.map(b => b.y0)) - PAD);
  const bottom = Math.min(H - 1, Math.max(...boxes.map(b => b.y1)) + PAD);
  return boxes.map((b, f) => {
    const x0 = Math.max(0, b.x0 - PAD), x1 = Math.min(W - 1, b.x1 + PAD);
    const w = x1 - x0 + 1, h = bottom - top + 1;
    const png = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (top + y) * W + x0 + x, o = (y * w + x) * 4;
      const a = owner[i] === f ? alpha[i] : 0;
      const g = a > 0 ? Math.round(gray[i]) : 0;
      png.data[o] = png.data[o + 1] = png.data[o + 2] = g;
      png.data[o + 3] = Math.round(a * 255);
    }
    return { png, w, h };
  });
}

// ---------------------------------------------------------------- saída
async function encodeWebp(browser, png, quality) {
  const page = await browser.newPage();
  const b64 = PNG.sync.write(png).toString('base64');
  const url = await page.evaluate(async ([src, q]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', q);
  }, [b64, quality]);
  await page.close();
  if (!url.startsWith('data:image/webp')) throw new Error('o navegador não codificou WebP');
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

/** Xadrez atrás do recorte (conferir bordas e restos de verde) e o par sobre a paisagem. */
function previews(land, chars) {
  const dir = path.join(ROOT, 'assets-src/preview');
  fs.mkdirSync(dir, { recursive: true });
  const gap = 24, w = chars.reduce((s, c) => s + c.w, 0) + gap * (chars.length + 1), h = chars[0].h + gap * 2;
  const chk = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, v = ((x >> 4) + (y >> 4)) & 1 ? 200 : 120;
    chk.data[o] = v; chk.data[o + 1] = v; chk.data[o + 2] = v; chk.data[o + 3] = 255;
  }
  let ox = gap;
  for (const c of chars) { blend(chk, c.png, ox, gap); ox += c.w + gap; }
  fs.writeFileSync(path.join(dir, 'menu-cutout.png'), PNG.sync.write(chk));
  const scene = PNG.sync.read(PNG.sync.write(land.png));
  ox = Math.round(scene.width / 2 - (chars[0].w + chars[1].w + 40) / 2);
  for (const c of chars) { blend(scene, c.png, ox, scene.height - c.h); ox += c.w + 40; }
  fs.writeFileSync(path.join(dir, 'menu-scene.png'), PNG.sync.write(scene));
}
function blend(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const tx = dx + x, ty = dy + y;
    if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
    const s = (y * src.width + x) * 4, d = (ty * dst.width + tx) * 4, a = src.data[s + 3] / 255;
    for (let k = 0; k < 3; k++) dst.data[d + k] = Math.round(src.data[s + k] * a + dst.data[d + k] * (1 - a));
  }
}

const land = landscape();
const chars = characters();
fs.mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  const files = [['landscape.webp', land.png, Q_LANDSCAPE], ['ronin.webp', chars[0].png, Q_CHAR], ['tomoe.webp', chars[1].png, Q_CHAR]];
  for (const [name, png, q] of files) {
    const buf = await encodeWebp(browser, png, q);
    fs.writeFileSync(path.join(OUT_DIR, name), buf);
    console.log(`${name}: ${png.width}×${png.height}, ${(buf.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
}
const meta = {
  landscape: { w: land.png.width, h: land.png.height },
  ronin: { w: chars[0].w, h: chars[0].h },
  tomoe: { w: chars[1].w, h: chars[1].h },
};
fs.writeFileSync(path.join(OUT_DIR, 'menu.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta));
if (PREVIEW) previews(land, chars);
