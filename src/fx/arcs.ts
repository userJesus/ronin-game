// Arcos desenhados em modo imediato (cada quadro o jogo de efeitos reenvia o que está vivo):
// - SlashBatch: meia-lua de corte num plano à altura da cintura (inclinável), bordas duras.
// - GroundBatch: marcas no chão — setor de aviso do golpe inimigo (contorno + enchimento), anéis e faixas
//   (coroa circular pontilhada: a pressão logo atrás de uma onda de choque).
// Formas por distância no fragment shader, com espessuras em pixels da baixa resolução (fwidth).
import * as THREE from 'three';
import { GLSL_BAYER, dynAttr, flush, stripGeometry } from './common';

// ------------------------------------------------------------------ meia-lua de corte

const SLASH_VERT = /* glsl */ `
attribute vec4 iA; // centro xyz, direção (rad)
attribute vec4 iB; // raio externo, meio-arco, espessura máx., inclinação
attribute vec4 iC; // ponta 0..1, cauda 0..1, cinza, sentido (+1/-1)
attribute vec4 iD; // eco (0/1), cinza interno
varying float vS;
varying float vR;
varying vec4 vB;
varying vec4 vC;
varying vec4 vD;
void main() {
  float ang = position.x * iB.y;
  float rIn = max(0.05, iB.x - iB.z * 1.8 - 0.14);
  float r = mix(rIn, iB.x + 0.05, position.y);
  vec3 F = vec3(cos(iA.w), 0.0, sin(iA.w));
  vec3 L = vec3(-F.z, 0.0, F.x);
  vec3 Lt = L * cos(iB.w) + vec3(0.0, sin(iB.w), 0.0);
  vec3 world = iA.xyz + F * (cos(ang) * r) + Lt * (sin(ang) * r);
  vS = position.x * iC.w;
  vR = r;
  vB = iB; vC = iC; vD = iD;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const SLASH_FRAG = /* glsl */ `
varying float vS;
varying float vR;
varying vec4 vB;
varying vec4 vC;
varying vec4 vD;
void main() {
  float head = vC.x * 2.0 - 1.0, tail = vC.y * 2.0 - 1.0;
  if (vS > head || vS < tail) discard;
  float k = (vS - tail) / max(1e-4, head - tail); // 0 = cauda, 1 = ponta
  // perfil de meia-lua: fino nas pontas, cheio perto da frente
  float prof = pow(max(0.0, sin(3.14159265 * pow(k, 0.6))), 0.7);
  float px = max(fwidth(vR), 1e-4);
  float w = vB.z * prof;
  float d = vB.x - vR; // 0 na borda externa, cresce para dentro
  if (d >= 0.0 && d < max(w, prof > 0.12 ? px * 0.9 : 0.0)) {
    float g = d < max(px * 1.6, w * 0.45) ? vC.z : vD.y;
    gl_FragColor = vec4(vec3(g), 1.0);
    return;
  }
  // risco de velocidade por dentro da lâmina
  if (vD.x > 0.5) {
    float e = d - w - px * 2.0 - vB.z * 0.3;
    if (e >= 0.0 && e < px && k > 0.3 && k < 0.9) { gl_FragColor = vec4(vec3(vD.y), 1.0); return; }
  }
  discard;
}
`;

export class SlashBatch {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private count = 0;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly attrs: THREE.InstancedBufferAttribute[];

  constructor(scene: THREE.Scene, capacity = 48) {
    this.cap = capacity;
    const strip = stripGeometry(48);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = strip.index;
    geo.setAttribute('position', strip.getAttribute('position'));
    this.attrs = [dynAttr(capacity, 4), dynAttr(capacity, 4), dynAttr(capacity, 4), dynAttr(capacity, 4)];
    ['iA', 'iB', 'iC', 'iD'].forEach((n, i) => geo.setAttribute(n, this.attrs[i]));
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: SLASH_VERT,
      fragmentShader: SLASH_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  begin(): void { this.count = 0; }

  push(
    x: number, y: number, z: number, yaw: number,
    radius: number, halfArc: number, width: number, tilt: number,
    head: number, tail: number, gray: number, sign: number,
    echo: boolean, innerGray: number,
  ): void {
    if (this.count >= this.cap || head <= tail) return;
    const i = this.count++;
    const [a, b, c, d] = this.attrs;
    a.setXYZW(i, x, y, z, yaw);
    b.setXYZW(i, radius, halfArc, width, tilt);
    c.setXYZW(i, head, tail, gray, sign);
    d.setXYZW(i, echo ? 1 : 0, innerGray, 0, 0);
  }

  end(): void {
    this.geo.instanceCount = this.count;
    flush(this.attrs, this.count);
  }
}

// ------------------------------------------------------------------ marcas no chão

export const GROUND = { warn: 0, ring: 1, band: 2 } as const;

const GROUND_VERT = /* glsl */ `
attribute vec4 iA; // centro xyz, direção (rad)
attribute vec4 iB; // raio, meio-arco (faixa: raio interno), progresso, estilo
attribute vec4 iC; // cinza, alfa, espessura (px), clarão
varying vec2 vL;
varying vec4 vB;
varying vec4 vC;
void main() {
  // disco unitário ampliado com folga para o contorno externo; frente = +y local
  vec2 l = position.xy * (iB.x + 0.25);
  vec3 F = vec3(cos(iA.w), 0.0, sin(iA.w));
  vec3 L = vec3(-F.z, 0.0, F.x);
  vec3 world = iA.xyz + F * l.y + L * l.x;
  vL = l;
  vB = iB; vC = iC;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const GROUND_FRAG = /* glsl */ `
varying vec2 vL;
varying vec4 vB;
varying vec4 vC;
${GLSL_BAYER}
// distância com sinal a um setor (Inigo Quilez), abertura em torno de +y
float sdPie(vec2 p, vec2 c, float r) {
  p.x = abs(p.x);
  float l = length(p) - r;
  float m = length(p - c * clamp(dot(p, c), 0.0, r));
  return max(l, m * sign(c.y * p.x - c.x * p.y));
}
void main() {
  if (vC.y < 0.999 && vC.y <= fxBayer4(gl_FragCoord.xy)) discard;
  float r = length(vL);
  float g;
  if (vB.w < 0.5) {
    float a = vB.y;
    float d = sdPie(vL, vec2(sin(a), cos(a)), vB.x);
    float pw = max(fwidth(d), 1e-4);
    if (d > pw * 1.4) discard;
    if (d > 0.0) g = 0.07;                 // borda escura por fora (lê em chão claro)
    else if (d > -pw * 1.25) g = vC.x;     // contorno claro
    else {
      float fr = vB.z * vB.x;
      bool checker = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 0.5;
      if (vC.w > fxBayer4(gl_FragCoord.xy)) g = 1.0;           // clarão do golpe
      else if (vB.z > 0.02 && abs(r - fr) < pw * 0.9) g = vC.x; // frente que avança
      else if (r < fr && checker) g = 0.92;                     // enchimento em xadrez
      else discard;
    }
  } else if (vB.w < 1.5) {
    float px = max(fwidth(r), 1e-4);
    if (abs(r - vB.x) > max(vC.z, 1.0) * px * 0.5) discard;
    g = vC.x;
  } else {
    if (r > vB.x || r < vB.y) discard;
    g = vC.x;
  }
  gl_FragColor = vec4(vec3(g), 1.0);
}
`;

export class GroundBatch {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private count = 0;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly attrs: THREE.InstancedBufferAttribute[];

  constructor(scene: THREE.Scene, capacity = 96) {
    this.cap = capacity;
    const disc = new THREE.CircleGeometry(1, 64);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = disc.index;
    geo.setAttribute('position', disc.getAttribute('position'));
    this.attrs = [dynAttr(capacity, 4), dynAttr(capacity, 4), dynAttr(capacity, 4)];
    ['iA', 'iB', 'iC'].forEach((n, i) => geo.setAttribute(n, this.attrs[i]));
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  begin(): void { this.count = 0; }

  /** Setor de aviso: `progress` 0..1 enche do centro para fora; `flash` 0..1 enche sólido. */
  warn(x: number, z: number, yaw: number, radius: number, halfArc: number, progress: number, gray: number, alpha: number, flash: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const [a, b, c] = this.attrs;
    a.setXYZW(i, x, 0.035, z, yaw);
    b.setXYZW(i, radius, halfArc, progress, GROUND.warn);
    c.setXYZW(i, gray, alpha, 1, flash);
  }

  /** Anel de `thickPx` pixels. */
  ring(x: number, y: number, z: number, radius: number, gray: number, alpha: number, thickPx: number): void {
    if (this.count >= this.cap || radius <= 0) return;
    const i = this.count++;
    const [a, b, c] = this.attrs;
    a.setXYZW(i, x, y, z, 0);
    b.setXYZW(i, radius, Math.PI, 0, GROUND.ring);
    c.setXYZW(i, gray, alpha, thickPx, 0);
  }

  /** Faixa entre `inner` e `outer` (m), cheia em pontilhado conforme `alpha`. */
  band(x: number, y: number, z: number, inner: number, outer: number, gray: number, alpha: number): void {
    if (this.count >= this.cap || outer <= inner || alpha <= 0) return;
    const i = this.count++;
    const [a, b, c] = this.attrs;
    a.setXYZW(i, x, y, z, 0);
    b.setXYZW(i, outer, Math.max(0, inner), 0, GROUND.band);
    c.setXYZW(i, gray, alpha, 1, 0);
  }

  end(): void {
    this.geo.instanceCount = this.count;
    flush(this.attrs, this.count);
  }
}
