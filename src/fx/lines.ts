// Linhas de corte em modo imediato: segmento do mundo com largura em pixels da tela,
// afinando nas pontas (lente), revelado de `tail` a `head`. Sempre por cima (sem teste de profundidade).
import * as THREE from 'three';
import { dynAttr, flush, trackResolution, uRes } from './common';

const VERT = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iP; // largura (px), cinza, ponta 0..1, cauda 0..1
uniform vec2 uRes;
varying vec2 vUv;
varying vec4 vP;
void main() {
  vec4 ca = projectionMatrix * viewMatrix * vec4(iA, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(iB, 1.0);
  vec2 pa = (ca.xy / ca.w * 0.5 + 0.5) * uRes;
  vec2 pb = (cb.xy / cb.w * 0.5 + 0.5) * uRes;
  vec2 dd = pb - pa;
  float len = max(length(dd), 1e-3);
  vec2 dir = dd / len, n = vec2(-dir.y, dir.x);
  float hw = iP.x * 0.5 + 1.0;
  float e = position.x * 2.0 - 1.0; // -1 no início, +1 no fim
  vec2 p = mix(pa, pb, position.x) + n * position.y * hw + dir * e;
  vec4 clip = mix(ca, cb, position.x);
  clip.xy = (p / uRes * 2.0 - 1.0) * clip.w;
  gl_Position = clip;
  vUv = vec2(position.x + e / len, position.y * hw);
  vP = iP;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vP;
void main() {
  float u = vUv.x;
  if (u < vP.w || u > vP.z) discard;
  float t = clamp(u, 0.0, 1.0) * 2.0 - 1.0;
  float hw = vP.x * 0.5 * sqrt(max(0.0, 1.0 - t * t));
  if (abs(vUv.y) > max(hw, 0.5)) discard;
  gl_FragColor = vec4(vec3(vP.y), 1.0);
}
`;

export class LineBatch {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private count = 0;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aA: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly aP: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, capacity = 96) {
    this.cap = capacity;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    this.aA = dynAttr(capacity, 3); this.aB = dynAttr(capacity, 3); this.aP = dynAttr(capacity, 4);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.setAttribute('iP', this.aP);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uRes },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    trackResolution(this.mesh);
    scene.add(this.mesh);
  }

  begin(): void { this.count = 0; }

  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, widthPx: number, gray: number, head: number, tail: number): void {
    if (this.count >= this.cap || head <= tail || widthPx <= 0) return;
    const i = this.count++;
    this.aA.setXYZ(i, ax, ay, az);
    this.aB.setXYZ(i, bx, by, bz);
    this.aP.setXYZW(i, widthPx, gray, head, tail);
  }

  end(): void {
    this.geo.instanceCount = this.count;
    flush([this.aA, this.aB, this.aP], this.count);
  }
}
