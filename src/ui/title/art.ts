// Arte do menu de título: a paisagem (fundo fixo) e os dois samurais recortados do fundo verde
// (npm run menu-art, a partir de assets-src/menu-*.png), mais o símbolo do título: um ensō (círculo de
// pincel) com um kanji no meio, gerado por código (determinístico) e escrito como texto SVG uma vez.
import landscapeUrl from '../../assets/menu/landscape.webp';
import roninUrl from '../../assets/menu/ronin.webp';
import tomoeUrl from '../../assets/menu/tomoe.webp';
import meta from '../../assets/menu/menu.json';

export const TITLE_ART = {
  landscape: { src: landscapeUrl, w: meta.landscape.w, h: meta.landscape.h },
  ronin: { src: roninUrl, w: meta.ronin.w, h: meta.ronin.h },
  tomoe: { src: tomoeUrl, w: meta.tomoe.w, h: meta.tomoe.h },
} as const;

/**
 * Baixa e decodifica a arte do título antes de a tela aparecer (sem imagem surgindo aos pedaços).
 * Nunca falha e não segura o jogo: resolve quando tudo carregou, deu erro ou passou `timeoutMs`.
 */
export function preloadTitleArt(timeoutMs = 4000): Promise<void> {
  const one = (src: string) => new Promise<void>(done => {
    const img = new Image();
    img.onload = () => { img.decode().catch(() => undefined).then(() => done()); };
    img.onerror = () => done();
    img.src = src;
  });
  const all = Promise.all(Object.values(TITLE_ART).map(a => one(a.src))).then(() => undefined);
  return Promise.race([all, new Promise<void>(done => setTimeout(done, timeoutMs))]);
}

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
const smooth = (a: number, b: number, t: number) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** Ruído 1D suave (soma de senos com fase sorteada), em torno de 0. */
function wobble(r: () => number, amp: number, freqs: number[]): (t: number) => number {
  const w = freqs.map((f, i) => ({ f, p: r() * Math.PI * 2, a: amp / (i + 1) }));
  return t => w.reduce((s, k) => s + Math.sin(t * k.f * Math.PI * 2 + k.p) * k.a, 0);
}

/** Traço do ensō: começo e giro (graus; y para baixo, positivo = horário), largura e onde o pincel abre em fios. */
const ENSO = { start: 112, sweep: 328, width: 38, split: 0.8, strands: 5 };

/**
 * Ensō em volta de (0, 0), raio 100: começa embaixo à esquerda com a ponta redonda (o pincel encosta), gira no
 * sentido horário até quase fechar, afina e abre em fios no fim (pincel seco). Cada pedaço é um caminho
 * separado (sobrepostos com sentidos opostos não abrem buraco).
 */
function enso(seed: number): string[] {
  const r = rng(seed);
  const R = 100, W = ENSO.width, { split } = ENSO;
  const a0 = (ENSO.start * Math.PI) / 180, sweep = (ENSO.sweep * Math.PI) / 180;
  const radius = wobble(r, R * 0.02, [1, 1.7, 3.1]);
  const edgeOut = wobble(r, 0.55, [3, 7.3, 13.1]), edgeIn = wobble(r, 0.55, [3.4, 6.7, 12.3]);
  const ang = (t: number) => a0 + sweep * t;
  const pt = (t: number, off: number): [number, number] => {
    const a = ang(t), rr = R + radius(t) + off;
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  };
  /** Faixa de t0 a t1 com centro deslocado `offset(t)` e largura `width(t)`; `cap`: ponta redonda no começo. */
  const band = (t0: number, t1: number, offset: (t: number) => number, width: (t: number) => number, cap: boolean): string => {
    const n = Math.max(10, Math.round((t1 - t0) * 300));
    const out: [number, number][] = [], inn: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n, w = width(t) / 2, c = offset(t), k = Math.min(1, w / 6);
      out.push(pt(t, c + w + edgeOut(t) * k));
      inn.push(pt(t, c - w - edgeIn(t) * k));
    }
    const pts = [...out, ...inn.reverse()];
    if (cap) {
      // de dentro para fora, por trás do ponto inicial (contra o sentido do giro)
      const a = ang(t0), w = width(t0) / 2, [cx, cy] = pt(t0, offset(t0));
      const nx = Math.cos(a), ny = Math.sin(a), tx = -Math.sin(a), ty = Math.cos(a);
      for (let i = 1; i < 12; i++) {
        const th = (i / 12) * Math.PI;
        pts.push([cx - w * (nx * Math.cos(th) + tx * Math.sin(th) * 0.8), cy - w * (ny * Math.cos(th) + ty * Math.sin(th) * 0.8)]);
      }
    }
    return `M${pts.map(([x, y]) => `${n2(x)} ${n2(y)}`).join(' L')} Z`;
  };
  // corpo: mais tinta no começo, uma leve respiração no meio e afinando até onde abre em fios
  const body = (t: number) => W * (0.86 + 0.22 * (1 - smooth(0, 0.1, t)) + 0.05 * Math.sin(t * 7 + 1.3)) * (1 - 0.45 * smooth(0.45, split, t));
  const parts = [band(0, split + 0.015, () => 0, body, true)];
  // pincel seco: a largura do fim do corpo se divide em fios, que se abrem um pouco e acabam em pontos diferentes
  const ws = body(split), N = ENSO.strands;
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N - 0.5;
    const end = split + (1 - split) * (0.7 + r() * 0.3) * (1 - Math.abs(u) * 0.5);
    const kw = (ws / N) * (0.95 + r() * 0.3);
    parts.push(band(split - 0.01, end, t => u * ws * (1 + 0.5 * smooth(split, end, t)), t => kw * Math.pow(1 - smooth(split, end, t), 0.7) + 0.3, false));
  }
  return parts;
}

/**
 * 雨 (chuva) em pincel: contorno do glifo da fonte Yuji Boku (Google Fonts, licença SIL OFL 1.1), tirado com
 * opentype.js e centrado em (0, 0) numa caixa de ~106 × 102. Outro kanji: trocar este caminho.
 */
const AME_PATH = [
  'M52.9-12.0L52.9-12.0Q52.6-10.4 51.1-9.5Q49.7-8.5 48.1-8.0Q46.5-7.5 45.5-7.3L45.5-7.3Q45.1-6.1 44.4-5.4',
  'Q43.7-4.7 42.7-4.1L42.7-4.1Q42.4-0.2 42.3 4.0Q42.3 8.2 42.1 12.4L42.1 12.4Q42.1 19.9 41.7 27.2',
  'Q41.3 34.5 39.6 40.2Q37.9 46.0 34.1 49.0L34.1 49.0Q33.6 49.3 32.2 49.9Q30.9 50.5 29.4 50.9',
  'Q27.9 51.3 26.9 51.0L26.9 51.0Q26.5 50.9 26.5 50.4Q26.4 49.8 26.1 49.7L26.1 49.7Q23.8 48.3 20.7 47.4',
  'Q17.7 46.5 14.7 45.3Q11.7 44.1 9.7 41.8L9.7 41.8Q9.9 40.8 9.5 40.2Q9.1 39.6 8.7 39.0L8.7 39.0',
  'Q8.3 38.4 8.0 37.9Q7.7 37.3 8.1 36.5L8.1 36.5Q7.2 35.9 6.0 35.7Q4.8 35.4 4.0 34.8L4.0 34.8Q5.4 34.8 7.1 35.2',
  'Q8.8 35.7 10.6 36.1L10.6 36.1Q14.4 37.2 18.4 37.7Q22.5 38.2 25.3 35.5L25.3 35.5Q27.3 33.9 28.5 29.8',
  'Q29.7 25.8 30.3 20.6Q31.0 15.4 31.1 9.9Q31.2 4.3 31.0-0.5Q30.7-5.4 30.1-8.6L30.1-8.6Q29.8-10.7 28.9-12.2',
  'Q28.0-13.8 28.0-15.1L28.0-15.1Q23.4-15.6 18.4-15.3Q13.5-15.1 8.5-14.7L8.5-14.7Q6.5-14.6 4.5-14.5',
  'Q2.4-14.4 0.4-14.3L0.4-14.3Q0.3-12.0 0.2-9.7Q0.1-7.4 0.0-5.1L0.0-5.1Q-0.3 2.4-0.5 10.0Q-0.6 17.7 0.5 25.2',
  'L0.5 25.2Q0.1 25.9 0.1 27.6Q0.1 29.2 0.1 31.3L0.1 31.3Q0.3 34.6 0.1 38.3Q0.0 42.0-1.4 44.3L-1.4 44.3',
  'Q-4.4 44.4-6.2 41.1Q-7.9 37.8-8.9 34.3L-8.9 34.3Q-7.5 27.5-7.7 18.6Q-7.8 9.7-8.1 1.2L-8.1 1.2',
  'Q-8.3-2.9-8.4-6.6Q-8.5-10.3-8.5-13.5L-8.5-13.5Q-12.5-13.1-16.7-12.8Q-20.9-12.6-24.6-11.8Q-28.3-11.0-31.1-9.3',
  'Q-33.8-7.7-35.1-4.3L-35.1-4.3Q-35.9-0.1-35.7 5.1Q-35.6 10.2-35.4 15.6L-35.4 15.6Q-35.1 19.7-35.0 23.7',
  'Q-34.8 27.7-35.0 31.6L-35.0 31.6Q-35.0 32.3-35.1 33.0Q-35.3 33.7-35.4 34.6L-35.4 34.6Q-35.5 35.8-35.6 36.9',
  'Q-35.7 38.1-35.6 38.8L-35.6 38.8Q-35.4 39.9-34.8 40.6Q-34.3 41.4-33.7 42.1L-33.7 42.1Q-32.7 43.1-32.2 44.1',
  'Q-31.7 45.1-32.3 46.6L-32.3 46.6Q-34.5 46.7-37.9 45.5Q-41.3 44.3-44.0 42.1Q-46.8 40.0-47.6 37.2',
  'Q-48.3 34.5-45.5 31.5L-45.5 31.5Q-45.6 28.9-45.4 25.3Q-45.2 21.6-44.9 17.7L-44.9 17.7Q-44.5 12.0-44.3 6.7',
  'Q-44.0 1.3-44.7-1.8L-44.7-1.8Q-45.9-6.6-50.9-6.9L-50.9-6.9Q-50.7-7.7-51.2-8.1Q-51.6-8.5-52.1-8.7L-52.1-8.7',
  'Q-53.0-9.5-52.9-9.9L-52.9-9.9Q-53.0-11.0-52.5-11.5Q-52.1-12.0-51.5-12.2L-51.5-12.2Q-51.0-12.6-50.5-12.9',
  'Q-50.0-13.3-49.9-14.0L-49.9-14.0Q-41.1-16.1-30.5-17.8Q-19.9-19.5-8.6-21.1L-8.6-21.1Q-9.0-25.4-9.6-29.5',
  'Q-10.2-33.6-11.9-36.9L-11.9-36.9Q-13.5-37.2-15.8-36.6Q-18.0-36.0-20.3-35.1L-20.3-35.1Q-22.7-34.4-24.9-33.8',
  'Q-27.2-33.1-29.0-33.3L-29.0-33.3Q-31.8-33.7-33.1-35.7Q-34.4-37.7-36.5-39.3L-36.5-39.3Q-38.0-40.7-39.7-41.1',
  'Q-41.4-41.6-42.1-43.5L-42.1-43.5Q-41.4-43.5-41.4-43.9Q-41.5-44.3-41.7-44.7L-41.7-44.7Q-42.0-45.2-42.2-45.6',
  'Q-42.3-46.1-41.9-46.3L-41.9-46.3Q-34.9-44.9-26.4-44.9Q-17.9-45.0-9.1-46.0Q-0.3-47.0 7.1-48.2L7.1-48.2',
  'Q9.5-48.7 11.5-48.9Q13.5-49.1 15.0-51.1L15.0-51.1Q18.6-50.5 22.2-49.4Q25.7-48.3 27.7-46.2',
  'Q29.8-44.1 28.9-40.1L28.9-40.1Q21.4-39.9 13.4-39.8Q5.4-39.7-2.7-38.6L-2.7-38.6Q-0.5-37.1 0.3-33.9',
  'Q1.1-30.8 0.9-27.5Q0.6-24.2-0.2-21.8L-0.2-21.8Q0.6-21.5 1.7-21.5Q2.8-21.6 4.0-21.6L4.0-21.6',
  'Q5.5-21.7 7.0-21.6Q8.5-21.6 9.4-20.7L9.4-20.7Q10.1-20.9 9.6-21.6L9.6-21.6Q9.1-22.2 9.7-22.2L9.7-22.2',
  'Q10.5-22.3 10.5-22.1Q10.5-21.9 10.5-21.8L10.5-21.8Q10.3-21.6 10.3-21.4Q10.3-21.2 11.1-21.3L11.1-21.3',
  'Q11.4-21.8 12.9-22.2Q14.4-22.5 16.1-22.5Q17.8-22.4 18.6-21.5L18.6-21.5Q20.3-22.4 22.7-22.5',
  'Q25.1-22.5 26.7-22.2L26.7-22.2Q30.7-24.0 33.6-23.4Q36.4-22.9 39.0-21.8L39.0-21.8Q40.3-21.3 41.7-20.9',
  'Q43.1-20.4 44.8-20.1L44.8-20.1Q44.8-19.4 45.3-18.9Q45.7-18.5 46.3-18.1L46.3-18.1Q46.9-17.6 47.4-17.1',
  'Q47.8-16.7 47.3-15.7L47.3-15.7Q49.0-15.0 50.5-14.3Q52.1-13.7 52.9-12.0ZM21.4 25.0L21.4 25.0',
  'Q18.4 26.5 15.9 25.8Q13.3 25.0 11.4 22.8Q9.5 20.5 8.0 17.8Q6.5 15.0 5.4 12.6L5.4 12.6Q6.7 11.7 9.1 11.9',
  'Q11.5 12.1 14.1 13.2Q16.6 14.3 18.6 15.9Q20.7 17.4 21.3 19.2L21.3 19.2Q21.6 20.1 21.6 21.0',
  'Q21.5 21.9 21.5 22.7L21.5 22.7Q21.4 23.3 21.3 23.8Q21.3 24.4 21.4 25.0ZM-12.3 7.0L-12.3 7.0',
  'Q-16.1 8.4-19.3 7.0Q-22.5 5.5-25.1 2.5Q-27.7-0.5-29.9-3.6L-29.9-3.6Q-30.0-4.2-29.8-4.4Q-29.6-4.5-29.3-4.7',
  'L-29.3-4.7Q-29.0-4.8-28.8-5.0Q-28.5-5.3-28.8-5.9L-28.8-5.9Q-24.9-5.0-21.3-3.9Q-17.7-2.7-15.2-0.3',
  'Q-12.7 2.1-12.3 7.0ZM-12.7 26.4L-12.7 26.4Q-15.1 28.3-17.6 28.0Q-20.1 27.6-22.5 25.8Q-24.8 24.0-26.7 21.4',
  'Q-28.7 18.9-29.9 16.3L-29.9 16.3Q-29.6 16.3-29.6 16.0Q-29.5 15.7-29.4 15.5L-29.4 15.5Q-25.2 14.8-21.6 16.1',
  'Q-18.1 17.4-15.7 20.2Q-13.3 22.9-12.7 26.4ZM22.1 4.6L22.1 4.6Q18.4 6.1 15.2 4.5Q12.0 2.9 9.7-0.5',
  'Q7.3-3.8 6.1-7.4L6.1-7.4Q6.0-8.1 6.5-8.3L6.5-8.3Q10.2-8.5 14.0-6.6Q17.8-4.7 20.2-1.7Q22.6 1.3 22.1 4.6Z',
].join('');

/** Símbolo do título (SVG): ensō de nanquim e o 雨 no meio, com um halo de papel que separa do fundo escuro. */
export function emblemSvg(): string {
  const ink = enso(99).map(d => `<path d="${d}"/>`).join('') + `<path d="${AME_PATH}" transform="scale(1.12)"/>`;
  return `<svg class="title-emblem" viewBox="-132 -132 264 264" aria-hidden="true" focusable="false">`
    + `<g class="te-halo">${ink}</g><g class="te-ink">${ink}</g></svg>`;
}
