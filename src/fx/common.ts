// Utilidades compartilhadas pelos efeitos: resolução do alvo, vetores da câmera, GLSL comum.
import * as THREE from 'three';
import { CAMERA } from '../config';

/** Resolução (px) do alvo em baixa resolução; atualizada antes de cada desenho. */
export const uRes = { value: new THREE.Vector2(1, 1) };
const viewport = new THREE.Vector4();

/** Liga a atualização de `uRes` ao desenho do objeto (o jogo não avisa os efeitos do redimensionamento). */
export function trackResolution(obj: THREE.Object3D): void {
  obj.onBeforeRender = (r) => {
    r.getCurrentViewport(viewport);
    uRes.value.set(Math.max(1, viewport.z), Math.max(1, viewport.w));
  };
}

/** "Direita da tela" no mundo. */
export const CAM_RIGHT = new THREE.Vector3(Math.cos(CAMERA.yaw), 0, -Math.sin(CAMERA.yaw));
/** Do chão para a lente (unitário). Na ortográfica, andar nesse eixo só muda a profundidade. */
export const CAM_BACK = new THREE.Vector3(
  Math.sin(CAMERA.yaw) * Math.cos(CAMERA.pitch), Math.sin(CAMERA.pitch), Math.cos(CAMERA.yaw) * Math.cos(CAMERA.pitch),
);
/** Metros de altura no mundo para subir 1 m na tela. */
export const SCREEN_UP_Y = 1 / Math.cos(CAMERA.pitch);

/** Bayer 4x4 (limiar em 0..1), o mesmo padrão do pós-processamento. */
export const GLSL_BAYER = /* glsl */ `
float fxBayer2(float x, float y) { return 2.0 * x * (1.0 - y) + 3.0 * (1.0 - x) * y + x * y; }
float fxBayer4(vec2 p) {
  vec2 i = mod(floor(p), 4.0);
  float b = 4.0 * fxBayer2(mod(i.x, 2.0), mod(i.y, 2.0)) + fxBayer2(floor(i.x / 2.0), floor(i.y / 2.0));
  return (b + 0.5) / 16.0;
}
`;

/** Atributo instanciado dinâmico. */
export function dynAttr(capacity: number, size: number): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

/** Marca só os primeiros `count` itens para envio à GPU. */
export function flush(attrs: readonly THREE.InstancedBufferAttribute[], count: number): void {
  for (const a of attrs) {
    a.clearUpdateRanges();
    a.addUpdateRange(0, Math.max(1, count) * a.itemSize);
    a.needsUpdate = true;
  }
}

/** Faixa de grade (u em -1..1, v em 0..1) para arcos e linhas. */
export function stripGeometry(segments: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = (i / segments) * 2 - 1;
    pos.push(u, 0, 0, u, 1, 0);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
