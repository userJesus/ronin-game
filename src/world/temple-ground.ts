// Chão do templo pintado na grade da tela: 32 texels por metro na horizontal (u) e 16 na profundidade (v).
// Com a câmera presa a texels e o buffer de dimensões pares, cada texel cai num pixel da baixa resolução:
// as juntas das lajes ficam linhas nítidas de 1 px, sem cintilar quando a câmera anda.
import * as THREE from 'three';
import { Rng } from '../core/math';
import { grayTexture, tileNoise } from './noise';
import {
  BELL, BURNER, CHOZUYA, GARDEN, GARDEN_ROCKS, GRAVEL, HALL, KOMAINU, LANTERNS, PAGODA, PLAZA, SAKURA, SANDO, SHINBOKU,
  TORII, WELL, type Rect,
} from './temple-layout';

/** Meia-medida do chão pintado (m); além disso, um chão liso de lama. */
export const GROUND_HALF = 42;
const PU = 32, PV = 16;
export const GROUND_W = GROUND_HALF * 2 * PU;
export const GROUND_H = GROUND_HALF * 2 * PV;

export function paintTempleGround(seed: number): THREE.DataTexture {
  const W = GROUND_W, H = GROUND_H;
  const rng = new Rng(seed ^ 0x2c1b3a);
  const lum = new Float32Array(W * H);
  const U = (px: number) => -GROUND_HALF + (px + 0.5) / PU;
  const V = (py: number) => -GROUND_HALF + (py + 0.5) / PV;
  const PX = (u: number) => Math.floor((u + GROUND_HALF) * PU);
  const PY = (v: number) => Math.floor((v + GROUND_HALF) * PV);
  const macro = tileNoise(rng, 6), mid = tileNoise(rng, 24), fine = tileNoise(rng, 96), wet = tileNoise(rng, 40), wet2 = tileNoise(rng, 90);
  const S = 1 / (GROUND_HALF * 2);

  // ---- base: lama/terra, pedrisco claro no pátio, jardim rastelado
  for (let py = 0; py < H; py++) {
    const v = V(py);
    for (let px = 0; px < W; px++) {
      const u = U(px);
      const nu = (u + GROUND_HALF) * S, nv = (v + GROUND_HALF) * S;
      const m = macro(nu, nv), md = mid(nu, nv), f = fine(nu, nv);
      const r = Math.hypot(u, v);
      // borda do pedrisco irregular (ruído) e lama perto do limite da arena
      const edge = Math.min(u - GRAVEL.u0, GRAVEL.u1 - u, v - GRAVEL.v0, GRAVEL.v1 - v, 35.4 - r) + m * 1.4 + md * 0.5;
      const h = (px * 73856093) ^ (py * 19349663) ^ seed;
      const k = ((h >>> 0) % 1000) / 1000;
      // faixa de transição pontilhada entre pedrisco e terra (sem borda dura)
      const gravel = edge > 0.3 || (edge > -0.3 && k < (edge + 0.3) / 0.6);
      let g: number;
      if (gravel) {
        g = 174 + md * 5 + f * 4;
        if (k < 0.07) g -= 22; else if (k < 0.12) g += 18;
      } else {
        g = 148 + m * 6 + md * 4 + f * 3;
        // musgo e capim
        if (m + md * 0.6 > 0.35) { g = 132 + f * 4; if (((px * 7 + py * 13) % 23) === 0) g = 116; }
      }
      // poças pequenas: fundo um pouco mais escuro e borda clara (reflexo do céu)
      const w = wet(nu, nv) * 0.7 + wet2(nu, nv) * 0.45;
      if (w < -0.72) g = (gravel ? 156 : 132) + f * 2; else if (w < -0.69) g = gravel ? 186 : 156;
      lum[py * W + px] = g;
    }
  }

  // ---- jardim de pedrisco rastelado: linhas retas e anéis em volta das pedras
  for (let py = PY(GARDEN.v0); py <= PY(GARDEN.v1); py++) {
    const v = V(py);
    for (let px = PX(GARDEN.u0); px <= PX(GARDEN.u1); px++) {
      const u = U(px);
      if (Math.hypot(u, v) > 35.2) continue;
      let ring = -1, near = Infinity;
      for (const rk of GARDEN_ROCKS) {
        const d = Math.hypot(u - rk.u, v - rk.v) - rk.r;
        if (d < near) { near = d; ring = d; }
      }
      let phase: number;
      if (ring >= 0 && ring < 1.7) phase = ring / 0.34; // anéis de 0,34 m
      else phase = (v - GARDEN.v0) / 0.34 + Math.sin(u * 0.35) * 0.3;
      const fr = phase - Math.floor(phase);
      let g = 194;
      if (fr < 0.18) g = 166; else if (fr < 0.36) g = 208;
      const i = py * W + px;
      if (((px * 31 + py * 17) % 29) === 0) g -= 16;
      lum[i] = g;
    }
  }
  // meio-fio do jardim: pedrinhas escuras
  const curb = (u0: number, v0: number, u1: number, v1: number) => {
    for (let py = PY(v0); py <= PY(v1); py++) for (let px = PX(u0); px <= PX(u1); px++) {
      if (Math.hypot(U(px), V(py)) > 35.2) continue;
      lum[py * W + px] = ((px >> 1) + (py >> 1)) % 2 === 0 ? 104 : 124;
    }
  };
  curb(GARDEN.u0, GARDEN.v1, GARDEN.u1, GARDEN.v1 + 0.18);
  curb(GARDEN.u0, GARDEN.v0 - 0.18, GARDEN.u1, GARDEN.v0);

  // ---- lajes de pedra: pátio e caminho do santuário (sandō)
  const slab = (u0: number, v0: number, u1: number, v1: number, tone: number) => {
    const x0 = PX(u0), x1 = PX(u1) - 1, y0 = PY(v0), y1 = PY(v1) - 1;
    const crack = rng.next() < 0.18;
    const cx = rng.int(x0, Math.max(x0, x1)), slope = rng.range(-1.5, 1.5);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const nu = (U(px) + GROUND_HALF) * S, nv = (V(py) + GROUND_HALF) * S;
      let g = tone + fine(nu, nv) * 5 + mid(nu, nv) * 3;
      // borda de cima da laje clara (luz)
      if (py === y1) g += 8;
      if (px === x0 || py === y0) g = 124; // junta
      if (crack && Math.abs(px - (cx + (py - y0) * slope)) < 0.6) g = 130;
      lum[py * W + px] = g;
    }
    // poça em cima da laje (pedra afundada)
    if (rng.next() < 0.1) {
      const pw = Math.max(2, Math.floor((x1 - x0) * rng.range(0.3, 0.6))), ph = Math.max(1, Math.floor((y1 - y0) * rng.range(0.3, 0.6)));
      const qx = rng.int(x0 + 2, Math.max(x0 + 2, x1 - pw - 1)), qy = rng.int(y0 + 2, Math.max(y0 + 2, y1 - ph - 1));
      for (let py = qy; py < qy + ph; py++) for (let px = qx; px < qx + pw; px++) lum[py * W + px] = py === qy + ph - 1 ? 196 : 140;
    }
  };
  // pátio: fiadas de 0,9-1,4 m, lajes de 1,1-2,2 m
  for (let v = PLAZA.v0; v < PLAZA.v1;) {
    const h = Math.min(rng.range(0.9, 1.4), PLAZA.v1 - v);
    for (let u = PLAZA.u0; u < PLAZA.u1;) {
      const w = Math.min(rng.range(1.1, 2.2), PLAZA.u1 - u);
      slab(u, v, u + w, v + h, 160 + rng.range(-6, 6));
      u += w;
    }
    v += h;
  }
  // sandō: lajes grandes em amarração, com meio-fio de pedrinhas
  let row = 0;
  for (let v = SANDO.v0; v < SANDO.v1; v += 0.9, row++) {
    const off = row % 2 === 0 ? 0 : 0.6;
    for (let u = SANDO.u0 - off; u < SANDO.u1; u += 1.2) {
      slab(Math.max(SANDO.u0, u), v, Math.min(SANDO.u1, u + 1.2), Math.min(SANDO.v1, v + 0.9), 156 + rng.range(-6, 6));
    }
  }
  curb(SANDO.u0 - 0.18, SANDO.v0, SANDO.u0, SANDO.v1);
  curb(SANDO.u1, SANDO.v0, SANDO.u1 + 0.18, SANDO.v1);
  // borda do pátio
  curb(PLAZA.u0 - 0.18, PLAZA.v0, PLAZA.u0, PLAZA.v1);
  curb(PLAZA.u1, PLAZA.v0, PLAZA.u1 + 0.18, PLAZA.v1);
  curb(PLAZA.u0 - 0.18, PLAZA.v0 - 0.18, -SANDO.u1 - 0.18, PLAZA.v0);
  curb(SANDO.u1 + 0.18, PLAZA.v0 - 0.18, PLAZA.u1 + 0.18, PLAZA.v0);
  // calha de pedras sob o beiral do salão (amaochi)
  curb(HALL.eave.u0, HALL.eave.v0 - 0.25, HALL.eave.u1, HALL.eave.v0 + 0.1);

  // ---- pedras de passo até a torre do sino e o pagode
  const stone = (u: number, v: number, r: number) => {
    for (let py = PY(v - r); py <= PY(v + r); py++) for (let px = PX(u - r * 1.1); px <= PX(u + r * 1.1); px++) {
      const du = (U(px) - u) / (r * 1.1), dv = (V(py) - v) / r, d = du * du + dv * dv;
      if (d > 1) continue;
      lum[py * W + px] = d > 0.7 ? 108 : dv > 0.3 ? 170 : 150;
    }
  };
  const path = (a: { u: number; v: number }, b: { u: number; v: number }, n: number) => {
    for (let k = 1; k < n; k++) {
      const t = k / n;
      stone(a.u + (b.u - a.u) * t + rng.range(-0.25, 0.25), a.v + (b.v - a.v) * t + rng.range(-0.15, 0.15), rng.range(0.32, 0.46));
    }
  };
  path({ u: PLAZA.u0, v: 13 }, { u: BELL.u + BELL.half, v: BELL.v - 1 }, 7);
  path({ u: PLAZA.u1, v: 13 }, { u: PAGODA.u - PAGODA.half, v: PAGODA.v - 2 }, 7);
  path({ u: CHOZUYA.u - 1.2, v: CHOZUYA.v + 0.2 }, { u: SANDO.u1 + 0.3, v: CHOZUYA.v + 1.5 }, 4);

  // ---- sombra de contato em volta das bases
  const ao = (r: Rect, d = 0.55, k = 0.28) => {
    for (let py = PY(r.v0 - d); py <= PY(r.v1 + d); py++) for (let px = PX(r.u0 - d); px <= PX(r.u1 + d); px++) {
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const u = U(px), v = V(py);
      const du = Math.max(r.u0 - u, 0, u - r.u1), dv = Math.max(r.v0 - v, 0, v - r.v1);
      const dd = Math.hypot(du, dv);
      if (dd > d || (du === 0 && dv === 0)) continue;
      lum[py * W + px] *= 1 - k * (1 - dd / d);
    }
  };
  const around = (u: number, v: number, r: number) => ao({ u0: u - r, v0: v - r, u1: u + r, v1: v + r }, 0.4, 0.25);
  ao(HALL.platform); ao(HALL.steps, 0.4, 0.2);
  ao({ u0: BELL.u - BELL.half, v0: BELL.v - BELL.half, u1: BELL.u + BELL.half, v1: BELL.v + BELL.half });
  ao({ u0: PAGODA.u - PAGODA.half, v0: PAGODA.v - PAGODA.half, u1: PAGODA.u + PAGODA.half, v1: PAGODA.v + PAGODA.half });
  ao({ u0: CHOZUYA.u - CHOZUYA.basin.hw, v0: CHOZUYA.v - CHOZUYA.basin.hd, u1: CHOZUYA.u + CHOZUYA.basin.hw, v1: CHOZUYA.v + CHOZUYA.basin.hd }, 0.4, 0.3);
  for (const l of LANTERNS) around(l.u, l.v, 0.36);
  for (const k of KOMAINU) around(k.u, k.v, 0.52);
  around(BURNER.u, BURNER.v, 0.8);
  around(WELL.u, WELL.v, 0.85);
  around(SHINBOKU.u, SHINBOKU.v, 0.9);
  for (const s of [-1, 1]) around(s * TORII.pillarU, TORII.v, 0.34);

  // ---- pétalas caídas sob a cerejeira
  for (let k = 0; k < 900; k++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 4.6;
    const px = PX(SAKURA.u + Math.cos(a) * d), py = PY(SAKURA.v + Math.sin(a) * d * 0.9);
    if (px >= 0 && py >= 0 && px < W && py < H) lum[py * W + px] = 222;
  }

  for (let i = 0; i < lum.length; i++) lum[i] = Math.round(lum[i] / 4) * 4;
  return grayTexture(lum, W, H);
}
