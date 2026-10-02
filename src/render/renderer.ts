// Renderização em baixa resolução + pós-processamento preto e branco.
// Cena -> alvo (cor + profundidade) em RES -> passe final (neblina radial ao redor do jogador,
// contraste, pontilhado ordenado, vinheta, grão, clarão/negativo) -> canvas ampliado em escala inteira.
import * as THREE from 'three';
import { CAMERA } from '../config';
import type { IsoCamera } from './camera';

THREE.ColorManagement.enabled = false; // trabalhamos direto em tons de cinza "de tela"

export interface PostParams {
  flash: number;
  invert: number;
  hurt: number;
  fogNear: number;
  fogFar: number;
  fogColor: number;
  /** Níveis de cinza do pontilhado. */
  levels: number;
  contrast: number;
  vignette: number;
  grain: number;
}

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform mat4 uInvViewProj;
uniform vec2 uRes;
uniform vec2 uFocus;
uniform float uFogNear, uFogFar, uFogColor;
uniform float uTime, uFlash, uInvert, uHurt, uLevels, uContrast, uVignette, uGrain;
varying vec2 vUv;
// Bayer 2x2 [[0,2],[3,1]] (x, y em {0,1})
float bayer2(float x, float y) { return 2.0 * x * (1.0 - y) + 3.0 * (1.0 - x) * y + x * y; }
// Bayer 4x4 recursivo: 4 * M2(bits baixos) + M2(bits altos), limiar em (0, 1)
float bayer4(vec2 p) {
  vec2 i = mod(floor(p), 4.0);
  float b = 4.0 * bayer2(mod(i.x, 2.0), mod(i.y, 2.0)) + bayer2(floor(i.x / 2.0), floor(i.y / 2.0));
  return (b + 0.5) / 16.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(uColor, vUv).rgb;
  float depth = texture2D(uDepth, vUv).x;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));

  // neblina radial em volta do jogador (posição reconstruída da profundidade)
  vec4 w = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 wp = w.xyz / w.w;
  float fd = depth >= 0.9999 ? 1e4 : length(wp.xz - uFocus);
  float fog = smoothstep(uFogNear, uFogFar, fd);
  lum = mix(lum, uFogColor, fog);

  // curva de contraste em S suave
  lum = clamp((lum - 0.5) * uContrast + 0.5, 0.0, 1.0);

  // vinheta + escurecimento ao levar dano
  vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r2 = dot(q, q);
  lum *= 1.0 - uVignette * smoothstep(0.12, 0.62, r2);
  lum *= 1.0 - uHurt * smoothstep(0.05, 0.45, r2);

  // grão de filme
  lum += (hash(floor(gl_FragCoord.xy) + fract(uTime * 7.13) * 91.7) - 0.5) * uGrain;

  // quantização com pontilhado ordenado
  float lv = uLevels;
  lum = floor(lum * lv + bayer4(gl_FragCoord.xy)) / lv;

  lum = mix(lum, 1.0, uFlash);
  lum = mix(lum, 1.0 - lum, uInvert);
  gl_FragColor = vec4(vec3(clamp(lum, 0.0, 1.0)), 1.0);
}
`;

export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private rt: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly postMat: THREE.ShaderMaterial;
  private readonly invVP = new THREE.Matrix4();
  resW = 2;
  resH = 2;
  /** Ampliação inteira (px de CSS por px da baixa resolução). */
  pixelScale = 1;
  readonly margin = 1;
  readonly params: PostParams = {
    flash: 0, invert: 0, hurt: 0, fogNear: 10, fogFar: 20, fogColor: 0.74,
    levels: 20, contrast: 1.12, vignette: 0.5, grain: 0.035,
  };

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'view';
    container.appendChild(this.canvas);

    this.rt = this.makeTarget(2, 2);
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        uColor: { value: this.rt.texture },
        uDepth: { value: this.rt.depthTexture },
        uInvViewProj: { value: this.invVP },
        uRes: { value: new THREE.Vector2(2, 2) },
        uFocus: { value: new THREE.Vector2() },
        uFogNear: { value: 10 }, uFogFar: { value: 20 }, uFogColor: { value: 0.74 },
        uTime: { value: 0 }, uFlash: { value: 0 }, uInvert: { value: 0 }, uHurt: { value: 0 },
        uLevels: { value: 20 }, uContrast: { value: 1.1 }, uVignette: { value: 0.5 }, uGrain: { value: 0.035 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(tri, this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  private makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      // stencil: silhueta dos personagens escondidos atrás de construções (src/render/occlusion.ts)
      stencilBuffer: true,
    });
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type);
    depth.format = THREE.DepthStencilFormat;
    rt.depthTexture = depth;
    return rt;
  }

  /** Recalcula resolução/escala a partir do tamanho da janela. Retorna true se mudou. */
  resize(cam: IsoCamera): boolean {
    const cssW = window.innerWidth, cssH = window.innerHeight;
    const scale = Math.max(1, Math.round(cssH / CAMERA.targetRows));
    // dimensões pares: as bordas dos pixels caem em múltiplos de 1 texel a partir do centro da câmera,
    // e o chão desenhado na grade da tela (cenário do templo) fica pixel a pixel, sem cintilar
    let w = Math.ceil(cssW / scale) + this.margin * 2;
    let h = Math.ceil(cssH / scale) + this.margin * 2;
    w += w % 2;
    h += h % 2;
    if (w === this.resW && h === this.resH && scale === this.pixelScale) return false;
    this.resW = w; this.resH = h; this.pixelScale = scale;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w * scale}px`;
    this.canvas.style.height = `${h * scale}px`;
    this.rt.dispose();
    this.rt = this.makeTarget(w, h);
    this.postMat.uniforms.uColor.value = this.rt.texture;
    this.postMat.uniforms.uDepth.value = this.rt.depthTexture;
    (this.postMat.uniforms.uRes.value as THREE.Vector2).set(w, h);
    cam.resize(w, h);
    return true;
  }

  render(scene: THREE.Scene, cam: IsoCamera, focus: { x: number; z: number }, time: number): void {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, cam.camera);
    r.setRenderTarget(null);

    const u = this.postMat.uniforms, p = this.params;
    this.invVP.multiplyMatrices(cam.camera.projectionMatrix, cam.camera.matrixWorldInverse).invert();
    (u.uFocus.value as THREE.Vector2).set(focus.x, focus.z);
    u.uFogNear.value = p.fogNear; u.uFogFar.value = p.fogFar; u.uFogColor.value = p.fogColor;
    u.uTime.value = time; u.uFlash.value = p.flash; u.uInvert.value = p.invert; u.uHurt.value = p.hurt;
    u.uLevels.value = p.levels; u.uContrast.value = p.contrast; u.uVignette.value = p.vignette; u.uGrain.value = p.grain;
    r.render(this.postScene, this.postCam);

    const s = this.pixelScale;
    this.canvas.style.transform = `translate(${(-this.margin + cam.subpixel.x) * s}px, ${(-this.margin + cam.subpixel.y) * s}px)`;
  }

  /** Mundo -> px de CSS na janela. */
  worldToCss(cam: IsoCamera, p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(cam.camera);
    const s = this.pixelScale;
    return {
      x: ((v.x * 0.5 + 0.5) * this.resW - this.margin + cam.subpixel.x) * s,
      y: ((-v.y * 0.5 + 0.5) * this.resH - this.margin + cam.subpixel.y) * s,
    };
  }
}
