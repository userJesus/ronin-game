// Texturas procedurais do templo, em tons de cinza e na escala de 32 texels por metro (como os sprites).
// As coordenadas de textura das peças são em metros; cada textura se repete a cada (largura/32) m.
import * as THREE from 'three';
import { TEXELS_PER_METER } from '../config';
import { Rng } from '../core/math';
import { grayTexture, tileNoise } from './noise';

/** Tela de luminância com utilitários de desenho (x para a direita, y = linha da textura: 0 embaixo, v = 0; repete nas bordas). */
export class Paint {
  readonly lum: Float32Array;
  alpha: Uint8Array | null = null;
  constructor(readonly w: number, readonly h: number, fill = 128) {
    this.lum = new Float32Array(w * h).fill(fill);
  }
  private i(x: number, y: number): number {
    const xx = ((Math.round(x) % this.w) + this.w) % this.w, yy = ((Math.round(y) % this.h) + this.h) % this.h;
    return yy * this.w + xx;
  }
  get(x: number, y: number): number { return this.lum[this.i(x, y)]; }
  set(x: number, y: number, v: number): void { this.lum[this.i(x, y)] = v; }
  add(x: number, y: number, v: number): void { this.lum[this.i(x, y)] += v; }
  rect(x0: number, y0: number, w: number, h: number, v: number): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, v);
  }
  hline(x0: number, x1: number, y: number, v: number): void { for (let x = x0; x <= x1; x++) this.set(x, y, v); }
  vline(x: number, y0: number, y1: number, v: number): void { for (let y = y0; y <= y1; y++) this.set(x, y, v); }
  /** Ruído de valor somado (amplitude a) que repete no tamanho da tela. */
  noise(rng: Rng, cells: number, a: number): void {
    const nz = tileNoise(rng, cells);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.lum[y * this.w + x] += nz(x / this.w, y / this.h) * a;
  }
  speckle(rng: Rng, n: number, lo: number, hi: number): void {
    for (let k = 0; k < n; k++) this.set(rng.int(0, this.w - 1), rng.int(0, this.h - 1), rng.range(lo, hi));
  }
  /** Degraus de `step` níveis (pixel art: nada de gradiente contínuo). */
  posterize(step = 6): void { for (let i = 0; i < this.lum.length; i++) this.lum[i] = Math.round(this.lum[i] / step) * step; }
  /** Textura repetida: 1 texel = 1/32 m nas coordenadas em metros. */
  texture(): THREE.DataTexture {
    const t = grayTexture(this.lum, this.w, this.h, this.alpha ?? undefined);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(TEXELS_PER_METER / this.w, TEXELS_PER_METER / this.h);
    t.needsUpdate = true;
    return t;
  }
}

export interface TempleTextures {
  woodDark: THREE.Texture;
  boards: THREE.Texture;
  plaster: THREE.Texture;
  wallSuji: THREE.Texture;
  tiles: THREE.Texture;
  stoneBlocks: THREE.Texture;
  stone: THREE.Texture;
  shoji: THREE.Texture;
  bronze: THREE.Texture;
  bark: THREE.Texture;
  foliage: THREE.Texture;
  blossom: THREE.Texture;
  bamboo: THREE.Texture;
  straw: THREE.Texture;
  paperLamp: THREE.Texture;
  lacquer: THREE.Texture;
}

export function templeTextures(seed: number): TempleTextures {
  const rng = new Rng(seed ^ 0x7e3a11);

  // madeira escura (pilares, vigas): veios verticais
  const wd = new Paint(64, 64, 96);
  wd.noise(rng, 4, 6);
  for (let x = 0; x < 64; x++) {
    const v = rng.range(-10, 10);
    for (let y = 0; y < 64; y++) wd.add(x, y, v * 0.6 + Math.sin(y * 0.2 + x) * 2);
  }
  for (let k = 0; k < 18; k++) { const x = rng.int(0, 63), y = rng.int(0, 63); wd.vline(x, y, y + rng.int(6, 20), 78); }
  for (let k = 0; k < 3; k++) { const x = rng.int(4, 60), y = rng.int(4, 60); wd.rect(x, y, 2, 3, 70); }
  wd.posterize();

  // tábuas verticais de 0,25 m (paredes de madeira, cerca, caixa de oferendas)
  const bd = new Paint(64, 64, 120);
  for (let b = 0; b < 8; b++) {
    const tone = rng.range(-12, 12);
    for (let y = 0; y < 64; y++) for (let x = b * 8; x < b * 8 + 8; x++) bd.add(x, y, tone + rng.range(-3, 3));
    bd.vline(b * 8, 0, 63, 82);
  }
  for (let k = 0; k < 24; k++) { const x = rng.int(0, 63), y = rng.int(0, 63); bd.vline(x, y, y + rng.int(4, 14), 104); }
  bd.posterize();

  // reboco claro com sujeira de respingo no pé (2 m x 4 m: o pé da parede fica em v = 0)
  const pl = new Paint(64, 128, 206);
  pl.noise(rng, 8, 5);
  pl.speckle(rng, 90, 188, 198);
  for (let y = 0; y < 18; y++) for (let x = 0; x < 64; x++) pl.add(x, y, -(18 - y) * 1.6 - rng.range(0, 6));
  // escorridos de chuva do beiral (de cima para baixo)
  for (let k = 0; k < 16; k++) { const x = rng.int(0, 63), l = rng.int(10, 50); for (let y = 0; y < l; y++) pl.add(x, 127 - y, -8 * (1 - y / l)); }
  pl.posterize();

  // muro com as linhas horizontais (suji-bei) na parte de cima
  const ws = new Paint(64, 72, 200);
  ws.noise(rng, 8, 5);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 64; x++) ws.add(x, y, -(14 - y) * 2 - rng.range(0, 5));
  for (const y of [62, 57, 52, 47]) ws.hline(0, 63, y, 132);
  ws.posterize();

  // telhas: colunas de telha capa (crista clara, calha escura) e fiadas sobrepostas
  const tl = new Paint(30, 33, 70);
  for (let x = 0; x < 30; x++) {
    const c = x % 10;
    const v = c === 2 || c === 3 ? 104 : c === 4 ? 92 : c >= 8 ? 50 : 72;
    for (let y = 0; y < 33; y++) tl.set(x, y, v);
  }
  for (let r = 0; r < 3; r++) { tl.hline(0, 29, r * 11, 40); tl.hline(0, 29, r * 11 + 1, 84); }
  tl.speckle(rng, 20, 60, 90);
  tl.posterize();

  // pedra em blocos (base do salão, pedestais, base da torre): fiadas de 0,5 m em amarração
  const sb = new Paint(64, 64, 150);
  sb.noise(rng, 8, 8);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 16;
    sb.hline(0, 63, y0, 96);
    let x = row % 2 === 0 ? 0 : 12;
    while (x < 64 + 12) {
      const w = rng.int(18, 30);
      const tone = rng.range(-10, 10);
      for (let y = y0 + 1; y < y0 + 16; y++) for (let xx = x + 1; xx < x + w; xx++) sb.add(xx, y, tone);
      sb.vline(x, y0, y0 + 15, 96);
      x += w;
    }
  }
  sb.speckle(rng, 140, 120, 170);
  for (let k = 0; k < 10; k++) { const x = rng.int(0, 63), y = rng.int(0, 63); sb.rect(x, y, 3, 2, 110); }
  sb.posterize();

  // granito (lanternas, torii de pedra, bacia): pintas
  const st = new Paint(32, 32, 150);
  st.noise(rng, 4, 8);
  st.speckle(rng, 110, 118, 176);
  st.posterize();

  // shoji: papel claro com grade de madeira escura a cada 0,25 m
  const sj = new Paint(64, 64, 214);
  sj.noise(rng, 4, 4);
  for (let k = 0; k < 64; k += 8) { sj.vline(k, 0, 63, 70); sj.hline(0, 63, k, 70); }
  for (let k = 0; k < 64; k += 32) { sj.vline(k + 1, 0, 63, 60); sj.hline(0, 63, k + 1, 60); }
  sj.posterize();

  // bronze escuro com pátina clara
  const bz = new Paint(32, 32, 74);
  bz.noise(rng, 4, 10);
  for (let k = 0; k < 14; k++) { const x = rng.int(0, 31), y = rng.int(0, 31); bz.rect(x, y, rng.int(1, 3), rng.int(1, 2), 112); }
  bz.posterize();

  // casca de cedro: fissuras verticais
  const bk = new Paint(32, 64, 84);
  for (let x = 0; x < 32; x++) { const v = rng.range(-14, 10); for (let y = 0; y < 64; y++) bk.add(x, y, v); }
  for (let k = 0; k < 10; k++) { const x = rng.int(0, 31); bk.vline(x, 0, 63, 56); }
  bk.posterize();

  // folhagem: tufos escuros com brilho em cima
  const fo = new Paint(32, 32, 84);
  for (let k = 0; k < 46; k++) {
    const x = rng.int(0, 31), y = rng.int(0, 31);
    fo.rect(x, y, 2, 1, 118); fo.set(x, y - 1, 66);
  }
  fo.posterize();

  // flor de cerejeira: claro, com vãos e pontinhos
  const bl = new Paint(32, 32, 196);
  bl.noise(rng, 4, 10);
  for (let k = 0; k < 30; k++) { const x = rng.int(0, 31), y = rng.int(0, 31); bl.set(x, y, 150); bl.set(x + 1, y, 164); }
  bl.speckle(rng, 30, 210, 232);
  bl.posterize();

  // bambu: colmo com nós a cada 0,6 m
  const ba = new Paint(8, 64, 128);
  for (let y = 0; y < 64; y++) { ba.set(1, y, 150); ba.set(6, y, 104); }
  for (const y of [0, 19, 38, 57]) { ba.hline(0, 7, y, 88); ba.hline(0, 7, y + 1, 160); }
  ba.posterize();

  // palha (fardos, corda sagrada)
  const sw = new Paint(32, 32, 150);
  for (let k = 0; k < 90; k++) {
    const x = rng.int(0, 31), y = rng.int(0, 31), l = rng.int(3, 7), v = rng.range(118, 176);
    for (let i = 0; i < l; i++) sw.set(x + i, y + i, v);
  }
  sw.posterize();

  // lanterna de papel: costelas horizontais e uma marca escura no meio
  const pp = new Paint(32, 32, 222);
  for (let y = 0; y < 32; y += 3) pp.hline(0, 31, y, 196);
  pp.rect(12, 10, 8, 12, 96);
  pp.rect(14, 12, 4, 8, 140);
  pp.posterize();

  // laca do torii (vermelho vira cinza médio) com desgaste
  const lq = new Paint(32, 32, 112);
  lq.noise(rng, 4, 6);
  lq.speckle(rng, 16, 90, 100);
  lq.posterize();

  return {
    woodDark: wd.texture(), boards: bd.texture(), plaster: pl.texture(), wallSuji: ws.texture(), tiles: tl.texture(),
    stoneBlocks: sb.texture(), stone: st.texture(), shoji: sj.texture(), bronze: bz.texture(), bark: bk.texture(),
    foliage: fo.texture(), blossom: bl.texture(), bamboo: ba.texture(), straw: sw.texture(), paperLamp: pp.texture(),
    lacquer: lq.texture(),
  };
}
