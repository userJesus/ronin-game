// Arte do HUD de pedra e tinta, gerada por código (determinística): lajes rachadas das barras, grão,
// máscara de giz, anéis desenhados à mão e o traço do marcador. Tudo vira texto SVG uma vez, na criação.
// Coordenadas: as barras são desenhadas numa largura de BAR_W unidades (≈ 1 px de CSS no tamanho padrão).

/** Largura das lajes (unidades do viewBox das barras). */
export const BAR_W = 400;
/** Altura da laje grossa (vida) e das finas (Ki, Fúria). */
export const SLAB_THICK = 24;
export const SLAB_THIN = 11;

/** PRNG pequeno e determinístico (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n2 = (v: number) => Math.round(v * 100) / 100;

/** Blocos [x0, x1] de uma laje: 4 pedras com vãos de ~4 unidades e larguras um pouco diferentes. */
function blocks(w: number, r: () => number, count = 4): [number, number][] {
  const gap = 4;
  const ws = Array.from({ length: count }, () => 1 + (r() - 0.5) * 0.12);
  const sum = ws.reduce((a, b) => a + b, 0);
  const free = w - gap * (count - 1);
  const out: [number, number][] = [];
  let x = 0;
  for (const k of ws) {
    const bw = (free * k) / sum;
    out.push([x, x + bw]);
    x += bw + gap;
  }
  return out;
}

/** Contorno lascado de uma pedra: topo e base serrilhados, lados com pequenos desvios, cantos chanfrados. */
function stone(x0: number, x1: number, h: number, r: () => number): string {
  const j = Math.max(0.6, h * 0.06);
  const pts: [number, number][] = [];
  pts.push([x0 + 3, 1 + r() * j * 0.5]);
  for (let x = x0 + 6; x < x1 - 5; x += 6) pts.push([x, r() * j]);
  pts.push([x1 - 2, 1 + r() * j * 0.5]);
  pts.push([x1, h * 0.12 + r() * j]);
  pts.push([x1 - r() * 1.2, h * 0.45]);
  pts.push([x1 - r() * 1.5, h * 0.72]);
  pts.push([x1 - 0.5, h - 2]);
  pts.push([x1 - 3, h]);
  for (let x = x1 - 7; x > x0 + 5; x -= 6) pts.push([x, h - r() * j]);
  pts.push([x0 + 2, h - 0.5]);
  pts.push([x0, h * 0.88 - r() * j]);
  pts.push([x0 + r() * 1.5, h * 0.6]);
  pts.push([x0 + r() * 1.2, h * 0.35]);
  pts.push([x0 + 0.5, h * 0.12]);
  return `M${pts.map(([x, y]) => `${n2(x)} ${n2(y)}`).join(' L')} Z`;
}

/** Rachaduras de uma pedra: veios verticais serpenteando, cada um com um galho fino. */
function cracks(x0: number, x1: number, h: number, r: () => number): { main: string; thin: string } {
  const main: string[] = [], thin: string[] = [];
  const n = x1 - x0 > 60 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const cx = x0 + (x1 - x0) * ((i + 0.6 + r() * 0.5) / (n + 0.6));
    const steps = 5;
    const pts: [number, number][] = [];
    for (let s = 0; s <= steps; s++) pts.push([cx + (r() - 0.5) * 7, (h * s) / steps]);
    main.push(`M${pts.map(([x, y]) => `${n2(x)} ${n2(y)}`).join(' L')}`);
    const [bx, by] = pts[1 + Math.floor(r() * (steps - 2))];
    const dir = r() < 0.5 ? -1 : 1;
    thin.push(`M${n2(bx)} ${n2(by)} L${n2(bx + dir * (4 + r() * 5))} ${n2(by - h * 0.15)} L${n2(bx + dir * (9 + r() * 8))} ${n2(by - h * (0.1 + r() * 0.2))}`);
  }
  return { main: main.join(' '), thin: thin.join(' ') };
}

/** Uma laje inteira: contorno (para preencher/recortar), rachaduras e o brilho fino do topo. */
export function slab(h: number, seed: number): { d: string; cracks: string; thin: string; shine: string } {
  const r = rng(seed);
  const parts = blocks(BAR_W, r);
  const ds: string[] = [], cm: string[] = [], ct: string[] = [], sh: string[] = [];
  for (const [x0, x1] of parts) {
    ds.push(stone(x0, x1, h, r));
    const c = cracks(x0, x1, h, r);
    cm.push(c.main);
    ct.push(c.thin);
    const y = Math.min(2, h * 0.12);
    const pts: string[] = [];
    for (let x = x0 + 3; x < x1 - 2; x += 7) pts.push(`${n2(x)} ${n2(y + r() * 0.7)}`);
    sh.push(`M${pts.join(' L')}`);
  }
  return { d: ds.join(' '), cracks: cm.join(' '), thin: ct.join(' '), shine: sh.join(' ') };
}

/** Padrão de grão: quadradinhos escuros espalhados (textura da pedra). */
export function grainPattern(id: string, size = 48, count = 90, seed = 7): string {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, w = 0.3 + r() * 1.1;
    s += `<path d="M${n2(x)} ${n2(y)}l${n2(w)} -.3 .2 ${n2(w * 0.6)} ${n2(-w * 0.6)} .5Z" opacity="${n2(0.1 + r() * 0.4)}"/>`;
  }
  return `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><g fill="#101010">${s}</g></pattern>`;
}

/** Máscara de giz: branco com furinhos pretos (o traço do giz falha aqui e ali). */
export function chalkMask(id: string, seed = 11): string {
  const r = rng(seed);
  const size = 40;
  let dots = '';
  for (let i = 0; i < 80; i++) dots += `<circle cx="${n2(r() * size)}" cy="${n2(r() * size)}" r="${n2(0.25 + r() * 0.65)}"/>`;
  return `<pattern id="${id}-p" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${dots}</g></pattern>`
    + `<mask id="${id}" maskUnits="userSpaceOnUse" x="-200" y="-200" width="1200" height="600"><rect x="-200" y="-200" width="1200" height="600" fill="url(#${id}-p)"/></mask>`;
}

/** Aro desenhado à mão: dois círculos irregulares (fora e dentro) com preenchimento evenodd. */
export function ring(cx: number, cy: number, rOut: number, rIn: number, seed: number, jitter = 1.2): string {
  const r = rng(seed);
  const loop = (rad: number, dirSign: number): string => {
    const n = 48;
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = (dirSign * i * Math.PI * 2) / n;
      const rr = rad + (r() - 0.5) * jitter;
      pts.push(`${n2(cx + Math.cos(a) * rr)} ${n2(cy + Math.sin(a) * rr)}`);
    }
    return `M${pts.join(' L')} Z`;
  };
  return `${loop(rOut, 1)} ${loop(rIn, -1)}`;
}

/** Marcador de giz na ponta do preenchimento (uma lasca vertical que passa um pouco da laje). */
export function markerPath(h: number): string {
  const t = -h * 0.16, b = h * 1.16;
  return `M-1 ${n2(t)} L1 ${n2(t - 1)} L2 ${n2(t + h * 0.25)} L1 ${n2(h * 0.4)} L2.4 ${n2(h * 0.65)} L1 ${n2(b)} L-1.6 ${n2(b - 1)} L-1 ${n2(h * 0.7)} L-2.4 ${n2(h * 0.4)} L-1 ${n2(h * 0.1)} Z`;
}

/** Traço de giz horizontal (linha irregular), de x0 a x1 em y. */
export function chalkLine(x0: number, x1: number, y: number, seed: number): string {
  const r = rng(seed);
  const pts: string[] = [];
  for (let x = x0; x <= x1; x += 6) pts.push(`${n2(x)} ${n2(y + (r() - 0.5) * 1.1)}`);
  return `M${pts.join(' L')}`;
}
