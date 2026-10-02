// Manchas de tinta (sangue em nanquim) no chão: atlas gerado pixel a pixel, um draw call,
// três anéis de reciclagem (manchas grandes, pingos e arranhões da garra do leão). A mancha nasce preta
// e se espalha, logo se entranha na lama (cinza-escuro, para não esconder os samurais quase pretos) e,
// no fim da vida, seca (clareia) e se desfaz das bordas para o centro. O arranhão é lama revolvida
// (nunca preto) e se abre ao longo do comprimento, como a unha passando.
import * as THREE from 'three';
import { Rng } from '../core/math';
import { GLSL_BAYER, dynAttr, flush } from './common';

const ATLAS_W = 256, ATLAS_H = 128;
/** Distância máxima (texels) guardada no canal G: 0 = borda, 1 = núcleo. */
const EDGE_CAP = 6;
/** Tons: tinta fresca, entranhada na lama, seca. */
const INK_FRESH = 0.04, INK_SOAKED = 0.2, INK_DRY = 0.34;
/** Tons do arranhão: sulco molhado, assentado, seco. */
const SCRATCH_FRESH = 0.17, SCRATCH_SOAKED = 0.25, SCRATCH_DRY = 0.34;

interface Cell { x: number; y: number; w: number; h: number }

const square = (x: number, y: number, n: number): Cell => ({ x, y, w: n, h: n });
const BIG_CELLS: Cell[] = [0, 1, 2, 3].map(i => square(i * 64, 0, 64));
const MED_CELLS: Cell[] = [0, 1, 2, 3, 4, 5, 6, 7].map(i => square(i * 32, 64, 32));
const SMALL_CELLS: Cell[] = Array.from({ length: 16 }, (_, i) => square(i * 16, 96, 16));
/** Três sulcos paralelos ao longo de +x (64 × 16 texels: a 2,8 m de comprimento, ~1,4 px por texel). */
const SCRATCH_CELLS: Cell[] = [0, 1, 2, 3].map(i => ({ x: i * 64, y: 112, w: 64, h: 16 }));

/** Desenha um respingo (voltado para +x) na máscara da célula. */
function paintSplat(mask: Uint8Array, n: number, rng: Rng, kind: 'big' | 'med' | 'small'): void {
  const disc = (cx: number, cy: number, r: number) => {
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(n - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(n - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) mask[y * n + x] = 1;
      }
    }
  };
  const inset = (v: number, r: number) => Math.min(n - 1.5 - r, Math.max(1.5 + r, v));
  if (kind === 'small') {
    // pingo: uma gota e às vezes uma gotinha ao lado
    const r = rng.range(1.2, 2.6);
    disc(n / 2, n / 2, r);
    if (rng.next() < 0.6) disc(n / 2 + rng.range(2.5, 4.5), n / 2 + rng.range(-2, 2), rng.range(0.6, 1.1));
    if (rng.next() < 0.4) disc(n / 2 + r * 0.6, n / 2 + rng.range(-1, 1), r * 0.7);
    return;
  }
  const big = kind === 'big';
  const cx = n * 0.4, cy = n * 0.5;
  const r0 = n * (big ? 0.19 : 0.2);
  disc(cx, cy, r0);
  // bordas irregulares
  const lumps = big ? 9 : 6;
  for (let i = 0; i < lumps; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0.25, 0.55) * r0;
    disc(cx + Math.cos(a) * r0 * 0.85, cy + Math.sin(a) * r0 * 0.85, rr);
  }
  // rastro na direção do golpe, afinando
  const len = n * rng.range(0.34, 0.44);
  let wob = 0;
  for (let s = 0; s <= len; s += 1) {
    const k = s / len;
    wob += rng.range(-0.35, 0.35);
    disc(cx + r0 * 0.5 + s, cy + wob * 0.6, Math.max(0.6, r0 * 0.62 * (1 - k * 0.85)));
  }
  // riscos de tinta jogada (pontos em linha)
  const flicks = big ? 4 : 2;
  for (let i = 0; i < flicks; i++) {
    const a = rng.range(-0.9, 0.9);
    let d = r0 + rng.range(2, 5);
    const steps = rng.int(3, big ? 7 : 4);
    for (let j = 0; j < steps; j++) {
      d += rng.range(1.2, 2.2);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (x > 1 && x < n - 2 && y > 1 && y < n - 2) disc(x, y, Math.max(0.55, 1.3 - j * 0.15));
    }
  }
  // gotas soltas, mais para a frente
  const sats = big ? 16 : 8;
  for (let i = 0; i < sats; i++) {
    const fwd = rng.next() < 0.75;
    const a = fwd ? rng.range(-1.1, 1.1) : rng.range(0, Math.PI * 2);
    const d = rng.range(r0 + 3, n * 0.47);
    const r = rng.range(0.6, big ? 2.1 : 1.5);
    disc(inset(cx + Math.cos(a) * d, r), inset(cy + Math.sin(a) * d, r), r);
  }
}

/**
 * Três sulcos de garra lado a lado ao longo de +x: afinam nas pontas, o do meio é o mais comprido e os três
 * entortam juntos (a pata faz o mesmo arco); alguns torrões soltos em volta.
 */
function paintScratch(mask: Uint8Array, w: number, h: number, rng: Rng): void {
  const disc = (cx: number, cy: number, r: number) => {
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) mask[y * w + x] = 1;
      }
    }
  };
  const bow = rng.range(-1, 1);
  for (let i = 0; i < 3; i++) {
    const side = Math.abs(i - 1);
    const x0 = 3 + side * rng.range(2, 6) + rng.range(0, 2);
    const x1 = w - 3 - side * rng.range(3, 8) - rng.range(0, 2);
    const yc = h / 2 + (i - 1) * 4.6 + rng.range(-0.3, 0.3);
    const xm = (x0 + x1) / 2, half = (x1 - x0) / 2;
    for (let x = x0; x <= x1; x += 0.5) {
      const k = (x - x0) / (x1 - x0);
      const u = (x - xm) / half;
      // fundo logo depois de a unha entrar, raspando mais raso até sair
      const r = 0.75 + 0.9 * Math.sin(Math.PI * Math.pow(k, 0.65));
      disc(x, yc + bow * (1 - u * u), r);
    }
  }
  for (let i = 0; i < 7; i++) disc(rng.range(6, w - 6), rng.range(2, h - 2), rng.range(0.55, 0.8));
}

/** Distância (quarteirão) até fora da máscara. */
function edgeDistance(mask: Uint8Array, w: number, h: number): Uint8Array {
  const d = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 255 : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1);
  }
  return d;
}

function buildAtlas(): THREE.DataTexture {
  const px = new Uint8Array(ATLAS_W * ATLAS_H * 4);
  const rng = new Rng(0x1c0ffee);
  const fill = (cells: Cell[], kind: 'big' | 'med' | 'small' | 'scratch') => {
    for (const c of cells) {
      const mask = new Uint8Array(c.w * c.h);
      if (kind === 'scratch') paintScratch(mask, c.w, c.h, rng);
      else paintSplat(mask, c.w, rng, kind);
      const dist = edgeDistance(mask, c.w, c.h);
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        const dd = dist[y * c.w + x];
        if (!dd) continue;
        const o = ((c.y + y) * ATLAS_W + c.x + x) * 4;
        // R marca a borda de 1 texel (um pouco mais clara: lama encharcada)
        px[o] = dd === 1 ? 255 : 0;
        px[o + 1] = Math.round((Math.min(dd, EDGE_CAP) / EDGE_CAP) * 255);
        // B: posição ao longo do arranhão (1..255) para ele se abrir da ponta de entrada à de saída
        px[o + 2] = kind === 'scratch' ? 1 + Math.round((254 * x) / (c.w - 1)) : 0;
        px[o + 3] = 255;
      }
    }
  };
  fill(BIG_CELLS, 'big');
  fill(MED_CELLS, 'med');
  fill(SMALL_CELLS, 'small');
  fill(SCRATCH_CELLS, 'scratch');
  const tex = new THREE.DataTexture(px, ATLAS_W, ATLAS_H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
attribute vec4 iA; // x, z, ângulo, comprimento (m)
attribute vec4 iB; // retângulo no atlas (uv)
attribute vec4 iC; // limiar de borda, tom, abertura ao longo (0..1), largura / comprimento
varying vec2 vUv;
varying vec4 vC;
void main() {
  if (iA.w <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float c = cos(iA.z), s = sin(iA.z);
  vec2 p = position.xy * vec2(iA.w, iA.w * iC.w);
  vec3 world = vec3(iA.x + p.x * c - p.y * s, 0.006, iA.y + p.x * s + p.y * c);
  vUv = iB.xy + (position.xy + 0.5) * iB.zw;
  vC = iC;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vC;
${GLSL_BAYER}
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a < 0.5) discard;
  // arranhão: só o trecho por onde a unha já passou (a tinta tem B = 0)
  if (t.b > vC.z) discard;
  // some das bordas (G baixo) para o núcleo, com um pouco de pontilhado na frente
  if (t.g + (fxBayer4(gl_FragCoord.xy) - 0.5) * 0.14 < vC.x) discard;
  float g = vC.y + (t.r > 0.5 ? 0.05 : 0.0);
  gl_FragColor = vec4(vec3(g), 1.0);
}
`;

interface Slot {
  age: number; life: number;
  /** Tinta: segundos para se espalhar. Arranhão: segundos para a unha passar de ponta a ponta. */
  spread: number;
  scratch: boolean;
}

export type StainSize = 'big' | 'medium' | 'small' | 'scratch';

export class Decals {
  readonly mesh: THREE.Mesh;
  private readonly bigCap: number;
  private readonly smallCap: number;
  private readonly scratchCap: number;
  private readonly slots: Slot[];
  private nextBig = 0;
  private nextSmall = 0;
  private nextScratch = 0;
  private readonly aA: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly aC: THREE.InstancedBufferAttribute;
  private readonly rng = new Rng(0x5a17);

  constructor(scene: THREE.Scene, bigCap = 120, smallCap = 220, scratchCap = 24) {
    this.bigCap = bigCap;
    this.smallCap = smallCap;
    this.scratchCap = scratchCap;
    const cap = bigCap + smallCap + scratchCap;
    this.slots = Array.from({ length: cap }, () => ({ age: 0, life: 0, spread: 0, scratch: false }));
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.aA = dynAttr(cap, 4); this.aB = dynAttr(cap, 4); this.aC = dynAttr(cap, 4);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.setAttribute('iC', this.aC);
    geo.instanceCount = cap;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uAtlas: { value: buildAtlas() } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    // antes das sombras em bolha (transparentes, ordem 0)
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  /**
   * Nova mancha voltada para `angle` (rad, no plano x/z). `spread` = segundos para se espalhar.
   * `'scratch'`: arranhão de `scale` metros de comprimento ao longo de `angle`, que se abre em `spread` segundos.
   * As mais antigas de cada anel são recicladas.
   */
  add(size: StainSize, x: number, z: number, angle: number, scale: number, life = 25, spread = 0): void {
    let i: number;
    let cell: Cell;
    if (size === 'small') {
      i = this.bigCap + this.nextSmall;
      this.nextSmall = (this.nextSmall + 1) % this.smallCap;
      cell = SMALL_CELLS[this.rng.int(0, SMALL_CELLS.length - 1)];
    } else if (size === 'scratch') {
      i = this.bigCap + this.smallCap + this.nextScratch;
      this.nextScratch = (this.nextScratch + 1) % this.scratchCap;
      cell = SCRATCH_CELLS[this.rng.int(0, SCRATCH_CELLS.length - 1)];
    } else {
      i = this.nextBig;
      this.nextBig = (this.nextBig + 1) % this.bigCap;
      const list = size === 'big' ? BIG_CELLS : MED_CELLS;
      cell = list[this.rng.int(0, list.length - 1)];
    }
    const s = this.slots[i];
    const scratch = size === 'scratch';
    s.age = 0; s.life = life; s.spread = spread; s.scratch = scratch;
    this.aA.setXYZW(i, x, z, angle, scale);
    this.aB.setXYZW(i, cell.x / ATLAS_W, cell.y / ATLAS_H, cell.w / ATLAS_W, cell.h / ATLAS_H);
    if (scratch) this.aC.setXYZW(i, -0.1, SCRATCH_FRESH, spread > 0 ? 0 : 1, cell.h / cell.w);
    else this.aC.setXYZW(i, spread > 0 ? 0.8 : -0.1, INK_FRESH, 1, 1);
  }

  update(dt: number): void {
    const a = this.aA.array as Float32Array, c = this.aC.array as Float32Array;
    for (let i = 0; i < this.slots.length; i++) {
      if (a[i * 4 + 3] <= 0) continue;
      const s = this.slots[i];
      s.age += dt;
      if (s.age >= s.life) { a[i * 4 + 3] = 0; continue; }
      const fadeStart = s.life * 0.6;
      if (s.scratch) {
        // abre de ponta a ponta; a lama revolvida assenta, seca e se desfaz como a tinta
        const k = s.age > fadeStart ? (s.age - fadeStart) / (s.life - fadeStart) : 0;
        c[i * 4] = -0.1 + 1.2 * k;
        c[i * 4 + 1] = k > 0
          ? SCRATCH_SOAKED + (SCRATCH_DRY - SCRATCH_SOAKED) * Math.min(1, k * 1.6)
          : SCRATCH_FRESH + (SCRATCH_SOAKED - SCRATCH_FRESH) * Math.min(1, s.age / 3);
        c[i * 4 + 2] = s.spread > 0 ? Math.min(1, s.age / s.spread) : 1;
        continue;
      }
      // espalha ao nascer; entranha na lama; seca e se desfaz nos últimos 40% da vida
      let thr = -0.1;
      let tone = s.age < 0.8 ? INK_FRESH : INK_FRESH + (INK_SOAKED - INK_FRESH) * Math.min(1, (s.age - 0.8) / 2.2);
      if (s.spread > 0 && s.age < s.spread) {
        const k = s.age / s.spread;
        thr = 0.8 - 0.9 * (1 - (1 - k) * (1 - k));
      }
      if (s.age > fadeStart) {
        const k = (s.age - fadeStart) / (s.life - fadeStart);
        tone = INK_SOAKED + (INK_DRY - INK_SOAKED) * Math.min(1, k * 1.6);
        thr = Math.max(thr, -0.1 + 1.2 * k);
      }
      c[i * 4] = thr;
      c[i * 4 + 1] = tone;
    }
    flush([this.aA, this.aB, this.aC], this.slots.length);
  }

  clear(): void {
    const a = this.aA.array as Float32Array;
    for (let i = 0; i < this.slots.length; i++) a[i * 4 + 3] = 0;
    this.nextBig = this.nextSmall = this.nextScratch = 0;
    flush([this.aA], this.slots.length);
  }

  get active(): number {
    const a = this.aA.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (a[i * 4 + 3] > 0) n++;
    return n;
  }
}
