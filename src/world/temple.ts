// Cenário "Templo": pátio de pedra diante do salão principal (hondō), com pagode de cinco andares,
// torre do sino, torii, lanternas de pedra, leões-guardiões, incensário fumegando, pia de purificação,
// poço, cerejeira, cedro sagrado, jardim de pedrisco e restos da batalha (escudos, carro quebrado,
// flechas cravadas, estandartes rasgados balançando). A planta está em temple-layout.ts.
import * as THREE from 'three';
import { CAMERA } from '../config';
import { Rng, type Vec2 } from '../core/math';
import { occluder } from '../render/occlusion';
import type { Box, Circle } from '../sim/types';
import type { StageBuilder } from './environment';
import { Kit, at, atRot, blob, box, cyl, gableRoof, glowMat, hipRoof, lathe, poly, propMat, type Geo } from './kit';
import { GROUND_HALF, paintTempleGround } from './temple-ground';
import {
  BANNERS, BELL, BURNER, CART, CHOZUYA, FALLEN_BANNER, GARDEN_FENCE, GARDEN_ROCKS, HALL, KOMAINU, LANTERNS, LAYOUT_ROT,
  PAGODA, SAKURA, SHIELDS, SHINBOKU, START, TORII, WALL, WELL, toWorld, type Rect,
} from './temple-layout';
import { Paint, templeTextures } from './textures';

/** Ponto da planta (u, v) e altura y -> coordenadas locais do grupo alinhado à tela (x = u, z = -v). */
const P = (u: number, v: number, y = 0): [number, number, number] => [u, y, -v];

// ------------------------------------------------------------------ estandarte (tecido com brasão)
function bannerTexture(seed: number): THREE.DataTexture {
  const rng = new Rng(seed ^ 0x4b1d);
  const W = 24, H = 106;
  const p = new Paint(W, H, 206);
  const a = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p.add(x, y, rng.range(-4, 4));
  // brasão: três vírgulas (mitsudomoe) num círculo, perto do topo
  const cx = 11.5, cy = H - 16, R = 8;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d > R + 0.5) continue;
    if (d > R - 1.2) { p.set(x, y, 40); continue; }
    const ang = Math.atan2(dy, dx);
    // vírgulas: cabeça redonda + cauda em espiral
    let ink = false;
    for (let k = 0; k < 3; k++) {
      const c = ang - (k * Math.PI * 2) / 3 + d * 0.28;
      const w = Math.cos(c);
      if (w > 0.55 && d > 1.5) ink = true;
    }
    if (ink) p.set(x, y, 40);
  }
  // coluna de "escrita": traços grossos
  for (let y = H - 32; y > 22; y -= rng.int(5, 8)) {
    const w = rng.int(4, 10), x0 = Math.round(cx - w / 2) + rng.int(-1, 1);
    p.rect(x0, y, w, rng.int(1, 3), 52);
    if (rng.next() < 0.5) p.rect(Math.round(cx) + rng.int(-2, 2), y - 2, 1, 4, 52);
  }
  // barra escura no pé e rasgos
  for (let y = 12; y < 16; y++) p.hline(0, W - 1, y, 70);
  for (let x = 0; x < W; x++) {
    const tear = Math.floor(Math.abs(Math.sin(x * 1.7 + seed) * 7) + rng.range(0, 4));
    for (let y = 0; y < tear; y++) a[y * W + x] = 0;
  }
  for (let k = 0; k < 3; k++) {
    const hx = rng.int(3, W - 4), hy = rng.int(20, H - 30), r = rng.range(1.2, 2.2);
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= r * r) a[(hy + y) * W + hx + x] = 0;
  }
  // a textura do estandarte não repete: coordenadas 0..1
  const t = new Paint(W, H);
  t.lum.set(p.lum);
  t.alpha = a;
  t.posterize();
  const tex = t.texture();
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

const SWAY_VERT = /* glsl */ `
attribute float aSway;
attribute float aPhase;
uniform float uTime;
`;

export const buildTemple: StageBuilder = (group, opts) => {
  const rng = new Rng(opts.seed ^ 0x3e11a);
  const T = templeTextures(opts.seed);
  const M = {
    wood: propMat(T.woodDark, 0xb4b4b4),
    woodLight: propMat(T.boards, 0xd8d8d8),
    plaster: propMat(T.plaster, 0xffffff),
    wall: propMat(T.wallSuji, 0xffffff),
    tiles: propMat(T.tiles, 0xe0e0e0),
    stoneBlocks: propMat(T.stoneBlocks, 0xf0f0f0),
    stone: propMat(T.stone, 0xe8e8e8),
    stoneDark: propMat(T.stone, 0xa8a8a8),
    // papel das portas com um pouco de luz de dentro (o salão fica na sombra do beiral)
    shoji: propMat(T.shoji, 0xffffff, { emissive: 0x484848 }),
    bronze: propMat(T.bronze, 0xd0d0d0),
    bark: propMat(T.bark, 0xc8c8c8),
    foliage: propMat(T.foliage, 0xc8c8c8, { flatShading: false }),
    blossom: propMat(T.blossom, 0xffffff, { flatShading: false }),
    bamboo: propMat(T.bamboo, 0xd8d8d8),
    straw: propMat(T.straw, 0xe8e8e8),
    lacquer: propMat(T.lacquer, 0xd0d0d0),
    black: propMat(null, 0x303030),
    water: propMat(null, 0x464646),
    paper: propMat(null, 0xe8e8e8),
    lampGlow: glowMat(0xdcdcdc, T.paperLamp),
    windowGlow: glowMat(0xc8c8c8),
  };
  const kit = new Kit();
  const site = new THREE.Group();
  site.rotation.y = CAMERA.yaw;
  group.add(site);

  const colliders: Circle[] = [];
  const boxes: Box[] = [];
  const circle = (u: number, v: number, r: number) => { const w = toWorld(u, v); colliders.push({ x: w.x, z: w.z, r }); };
  const rect = (r: Rect) => {
    const w = toWorld((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
    boxes.push({ x: w.x, z: w.z, hw: (r.u1 - r.u0) / 2, hd: (r.v1 - r.v0) / 2, rot: LAYOUT_ROT });
  };
  const put = (mat: THREE.Material, g: Geo, u: number, v: number, y = 0, ry = 0) => kit.add(mat, g, at(...P(u, v, y), ry));

  // ---------------------------------------------------------------- chão
  const groundTex = paintTempleGround(opts.seed);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2), new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  site.add(ground);
  // além do chão pintado: lama lisa (quase sempre dentro da neblina)
  const mud = new Paint(64, 32, 124);
  mud.noise(rng, 4, 8);
  mud.speckle(rng, 60, 104, 140);
  mud.posterize(4);
  const mudTex = mud.texture();
  const outerGeo = new THREE.PlaneGeometry(240, 240);
  const ouv = outerGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < ouv.count; i++) ouv.setXY(i, ouv.getX(i) * 240, ouv.getY(i) * 240);
  const outer = new THREE.Mesh(outerGeo, new THREE.MeshLambertMaterial({ map: mudTex }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  site.add(outer);

  // ---------------------------------------------------------------- salão principal (hondō)
  {
    const H = HALL, ph = H.platformH;
    const pc = { u: (H.platform.u0 + H.platform.u1) / 2, v: (H.platform.v0 + H.platform.v1) / 2 };
    const pw = H.platform.u1 - H.platform.u0, pd = H.platform.v1 - H.platform.v0;
    put(M.stoneBlocks, box(pw, ph, pd), pc.u, pc.v);
    put(M.woodLight, box(pw - 0.2, 0.06, pd - 0.2), pc.u, pc.v, ph);
    // escada (4 degraus) e muretas laterais
    const sw = H.steps.u1 - H.steps.u0, sd = H.steps.v1 - H.steps.v0;
    for (let k = 0; k < 4; k++) {
      const d = sd - k * (sd / 4);
      put(M.stone, box(sw, (ph * (k + 1)) / 4, d), 0, H.steps.v1 - d / 2);
    }
    for (const s of [-1, 1]) put(M.stoneBlocks, box(0.32, ph + 0.15, sd), s * (sw / 2 + 0.16), H.steps.v0 + sd / 2);

    // corpo: paredes de reboco, fachada de portas de papel entre pilares
    const bw = H.body.u1 - H.body.u0, bd = H.body.v1 - H.body.v0, bh = H.wallTop - ph;
    const bc = (H.body.v0 + H.body.v1) / 2;
    put(M.plaster, box(bw, bh, bd), 0, bc, ph);
    const cols = [-8, -4.8, -1.6, 1.6, 4.8, 8];
    for (let i = 0; i + 1 < cols.length; i++) {
      const u = (cols[i] + cols[i + 1]) / 2, w = cols[i + 1] - cols[i] - 0.34;
      put(M.shoji, box(w, 2.75, 0.08), u, H.body.v0 - 0.03, ph + 0.28);
      // travessa do meio das portas
      put(M.wood, box(w, 0.1, 0.1), u, H.body.v0 - 0.08, ph + 1.6);
    }
    for (const u of cols) put(M.wood, cyl(0.2, 0.21, bh + 0.35, 8), u, H.body.v0 - 0.1, ph);
    for (const s of [-1, 1]) for (const v of [22.3, 24.4, 26.5, 28.5]) put(M.wood, cyl(0.2, 0.21, bh + 0.35, 8), s * 8.02, v, ph);
    // vigas (nageshi) e mísulas (tokyō) sob o beiral
    put(M.wood, box(bw + 0.5, 0.2, 0.28), 0, H.body.v0 - 0.12, ph + 0.12);
    put(M.wood, box(bw + 0.5, 0.26, 0.3), 0, H.body.v0 - 0.12, ph + 3.05);
    put(M.wood, box(bw + 0.8, 0.28, 0.34), 0, H.body.v0 - 0.12, H.wallTop - 0.18);
    for (let u = -8.2; u <= 8.21; u += 0.82) put(M.wood, box(0.3, 0.36, 0.55), u, H.body.v0 - 0.2, H.wallTop + 0.08);
    for (const s of [-1, 1]) for (let v = 20.6; v <= 28.4; v += 0.82) put(M.wood, box(0.55, 0.36, 0.3), s * 8.15, v, H.wallTop + 0.08);
    // parapeito da varanda (sem a parte da escada)
    const railV = H.platform.v0 + 0.22;
    for (let u = H.platform.u0 + 0.2; u <= H.platform.u1 - 0.19; u += 1.6) {
      if (Math.abs(u) < H.steps.u1 + 0.1) continue;
      put(M.wood, box(0.12, 0.72, 0.12), u, railV, ph);
    }
    for (const s of [-1, 1]) {
      const u0 = s < 0 ? H.platform.u0 + 0.2 : H.steps.u1 + 0.1, u1 = s < 0 ? -H.steps.u1 - 0.1 : H.platform.u1 - 0.2;
      put(M.wood, box(u1 - u0, 0.08, 0.1), (u0 + u1) / 2, railV, ph + 0.66);
      put(M.wood, box(u1 - u0, 0.06, 0.08), (u0 + u1) / 2, railV, ph + 0.34);
      put(M.wood, box(0.1, 0.08, pd - 0.5), s * (H.platform.u1 - 0.2), pc.v + 0.1, ph + 0.66);
      for (let v = railV; v < H.platform.v1 - 0.3; v += 1.6) put(M.wood, box(0.12, 0.72, 0.12), s * (H.platform.u1 - 0.2), v, ph);
    }
    // caixa de oferendas, corda do sino e lanternas de papel
    put(M.woodLight, box(1.8, 0.8, 0.8), 0, H.body.v0 - 0.9, ph);
    for (let k = -3; k <= 3; k++) put(M.black, box(0.08, 0.05, 0.78), k * 0.24, H.body.v0 - 0.9, ph + 0.8);
    put(M.straw, cyl(0.055, 0.065, 2.4, 5), 0, H.body.v0 - 0.45, ph + 0.7);
    put(M.bronze, blob(0.22, 1, 1), 0, H.body.v0 - 0.45, ph + 3.2);
    for (const s of [-1, 1]) {
      const u = s * 2.9, v = H.body.v0 - 0.75;
      put(M.lampGlow, lathe([[0.12, 0], [0.28, 0.08], [0.34, 0.4], [0.28, 0.74], [0.12, 0.82]], 10), u, v, ph + 1.7);
      put(M.black, cyl(0.15, 0.15, 0.08, 8), u, v, ph + 1.66);
      put(M.black, cyl(0.15, 0.15, 0.08, 8), u, v, ph + 2.52);
      put(M.black, box(0.03, 1.2, 0.03), u, v, ph + 2.6);
    }
    // placa com o nome do templo
    put(M.black, box(1.3, 0.85, 0.08), 0, H.body.v0 - 0.32, ph + 2.15);
    for (let k = 0; k < 3; k++) put(M.paper, box(0.07, 0.5, 0.02), -0.28 + k * 0.28, H.body.v0 - 0.37, ph + 2.33);

    // telhado irimoya: quatro águas embaixo + duas águas em cima (com empenas)
    const ec = (H.eave.v0 + H.eave.v1) / 2;
    const ex = (H.eave.u1 - H.eave.u0) / 2, ez = (H.eave.v1 - H.eave.v0) / 2;
    const lower = hipRoof({ ex, ez, y0: H.wallTop + 0.42, tx: 7.4, tz: 3.4, y1: 7.7, lift: 0.8, curve: 1.6, edge: 0.36 }, 12);
    const m0 = at(...P(0, ec));
    for (const g of lower.tiles) kit.add(M.tiles, g, m0);
    for (const g of lower.edge) kit.add(M.black, g, m0);
    kit.add(M.tiles, poly([[-7.4, 7.7, 3.4], [7.4, 7.7, 3.4], [7.4, 7.7, -3.4], [-7.4, 7.7, -3.4]]), m0);
    const upper = gableRoof({ ex: 6.6, ez: 4.0, y0: 7.55, y1: 10.6, curve: 1.35, lift: 0.25, edge: 0.34 }, 10);
    for (const g of upper.tiles) kit.add(M.tiles, g, m0);
    for (const g of upper.gable) kit.add(M.woodLight, g, m0);
    for (const g of upper.boards) kit.add(M.black, g, m0);
    kit.add(M.black, upper.ridge, m0);
    for (const s of [-1, 1]) {
      kit.add(M.black, box(0.55, 1.0, 0.7), at(s * 6.75, 10.2, -ec));
      kit.add(M.black, box(0.2, 0.55, 0.2), atRot(s * 6.95, 10.95, -ec, 0, 0, -s * 0.5));
    }
    rect({ u0: H.platform.u0 - 0.4, v0: H.steps.v0 - 0.3, u1: H.platform.u1 + 0.4, v1: 40 });
  }

  // ---------------------------------------------------------------- leões-guardiões (komainu)
  for (const [i, k] of KOMAINU.entries()) {
    const s = i === 0 ? -1 : 1;
    put(M.stoneBlocks, box(0.95, 1.1, 0.95), k.u, k.v);
    const ry = s * 0.45; // olhando para quem chega
    const m = (x: number, y: number, z: number) => at(...P(k.u, k.v, 1.1), ry).multiply(at(x, y, z));
    kit.add(M.stone, box(0.62, 0.42, 0.72), m(0, 0, 0));
    kit.add(M.stone, blob(0.3, 1.1, 1), m(0, 0.62, 0.12));
    kit.add(M.stone, box(0.36, 0.34, 0.34), m(0, 0.78, 0.32));
    kit.add(M.stone, box(0.12, 0.42, 0.14), m(-0.18, 0, 0.3));
    kit.add(M.stone, box(0.12, 0.42, 0.14), m(0.18, 0, 0.3));
    kit.add(M.stone, blob(0.12, 1, 0), m(0, 0.5, -0.36));
    circle(k.u, k.v, k.r);
  }

  // ---------------------------------------------------------------- incensário (jōkōro)
  {
    const { u, v } = BURNER;
    put(M.stoneBlocks, box(1.7, 0.3, 1.7), u, v);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      put(M.bronze, cyl(0.06, 0.09, 0.5, 5), u + Math.cos(a) * 0.45, v + Math.sin(a) * 0.45, 0.3);
    }
    put(M.bronze, lathe([[0.3, 0], [0.62, 0.12], [0.74, 0.42], [0.68, 0.66], [0.8, 0.74], [0.8, 0.8]], 10), u, v, 0.78);
    put(M.black, cyl(0.66, 0.66, 0.02, 10), u, v, 1.5);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
      put(M.bronze, cyl(0.035, 0.035, 0.75, 4), u + Math.cos(a) * 0.62, v + Math.sin(a) * 0.62, 1.55);
    }
    const cap = hipRoof({ ex: 0.95, ez: 0.95, y0: 2.3, tx: 0.08, tz: 0.08, y1: 2.85, lift: 0.22, curve: 1.6, edge: 0.1 }, 6);
    for (const g of cap.tiles) put(M.bronze, g, u, v);
    for (const g of cap.edge) put(M.black, g, u, v);
    put(M.bronze, blob(0.1, 1.4, 0), u, v, 2.9);
    circle(u, v, BURNER.r);
  }

  // ---------------------------------------------------------------- lanternas de pedra (tōrō)
  const lantern = (u: number, v: number) => {
    const r6 = Math.PI / 6;
    put(M.stone, cyl(0.42, 0.46, 0.28, 6), u, v, 0, r6);
    put(M.stone, cyl(0.14, 0.15, 0.86, 8), u, v, 0.28);
    put(M.stone, cyl(0.18, 0.18, 0.09, 8), u, v, 0.66);
    put(M.stone, cyl(0.4, 0.22, 0.2, 6), u, v, 1.14, r6);
    put(M.stone, cyl(0.27, 0.27, 0.42, 6), u, v, 1.34, r6);
    // janelas acesas nas faces da frente e de lado
    const fz = 0.27 * Math.cos(r6) + 0.012;
    kit.add(M.windowGlow, box(0.19, 0.22, 0.01), at(...P(u, v, 1.44)).multiply(at(0, 0, fz)));
    kit.add(M.windowGlow, box(0.19, 0.22, 0.01), at(...P(u, v, 1.44)).multiply(at(0, 0, 0, -Math.PI / 3)).multiply(at(0, 0, fz)));
    kit.add(M.windowGlow, box(0.19, 0.22, 0.01), at(...P(u, v, 1.44)).multiply(at(0, 0, 0, Math.PI / 3)).multiply(at(0, 0, fz)));
    put(M.stone, cyl(0.1, 0.56, 0.32, 6), u, v, 1.76, r6);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      put(M.stone, blob(0.06, 1.3, 0), u + Math.sin(a) * 0.54, v - Math.cos(a) * 0.54, 1.8);
    }
    put(M.stone, cyl(0.08, 0.1, 0.1, 6), u, v, 2.08);
    put(M.stone, blob(0.1, 1.5, 0), u, v, 2.24);
  };
  for (const l of LANTERNS) { lantern(l.u, l.v); circle(l.u, l.v, l.r); }

  // ---------------------------------------------------------------- torii
  {
    const v = TORII.v, pu = TORII.pillarU;
    for (const s of [-1, 1]) {
      kit.add(M.lacquer, cyl(0.29, 0.34, 5.2, 10), atRot(...P(s * pu, v), 0, 0, s * 0.03));
      put(M.black, cyl(0.39, 0.39, 0.4, 10), s * pu, v);
      circle(s * pu, v, TORII.r);
    }
    put(M.lacquer, box(8.4, 0.36, 0.3), 0, v, 4.0);
    put(M.lacquer, box(0.34, 0.86, 0.28), 0, v, 4.36);
    put(M.black, box(0.72, 0.98, 0.1), 0, v - 0.2, 4.3);
    put(M.paper, box(0.5, 0.74, 0.02), 0, v - 0.26, 4.42);
    put(M.lacquer, box(9.6, 0.3, 0.46), 0, v, 5.2);
    // kasagi: viga preta de cima com as pontas levantadas
    put(M.black, box(5.2, 0.42, 0.56), 0, v, 5.5);
    for (const s of [-1, 1]) {
      kit.add(M.black, box(2.1, 0.42, 0.56), atRot(...P(s * 3.55, v, 5.55), 0, 0, s * 0.09));
      kit.add(M.black, box(1.3, 0.42, 0.56), atRot(...P(s * 5.1, v, 5.75), 0, 0, s * 0.2));
    }
  }

  // ---------------------------------------------------------------- pia de purificação (chōzuya)
  {
    const { u, v } = CHOZUYA;
    put(M.stone, box(2.0, 0.8, 1.0), u, v);
    put(M.water, box(1.76, 0.02, 0.76), u, v, 0.76);
    for (let k = 0; k < 3; k++) kit.add(M.bamboo, cyl(0.03, 0.03, 0.7, 5), atRot(...P(u - 0.5 + k * 0.45, v - 0.05, 0.83), Math.PI / 2, 0, 0));
    kit.add(M.bamboo, cyl(0.05, 0.05, 0.9, 5), atRot(...P(u + 0.3, v + 0.7, 1.05), 0.9, 0, 0));
    for (const su of [-1, 1]) for (const sv of [-1, 1]) put(M.wood, cyl(0.11, 0.12, 2.6, 6), u + su * CHOZUYA.posts.hw, v + sv * CHOZUYA.posts.hd);
    for (const sv of [-1, 1]) put(M.wood, box(3.1, 0.18, 0.18), u, v + sv * CHOZUYA.posts.hd, 2.45);
    const r = gableRoof({ ex: 1.95, ez: 1.5, y0: 2.55, y1: 3.45, curve: 1.3, lift: 0.12, edge: 0.18 }, 6);
    for (const g of r.tiles) put(M.tiles, g, u, v);
    for (const g of r.gable) put(M.woodLight, g, u, v);
    for (const g of r.boards) put(M.black, g, u, v);
    put(M.black, r.ridge, u, v);
    rect({ u0: u - 1.55, v0: v - 1.05, u1: u + 1.55, v1: v + 1.05 });
  }

  // ---------------------------------------------------------------- torre do sino (shōrō)
  {
    const { u, v, half } = BELL;
    put(M.stoneBlocks, box(half * 2, 0.7, half * 2), u, v);
    for (const su of [-1, 1]) for (const sv of [-1, 1]) kit.add(M.wood, cyl(0.17, 0.2, 4.45, 8), atRot(...P(u + su * 1.8, v + sv * 1.8, 0.7), -sv * 0.02, 0, -su * 0.02));
    for (const y of [3.2, 4.9]) {
      for (const sv of [-1, 1]) put(M.wood, box(4.1, 0.2, 0.2), u, v + sv * 1.78, y);
      for (const su of [-1, 1]) put(M.wood, box(0.2, 0.2, 4.1), u + su * 1.78, v, y);
    }
    put(M.bronze, lathe([[0.04, 0], [0.74, 0], [0.76, 0.1], [0.66, 0.45], [0.62, 1.2], [0.5, 1.55], [0.2, 1.7], [0.05, 1.78]], 12), u, v, 2.55);
    put(M.bronze, box(0.2, 0.3, 0.12), u, v, 4.33);
    put(M.wood, box(0.1, 0.35, 0.1), u, v, 4.62);
    kit.add(M.woodLight, cyl(0.14, 0.14, 2.0, 7), atRot(...P(u + 1.5, v, 3.1), 0, 0, Math.PI / 2));
    for (const du of [0.95, 2.0]) put(M.straw, cyl(0.02, 0.02, 1.8, 4), u + du, v, 3.1);
    const lower = hipRoof({ ex: 3.35, ez: 3.35, y0: 5.25, tx: 2.3, tz: 1.3, y1: 6.45, lift: 0.5, curve: 1.6, edge: 0.26 }, 8);
    for (const g of lower.tiles) put(M.tiles, g, u, v);
    for (const g of lower.edge) put(M.black, g, u, v);
    kit.add(M.tiles, poly([[-2.3, 6.45, 1.3], [2.3, 6.45, 1.3], [2.3, 6.45, -1.3], [-2.3, 6.45, -1.3]]), at(...P(u, v)));
    const upper = gableRoof({ ex: 2.05, ez: 1.6, y0: 6.35, y1: 7.7, curve: 1.3, lift: 0.12, edge: 0.24 }, 6);
    for (const g of upper.tiles) put(M.tiles, g, u, v);
    for (const g of upper.gable) put(M.woodLight, g, u, v);
    for (const g of upper.boards) put(M.black, g, u, v);
    put(M.black, upper.ridge, u, v);
    rect({ u0: u - half - 0.1, v0: v - half - 0.1, u1: u + half + 0.1, v1: 31 });
  }

  // ---------------------------------------------------------------- pagode de cinco andares
  {
    const { u, v, half } = PAGODA;
    put(M.stoneBlocks, box(half * 2, 0.8, half * 2), u, v);
    let y = 0.8;
    const halves = [2.1, 1.88, 1.66, 1.44, 1.22];
    for (let i = 0; i < 5; i++) {
      const b = halves[i], h = i === 0 ? 2.2 : 1.5;
      put(M.plaster, box(b * 2, h, b * 2), u, v, y);
      for (const su of [-1, 1]) for (const sv of [-1, 1]) put(M.wood, box(0.2, h, 0.2), u + su * (b - 0.02), v + sv * (b - 0.02), y);
      put(M.wood, box(b * 2 + 0.2, 0.22, b * 2 + 0.2), u, v, y + h - 0.22);
      put(M.wood, box(b * 1.1, h * (i === 0 ? 0.7 : 0.55), 0.06), u, v - b - 0.02, y + 0.12);
      for (let k = -2; k <= 2; k++) put(M.wood, box(0.24, 0.26, 0.45), u + k * b * 0.42, v - b - 0.12, y + h);
      const y0 = y + h + 0.32, top = i < 4 ? y0 + 0.75 : y0 + 0.95;
      const next = i < 4 ? halves[i + 1] * 0.92 : 0.18;
      const r = hipRoof({ ex: b + 1.45, ez: b + 1.45, y0, tx: next, tz: next, y1: top, lift: 0.55, curve: 1.8, edge: 0.3 }, 8);
      for (const g of r.tiles) put(M.tiles, g, u, v);
      for (const g of r.edge) put(M.black, g, u, v);
      if (i < 4) kit.add(M.tiles, poly([[-next, top, next], [next, top, next], [next, top, -next], [-next, top, -next]]), at(...P(u, v)));
      y = top;
    }
    // sōrin: mastro com nove anéis e a chama
    put(M.bronze, cyl(0.09, 0.12, 4.4, 6), u, v, y);
    for (let k = 0; k < 9; k++) put(M.bronze, cyl(0.3 - k * 0.012, 0.3 - k * 0.012, 0.07, 8), u, v, y + 0.9 + k * 0.28);
    put(M.bronze, blob(0.2, 1.6, 0), u, v, y + 4.5);
    rect({ u0: u - half - 0.1, v0: v - half - 0.1, u1: u + half + 0.1, v1: 36 });
  }

  // ---------------------------------------------------------------- cedro sagrado (shinboku) com a corda
  // cedro (sugi): tronco reto e camadas cônicas encavaladas, finas no alto
  const cedar = (u: number, v: number, h: number, r: number, trunkR: number) => {
    put(M.bark, cyl(trunkR * 0.6, trunkR, h * 0.9, 8), u, v);
    const tiers = 8;
    let y = h * 0.22;
    for (let k = 0; k < tiers; k++) {
      const t = k / (tiers - 1);
      const rr = r * (1 - t * 0.78), hh = rr * 1.7;
      put(M.foliage, cyl(0, rr, hh, 9), u + rng.range(-0.12, 0.12), v + rng.range(-0.12, 0.12), y, rng.range(0, 1));
      y += hh * 0.42;
    }
    put(M.foliage, cyl(0, r * 0.18, r * 0.9, 7), u, v, y);
  };
  {
    const { u, v } = SHINBOKU;
    cedar(u, v, 15, 3.8, 1.0);
    kit.add(M.straw, new THREE.TorusGeometry(1.02, 0.16, 5, 14), atRot(...P(u, v, 2.3), Math.PI / 2, 0, 0));
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k - 2) * 0.5;
      const pu = u + Math.cos(a) * 1.08, pv = v + Math.sin(a) * 1.08;
      for (let j = 0; j < 3; j++) put(M.paper, box(0.1, 0.16, 0.02), pu + (j % 2) * 0.05, pv, 2.05 - j * 0.16, -a);
    }
    // cerquinha em volta (tamagaki)
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      put(M.woodLight, box(0.1, 0.8, 0.1), u + Math.cos(a) * 1.9, v + Math.sin(a) * 1.9);
      const b = a + Math.PI / 10;
      put(M.woodLight, box(1.2, 0.07, 0.07), u + Math.cos(b) * 1.86, v + Math.sin(b) * 1.86, 0.62, b + Math.PI / 2);
    }
    circle(u, v, 2.05);
  }

  // ---------------------------------------------------------------- cerejeira
  {
    const { u, v } = SAKURA;
    kit.add(M.bark, cyl(0.2, 0.28, 1.5, 7), atRot(...P(u, v), 0.08, 0, 0.1));
    kit.add(M.bark, cyl(0.15, 0.2, 1.4, 7), atRot(...P(u + 0.15, v, 1.4), -0.1, 0, -0.18));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.4;
      kit.add(M.bark, cyl(0.05, 0.1, 1.9, 5), atRot(...P(u + 0.1, v, 2.3), Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9));
    }
    for (let k = 0; k < 11; k++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(0.4, 2.6);
      put(M.blossom, blob(rng.range(1.0, 1.5), 0.72, 1, 0.12, rng), u + Math.cos(a) * d, v + Math.sin(a) * d * 0.8, rng.range(3.0, 4.6));
    }
    circle(u, v, SAKURA.r);
  }

  // ---------------------------------------------------------------- poço
  {
    const { u, v } = WELL;
    put(M.stone, cyl(0.86, 0.9, 0.75, 10, true), u, v);
    put(M.stone, cyl(0.7, 0.72, 0.75, 10, true), u, v);
    put(M.stone, cyl(0.86, 0.86, 0.04, 10), u, v, 0.73);
    put(M.water, cyl(0.7, 0.7, 0.02, 10), u, v, 0.45);
    for (const s of [-1, 1]) put(M.wood, box(0.13, 2.5, 0.13), u + s * 1.02, v);
    put(M.wood, box(2.3, 0.14, 0.14), u, v, 2.34);
    kit.add(M.woodLight, cyl(0.16, 0.16, 0.08, 10), atRot(...P(u, v, 2.14), 0, 0, Math.PI / 2));
    put(M.straw, cyl(0.015, 0.015, 1.5, 3), u, v, 0.65);
    put(M.woodLight, cyl(0.2, 0.17, 0.32, 8), u + 0.55, v - 0.55, 0.77);
    const r = gableRoof({ ex: 1.3, ez: 0.72, y0: 2.45, y1: 2.95, curve: 1.2, edge: 0.12 }, 5);
    for (const g of r.tiles) put(M.woodLight, g, u, v);
    for (const g of r.gable) put(M.woodLight, g, u, v);
    for (const g of r.boards) put(M.black, g, u, v);
    circle(u, v, WELL.r);
  }

  // ---------------------------------------------------------------- jardim de pedrisco: pedras e cerca de bambu
  for (const rk of GARDEN_ROCKS) {
    put(M.stoneDark, blob(rk.r, rng.range(0.55, 0.75), 1, 0.22, rng), rk.u, rk.v, rk.r * 0.08, rng.range(0, 3));
    circle(rk.u, rk.v, rk.r);
  }
  for (const f of GARDEN_FENCE) {
    const u = (f.u0 + f.u1) / 2, len = f.v1 - f.v0;
    for (let v = f.v0; v <= f.v1 + 1e-6; v += len / Math.max(1, Math.round(len / 1.7))) put(M.bamboo, cyl(0.045, 0.045, 0.98, 5), u, v);
    for (const y of [0.34, 0.7]) kit.add(M.bamboo, cyl(0.03, 0.03, len, 5), atRot(...P(u, f.v0, y), -Math.PI / 2, 0, 0));
    for (let v = f.v0 + 0.15; v < f.v1; v += 0.34) put(M.bamboo, box(0.035, 0.86, 0.035), u + 0.05, v);
    rect(f);
  }

  // ---------------------------------------------------------------- restos da batalha: escudos e carro de bois
  const arrows: [number, number, number, number, number, number][] = []; // base xyz, ponta xyz (locais)
  const arrowAt = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => arrows.push([x, y, z, x + dx, y + dy, z + dz]);
  for (let k = 0; k < SHIELDS.n; k++) {
    const u = SHIELDS.u - 0.9 + k * 0.45, v = SHIELDS.v - 2 + k * 1.05, ry = 0.9;
    kit.add(M.woodLight, box(0.95, 1.8, 0.08), at(...P(u, v)).multiply(atRot(0, 0, 0, -0.16, ry, 0)));
    kit.add(M.black, box(0.95, 0.08, 0.1), at(...P(u, v, 1.35)).multiply(at(0, 0, 0, ry)));
    kit.add(M.wood, cyl(0.03, 0.03, 1.7, 4), at(...P(u + 0.35, v + 0.3)).multiply(atRot(0, 0, 0, 0.5, ry, 0)));
    // flechas cravadas no escudo, apontando para quem atirou (lado da câmera)
    for (let a = 0; a < 3; a++) {
      const [x, , z] = P(u + rng.range(-0.3, 0.3), v + rng.range(-0.25, 0.25));
      arrowAt(x, rng.range(0.6, 1.6), z, rng.range(-0.1, 0.25), rng.range(-0.1, 0.05), rng.range(0.45, 0.6));
    }
    const w = toWorld(u, v);
    boxes.push({ x: w.x, z: w.z, hw: 0.5, hd: 0.12, rot: LAYOUT_ROT + ry });
  }
  {
    const { u, v } = CART;
    kit.add(M.woodLight, box(2.7, 0.12, 1.35), at(...P(u, v, 0.35)).multiply(atRot(0, 0, 0, 0, 0.3, 0.24)));
    kit.add(M.woodLight, box(2.6, 0.35, 0.08), at(...P(u, v - 0.6, 0.4)).multiply(atRot(0, 0, 0, 0, 0.3, 0.24)));
    kit.add(M.wood, cyl(0.72, 0.72, 0.12, 12), atRot(...P(u + 0.5, v + 0.85, 0.72), Math.PI / 2, 0.3, 0));
    kit.add(M.wood, cyl(0.72, 0.72, 0.12, 12), at(...P(u - 1.9, v - 1.3, 0.06)));
    for (const s of [-1, 1]) kit.add(M.wood, box(3.0, 0.08, 0.08), at(...P(u + 2.3, v + s * 0.5, 0.05), 0.3 + s * 0.1));
    for (let k = 0; k < 3; k++) put(M.straw, box(0.8, 0.45, 0.5), u - 1.2 + k * 0.9, v + 1.4 + (k % 2) * 0.4, 0, rng.range(0, 1));
    put(M.woodLight, cyl(0.32, 0.28, 0.7, 9, true), u + 1.8, v - 1.2);
    rect({ u0: u - 1.6, v0: v - 1.1, u1: u + 1.6, v1: v + 1.2 });
  }
  // flechas espalhadas pelo chão de terra e de pedrisco (fora das lajes)
  for (let k = 0; k < 150; k++) {
    const u = rng.range(-30, 30), v = rng.range(-33, 16);
    if (Math.hypot(u, v) > 34.5 || (u > -14.4 && u < 14.4 && v > -2.4 && v < 16.8) || Math.abs(u) < 2.2) continue;
    const [x, , z] = P(u, v);
    const tilt = rng.range(0.15, 0.55), a = rng.range(-0.8, 0.8) + Math.PI * 0.75;
    const l = rng.range(0.55, 0.8);
    arrowAt(x, 0, z, Math.sin(tilt) * Math.cos(a) * l, Math.cos(tilt) * l, Math.sin(tilt) * Math.sin(a) * l);
  }
  // lanças cravadas perto dos escudos e do torii
  const spears: [number, number, number, number, number, number][] = [];
  for (let k = 0; k < 7; k++) {
    const u = k < 4 ? SHIELDS.u + rng.range(-2.5, 1.5) : rng.range(-7, 7), v = k < 4 ? SHIELDS.v + rng.range(-4, 4) : TORII.v + rng.range(1, 5);
    if (Math.abs(u) < 2.4) continue;
    const [x, , z] = P(u, v);
    spears.push([x, 0, z, x + rng.range(-0.5, 0.5), rng.range(1.9, 2.3), z + rng.range(-0.3, 0.6)]);
  }
  {
    const pos: number[] = [], col: number[] = [];
    const seg = (a: readonly number[], b: readonly number[], c: number) => { pos.push(...a, ...b); col.push(c, c, c, c, c, c); };
    for (const [x0, y0, z0, x1, y1, z1] of arrows) {
      seg([x0, y0, z0], [x1, y1, z1], 0.2);
      // penas: dois riscos claros perto da ponta de trás
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, l = Math.hypot(dx, dy, dz);
      const bx = x1 - (dx / l) * 0.12, by = y1 - (dy / l) * 0.12, bz = z1 - (dz / l) * 0.12;
      seg([x1, y1, z1], [bx + 0.05, by, bz], 0.72);
      seg([x1, y1, z1], [bx - 0.05, by, bz], 0.72);
    }
    for (const [x0, y0, z0, x1, y1, z1] of spears) {
      seg([x0, y0, z0], [x1, y1, z1], 0.25);
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, l = Math.hypot(dx, dy, dz);
      seg([x1, y1, z1], [x1 + (dx / l) * 0.28, y1 + (dy / l) * 0.28, z1 + (dz / l) * 0.28], 0.85);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
    lines.frustumCulled = false;
    site.add(lines);
  }

  // ---------------------------------------------------------------- muro do recinto (metade de baixo) com a abertura do torii
  {
    const R = WALL.radius, n = 44;
    for (let k = 0; k < n; k++) {
      const a0 = (WALL.from + ((WALL.to - WALL.from) * k) / n) * (Math.PI / 180);
      const a1 = (WALL.from + ((WALL.to - WALL.from) * (k + 1)) / n) * (Math.PI / 180);
      const am = (a0 + a1) / 2;
      const u = Math.cos(am) * R, v = Math.sin(am) * R;
      if (Math.abs(u) < WALL.gap) continue;
      const len = R * (a1 - a0) + 0.08;
      // eixo x da peça ao longo da tangente do arco (no grupo: x = u, z = -v)
      const ry = Math.atan2(Math.cos(am), -Math.sin(am));
      const m = at(...P(u, v), ry);
      kit.add(M.stoneBlocks, box(len, 0.35, 0.85), m);
      kit.add(M.wall, box(len, 2.15, 0.7), m);
      const r = gableRoof({ ex: len / 2 + 0.02, ez: 0.62, y0: 2.1, y1: 2.5, curve: 1.2, edge: 0.1 }, 2);
      for (const g of r.tiles) kit.add(M.tiles, g, m);
      kit.add(M.black, r.ridge, m);
    }
    // pilares do portão na abertura
    for (const s of [-1, 1]) {
      const u = s * WALL.gap, v = -Math.sqrt(R * R - WALL.gap * WALL.gap);
      put(M.wood, box(0.45, 2.7, 0.45), u, v);
    }
  }

  // ---------------------------------------------------------------- borda: cedros no alto, bambuzal dos lados
  for (let k = 0; k < 36; k++) {
    const a = (15 + (150 * k) / 35 + rng.range(-2, 2)) * (Math.PI / 180);
    const r = rng.range(37.5, 45);
    cedar(Math.cos(a) * r, Math.sin(a) * r, rng.range(11, 16), rng.range(2.6, 3.6), rng.range(0.35, 0.5));
  }
  // bambuzal: colmos finos e folhas em riscos (1 px) saindo dos nós de cima
  const leaves: number[] = [];
  for (let k = 0; k < 260; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const a = (side > 0 ? rng.range(-22, 17) : rng.range(163, 202)) * (Math.PI / 180);
    const r = rng.range(36.9, 41);
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    const h = rng.range(5.5, 9), lx = rng.range(-0.05, 0.05), lz = rng.range(-0.06, 0.06);
    kit.add(M.bamboo, box(0.075, h, 0.075), atRot(...P(u, v), lx, 0, lz));
    const [x, , z] = P(u, v);
    for (let n = 0; n < 7; n++) {
      const y = h * rng.range(0.45, 1), ang = rng.range(0, Math.PI * 2), l = rng.range(0.3, 0.55);
      // o colmo inclinado: o nó sai do eixo na mesma proporção
      const bx = x - lz * y, bz = z + lx * y;
      leaves.push(bx, y, bz, bx + Math.cos(ang) * l, y - l * rng.range(0.25, 0.6), bz + Math.sin(ang) * l);
    }
  }
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(leaves, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x505050 }));
    lines.frustumCulled = false;
    site.add(lines);
  }

  // ---------------------------------------------------------------- estandarte caído
  const bannerTex = bannerTexture(opts.seed);
  const clothMat = occluder(new THREE.MeshLambertMaterial({ map: bannerTex, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0x3a3a3a }));
  clothMat.shadowSide = THREE.DoubleSide;
  {
    const { u, v } = FALLEN_BANNER;
    const g = new THREE.PlaneGeometry(0.75, 3.3);
    g.rotateX(-Math.PI / 2);
    const m = at(...P(u, v, 0.03), 1.1);
    const mesh = new THREE.Mesh(g.applyMatrix4(m), clothMat);
    mesh.receiveShadow = true;
    site.add(mesh);
    kit.add(M.wood, cyl(0.05, 0.05, 2.6, 5), at(...P(u, v, 0.05)).multiply(atRot(0.9, 0, 0.3, Math.PI / 2, 1.1, 0)));
    kit.add(M.wood, cyl(0.05, 0.05, 1.6, 5), at(...P(u + 1.2, v - 1.9, 0.05)).multiply(atRot(0, 0, 0, Math.PI / 2, 0.4, 0)));
  }

  // ---------------------------------------------------------------- estandartes de pé (balançam ao vento)
  const swayUniforms = { uTime: { value: 0 } };
  {
    const pos: number[] = [], uv: number[] = [], sway: number[] = [], phase: number[] = [];
    const idx: number[] = [];
    const NX = 3, NY = 12;
    for (const [bi, b] of BANNERS.entries()) {
      const top = 5.0, bottom = 1.7;
      // pano girado em relação à câmera: o balanço (ao longo da normal) aparece de lado na tela
      const phi = bi % 2 === 0 ? 0.65 : Math.PI - 0.65;
      const du = Math.cos(phi), dv = Math.sin(phi);
      // mastro e travessa
      put(M.wood, cyl(0.05, 0.065, 5.3, 6), b.u, b.v);
      put(M.wood, box(0.85, 0.05, 0.05), b.u + du * 0.4, b.v + dv * 0.4, top + 0.02, phi);
      circle(b.u, b.v, 0.2);
      const base = pos.length / 3;
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
        const s = i / NX, t = j / NY;
        const [x, , z] = P(b.u + du * (0.06 + s * 0.75), b.v + dv * (0.06 + s * 0.75));
        pos.push(x, bottom + (top - bottom) * t, z);
        uv.push(s, t);
        // preso no mastro (s = 0) e na travessa (t = 1): balança mais na ponta solta de baixo
        sway.push(Math.min(1, s * 0.7 + (1 - t) * 0.8) * (0.6 + s * 0.4));
        phase.push(bi * 1.7 + t * 1.9 + s * 0.8);
      }
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const a = base + j * (NX + 1) + i, c = a + NX + 1;
        idx.push(a, a + 1, c + 1, a, c + 1, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = clothMat.clone();
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = swayUniforms.uTime;
      sh.vertexShader = SWAY_VERT + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float w = sin(uTime * 2.3 + aPhase) * 0.6 + sin(uTime * 3.7 + aPhase * 1.3) * 0.3;
        transformed += objectNormal * w * 0.22 * aSway;
        transformed.y += -abs(w) * 0.05 * aSway;`);
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    site.add(mesh);
  }

  kit.build(site);

  // ---------------------------------------------------------------- fumaça do incensário e pétalas (pontos pixelados)
  const makePoints = (n: number, color: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aAlpha; varying float vAlpha;
        void main() { vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vAlpha;
        float b2(vec2 i) { return 2.0 * i.x * (1.0 - i.y) + 3.0 * (1.0 - i.x) * i.y + i.x * i.y; }
        float bayer4(vec2 p) { vec2 i = mod(floor(p), 4.0); return (4.0 * b2(mod(i, 2.0)) + b2(floor(i / 2.0)) + 0.5) / 16.0; }
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          // transparência por pontilhado (pixel art), mais rala na borda do floco
          if (vAlpha * (1.0 - d * 2.4) < bayer4(gl_FragCoord.xy)) discard;
          gl_FragColor = vec4(uColor, 1.0);
        }`,
      depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    site.add(pts);
    return g;
  };
  const SMOKE = 36, PETALS = 34;
  const smokeGeo = makePoints(SMOKE, 0xcfcfcf);
  const petalGeo = makePoints(PETALS, 0xececec);
  const smoke = Array.from({ length: SMOKE }, (_, i) => ({ t: i / SMOKE, seed: rng.range(0, 10) }));
  const petals = Array.from({ length: PETALS }, () => ({ t: rng.next(), a: rng.range(0, Math.PI * 2), d: rng.range(0.3, 3), s: rng.range(0, 10) }));
  const SMOKE_LIFE = 4.2, PETAL_LIFE = 6;
  const lampBase = new THREE.Color(0xdcdcdc), winBase = new THREE.Color(0xc8c8c8);

  const update = (dt: number, time: number, _focus: Vec2) => {
    swayUniforms.uTime.value = time;
    // fumaça: sobe, abre e vai com o vento para a esquerda da tela
    const sp = smokeGeo.getAttribute('position') as THREE.BufferAttribute;
    const ss = smokeGeo.getAttribute('aSize') as THREE.BufferAttribute, sa = smokeGeo.getAttribute('aAlpha') as THREE.BufferAttribute;
    for (let i = 0; i < SMOKE; i++) {
      const p = smoke[i];
      p.t += dt / SMOKE_LIFE;
      if (p.t >= 1) { p.t -= 1; p.seed = rng.range(0, 10); }
      const k = p.t;
      const [x, , z] = P(BURNER.u - k * 1.6 + Math.sin(time * 0.9 + p.seed) * 0.25 * k, BURNER.v + k * 0.4);
      sp.setXYZ(i, x, 1.6 + k * 3.4, z);
      ss.setX(i, 3 + k * 12);
      sa.setX(i, Math.min(1, k * 5) * (1 - k) * 0.7);
    }
    sp.needsUpdate = ss.needsUpdate = sa.needsUpdate = true;
    // pétalas: caem da copa girando e pousam
    const pp = petalGeo.getAttribute('position') as THREE.BufferAttribute;
    const ps = petalGeo.getAttribute('aSize') as THREE.BufferAttribute, pa = petalGeo.getAttribute('aAlpha') as THREE.BufferAttribute;
    for (let i = 0; i < PETALS; i++) {
      const p = petals[i];
      p.t += dt / PETAL_LIFE;
      if (p.t >= 1) { p.t -= 1; p.a = rng.range(0, Math.PI * 2); p.d = rng.range(0.3, 3); }
      const k = p.t;
      const [x, , z] = P(SAKURA.u + Math.cos(p.a) * p.d - k * 2.2 + Math.sin(time * 2 + p.s) * 0.3, SAKURA.v + Math.sin(p.a) * p.d * 0.8);
      pp.setXYZ(i, x, Math.max(0.02, 4.2 * (1 - k)), z);
      ps.setX(i, 2);
      pa.setX(i, k > 0.96 ? 0 : 1);
    }
    pp.needsUpdate = ps.needsUpdate = pa.needsUpdate = true;
    // chama das lanternas tremulando
    const f = 0.94 + Math.sin(time * 11.3) * 0.03 + Math.sin(time * 17.9 + 1.3) * 0.03;
    M.lampGlow.color.copy(lampBase).multiplyScalar(f);
    M.windowGlow.color.copy(winBase).multiplyScalar(0.96 + (f - 0.94) * 0.8);
  };

  const s = toWorld(START.u, START.v);
  return {
    colliders, boxes, start: { x: s.x, z: s.z }, shadows: true, update,
    // sol da frente-esquerda (ilumina as fachadas voltadas para a câmera), fraco: tarde de chuva, sombras suaves
    sun: new THREE.Vector3(-0.07, 1.2, 0.78).normalize(),
    light: { sun: 0.7, sky: 1.9, skyColor: 0xe6e6e6, groundColor: 0x6a6a6a },
  };
};
