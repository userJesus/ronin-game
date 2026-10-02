// Partículas em pixel art: quadrados, discos, estrelas, anéis e riscos presos à grade da tela
// em baixa resolução (formas desenhadas pixel a pixel no shader). Física simples na CPU, pool fixo,
// um único draw call. Também aceita "carimbos" de um quadro só (brilhos que seguem alguém).
import * as THREE from 'three';
import { CAM_BACK, GLSL_BAYER, dynAttr, flush, trackResolution, uRes } from './common';

export const SHAPE = { square: 0, disc: 1, star: 2, ring: 3, vline: 4 } as const;

/** Comportamentos (bits). */
export const PF = {
  /** Ao tocar o chão vira mancha (`onLand`) e some. */
  land: 1,
  /** Quica no chão. */
  bounce: 2,
  /** Converge para o ponto `home` (vel guarda o deslocamento inicial). */
  home: 4,
  /** Pertence à carga do iaido (some no cancelamento). */
  charge: 8,
  /** Incha até `size1` no começo da vida e encolhe até sumir (fumaça em pixel art, sem pontilhado). */
  swell: 16,
} as const;

// layout de cada partícula no buffer
const X = 0, Y = 1, Z = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7, S0 = 8, S1 = 9;
const GRAY = 10, SHP = 11, GRAV = 12, DRAG = 13, FLAGS = 14, FADE = 15, SPIN = 16;
const STRIDE = 17;

/** Molde reaproveitado para criar partículas sem alocar. */
export interface ParticleSpec {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  /** Tamanho (px da baixa resolução) no início e no fim. */
  size0: number; size1: number;
  gray: number;
  shape: number;
  /** Aceleração vertical (m/s², negativa = cai). */
  grav: number;
  /** Arrasto (1/s). */
  drag: number;
  flags: number;
  /** Fração da vida em que começa a sumir em pontilhado (1 = some de uma vez). */
  fadeAt: number;
  /** Giro (rad) ao convergir (`home`). */
  spin: number;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iP; // tamanho (px), cinza, forma, alfa
uniform vec2 uRes;
uniform vec3 uToCam;
varying vec2 vCenter;
varying vec4 vP;
void main() {
  if (iP.x < 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  // puxa para a câmera: na ortográfica só muda a profundidade (não some dentro do chão)
  vec4 clip = projectionMatrix * viewMatrix * vec4(iPos + uToCam, 1.0);
  vec2 pix = (clip.xy / clip.w * 0.5 + 0.5) * uRes;
  vec2 c = floor(pix) + 0.5;
  float s = floor(iP.x + 0.5);
  if (iP.z > 1.5 && iP.z < 2.5) s = floor(s * 0.5) * 2.0 + 1.0; // estrela: tamanho ímpar
  vec2 corner = c + position.xy * (s + 2.0);
  clip.xy = (corner / uRes * 2.0 - 1.0) * clip.w;
  gl_Position = clip;
  vCenter = c;
  vP = vec4(s, iP.yzw);
}
`;

const FRAG = /* glsl */ `
varying vec2 vCenter;
varying vec4 vP;
${GLSL_BAYER}
void main() {
  float s = vP.x, h = s * 0.5, shape = vP.z;
  vec2 d = floor(gl_FragCoord.xy) + 0.5 - vCenter;
  vec2 q = d + (mod(s, 2.0) > 0.5 ? 0.0 : 0.5);
  vec2 a = abs(q);
  bool on;
  if (shape < 0.5) on = max(a.x, a.y) <= h - 0.5;
  else if (shape < 1.5) on = length(q) < h - 0.1;
  else if (shape < 2.5) on = (a.x < 0.5 && a.y <= h) || (a.y < 0.5 && a.x <= h) || (sqrt(a.x) + sqrt(a.y) <= sqrt(h) + 0.05);
  else if (shape < 3.5) on = abs(length(q) - (h - 0.6)) < 0.55;
  else on = abs(d.x) < 0.5 && a.y <= h - 0.5;
  if (!on) discard;
  if (vP.w < 0.999 && vP.w <= fxBayer4(gl_FragCoord.xy)) discard;
  gl_FragColor = vec4(vec3(vP.y), 1.0);
}
`;

export class Particles {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  /** Molde: preencha e chame `emit()`. `reset()` volta aos padrões. */
  readonly t: ParticleSpec = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.5, size0: 1, size1: 1, gray: 1, shape: 0,
    grav: 0, drag: 0, flags: 0, fadeAt: 1, spin: 0,
  };
  /** Chamado quando uma partícula com `PF.land` toca o chão. */
  onLand: ((x: number, z: number, size: number) => void) | null = null;
  private readonly data: Float32Array;
  private alive = 0;
  private count = 0;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aP: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, capacity = 2048) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    // +64 para os carimbos de um quadro
    this.aPos = dynAttr(capacity + 64, 3);
    this.aP = dynAttr(capacity + 64, 4);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iP', this.aP);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uRes, uToCam: { value: CAM_BACK.clone().multiplyScalar(0.45) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    trackResolution(this.mesh);
    scene.add(this.mesh);
  }

  reset(): ParticleSpec {
    const t = this.t;
    t.x = t.y = t.z = t.vx = t.vy = t.vz = 0;
    t.life = 0.5; t.size0 = t.size1 = 1; t.gray = 1; t.shape = SHAPE.square;
    t.grav = 0; t.drag = 0; t.flags = 0; t.fadeAt = 1; t.spin = 0;
    return t;
  }

  /** Cria uma partícula a partir do molde. Sem espaço, recicla a mais antiga do começo do pool. */
  emit(): void {
    const t = this.t;
    const i = this.alive < this.capacity ? this.alive++ : 0;
    const d = this.data, o = i * STRIDE;
    d[o + X] = t.x; d[o + Y] = t.y; d[o + Z] = t.z;
    d[o + VX] = t.vx; d[o + VY] = t.vy; d[o + VZ] = t.vz;
    d[o + AGE] = 0; d[o + LIFE] = Math.max(0.01, t.life);
    d[o + S0] = t.size0; d[o + S1] = t.size1;
    d[o + GRAY] = t.gray; d[o + SHP] = t.shape;
    d[o + GRAV] = t.grav; d[o + DRAG] = t.drag; d[o + FLAGS] = t.flags;
    d[o + FADE] = t.fadeAt; d[o + SPIN] = t.spin;
  }

  private kill(i: number): void {
    const last = --this.alive;
    if (i !== last) this.data.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
  }

  /** Remove as partículas que tenham algum dos bits. */
  killFlag(flag: number): void {
    let i = 0;
    while (i < this.alive) {
      if (this.data[i * STRIDE + FLAGS] & flag) this.kill(i);
      else i++;
    }
  }

  clear(): void { this.alive = 0; this.count = 0; this.geo.instanceCount = 0; }

  /** Avança a física e escreve as partículas vivas. `home` = alvo das que convergem. */
  simulate(dt: number, hx: number, hy: number, hz: number): void {
    const d = this.data;
    let i = 0;
    while (i < this.alive) {
      const o = i * STRIDE;
      const age = (d[o + AGE] += dt);
      const life = d[o + LIFE];
      if (age >= life) { this.kill(i); continue; }
      const flags = d[o + FLAGS];
      const k = age / life;
      if (flags & PF.home) {
        // espiral encolhendo até o alvo
        const f = (1 - k) * Math.sqrt(1 - k);
        const a = d[o + SPIN] * k, c = Math.cos(a), s = Math.sin(a);
        const ox = d[o + VX], oz = d[o + VZ];
        d[o + X] = hx + (ox * c - oz * s) * f;
        d[o + Y] = hy + d[o + VY] * f;
        d[o + Z] = hz + (ox * s + oz * c) * f;
      } else if (dt > 0) {
        d[o + VY] += d[o + GRAV] * dt;
        const drag = Math.max(0, 1 - d[o + DRAG] * dt);
        d[o + VX] *= drag; d[o + VY] *= drag; d[o + VZ] *= drag;
        d[o + X] += d[o + VX] * dt;
        d[o + Y] += d[o + VY] * dt;
        d[o + Z] += d[o + VZ] * dt;
        if (d[o + Y] <= 0.02 && d[o + VY] < 0) {
          if (flags & PF.land) {
            this.onLand?.(d[o + X], d[o + Z], d[o + S0]);
            this.kill(i);
            continue;
          }
          d[o + Y] = 0.02;
          if (flags & PF.bounce) { d[o + VY] *= -0.35; d[o + VX] *= 0.5; d[o + VZ] *= 0.5; }
          else { d[o + VY] = 0; d[o + VX] *= 0.6; d[o + VZ] *= 0.6; }
        }
      }
      i++;
    }
    const pos = this.aPos.array as Float32Array, pr = this.aP.array as Float32Array;
    for (let j = 0; j < this.alive; j++) {
      const o = j * STRIDE;
      const k = d[o + AGE] / d[o + LIFE];
      const fadeAt = d[o + FADE];
      pos[j * 3] = d[o + X]; pos[j * 3 + 1] = d[o + Y]; pos[j * 3 + 2] = d[o + Z];
      const sk = d[o + FLAGS] & PF.swell ? Math.sin(Math.PI * Math.sqrt(k)) : k;
      pr[j * 4] = d[o + S0] + (d[o + S1] - d[o + S0]) * sk;
      pr[j * 4 + 1] = d[o + GRAY];
      pr[j * 4 + 2] = d[o + SHP];
      pr[j * 4 + 3] = fadeAt >= 1 || k < fadeAt ? 1 : 1 - (k - fadeAt) / (1 - fadeAt);
    }
    this.count = this.alive;
  }

  /** Desenha algo só neste quadro (depois de `simulate`, antes de `end`). */
  stamp(x: number, y: number, z: number, size: number, gray: number, shape: number, alpha = 1): void {
    if (this.count >= this.capacity + 64) return;
    const j = this.count++;
    const pos = this.aPos.array as Float32Array, pr = this.aP.array as Float32Array;
    pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z;
    pr[j * 4] = size; pr[j * 4 + 1] = gray; pr[j * 4 + 2] = shape; pr[j * 4 + 3] = alpha;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    flush([this.aPos, this.aP], this.count);
  }

  get active(): number { return this.alive; }
}
