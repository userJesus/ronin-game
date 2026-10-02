// Marca do repositório (npm run brand): o símbolo do jogo e as imagens de divulgação, gerados a partir do
// código e da arte do jogo, sempre iguais (mesma entrada, mesmos bytes):
//   docs/media/emblem-ink.svg    o símbolo (ensō com o 雨) em nanquim, fundo transparente (README, tema claro)
//   docs/media/emblem-paper.svg  o mesmo em papel (tema escuro)
//   public/favicon.svg           nanquim num quadrado arredondado de papel: lê em abas claras e escuras
//   public/apple-touch-icon.png  180×180, papel opaco (o iOS arredonda os cantos)
//   public/og-image.png          1280×640, prévia de links e "social preview" do GitHub: a paisagem do título,
//                                os dois samurais e o símbolo grande no meio (o essencial a 40 px das bordas)
//   docs/media/banner.png        faixa do topo do README, na mesma linguagem
// O desenho não é copiado: emblemSvg() de src/ui/title/art.ts é carregado pelo Vite em modo SSR (resolve os
// imports de .webp/.json); as cores vêm de src/style.css e o estilo do símbolo, de src/ui/title/title.css (nos
// arquivos soltos, que não têm o CSS do jogo, viram atributos). As composições são montadas numa página HTML e
// fotografadas no Chromium do Playwright; os PNG saem em cinza puro (tipo 0, pelo pngjs): sem cor por construção.
// Posição e tamanho de cada peça das composições: OG e BANNER, abaixo. Leva poucos segundos, sem servidor.
// --preview grava amostras em assets-src/preview/brand-*.png (ou --preview=PASTA): o favicon a 16, 32 e 64 px
// em abas claras e escuras, os símbolos sobre os fundos do GitHub e a prévia de link em miniatura (600×300).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const previewArg = process.argv.find(a => a === '--preview' || a.startsWith('--preview='));
const PREVIEW = previewArg && (previewArg.slice('--preview='.length) || path.join(ROOT, 'assets-src/preview'));

const text = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function save(rel, data, note = '') {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`${rel.padEnd(28)} ${(data.length / 1024).toFixed(1).padStart(7)} KB  ${note}`);
}

// ---------------------------------------------------------------- o que vem do jogo
const STYLE = text('src/style.css'), TITLE_CSS = text('src/ui/title/title.css');
const token = name => STYLE.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1].toLowerCase();
const rule = sel => TITLE_CSS.match(new RegExp(`\\${sel}\\s*\\{[^}]*\\}`))?.[0];
const INK = token('ink'), PAPER = token('paper');
const EMBLEM_CSS = ['.title-emblem', '.te-ink', '.te-halo'].map(rule);
if (!INK || !PAPER || EMBLEM_CSS.includes(undefined)) throw new Error('cores (style.css) ou estilo do símbolo (title.css) mudaram');

const vite = await createServer({
  root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
let art;
try { art = await vite.ssrLoadModule('/src/ui/title/art.ts'); } finally { await vite.close(); }
const EMBLEM = art.emblemSvg();
const INK_PATHS = EMBLEM.match(/<g class="te-ink">([\s\S]*?)<\/g>/)?.[1];
const GAME_VIEWBOX = EMBLEM.match(/viewBox="([^"]+)"/)?.[1];
if (!INK_PATHS || !GAME_VIEWBOX) throw new Error('emblemSvg() mudou de forma: ajuste a leitura em scripts/brand.mjs');
/** Arte do título como data URI (o Vite em SSR dá o caminho a partir da raiz do projeto). */
const artUri = key => {
  const { src } = art.TITLE_ART[key];
  return src.startsWith('data:') ? src : `data:image/webp;base64,${fs.readFileSync(path.join(ROOT, src.split('?')[0])).toString('base64')}`;
};

// ---------------------------------------------------------------- composições
/** Chão escuro do título (title.css, .scr-title::after): assenta os samurais. */
const FLOOR = 'linear-gradient(to top, rgba(8, 8, 9, 0.62), rgba(8, 8, 9, 0.28) 45%, rgba(8, 8, 9, 0))';
/** Céu de chuva: escurece a borda de cima (o cartaz não some no fundo branco do GitHub) e apaga a lua. */
const SKY = 'linear-gradient(to bottom, rgba(8, 8, 9, 0.4), rgba(8, 8, 9, 0))';
/** Sombra no chão sob cada samurai (title.css, .char-card::before). */
const SHADOW = 'radial-gradient(closest-side, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0))';
/** Contorno de papel do samurai sob o cursor no título (.char-card:hover): separa o nanquim do fundo escuro. */
const RIM = ['2px 0', '-2px 0', '0 2px', '0 -2px'].map(o => `drop-shadow(${o} 0 rgba(233, 231, 226, 0.55))`).join(' ');

/**
 * Cartaz (medidas em px): paisagem cobrindo tudo (`bgY` como object-position vertical), chão escuro em `floor` e
 * céu de chuva em `sky` (frações da altura), os dois samurais com os pés em `feet`, altura `charH` e centros em
 * `ronin`/`tomoe`, e o símbolo do jogo (com o halo do título) centrado em (`markX`, `markY`), quadro de `mark` px.
 */
function poster(L) {
  const land = art.TITLE_ART.landscape;
  const s = Math.max(L.w / land.w, L.h / land.h), bw = land.w * s, bh = land.h * s;
  const fig = key => {
    const a = art.TITLE_ART[key], h = L.charH, w = (a.w * h) / a.h, x = L[key] - w / 2;
    return `<i style="left:${x + w * 0.04}px;top:${L.feet - h * 0.038}px;width:${w * 0.92}px;height:${h * 0.06}px;background:${SHADOW}"></i>`
      + `<img src="${artUri(key)}" style="left:${x}px;top:${L.feet - h}px;width:${w}px;height:${h}px;filter:${RIM}">`;
  };
  return `<style>:root{--ink:${INK};--paper:${PAPER}}body{background:${INK}}body>:not(style){position:absolute;display:block}${EMBLEM_CSS.join('')}</style>`
    + `<img src="${artUri('landscape')}" style="left:${(L.w - bw) / 2}px;top:${(L.h - bh) * L.bgY}px;width:${bw}px;height:${bh}px">`
    + `<i style="left:0;right:0;bottom:0;height:${L.floor * 100}%;background:${FLOOR}"></i>`
    + `<i style="left:0;right:0;top:0;height:${L.sky * 100}%;background:${SKY}"></i>`
    + fig('ronin') + fig('tomoe')
    + `<div style="left:${L.markX - L.mark / 2}px;top:${L.markY - L.mark / 2}px;width:${L.mark}px;height:${L.mark}px">${EMBLEM}</div>`;
}

// prévia de link (símbolo e samurais a 40 px ou mais das bordas) e faixa do README
const OG = { w: 1280, h: 640, bgY: 0.3, floor: 0.34, sky: 0.3, charH: 500, feet: 600, ronin: 318, tomoe: 962, markX: 640, markY: 300, mark: 410 };
const BANNER = { w: 1600, h: 520, bgY: 0.3, floor: 0.4, sky: 0.3, charH: 410, feet: 490, ronin: 500, tomoe: 1090, markX: 800, markY: 255, mark: 380 };

// ---------------------------------------------------------------- render
const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });

/** Fotografa `body` (HTML) numa janela w×h e devolve o PNG decodificado. */
async function shoot(body, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}</style>${body}`);
  await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  return PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
}
/** PNG em cinza puro (luma Rec. 601); devolve também a maior diferença entre canais antes da conversão. */
function gray(png) {
  const d = png.data;
  let tint = 0;
  for (let i = 0; i < d.length; i += 4) {
    tint = Math.max(tint, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2]), Math.abs(d[i] - d[i + 2]));
    d[i] = d[i + 1] = d[i + 2] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  }
  return { data: PNG.sync.write(png, { colorType: 0, deflateStrategy: 1 }), note: `${png.width}×${png.height}, cinza (desvio de canal antes: ${tint})` };
}

try {
  // quadro justo do símbolo (quadrado, centrado no desenho)
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${GAME_VIEWBOX}"><g>${INK_PATHS}</g></svg>`);
  const [bx, by, bw, bh] = await page.evaluate(() => { const b = document.querySelector('g').getBBox(); return [b.x, b.y, b.width, b.height]; });
  const R = Math.ceil(Math.max(bw, bh) / 2) + 2; // meio lado, com 2 unidades de folga
  const CX = Math.round(bx + bw / 2), CY = Math.round(by + bh / 2);
  const svg = (r, body, size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CX - r} ${CY - r} ${2 * r} ${2 * r}"`
    + `${size ? ` width="${size}" height="${size}"` : ''}>${body}</svg>\n`;
  const ink = (fill, bold = 0) => `<g fill="${fill}"${bold ? ` stroke="${fill}" stroke-width="${bold}" stroke-linejoin="round"` : ''}>${INK_PATHS}</g>`;
  /** Ícone: o símbolo em nanquim num quadrado de papel; `pad`: folga (fração do raio); `round`: canto (fração do lado). */
  const icon = ({ pad, round, bold, size }) => {
    const r = Math.round(R * (1 + pad));
    return svg(r, `<rect x="${CX - r}" y="${CY - r}" width="${2 * r}" height="${2 * r}" rx="${Math.round(2 * r * round)}" fill="${PAPER}"/>${ink(INK, bold)}`, size);
  };

  const emblemInk = svg(R, ink(INK), 160), emblemPaper = svg(R, ink(PAPER), 160);
  // favicon: o símbolo quase encosta na borda e o traço engrossa 6 unidades (a 16–32 px o fino some)
  const favicon = icon({ pad: 0.08, round: 0.22, bold: 6 });
  const touch = icon({ pad: 0.32, round: 0, bold: 0, size: 180 });
  save('docs/media/emblem-ink.svg', emblemInk, `viewBox ${2 * R}×${2 * R}`);
  save('docs/media/emblem-paper.svg', emblemPaper, `viewBox ${2 * R}×${2 * R}`);
  save('public/favicon.svg', favicon);

  const pngs = {
    'public/apple-touch-icon.png': gray(await shoot(touch, 180, 180)),
    'public/og-image.png': gray(await shoot(poster(OG), OG.w, OG.h)),
    'docs/media/banner.png': gray(await shoot(poster(BANNER), BANNER.w, BANNER.h)),
  };
  for (const [rel, { data, note }] of Object.entries(pngs)) save(rel, data, note);

  if (PREVIEW) {
    fs.mkdirSync(PREVIEW, { recursive: true });
    const svgUri = s => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;
    // favicon: cada tamanho rasterizado no próprio tamanho e ampliado por vizinho mais próximo para 128 px
    await page.setViewportSize({ width: 620, height: 4 * 144 });
    await page.setContent('<body style="margin:0"><canvas width="620" height="576"></canvas></body>');
    await page.evaluate(async src => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const g = document.querySelector('canvas').getContext('2d');
      ['#ffffff', '#dee1e6', '#35363a', '#202124'].forEach((bg, row) => {
        const y = row * 144;
        g.fillStyle = bg;
        g.fillRect(0, y, 620, 144);
        let zoomed = 8, real = 3 * 136 + 16;
        for (const s of [16, 32, 64]) {
          const t = document.createElement('canvas');
          t.width = t.height = s;
          t.getContext('2d').drawImage(img, 0, 0, s, s);
          g.imageSmoothingEnabled = false;
          g.drawImage(t, zoomed, y + 8, 128, 128);
          g.drawImage(t, real, y + 40);
          zoomed += 136;
          real += s + 8;
        }
      });
    }, svgUri(favicon));
    fs.writeFileSync(path.join(PREVIEW, 'brand-favicon.png'), await page.screenshot());
    // símbolos sobre os fundos do GitHub (claro #ffffff, escuro #0d1117), como <img>
    const cell = (bg, s) => `<div style="display:inline-flex;gap:24px;align-items:center;padding:24px;background:${bg}">`
      + `<img src="${svgUri(s)}" width="160"><img src="${svgUri(s)}" width="48"><img src="${svgUri(touch)}" width="90"></div>`;
    await page.setViewportSize({ width: 2 * 380, height: 210 });
    await page.setContent(`<body style="margin:0;display:flex">${cell('#ffffff', emblemInk)}${cell('#0d1117', emblemPaper)}</body>`);
    await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
    fs.writeFileSync(path.join(PREVIEW, 'brand-emblems.png'), await page.screenshot());
    // prévia de link em miniatura (~600×300)
    const og = `data:image/png;base64,${pngs['public/og-image.png'].data.toString('base64')}`;
    await page.setViewportSize({ width: 600, height: 300 });
    await page.setContent(`<body style="margin:0"><img src="${og}" width="600" height="300" style="display:block"></body>`);
    await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
    fs.writeFileSync(path.join(PREVIEW, 'brand-og-thumb.png'), await page.screenshot());
    console.log(`amostras em ${PREVIEW}`);
  }
} finally {
  await browser.close();
}
