// Cenário: o chão e as construções de cada fase (src/world/field.ts, src/world/temple.ts) mais o que é
// comum a todas — luz de tarde nublada, chuva (riscos, respingos no chão) e relâmpagos.
import * as THREE from 'three';
import { CAMERA } from '../config';
import { Rng, type Vec2 } from '../core/math';
import type { Box, Circle } from '../sim/types';
import { buildField } from './field';
import type { StageId } from './stages';
import { buildTemple } from './temple';

export interface EnvironmentOptions {
  arenaRadius: number;
  seed: number;
  stage?: StageId;
}

export interface Environment {
  readonly stage: StageId;
  /** Obstáculos estáticos para a simulação (círculos no chão). */
  readonly colliders: Circle[];
  /** Construções e muros (retângulos girados). */
  readonly boxes: Box[];
  /** Onde o jogador começa. */
  readonly start: Vec2;
  /** Anima a chuva, os relâmpagos e o que se mexe no cenário; faz a luz acompanhar o foco. */
  update(dt: number, time: number, focus: Vec2): void;
  /** Clarão atual de relâmpago 0..1 (o jogo soma ao clarão do pós-processamento). */
  readonly lightning: number;
  /** Chamado no instante de um relâmpago (o jogo liga ao trovão do áudio). */
  onLightning: ((strength: number) => void) | null;
  /** Tira tudo da cena e libera a memória de vídeo (troca de cenário no menu). */
  dispose(): void;
}

/** O que cada cenário monta dentro do próprio grupo. */
export interface StageContent {
  colliders: Circle[];
  boxes: Box[];
  start: Vec2;
  /** Construções projetam sombra da luz principal. */
  shadows: boolean;
  /** Direção até o sol (padrão: de cima, vindo da esquerda da tela). */
  sun?: THREE.Vector3;
  /** Intensidades do sol e do céu (padrão 1,25 / 1,1): céu mais forte = sombras mais suaves. */
  light?: { sun: number; sky: number; skyColor?: number; groundColor?: number };
  update?(dt: number, time: number, focus: Vec2): void;
}
export type StageBuilder = (group: THREE.Group, opts: { arenaRadius: number; seed: number }) => StageContent;

const BUILDERS: Record<StageId, StageBuilder> = { field: buildField, temple: buildTemple };

const RAIN = {
  drops: 950,
  /** Meia-largura da caixa de chuva em volta do foco (m). */
  half: 22,
  top: 14,
  speed: 19,
  wind: { x: -2.6, z: 1.3 },
  /** Comprimento do risco (m). */
  len: 0.55,
  /** Só respinga perto do foco (onde se vê). */
  splashRange: 14,
  splashes: 240,
  splashLife: 0.3,
  splashSize: 0.3,
};

/** Luz principal: de cima, vinda da esquerda da tela (direção até a luz). */
const SUN_DIR = new THREE.Vector3(-10, 20, 6).normalize();
const SHADOW = { half: 30, map: 2048, depth: 120 };

// ------------------------------------------------------------------ respingos
const SPLASH_VERT = /* glsl */ `
attribute vec4 iData; // x, z, idade 0..1, tamanho (m)
varying vec2 vUv;
varying float vAge;
void main() {
  vUv = position.xy * 2.0;
  vAge = iData.z;
  float r = iData.w * mix(0.25, 1.0, iData.z);
  vec3 p = vec3(iData.x + position.x * 2.0 * r, 0.025, iData.y + position.y * 2.0 * r);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const SPLASH_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAge;
void main() {
  if (vAge >= 1.0) discard;
  float d = length(vUv);
  // anel fino (1 texel na baixa resolução) que esmaece
  if (d > 1.0 || d < 0.72) discard;
  gl_FragColor = vec4(vec3(0.86), 0.75 * (1.0 - vAge));
}
`;

function disposeTree(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.geometry) geometries.add(m.geometry);
    if (!m.material) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      materials.add(mat);
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v);
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) for (const k of Object.keys(u)) if (u[k].value instanceof THREE.Texture) textures.add(u[k].value);
    }
  });
  for (const t of textures) t.dispose();
  for (const m of materials) m.dispose();
  for (const g of geometries) g.dispose();
}

export function createEnvironment(scene: THREE.Scene, opts: EnvironmentOptions): Environment {
  const rng = new Rng(opts.seed ^ 0x51ed27);
  const stageId = opts.stage ?? 'field';
  const root = new THREE.Group();
  root.name = `stage:${stageId}`;
  scene.add(root);

  const stageGroup = new THREE.Group();
  root.add(stageGroup);
  const content = BUILDERS[stageId](stageGroup, { arenaRadius: opts.arenaRadius, seed: opts.seed });

  // luz de tarde nublada
  const sunDir = content.sun ?? SUN_DIR;
  const L = content.light;
  const sun = new THREE.DirectionalLight(0xffffff, L?.sun ?? 1.25);
  sun.position.copy(sunDir).multiplyScalar(22);
  const sky = new THREE.HemisphereLight(L?.skyColor ?? 0xdddddd, L?.groundColor ?? 0x444444, L?.sky ?? 1.1);
  root.add(sun, sun.target, sky);
  // eixos da câmera de sombra (lookAt do sol para o alvo, "para cima" = +y)
  const sx = new THREE.Vector3(0, 1, 0).cross(sunDir).normalize();
  const sy = sunDir.clone().cross(sx);
  const shadowTexel = (SHADOW.half * 2) / SHADOW.map;
  if (content.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW.map, SHADOW.map);
    const c = sun.shadow.camera;
    c.left = -SHADOW.half; c.right = SHADOW.half; c.top = SHADOW.half; c.bottom = -SHADOW.half;
    c.near = 1; c.far = SHADOW.depth;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
  }
  const lightTarget = new THREE.Vector3();

  // ---- chuva: riscos em LineSegments (1 px de largura na baixa resolução)
  const n = RAIN.drops;
  const drop = new Float32Array(n * 4); // x, y, z, velocidade
  const pos = new Float32Array(n * 6);
  const vel = { x: RAIN.wind.x, y: -RAIN.speed, z: RAIN.wind.z };
  const vl = Math.hypot(vel.x, vel.y, vel.z);
  const dir = { x: vel.x / vl, y: vel.y / vl, z: vel.z / vl };
  // a caixa de chuva fica deslocada para a câmera: gotas altas aparecem mais acima na tela
  const back = { x: Math.sin(CAMERA.yaw), z: Math.cos(CAMERA.yaw) };
  const center = { x: content.start.x, z: content.start.z };
  const place = (i: number, anyHeight: boolean) => {
    drop[i * 4] = center.x + rng.range(-RAIN.half, RAIN.half);
    drop[i * 4 + 1] = anyHeight ? rng.range(0, RAIN.top) : RAIN.top + rng.range(0, 2);
    drop[i * 4 + 2] = center.z + rng.range(-RAIN.half, RAIN.half);
    drop[i * 4 + 3] = rng.range(0.85, 1.15);
  };
  for (let i = 0; i < n; i++) place(i, true);
  const rainGeo = new THREE.BufferGeometry();
  const rainAttr = new THREE.BufferAttribute(pos, 3);
  rainAttr.setUsage(THREE.DynamicDrawUsage);
  rainGeo.setAttribute('position', rainAttr);
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xcfcfcf, transparent: true, opacity: 0.5, depthWrite: false }));
  rain.frustumCulled = false;
  rain.renderOrder = 3;
  root.add(rain);

  // ---- respingos: anéis instanciados no chão
  const sp = RAIN.splashes;
  const splashGeo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.rotateX(-Math.PI / 2);
  splashGeo.index = quad.index;
  splashGeo.setAttribute('position', quad.getAttribute('position'));
  const splashData = new Float32Array(sp * 4);
  for (let i = 0; i < sp; i++) splashData[i * 4 + 2] = 1; // idade 1 = livre
  const splashAttr = new THREE.InstancedBufferAttribute(splashData, 4);
  splashAttr.setUsage(THREE.DynamicDrawUsage);
  splashGeo.setAttribute('iData', splashAttr);
  splashGeo.instanceCount = sp;
  const splashes = new THREE.Mesh(splashGeo, new THREE.ShaderMaterial({
    vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG, transparent: true, depthWrite: false,
  }));
  splashes.frustumCulled = false;
  splashes.renderOrder = 0;
  root.add(splashes);
  let splashCursor = 0;
  const splash = (x: number, z: number) => {
    const i = splashCursor;
    splashCursor = (splashCursor + 1) % sp;
    splashData[i * 4] = x; splashData[i * 4 + 1] = z; splashData[i * 4 + 2] = 0;
    splashData[i * 4 + 3] = RAIN.splashSize * rng.range(0.6, 1.1);
  };

  // ---- relâmpagos: raros, com clarão duplo
  let nextStrike = rng.range(14, 30);
  let flashT = -1;
  let flashStrength = 0;

  const env: Environment = {
    stage: stageId,
    colliders: content.colliders,
    boxes: content.boxes,
    start: content.start,
    lightning: 0,
    onLightning: null,
    update(dt, time, focus) {
      center.x = focus.x + back.x * 6;
      center.z = focus.z + back.z * 6;
      // luz presa à grade de texels do mapa de sombra: a sombra não "nada" quando a câmera anda
      lightTarget.set(focus.x, 0, focus.z);
      const a = Math.round(lightTarget.dot(sx) / shadowTexel) * shadowTexel;
      const b = Math.round(lightTarget.dot(sy) / shadowTexel) * shadowTexel;
      const c = lightTarget.dot(sunDir);
      lightTarget.copy(sx).multiplyScalar(a).addScaledVector(sy, b).addScaledVector(sunDir, c);
      sun.target.position.copy(lightTarget);
      sun.position.copy(lightTarget).addScaledVector(sunDir, SHADOW.depth * 0.5);
      content.update?.(dt, time, focus);

      // gotas
      const h = RAIN.half;
      for (let i = 0; i < n; i++) {
        const o = i * 4, k = drop[o + 3];
        drop[o] += vel.x * k * dt;
        drop[o + 1] += vel.y * k * dt;
        drop[o + 2] += vel.z * k * dt;
        if (drop[o + 1] <= 0) {
          const dx = drop[o] - focus.x, dz = drop[o + 2] - focus.z;
          if (dx * dx + dz * dz < RAIN.splashRange * RAIN.splashRange && rng.next() < 0.45) splash(drop[o], drop[o + 2]);
          place(i, false);
        }
        // o foco anda: gotas que ficaram para trás reaparecem do outro lado da caixa
        if (drop[o] - center.x > h) drop[o] -= 2 * h; else if (center.x - drop[o] > h) drop[o] += 2 * h;
        if (drop[o + 2] - center.z > h) drop[o + 2] -= 2 * h; else if (center.z - drop[o + 2] > h) drop[o + 2] += 2 * h;
        const p = i * 6, len = RAIN.len * k;
        pos[p] = drop[o]; pos[p + 1] = drop[o + 1]; pos[p + 2] = drop[o + 2];
        pos[p + 3] = drop[o] - dir.x * len; pos[p + 4] = drop[o + 1] - dir.y * len; pos[p + 5] = drop[o + 2] - dir.z * len;
      }
      rainAttr.needsUpdate = true;

      for (let i = 0; i < sp; i++) {
        const o = i * 4 + 2;
        if (splashData[o] < 1) splashData[o] = Math.min(1, splashData[o] + dt / RAIN.splashLife);
      }
      splashAttr.needsUpdate = true;

      // relâmpago
      nextStrike -= dt;
      if (nextStrike <= 0) {
        nextStrike = rng.range(20, 45);
        flashT = 0;
        flashStrength = rng.range(0.6, 1);
        env.onLightning?.(flashStrength);
      }
      let l = 0;
      if (flashT >= 0) {
        flashT += dt;
        // clarão, apaga, segundo clarão mais fraco que decai
        if (flashT < 0.07) l = 1;
        else if (flashT < 0.14) l = 0.1;
        else if (flashT < 0.5) l = 0.7 * (1 - (flashT - 0.14) / 0.36);
        else flashT = -1;
      }
      (env as { lightning: number }).lightning = l * flashStrength;
    },
    dispose() {
      scene.remove(root);
      sun.shadow.map?.dispose();
      disposeTree(root);
    },
  };
  return env;
}
