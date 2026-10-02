// Kit de montagem do cenário procedural: peças com coordenadas de textura em metros, juntadas num
// mesh por material (poucos draw calls). Telhados japoneses: perfil côncavo e cantos levantados (sori).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { occluder } from '../render/occlusion';

export type Geo = THREE.BufferGeometry;
type V3 = readonly [number, number, number];

/** Matriz de posição, giro em y e escala. */
export function at(x: number, y: number, z: number, ry = 0, s: number | V3 = 1): THREE.Matrix4 {
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), sc);
}
/** Giro qualquer (ordem XYZ) + posição. */
export function atRot(x: number, y: number, z: number, rx: number, ry: number, rz: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z);
}

/** Material das construções: Lambert facetado, textura em metros, marca o stencil de oclusão. */
export function propMat(map: THREE.Texture | null, color = 0xffffff, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, map, flatShading: true, side: THREE.DoubleSide, ...extra });
  m.shadowSide = THREE.DoubleSide;
  return occluder(m);
}
/** Material que brilha sozinho (papel de lanterna aceso, janelas da lanterna de pedra). */
export function glowMat(color: number, map: THREE.Texture | null = null): THREE.MeshBasicMaterial {
  return occluder(new THREE.MeshBasicMaterial({ color, map, side: THREE.DoubleSide }));
}

/** Coleta peças por material; build() junta cada material num mesh só. */
export class Kit {
  private parts = new Map<THREE.Material, Geo[]>();

  add(mat: THREE.Material, geo: Geo, m?: THREE.Matrix4): void {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    // só o que todas as peças têm (senão a junção falha)
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (m) g = g.applyMatrix4(m);
    // normais da própria peça (copas e cones suaves); as facetadas vêm do flatShading do material
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
  }

  build(parent: THREE.Object3D, o: { cast?: boolean; receive?: boolean } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = o.cast ?? true;
      mesh.receiveShadow = o.receive ?? true;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

// ------------------------------------------------------------------ primitivas (base em y = 0)
/** Caixa w (x) × h (y) × d (z) com a base em y = 0; textura em metros em cada face. */
export function box(w: number, h: number, d: number): Geo {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // ordem das faces do BoxGeometry: +x, -x, +y, -y, +z, -z (4 vértices cada)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  return g;
}

/** Cilindro/cone com base em y = 0 (poucos lados = prisma facetado). */
export function cyl(rTop: number, rBot: number, h: number, seg = 8, open = false): Geo {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  g.translate(0, h / 2, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const circ = Math.PI * (rTop + rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  return g;
}

/** Sólido de revolução: perfil [raio, altura] de baixo para cima. */
export function lathe(profile: readonly (readonly [number, number])[], seg = 10): Geo {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  const g = new THREE.LatheGeometry(pts, seg);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  const maxR = Math.max(...profile.map(p => p[0]));
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * maxR, uv.getY(i) * len);
  return g;
}

/** Esfera facetada achatada (copa de árvore, pedra). */
export function blob(r: number, sy = 1, detail = 1, jitter = 0, rng?: { range(a: number, b: number): number }): Geo {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  // mesmo deslocamento para vértices repetidos (a malha não abre)
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let k = seen.get(key);
    if (k === undefined) { k = 1 + (rng ? rng.range(-jitter, jitter) : 0); seen.set(key, k); }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * sy, p.getZ(i) * k);
  }
  // normais suaves (a copa fica redonda com o sombreamento do material sem flatShading)
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const s = mergeVertices(g, 1e-4);
  s.computeVertexNormals();
  const sp = s.getAttribute('position') as THREE.BufferAttribute;
  const uvs = new Float32Array(sp.count * 2);
  for (let i = 0; i < sp.count; i++) { uvs[i * 2] = (Math.atan2(sp.getZ(i), sp.getX(i)) + Math.PI) * r; uvs[i * 2 + 1] = sp.getY(i); }
  s.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return s;
}

/**
 * Superfície paramétrica (s, t) em [0,1]²: coordenada de textura u = distância ao longo da linha
 * (centrada), v = distância ao longo de t na coluna do meio.
 */
export function surface(fn: (s: number, t: number) => V3, ns: number, nt: number): Geo {
  const P: THREE.Vector3[][] = [];
  for (let j = 0; j <= nt; j++) {
    const row: THREE.Vector3[] = [];
    for (let i = 0; i <= ns; i++) { const [x, y, z] = fn(i / ns, j / nt); row.push(new THREE.Vector3(x, y, z)); }
    P.push(row);
  }
  const vAt: number[] = [0];
  const mid = Math.round(ns / 2);
  for (let j = 1; j <= nt; j++) vAt.push(vAt[j - 1] + P[j][mid].distanceTo(P[j - 1][mid]));
  const U: number[][] = P.map(row => {
    const acc = [0];
    for (let i = 1; i < row.length; i++) acc.push(acc[i - 1] + row[i].distanceTo(row[i - 1]));
    const half = acc[acc.length - 1] / 2;
    return acc.map(a => a - half);
  });
  const pos: number[] = [], uvs: number[] = [];
  const push = (i: number, j: number) => { const p = P[j][i]; pos.push(p.x, p.y, p.z); uvs.push(U[j][i], vAt[j]); };
  for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) {
    push(i, j); push(i + 1, j); push(i + 1, j + 1);
    push(i, j); push(i + 1, j + 1); push(i, j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/** Polígono plano convexo (leque); textura projetada no plano, em metros. */
export function poly(verts: readonly V3[]): Geo {
  const v = verts.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const e1 = v[1].clone().sub(v[0]).normalize();
  const n = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0])).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1);
  const pos: number[] = [], uvs: number[] = [];
  const push = (p: THREE.Vector3) => { pos.push(p.x, p.y, p.z); const d = p.clone().sub(v[0]); uvs.push(d.dot(e1), d.dot(e2)); };
  for (let i = 1; i + 1 < v.length; i++) { push(v[0]); push(v[i]); push(v[i + 1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/** Faixa vertical que segue uma curva (beiral, tábua de empena): de y(p) - h a y(p). */
export function strip(curve: (s: number) => V3, h: number, n: number): Geo {
  return surface((s, t) => { const [x, y, z] = curve(s); return [x, y - h * (1 - t), z]; }, n, 1);
}

// ------------------------------------------------------------------ telhados
export interface HipRoof {
  /** Meias-medidas do beiral (x = largura, z = profundidade) e altura do beiral no meio. */
  ex: number; ez: number; y0: number;
  /** Meias-medidas e altura no topo (onde o telhado é cortado: cumeeira ou base do andar de cima). */
  tx: number; tz: number; y1: number;
  /** Quanto os cantos do beiral sobem (sori). */
  lift: number;
  /** Expoente do perfil (> 1 = côncavo: raso no beiral, íngreme no topo). */
  curve?: number;
  /** Espessura da borda do beiral. */
  edge?: number;
}

/** Telhado de quatro águas (ou pirâmide cortada): superfície de telhas + borda do beiral. */
export function hipRoof(r: HipRoof, seg = 10): { tiles: Geo[]; edge: Geo[] } {
  const k = r.curve ?? 1.5;
  const X = (t: number) => r.ex + (r.tx - r.ex) * t;
  const Z = (t: number) => r.ez + (r.tz - r.ez) * t;
  const Y = (t: number, q: number) => r.y0 + (r.y1 - r.y0) * Math.pow(t, k) + r.lift * Math.pow(Math.abs(q), 6) * (1 - t) * (1 - t);
  const sides: ((s: number, t: number) => V3)[] = [
    (s, t) => { const x = (s * 2 - 1) * X(t); return [x, Y(t, x / X(t)), Z(t)]; },
    (s, t) => { const x = (1 - s * 2) * X(t); return [x, Y(t, x / X(t)), -Z(t)]; },
    (s, t) => { const z = (1 - s * 2) * Z(t); return [X(t), Y(t, z / Z(t)), z]; },
    (s, t) => { const z = (s * 2 - 1) * Z(t); return [-X(t), Y(t, z / Z(t)), z]; },
  ];
  const tiles = sides.map(f => surface(f, seg, 6));
  const h = r.edge ?? 0.28;
  const edge = sides.map(f => strip(s => f(s, 0), h, seg));
  return { tiles, edge };
}

export interface GableRoof {
  /** Meia-largura (ao longo da cumeeira) e meia-profundidade do beiral; alturas do beiral e da cumeeira. */
  ex: number; ez: number; y0: number; y1: number;
  curve?: number;
  lift?: number;
  edge?: number;
}

/** Telhado de duas águas: telhas, triângulos de empena, tábuas de empena (hafu) e cumeeira. */
export function gableRoof(r: GableRoof, seg = 8): { tiles: Geo[]; gable: Geo[]; boards: Geo[]; ridge: Geo } {
  const k = r.curve ?? 1.4, lift = r.lift ?? 0;
  const Y = (t: number, q: number) => r.y0 + (r.y1 - r.y0) * Math.pow(t, k) + lift * Math.pow(Math.abs(q), 8) * (1 - t) * (1 - t);
  const tiles = [
    surface((s, t) => { const x = (s * 2 - 1) * r.ex; return [x, Y(t, x / r.ex), r.ez * (1 - t)]; }, seg, 6),
    surface((s, t) => { const x = (1 - s * 2) * r.ex; return [x, Y(t, x / r.ex), -r.ez * (1 - t)]; }, seg, 6),
  ];
  // empena: triângulo vertical recuado sob a tábua, seguindo o perfil
  const inset = 0.25;
  const gable: Geo[] = [];
  for (const sx of [1, -1]) {
    gable.push(surface((s, t) => {
      const z = (s * 2 - 1) * r.ez * 0.92 * (1 - t);
      const top = Y(1 - Math.abs(z) / r.ez, 0) - 0.05;
      const bottom = r.y0 - 0.05;
      return [sx * (r.ex - inset), bottom + (top - bottom) * t, z];
    }, 6, 1));
  }
  const bh = r.edge ?? 0.3;
  const boards: Geo[] = [];
  for (const sx of [1, -1]) {
    boards.push(strip(s => { const z = (s * 2 - 1) * r.ez; return [sx * (r.ex + 0.02), Y(1 - Math.abs(z) / r.ez, 1) + 0.04, z]; }, bh, 12));
  }
  for (const sz of [1, -1]) boards.push(strip(s => { const x = (s * 2 - 1) * r.ex; return [x, Y(0, x / r.ex), sz * r.ez]; }, bh * 0.8, seg));
  const ridge = box(r.ex * 2 + 0.3, 0.42, 0.42);
  ridge.translate(0, r.y1 - 0.12, 0);
  return { tiles, gable, boards, ridge };
}
