// Lote instanciado de sprites em billboard vertical (um draw call para todos os samurais).
// Cada instância: posição do pé, retângulo no atlas, âncora, espelhamento, clarão, dissolução,
// contorno e tom. Os sprites ficam presos à grade de pixels da tela em baixa resolução.
import * as THREE from 'three';
import { CAMERA, TEXELS_PER_METER } from '../config';
import atlasMeta from '../assets/sprites/samurai.json';
import atlasUrl from '../assets/sprites/samurai.png?url';
import { clearsOccluder, occludedPass } from './occlusion';
import type { FrameName } from './pose';

export interface FrameRect { x: number; y: number; w: number; h: number; ax: number; ay: number }
export const FRAMES = atlasMeta.frames as Record<FrameName, FrameRect>;
export const ATLAS_SIZE = { w: atlasMeta.width, h: atlasMeta.height };

export interface SpriteInstance {
  x: number; y: number; z: number;
  frame: FrameName;
  flip: boolean;
  /** Rotação no plano da tela em torno do pé (queda do corpo), rad. */
  rot: number;
  /** 0..1 clarão branco. */
  flash: number;
  /** 0..1 fração dissolvida (0 = inteiro). */
  dissolve: number;
  /** Brilho do contorno de 1 texel (0 = sem contorno, 1 = branco). */
  outline: number;
  /** cor = cor * mul + add */
  toneMul: number;
  toneAdd: number;
}

export const makeInstance = (): SpriteInstance => ({
  x: 0, y: 0, z: 0, frame: 'front', flip: false, rot: 0, flash: 0, dissolve: 0, outline: 0, toneMul: 1, toneAdd: 0,
});

export function loadAtlas(): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(atlasUrl, tex => {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      resolve(tex);
    }, undefined, reject);
  });
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iRect;   // x, y, w, h no atlas (texels)
attribute vec4 iAnchor; // ax, ay, flip, rot
attribute vec4 iFx;     // flash, dissolve, outline, 0
attribute vec2 iTone;   // mul, add
uniform vec3 uCamRight;
uniform vec3 uCamBack;  // no chão, apontando para a câmera
uniform float uSinPitch;
uniform float uStretch;
uniform float uTexel;   // metros por texel
uniform vec2 uRes;
varying vec2 vTexel;
varying vec4 vRect;
varying vec4 vFx;
varying vec2 vTone;
void main() {
  float w = iRect.z, h = iRect.w, ax = iAnchor.x;
  bool flip = iAnchor.z > 0.5;
  // deslocamento na tela (texels) a partir do pé; quad expandido 1 texel para o contorno
  float s = flip ? mix(-(w - ax) - 1.0, ax + 1.0, position.x) : mix(-ax - 1.0, w - ax + 1.0, position.x);
  // 3 linhas de vértices: base (abaixo do pé), pé e topo. O que fica abaixo do pé (anéis, poeira)
  // deita no chão em direção à câmera em vez de afundar na terra.
  float below = h - iAnchor.y;
  float hgt = position.y < 0.25 ? -(below + 1.0) : (position.y < 0.75 ? 0.0 : iAnchor.y + 1.0);
  float ty = hgt + below;
  float tx = flip ? ax - s : ax + s;
  vTexel = vec2(tx, ty);
  vRect = iRect;
  vFx = iFx;
  vTone = iTone;
  float c = cos(iAnchor.w), sn = sin(iAnchor.w);
  vec2 local = vec2(s * c - hgt * sn, s * sn + hgt * c) * uTexel;
  vec3 world = local.y >= 0.0
    ? iPos + uCamRight * local.x + vec3(0.0, local.y * uStretch, 0.0)
    : iPos + uCamRight * local.x + uCamBack * (-local.y / uSinPitch) + vec3(0.0, 0.02, 0.0);
  vec4 anchorClip = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
  vec2 pix = (anchorClip.xy / anchorClip.w * 0.5 + 0.5) * uRes;
  vec2 snapDelta = (floor(pix + 0.5) - pix) / uRes * 2.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  gl_Position.xy += snapDelta * gl_Position.w;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
varying vec2 vTexel;
varying vec4 vRect;
varying vec4 vFx;
varying vec2 vTone;
vec4 texelAt(vec2 t) {
  if (t.x < 0.0 || t.y < 0.0 || t.x >= vRect.z || t.y >= vRect.w) return vec4(0.0);
  vec2 px = vec2(vRect.x + t.x, vRect.y + (vRect.w - 1.0 - t.y)) + 0.5;
  return texture2D(uAtlas, px / uAtlasSize);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 t = floor(vTexel);
  vec4 c = texelAt(t);
#ifdef OCCLUDED
  // atrás de uma construção: meio-tom em xadrez (herói e aviso de golpe claros, horda cinza)
  if (c.a < 0.5 || vFx.y > 0.0) discard;
  if (mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) > 0.5) discard;
  gl_FragColor = vec4(vec3(vFx.z > 0.5 ? 0.92 : 0.6), 1.0);
  return;
#endif
  if (c.a < 0.5) {
    if (vFx.z <= 0.0 || vFx.y > 0.0) discard;
    float n = texelAt(t + vec2(1.0, 0.0)).a + texelAt(t - vec2(1.0, 0.0)).a
            + texelAt(t + vec2(0.0, 1.0)).a + texelAt(t - vec2(0.0, 1.0)).a;
    if (n < 0.5) discard;
    gl_FragColor = vec4(vec3(vFx.z), 1.0);
    return;
  }
  float d = vFx.y;
  if (d > 0.0) {
    // dissolve em blocos de 2x2 texels, de cima para baixo com ruído
    float n = hash(floor(t / 2.0) + vRect.xy) * 0.65 + (t.y / vRect.w) * 0.35;
    if (n < d) discard;
    if (n < d + 0.06) { gl_FragColor = vec4(vec3(0.93), 1.0); return; }
  }
  vec3 col = c.rgb * vTone.x + vTone.y;
  col = mix(col, vec3(1.0), vFx.x);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  /** Segundo passe: silhueta de quem ficou atrás de construções (ver occlusion.ts). */
  readonly occludedMesh: THREE.Mesh;
  readonly capacity: number;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aRect: THREE.InstancedBufferAttribute;
  private readonly aAnchor: THREE.InstancedBufferAttribute;
  private readonly aFx: THREE.InstancedBufferAttribute;
  private readonly aTone: THREE.InstancedBufferAttribute;
  readonly material: THREE.ShaderMaterial;
  private count = 0;

  constructor(atlas: THREE.Texture, capacity = 256) {
    this.capacity = capacity;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1, 1, 2);
    quad.translate(0.5, 0.5, 0);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const mk = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(3); this.aRect = mk(4); this.aAnchor = mk(4); this.aFx = mk(4); this.aTone = mk(2);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iRect', this.aRect);
    geo.setAttribute('iAnchor', this.aAnchor);
    geo.setAttribute('iFx', this.aFx);
    geo.setAttribute('iTone', this.aTone);
    geo.instanceCount = 0;
    this.geo = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uAtlas: { value: atlas },
        uAtlasSize: { value: new THREE.Vector2(ATLAS_SIZE.w, ATLAS_SIZE.h) },
        uCamRight: { value: new THREE.Vector3(Math.cos(CAMERA.yaw), 0, -Math.sin(CAMERA.yaw)) },
        uCamBack: { value: new THREE.Vector3(Math.sin(CAMERA.yaw), 0, Math.cos(CAMERA.yaw)) },
        uSinPitch: { value: Math.sin(CAMERA.pitch) },
        uStretch: { value: 1 / Math.cos(CAMERA.pitch) },
        uTexel: { value: 1 / TEXELS_PER_METER },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      side: THREE.DoubleSide,
    });
    clearsOccluder(this.material);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    // mesmos uniforms (resolução, atlas): só muda o que o fragmento desenha e os testes
    const occ = occludedPass(new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.material.uniforms, defines: { OCCLUDED: 1 }, side: THREE.DoubleSide,
    }));
    this.occludedMesh = new THREE.Mesh(geo, occ);
    this.occludedMesh.frustumCulled = false;
    this.occludedMesh.renderOrder = 2;
  }

  setResolution(w: number, h: number): void { (this.material.uniforms.uRes.value as THREE.Vector2).set(w, h); }

  begin(): void { this.count = 0; }

  push(s: SpriteInstance): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const f = FRAMES[s.frame];
    this.aPos.setXYZ(i, s.x, s.y, s.z);
    this.aRect.setXYZW(i, f.x, f.y, f.w, f.h);
    this.aAnchor.setXYZW(i, f.ax, f.ay, s.flip ? 1 : 0, s.rot);
    this.aFx.setXYZW(i, s.flash, s.dissolve, s.outline, 0);
    this.aTone.setXY(i, s.toneMul, s.toneAdd);
  }

  end(): void {
    this.geo.instanceCount = this.count;
    for (const a of [this.aPos, this.aRect, this.aAnchor, this.aFx, this.aTone]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }
}
