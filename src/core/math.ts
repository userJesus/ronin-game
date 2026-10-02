// Vetores 2D no plano do chão (x, z) e utilitários numéricos puros.

export interface Vec2 { x: number; z: number }

export const v2 = (x = 0, z = 0): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const len = (a: Vec2): number => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export function norm(a: Vec2, fallback: Vec2 = { x: 0, z: 1 }): Vec2 {
  const l = Math.hypot(a.x, a.z);
  return l > 1e-6 ? { x: a.x / l, z: a.z / l } : { x: fallback.x, z: fallback.z };
}

export const fromAngle = (a: number): Vec2 => ({ x: Math.cos(a), z: Math.sin(a) });
export const angleOf = (a: Vec2): number => Math.atan2(a.z, a.x);

/** Diferença angular com sinal em (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Ângulo (rad) entre dois vetores unitários. */
export const angleBetween = (a: Vec2, b: Vec2): number => Math.acos(clamp(dot(a, b), -1, 1));

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Aproximação exponencial independente de framerate. */
export const damp = (a: number, b: number, rate: number, dt: number): number => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Distância de p ao segmento ab. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const t = l2 > 0 ? clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / l2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

/** PRNG determinístico (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  sign(): number { return this.next() < 0.5 ? -1 : 1; }
}
