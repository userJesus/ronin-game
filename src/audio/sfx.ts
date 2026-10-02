// Síntese dos efeitos sonoros. Cada função recebe uma Voice (contexto + destino) e agenda seus nós a partir de t.
// Níveis de referência (medidos com debug.ts): impactos e aviso de preparação no topo, passos e chuva embaixo.
import type { EnemyKind } from '../config';
import { ad, rand, vary, type NoiseKind, type Voice } from './voice';

export interface SfxOpts {
  /** Passo do combo (0..2). */
  step?: number;
  kind?: EnemyKind;
  heavy?: boolean;
  killed?: boolean;
  /** Força do trovão 0..1. */
  strength?: number;
  hits?: number;
  kills?: number;
  /** Duração de referência (carga do iaido, subida antes do corte). */
  dur?: number;
  /** Intensidade 0..1 (tambores, coração). */
  vel?: number;
  /** Multiplicador de altura. */
  pitch?: number;
}

const KIND_PITCH: Record<EnemyKind, number> = { ronin: 1, brute: 0.78, swift: 1.2 };
const kindPitch = (o: SfxOpts): number => KIND_PITCH[o.kind ?? 'ronin'];

/** Rampa exponencial explícita de `from` a `to` em `dur` segundos. */
function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(to, t + dur);
}

/** Rajada de ruído filtrado com envelope ataque-queda. Devolve o filtro (para automação). */
function burst(v: Voice, kind: NoiseKind, type: BiquadFilterType, f: number, q: number,
  t: number, att: number, peak: number, dec: number, to: AudioNode = v.out): BiquadFilterNode {
  const src = v.noise(kind, t, t + att + dec + 0.02);
  const fl = v.filter(type, f, q);
  const g = v.gain();
  ad(g.gain, t, att, peak, dec);
  src.connect(fl);
  fl.connect(g);
  g.connect(to);
  return fl;
}

/** Oscilador com envelope ataque-queda. */
function tone(v: Voice, type: OscillatorType, f: number, t: number, att: number, peak: number, dec: number,
  to: AudioNode = v.out): OscillatorNode {
  const o = v.osc(type, f, t, t + att + dec + 0.02);
  const g = v.gain();
  ad(g.gain, t, att, peak, dec);
  o.connect(g);
  g.connect(to);
  return o;
}

/** Ruído passa-banda varrendo f0 -> f1 -> f2; o volume cresce até ~40% da duração e some. */
function whoosh(v: Voice, t: number, f0: number, f1: number, f2: number, dur: number, q: number, peak: number,
  to: AudioNode = v.out): void {
  const src = v.noise('white', t, t + dur + 0.03);
  const bp = v.filter('bandpass', f0, q);
  const fr = bp.frequency;
  fr.setValueAtTime(f0, t);
  fr.exponentialRampToValueAtTime(f1, t + dur * 0.45);
  fr.exponentialRampToValueAtTime(f2, t + dur);
  const g = v.gain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + dur * 0.38);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(to);
}

/** Parciais inarmônicas (metal, sino, tigela). `twin` > 0 soma cópias desafinadas em Hz (batimento). */
function partials(v: Voice, t: number, f: number, ratios: readonly number[], amps: readonly number[],
  decays: readonly number[], peak: number, att = 0.001, twin = 0, to: AudioNode = v.out): void {
  for (let i = 0; i < ratios.length; i++) {
    tone(v, 'sine', f * ratios[i], t, att, peak * amps[i], decays[i], to);
    if (twin > 0) tone(v, 'sine', f * ratios[i] + twin * (i + 1), t, att, peak * amps[i] * 0.6, decays[i] * 0.9, to);
  }
}

/** Tambor grave (taiko): seno com queda de altura, modo de membrana, tapa da pele e corpo. */
function drum(v: Voice, t: number, vel: number, f: number): void {
  const o = tone(v, 'sine', f, t, 0.003, 0.95 * vel, 0.8);
  o.frequency.setValueAtTime(f * 1.7, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
  o.frequency.exponentialRampToValueAtTime(f * 0.86, t + 0.65);
  const m = tone(v, 'sine', f * 2.3, t, 0.002, 0.22 * vel, 0.16);
  glide(m.frequency, t, f * 2.7, f * 2.3, 0.03);
  burst(v, 'white', 'lowpass', 1100, 0.5, t, 0.001, 0.4 * vel, 0.05);
  burst(v, 'brown', 'lowpass', 320, 0.5, t, 0.002, 0.55 * vel, 0.32);
}

const METAL = [1, 1.483, 2.116, 2.873, 3.61] as const;
const BLADE = [1, 1.34, 1.91, 2.52, 3.3] as const;
const GONG = [1, 1.52, 2.03, 2.71, 3.46, 4.31] as const;

type SfxFn = (v: Voice, t: number, o: SfxOpts) => void;

export const SFX = {
  /** Corte do herói: 3 variações; o 3º passo é mais pesado. */
  playerSwing(v, t, o) {
    const s = o.step ?? 0;
    const p = vary(1, 0.06);
    if (s >= 2) {
      whoosh(v, t, 320 * p, 1700 * p, 480 * p, 0.32, 0.9, 1.0);
      whoosh(v, t + 0.02, 900 * p, 3600 * p, 1400 * p, 0.24, 1.6, 0.3);
      const b = tone(v, 'sine', 110, t + 0.03, 0.01, 0.3, 0.2);
      glide(b.frequency, t + 0.03, 110, 55, 0.18);
    } else if (s === 1) {
      whoosh(v, t, 760 * p, 3000 * p, 1150 * p, 0.18, 1.3, 1.0);
    } else {
      whoosh(v, t, 520 * p, 2500 * p, 900 * p, 0.2, 1.3, 1.0);
    }
    v.send(v.out, 0.08);
  },

  /** Impacto carnudo curto. */
  enemyHit(v, t, o) {
    const p = kindPitch(o) * vary(1, 0.07);
    const body = tone(v, 'sine', 150 * p, t, 0.002, 0.9, 0.17);
    glide(body.frequency, t, 170 * p, 52 * p, 0.09);
    burst(v, 'white', 'lowpass', 1700 * p, 0.5, t, 0.001, 0.8, 0.075);
    const sq = burst(v, 'white', 'bandpass', 1200 * p, 3, t + 0.008, 0.004, 1.1, 0.1);
    glide(sq.frequency, t + 0.008, 1300 * p, 360 * p, 0.09);
    if (o.heavy || o.killed) burst(v, 'brown', 'lowpass', 420, 0.5, t, 0.002, 0.7, 0.2);
    v.send(v.out, 0.1);
  },

  /** "Shing" metálico que acompanha golpe pesado ou morte. */
  metal(v, t, o) {
    const f = 2380 * vary(1, 0.05) * (o.kind === 'brute' ? 0.85 : 1);
    partials(v, t, f, METAL, [1, 0.7, 0.55, 0.4, 0.3], [0.5, 0.36, 0.26, 0.18, 0.12], 0.11);
    burst(v, 'white', 'highpass', 4500, 0.7, t, 0.001, 0.4, 0.05);
    v.send(v.out, 0.3);
  },

  /** Queda pesada e abafada do corpo (atrasada: o corpo cai depois do golpe). */
  enemyDeath(v, t0, o) {
    const p = kindPitch(o) * vary(1, 0.08);
    const t = t0 + 0.26 + rand() * 0.05;
    burst(v, 'brown', 'lowpass', 260 * p, 0.5, t, 0.006, 1.1, 0.4);
    const b = tone(v, 'sine', 70 * p, t, 0.003, 0.7, 0.42);
    glide(b.frequency, t, 75 * p, 36 * p, 0.3);
    burst(v, 'white', 'bandpass', 550 * p, 1.2, t + 0.004, 0.004, 0.55, 0.2);
    // armadura chacoalhando: três estalos curtos
    const src = v.noise('white', t, t + 0.2);
    const bp = v.filter('bandpass', 2700 * p, 6);
    const g = v.gain();
    for (let k = 0; k < 3; k++) {
      const tk = t + 0.012 + k * 0.043;
      g.gain.setValueAtTime(0, tk);
      g.gain.linearRampToValueAtTime(0.5 - k * 0.12, tk + 0.002);
      g.gain.exponentialRampToValueAtTime(1e-4, tk + 0.03);
    }
    src.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    v.send(v.out, 0.1);
  },

  /** AVISO de ataque: raspar de lâmina subindo + tilintar claro. Tem de furar a mistura. */
  enemyWindup(v, t, o) {
    const p = kindPitch(o) * vary(1, 0.04);
    const sc = burst(v, 'white', 'bandpass', 2600 * p, 9, t, 0.008, 1.6, 0.17);
    glide(sc.frequency, t, 2500 * p, 5400 * p, 0.13);
    partials(v, t + 0.012, 1850 * p, [1, 2.76, 4.07], [1, 0.5, 0.32], [0.36, 0.22, 0.13], 0.2, 0.0015);
    v.send(v.out, 0.16);
  },

  /** Golpe do inimigo: whoosh mais grave. */
  enemySwing(v, t, o) {
    const p = kindPitch(o) * vary(1, 0.06);
    const d = o.kind === 'brute' ? 0.32 : o.kind === 'swift' ? 0.18 : 0.24;
    whoosh(v, t, 260 * p, 1150 * p, 380 * p, d, 1.1, 1.0);
    burst(v, 'brown', 'lowpass', 260, 0.5, t + d * 0.2, 0.05, 0.3, d * 0.8);
  },

  /** Herói ferido: baque surdo. */
  playerHurt(v, t) {
    const b = tone(v, 'sine', 120, t, 0.002, 1.0, 0.26);
    glide(b.frequency, t, 125, 46, 0.16);
    burst(v, 'brown', 'lowpass', 650, 0.5, t, 0.002, 1.0, 0.18);
    burst(v, 'white', 'bandpass', 1400, 1.2, t, 0.001, 0.45, 0.06);
    v.send(v.out, 0.08);
  },

  /** Morte do herói: estrondo, crescendo longo e acorde grave, muito reverb. */
  playerDeath(v, t) {
    const b = tone(v, 'sine', 62, t, 0.005, 0.9, 2.4);
    glide(b.frequency, t, 64, 30, 1.4);
    const lo = burst(v, 'brown', 'lowpass', 340, 0.5, t, 0.01, 0.9, 1.8);
    glide(lo.frequency, t, 340, 110, 1.6);
    const src = v.noise('pink', t, t + 5);
    const bp = v.filter('bandpass', 300, 0.7);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 1.8);
    bp.frequency.exponentialRampToValueAtTime(250, t + 4.6);
    const g = v.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 1.8);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 4.9);
    src.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const lp = v.filter('lowpass', 220, 1);
    lp.frequency.setValueAtTime(220, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 1.8);
    lp.frequency.exponentialRampToValueAtTime(160, t + 4.8);
    const dg = v.gain();
    dg.gain.setValueAtTime(0, t);
    dg.gain.linearRampToValueAtTime(0.12, t + 1.6);
    dg.gain.exponentialRampToValueAtTime(1e-4, t + 4.9);
    for (const f of [73.42, 110, 110.6, 146.8]) v.osc('sawtooth', f, t, t + 5).connect(lp);
    lp.connect(dg);
    dg.connect(v.out);
    v.send(v.out, 0.6);
  },

  /** Esquiva: whoosh curto e agudo + pano. */
  dash(v, t) {
    const p = vary(1, 0.08);
    whoosh(v, t, 900 * p, 3400 * p, 1500 * p, 0.15, 1.1, 0.75);
    burst(v, 'white', 'lowpass', 900, 0.5, t, 0.012, 0.3, 0.1);
  },

  /** Carga do iaido: tom subindo até o fim da carga, depois zumbido baixo sustentado (cortado de fora). */
  chargeStart(v, t, o) {
    const d = o.dur ?? 0.45;
    const end = t + 20;
    const a = v.osc('triangle', 196, t, end);
    glide(a.frequency, t, 196, 392, d);
    const ga = v.gain();
    ga.gain.setValueAtTime(0, t);
    ga.gain.linearRampToValueAtTime(0.16, t + d);
    ga.gain.setTargetAtTime(0.05, t + d + 0.04, 0.25);
    const b = v.osc('sine', 392, t, end);
    glide(b.frequency, t, 392, 784, d);
    const gb = v.gain();
    gb.gain.setValueAtTime(0, t);
    gb.gain.linearRampToValueAtTime(0.06, t + d);
    gb.gain.setTargetAtTime(0.018, t + d + 0.04, 0.25);
    const lfo = v.osc('sine', 6.5, t, end);
    const lg = v.gain(0.012);
    lfo.connect(lg);
    lg.connect(ga.gain);
    const sh = v.noise('white', t, t + d + 0.8);
    const hp = v.filter('highpass', 5000, 0.7);
    const gs = v.gain();
    gs.gain.setValueAtTime(0, t);
    gs.gain.linearRampToValueAtTime(0.08, t + d);
    gs.gain.setTargetAtTime(0, t + d, 0.12);
    sh.connect(hp);
    hp.connect(gs);
    gs.connect(v.out);
    a.connect(ga);
    ga.connect(v.out);
    b.connect(gb);
    gb.connect(v.out);
    v.send(v.out, 0.12);
  },

  /** Carga pronta: sino pequeno, brilhante (`pitch` 0,5 = o mesmo sino uma oitava abaixo, para o rugido do leão). */
  chargeReady(v, t, o) {
    const f = 1568 * (o.pitch ?? 1);
    partials(v, t, f, [1, 2.0, 2.76, 4.2, 5.4], [1, 0.35, 0.5, 0.25, 0.15], [1.4, 0.9, 0.8, 0.45, 0.3], 0.1, 0.001, 1.8);
    burst(v, 'white', 'highpass', 6500, 0.7, t, 0.001, 0.25, 0.025);
    v.send(v.out, 0.35);
  },

  /** Carga cancelada: o tom cai e some. */
  chargeCancel(v, t) {
    const o = tone(v, 'triangle', 392, t, 0.003, 0.14, 0.12);
    glide(o.frequency, t, 392, 170, 0.1);
  },

  /** Ruído reverso que sobe no silêncio do iaido e culmina no corte. */
  iaidoSwell(v, t, o) {
    const d = o.dur ?? 0.25;
    const src = v.noise('white', t, t + d + 0.01);
    const hp = v.filter('highpass', 900, 0.7);
    glide(hp.frequency, t, 900, 5200, d);
    const g = v.gain();
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + d);
    g.gain.linearRampToValueAtTime(0, t + d + 0.005);
    src.connect(hp);
    hp.connect(g);
    g.connect(v.out);
    const low = v.noise('brown', t, t + d + 0.01);
    const lp = v.filter('lowpass', 200, 0.5);
    const gl = v.gain();
    gl.gain.setValueAtTime(1e-4, t);
    gl.gain.exponentialRampToValueAtTime(0.45, t + d);
    gl.gain.linearRampToValueAtTime(0, t + d + 0.005);
    low.connect(lp);
    lp.connect(gl);
    gl.connect(v.out);
    v.send(v.out, 0.05);
  },

  /** Corte do iaido: SHING agudo com cauda longa, ar rasgado e estrondo se acertou alguém. */
  iaidoCut(v, t, o) {
    const hits = o.hits ?? 1;
    const f = 3150 * vary(1, 0.02);
    partials(v, t, f, BLADE, [1, 0.8, 0.6, 0.45, 0.3], [2.4, 1.7, 1.2, 0.8, 0.5], 0.085, 0.001, 2.2);
    burst(v, 'white', 'highpass', 3000, 0.7, t, 0.002, 0.9, 0.26);
    whoosh(v, t, 380, 2000, 300, 0.22, 0.9, 0.7);
    if (hits > 0) {
      const b = tone(v, 'sine', 58, t, 0.004, Math.min(1, 0.75 + 0.08 * hits), 0.9);
      glide(b.frequency, t, 62, 33, 0.6);
      burst(v, 'brown', 'lowpass', 300, 0.5, t, 0.003, 0.6, 0.4);
    }
    v.send(v.out, 0.55);
  },

  /** Passo na lama molhada. */
  footstep(v, t) {
    const p = vary(1, 0.15);
    burst(v, 'white', 'lowpass', 750 * p, 0.5, t, 0.003, 0.55, vary(0.075, 0.2));
    const sq = burst(v, 'white', 'bandpass', 1200 * p, 5, t + 0.012, 0.006, vary(0.5, 0.25), 0.085);
    glide(sq.frequency, t + 0.012, 1250 * p, 330 * p, 0.075);
  },

  /** Início de onda: três golpes graves de taiko, o último maior. */
  waveStart(v, t) {
    drum(v, t, 0.8, 72);
    drum(v, t + 0.46, 0.8, 72);
    drum(v, t + 0.92, 1, 64);
    v.send(v.out, 0.3);
  },

  /** Fim de onda: tigela tibetana suave (parciais com batimento, queda longa). */
  waveClear(v, t) {
    partials(v, t, 196, [1, 2.76, 5.2, 8.5], [1, 0.5, 0.28, 0.14], [4.8, 3.4, 2.3, 1.4], 0.12, 0.018, 0.9);
    burst(v, 'brown', 'lowpass', 420, 0.5, t, 0.002, 0.35, 0.09);
    v.send(v.out, 0.5);
  },

  /** Trovão distante: estalo (se forte), estrondo com rolagem e camada funda. */
  thunder(v, t, o) {
    const s = Math.max(0.05, Math.min(1, o.strength ?? 0.7));
    const dur = (3.2 + 2.8 * s) * vary(1, 0.15);
    const rollEnd = t + 0.6 + dur * 0.6;
    const tau = 0.3 + 0.1 * dur;
    const stop = rollEnd + tau * 6;
    if (s > 0.55) burst(v, 'white', 'lowpass', 2400, 0.5, t, 0.004, 0.4 * s, 0.4);
    const src = v.noise('brown', t, stop);
    const lp = v.filter('lowpass', 600, 0.5);
    glide(lp.frequency, t, 600, 150, stop - t);
    const g = v.gain();
    const gp = g.gain;
    gp.setValueAtTime(0, t);
    gp.linearRampToValueAtTime(0.6 * s + 0.2, t + 0.07);
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const tb = t + 0.25 + (i / n) * dur * 0.6 + rand() * 0.25;
      const pk = (0.9 - i * 0.12) * (0.5 + 0.5 * s) * vary(1, 0.25);
      gp.setTargetAtTime(pk, tb, 0.06);
      gp.setTargetAtTime(pk * 0.3, tb + 0.16, 0.3);
    }
    gp.setTargetAtTime(0, rollEnd, tau);
    src.connect(lp);
    lp.connect(g);
    g.connect(v.out);
    const deep = v.noise('brown', t, stop, 0.5);
    const lp2 = v.filter('lowpass', 140, 0.5);
    const g2 = v.gain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.7 * s + 0.2, t + 0.3);
    g2.gain.setTargetAtTime(0, rollEnd, tau);
    deep.connect(lp2);
    lp2.connect(g2);
    g2.connect(v.out);
    v.send(v.out, 0.35);
  },

  /** Batida de coração (vida baixa): "tum-tum" grave. */
  heartbeat(v, t, o) {
    const vel = o.vel ?? 1;
    const lp = v.filter('lowpass', 320, 0.5);
    lp.connect(v.out);
    const a = tone(v, 'triangle', 66, t, 0.005, 0.9 * vel, 0.16, lp);
    glide(a.frequency, t, 72, 44, 0.1);
    const b = tone(v, 'triangle', 58, t + 0.17, 0.005, 0.65 * vel, 0.14, lp);
    glide(b.frequency, t + 0.17, 62, 40, 0.1);
  },

  /** Taiko da música (esparso). */
  taiko(v, t, o) {
    drum(v, t, o.vel ?? 0.8, 80 * (o.pitch ?? 1));
    v.send(v.out, 0.25);
  },

  /** "Ka": batida na borda do taiko. */
  taikoKa(v, t, o) {
    const vel = o.vel ?? 0.6;
    burst(v, 'white', 'bandpass', 2000, 3.5, t, 0.001, 0.8 * vel, 0.035);
    tone(v, 'sine', 820, t, 0.001, 0.25 * vel, 0.05);
    v.send(v.out, 0.2);
  },

  // ---- forma de leão (só o Ronin)

  /** Fúria cheia: gongo grave e curto; o fundamental afunda logo depois da batida. */
  furyReady(v, t) {
    const f = 98;
    partials(v, t, f, GONG, [1, 0.6, 0.5, 0.38, 0.26, 0.16], [1.8, 1.3, 1, 0.75, 0.5, 0.32], 0.15, 0.002, 1.1);
    const b = tone(v, 'sine', f, t, 0.003, 0.3, 1.1);
    glide(b.frequency, t, f * 1.08, f * 0.97, 0.5);
    burst(v, 'brown', 'lowpass', 360, 0.5, t, 0.002, 0.5, 0.09);
    burst(v, 'white', 'bandpass', 1500, 1.5, t, 0.001, 0.14, 0.03);
    v.send(v.out, 0.45);
  },

  /**
   * Transformação: crescendo grave e tenso que culmina no rugido em `dur` (segunda menor de serras graves abrindo
   * o filtro, tremor que acelera, ronco de terra e a inspiração antes do rugido). Depois some (o rugido corta).
   */
  lionSwell(v, t, o) {
    const d = o.dur ?? 1.42;
    const end = t + d + 1.5;
    // massa: E1/F1 + oitava, subindo uma quarta enquanto o filtro abre
    const lp = v.filter('lowpass', 130, 3);
    glide(lp.frequency, t, 130, 1300, d);
    lp.frequency.setTargetAtTime(260, t + d, 0.3);
    for (const [f, a] of [[41.2, 1], [43.65, 0.9], [82.4, 0.5]] as const) {
      const s = v.osc('sawtooth', f, t, end);
      glide(s.frequency, t, f, f * 1.335, d);
      const sg = v.gain(a);
      s.connect(sg);
      sg.connect(lp);
    }
    // tremor (respiração ofegante) que acelera até o rugido
    const trem = v.gain(0.7);
    const lfo = v.osc('sine', 3, t, end);
    glide(lfo.frequency, t, 3, 15, d);
    const lg = v.gain(0.3);
    lfo.connect(lg);
    lg.connect(trem.gain);
    const g = v.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.3, t + d);
    g.gain.setTargetAtTime(0, t + d, 0.3);
    lp.connect(trem);
    trem.connect(g);
    g.connect(v.out);
    // ronco de terra
    const rum = v.noise('brown', t, end);
    const rlp = v.filter('lowpass', 90, 0.7);
    glide(rlp.frequency, t, 90, 380, d);
    const rg = v.gain();
    rg.gain.setValueAtTime(0, t);
    rg.gain.linearRampToValueAtTime(0.12, t + 0.15);
    rg.gain.exponentialRampToValueAtTime(0.7, t + d);
    rg.gain.setTargetAtTime(0, t + d, 0.3);
    rum.connect(rlp);
    rlp.connect(rg);
    rg.connect(v.out);
    // inspiração: ar subindo no último trecho, para de golpe no rugido
    const ta = t + d * 0.45;
    const air = v.noise('pink', ta, t + d + 0.08);
    const abp = v.filter('bandpass', 600, 1.3);
    glide(abp.frequency, ta, 600, 2200, t + d - ta);
    const ag = v.gain();
    ag.gain.setValueAtTime(0, ta);
    ag.gain.linearRampToValueAtTime(0.22, t + d);
    ag.gain.linearRampToValueAtTime(0, t + d + 0.06);
    air.connect(abp);
    abp.connect(ag);
    ag.connect(v.out);
    v.send(v.out, 0.15);
  },

  /**
   * Rugido do leão (~1,2 s): serras graves com vibrato e aspereza + ruído, por formantes graves que abrem e fecham
   * (a boca), sobre o impacto grave da onda de choque.
   */
  roar(v, t) {
    const d = 1.2, end = t + d + 0.05;
    const f0 = 96 * vary(1, 0.04);
    // fonte: serra, serra desafinada e sub-oitava; vibrato lento + tremor rápido (aspereza) no detune (cents)
    const src = v.gain(1);
    const vib = v.osc('sine', 6, t, end);
    const vg = v.gain(30);
    vib.connect(vg);
    const jit = v.osc('sine', 23, t, end);
    const jg = v.gain(18);
    jit.connect(jg);
    for (const [k, a] of [[1, 0.5], [1.012, 0.4], [0.5, 0.45]] as const) {
      const s = v.osc('sawtooth', f0 * k, t, end);
      const fr = s.frequency;
      fr.setValueAtTime(f0 * k * 0.78, t);
      fr.linearRampToValueAtTime(f0 * k * 1.22, t + 0.16);
      fr.exponentialRampToValueAtTime(f0 * k * 0.6, t + d);
      vg.connect(s.detune);
      jg.connect(s.detune);
      const sg = v.gain(a);
      s.connect(sg);
      sg.connect(src);
    }
    const n = v.noise('pink', t, end);
    const ng = v.gain(0.9);
    n.connect(ng);
    ng.connect(src);
    // garganta: modulação de amplitude ~31 Hz (o "rasgado")
    const rasp = v.gain(0.65);
    const am = v.osc('sine', 31, t, end);
    const amg = v.gain(0.35);
    am.connect(amg);
    amg.connect(rasp.gain);
    src.connect(rasp);
    const env = v.gain();
    const eg = env.gain;
    eg.setValueAtTime(0, t);
    eg.linearRampToValueAtTime(1, t + 0.07);
    eg.linearRampToValueAtTime(0.85, t + 0.5);
    eg.exponentialRampToValueAtTime(0.4, t + 0.95);
    eg.exponentialRampToValueAtTime(1e-4, t + d);
    // boca: formantes (início, aberto, fim, Q, ganho)
    for (const [fa, fb, fc, q, a] of [[300, 560, 320, 3, 2.2], [800, 1150, 680, 4, 1.3], [2100, 2500, 1900, 5, 0.5]] as const) {
      const bp = v.filter('bandpass', fa, q);
      bp.frequency.setValueAtTime(fa, t);
      bp.frequency.linearRampToValueAtTime(fb, t + 0.22);
      bp.frequency.exponentialRampToValueAtTime(fc, t + d);
      const fg = v.gain(a);
      rasp.connect(bp);
      bp.connect(fg);
      fg.connect(env);
    }
    // peito: o grave direto
    const chest = v.filter('lowpass', 240, 0.7);
    const cg = v.gain(0.55);
    rasp.connect(chest);
    chest.connect(cg);
    cg.connect(env);
    env.connect(v.out);
    // onda de choque: baque grave + ar empurrado
    const b = tone(v, 'sine', 58, t, 0.004, 0.7, 1);
    glide(b.frequency, t, 66, 30, 0.7);
    burst(v, 'brown', 'lowpass', 300, 0.5, t, 0.004, 0.55, 0.45);
    whoosh(v, t, 220, 900, 160, 0.5, 0.8, 0.35);
    v.send(v.out, 0.45);
  },

  /** Volta a humano: sopro que desce do agudo ao grave e um brilho que some. */
  revert(v, t) {
    const d = 0.95;
    const src = v.noise('pink', t, t + d + 0.03);
    const bp = v.filter('bandpass', 2600, 1.3);
    glide(bp.frequency, t, 2600, 240, d);
    const g = v.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.1);
    g.gain.linearRampToValueAtTime(0.3, t + d * 0.55);
    g.gain.exponentialRampToValueAtTime(1e-4, t + d);
    src.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    // brilho: parciais agudas que descem uma oitava e somem
    const sg = v.gain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.045, t + 0.05);
    sg.gain.linearRampToValueAtTime(0.028, t + d * 0.45);
    sg.gain.exponentialRampToValueAtTime(1e-4, t + d);
    sg.connect(v.out);
    for (const [r, a] of [[1, 1], [1.5, 0.55], [2.01, 0.4], [2.99, 0.25]] as const) {
      const s = v.osc('sine', 1320 * r, t, t + d + 0.02);
      glide(s.frequency, t, 1320 * r, 660 * r, d);
      const pg = v.gain(a);
      s.connect(pg);
      pg.connect(sg);
    }
    // o corpo encolhe: grave curto que cai
    const b = tone(v, 'sine', 92, t, 0.02, 0.3, 0.45);
    glide(b.frequency, t, 92, 46, 0.4);
    v.send(v.out, 0.4);
  },

  /**
   * Garra do leão: patada pesada — sopro grave e largo do braço, três unhas rasgando o ar uma atrás da outra,
   * o bufo curto da fera e o peso do corpo indo junto.
   */
  claw(v, t) {
    const p = vary(1, 0.06);
    whoosh(v, t, 150 * p, 820 * p, 200 * p, 0.36, 0.8, 1.0);
    whoosh(v, t + 0.04, 520 * p, 2300 * p, 700 * p, 0.22, 1.3, 0.4);
    // três unhas: raspas agudas que descem
    for (let k = 0; k < 3; k++) {
      const tk = t + 0.1 + k * 0.024;
      const sc = burst(v, 'white', 'bandpass', 2800 * p, 6, tk, 0.003, 0.55 - k * 0.1, 0.07);
      glide(sc.frequency, tk, 3400 * p, 1300 * p, 0.07);
    }
    // bufo: serra grave curta e abafada
    const lp = v.filter('lowpass', 520, 2);
    lp.connect(v.out);
    const g = tone(v, 'sawtooth', 84 * p, t + 0.03, 0.02, 0.22, 0.2, lp);
    glide(g.frequency, t + 0.03, 96 * p, 66 * p, 0.2);
    // peso do corpo
    const b = tone(v, 'sine', 92, t + 0.08, 0.005, 0.4, 0.22);
    glide(b.frequency, t + 0.08, 110, 46, 0.18);
    v.send(v.out, 0.1);
  },

  /**
   * Carga do rugido: rosnado grave que incha até a carga ficar pronta (`dur`) e segue baixo e ameaçador até ser
   * cortado de fora (soltou ou desistiu). Serras desafinadas pela garganta (tremor de amplitude), filtro abrindo,
   * ar e um ronco de terra por baixo.
   */
  growl(v, t, o) {
    const d = o.dur ?? 0.6;
    const end = t + 20;
    const f0 = 58 * vary(1, 0.04);
    const lp = v.filter('lowpass', 160, 2.5);
    glide(lp.frequency, t, 160, 950, d);
    lp.frequency.setTargetAtTime(520, t + d, 0.3);
    for (const [k, a] of [[1, 0.55], [1.014, 0.45], [2.005, 0.22]] as const) {
      const s = v.osc('sawtooth', f0 * k, t, end);
      glide(s.frequency, t, f0 * k * 0.86, f0 * k * 1.12, d);
      const sg = v.gain(a);
      s.connect(sg);
      sg.connect(lp);
    }
    // garganta: tremor de amplitude que acelera junto com a carga
    const rasp = v.gain(0.6);
    const am = v.osc('sine', 18, t, end);
    glide(am.frequency, t, 18, 27, d);
    const amg = v.gain(0.4);
    am.connect(amg);
    amg.connect(rasp.gain);
    lp.connect(rasp);
    // ar pela garganta
    const air = v.noise('pink', t, end);
    const abp = v.filter('bandpass', 380, 1.4);
    glide(abp.frequency, t, 380, 900, d);
    const ag = v.gain();
    ag.gain.setValueAtTime(0, t);
    ag.gain.linearRampToValueAtTime(0.35, t + d);
    ag.gain.setTargetAtTime(0.12, t + d + 0.02, 0.3);
    air.connect(abp);
    abp.connect(ag);
    ag.connect(rasp);
    const g = v.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.5, t + d);
    g.gain.setTargetAtTime(0.2, t + d + 0.02, 0.35);
    rasp.connect(g);
    g.connect(v.out);
    // ronco de terra
    const rum = v.noise('brown', t, end);
    const rlp = v.filter('lowpass', 110, 0.7);
    const rg = v.gain();
    rg.gain.setValueAtTime(0, t);
    rg.gain.linearRampToValueAtTime(0.45, t + d);
    rg.gain.setTargetAtTime(0.18, t + d + 0.02, 0.3);
    rum.connect(rlp);
    rlp.connect(rg);
    rg.connect(v.out);
    v.send(v.out, 0.12);
  },

  /** Rugido desistido (soltou cedo, a forma acabou): bufo curto pelo nariz, caindo. */
  snort(v, t) {
    const p = vary(1, 0.08);
    const bp = burst(v, 'pink', 'bandpass', 1100 * p, 1.6, t, 0.012, 1.0, 0.16);
    glide(bp.frequency, t, 1100 * p, 380 * p, 0.15);
    const b = tone(v, 'sine', 80 * p, t, 0.01, 0.35, 0.14);
    glide(b.frequency, t, 84 * p, 50 * p, 0.12);
    v.send(v.out, 0.08);
  },

  /** Passada do leão: mais pesada e abafada que o passo humano (pata larga afundando na lama). */
  paw(v, t) {
    const p = vary(1, 0.12);
    burst(v, 'brown', 'lowpass', 300 * p, 0.6, t, 0.005, 0.8, vary(0.09, 0.2));
    const b = tone(v, 'sine', 80 * p, t, 0.003, 0.5, 0.1);
    glide(b.frequency, t, 100 * p, 50 * p, 0.08);
    const sq = burst(v, 'white', 'bandpass', 620 * p, 3, t + 0.018, 0.008, vary(0.35, 0.25), 0.09);
    glide(sq.frequency, t + 0.018, 700 * p, 220 * p, 0.08);
  },
} satisfies Record<string, SfxFn>;

export type SfxName = keyof typeof SFX;

/** Mesa de mixagem: ganho de cada SFX (ajustado pela loudness medida em debug.ts). */
export const SFX_LEVEL: Record<SfxName, number> = {
  playerSwing: 1, enemyHit: 1, metal: 1.26, enemyDeath: 0.65, enemyWindup: 1.9, enemySwing: 1.33,
  playerHurt: 1, playerDeath: 0.45, dash: 1, chargeStart: 0.58, chargeReady: 1, chargeCancel: 1.6,
  iaidoSwell: 0.84, iaidoCut: 0.6, footstep: 2, waveStart: 0.65, waveClear: 0.7, thunder: 0.35, heartbeat: 0.7,
  taiko: 0.5, taikoKa: 2.5, furyReady: 0.65, lionSwell: 0.5, roar: 0.66, revert: 0.9, claw: 1.1, growl: 0.65,
  snort: 1, paw: 0.42,
};

/** Duração a renderizar nas medições (som + cauda do reverb). */
export const SFX_LEN: Record<SfxName, number> = {
  playerSwing: 1.4, enemyHit: 1.3, metal: 1.8, enemyDeath: 1.8, enemyWindup: 1.6, enemySwing: 1.4,
  playerHurt: 1.4, playerDeath: 7.5, dash: 1.2, chargeStart: 1.5, chargeReady: 3.5, chargeCancel: 0.6,
  iaidoSwell: 1.2, iaidoCut: 5, footstep: 0.5, waveStart: 4, waveClear: 7.5, thunder: 9.5, heartbeat: 0.8,
  taiko: 3, taikoKa: 1.5, furyReady: 3.5, lionSwell: 4, roar: 4, revert: 2.5, claw: 1.6, growl: 2, snort: 1,
  paw: 0.8,
};
