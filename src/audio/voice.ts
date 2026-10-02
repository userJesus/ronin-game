// Vozes de SFX: agrupam os nós de um som, desconectam tudo ao terminar e podem ser cortadas.
// Também guarda o "kit" por contexto: buffers de ruído em laço e a resposta ao impulso do reverb.
import { Rng } from '../core/math';

/** Onde um som é agendado: contexto + entrada seca + envio de reverb (opcional). */
export interface Dest {
  ctx: BaseAudioContext;
  out: AudioNode;
  rvb: AudioNode | null;
}

export type NoiseKind = 'white' | 'pink' | 'brown';

interface Kit { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer; ir: AudioBuffer }
const kits = new WeakMap<BaseAudioContext, Kit>();

// variação aleatória dos sons (fora da simulação: PRNG próprio, re-semeável para medições)
let rng = new Rng(0x7a1d);
export const rand = (): number => rng.next();
/** x com variação relativa de ±amt. */
export const vary = (x: number, amt: number): number => x * (1 + (rng.next() * 2 - 1) * amt);
export function reseedAudio(seed: number): void { rng = new Rng(seed); }

/** Ruído em laço sem estalo na emenda (o fim entra no começo em cross-fade), normalizado por RMS. */
function makeNoise(ctx: BaseAudioContext, kind: NoiseKind, seconds: number, rms: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), fade = Math.floor(sr * 0.05);
  const r = new Rng(kind === 'white' ? 11 : kind === 'pink' ? 23 : 37);
  const tmp = new Float32Array(n + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n + fade; i++) {
    const w = r.next() * 2 - 1;
    if (kind === 'white') tmp[i] = w;
    else if (kind === 'pink') {
      // filtro de Paul Kellet
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      tmp[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      tmp[i] = last;
    }
  }
  for (let i = 0; i < fade; i++) { const k = i / fade; tmp[i] = tmp[i] * k + tmp[n + i] * (1 - k); }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += tmp[i];
  mean /= n;
  let s = 0;
  for (let i = 0; i < n; i++) { const x = tmp[i] - mean; s += x * x; }
  const g = rms / Math.max(1e-9, Math.sqrt(s / n));
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (tmp[i] - mean) * g;
  return buf;
}

/** Resposta ao impulso estéreo: pré-atraso, reflexões iniciais e cauda de ruído que escurece ao decair. */
function makeIr(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), pre = Math.floor(sr * 0.014);
  const buf = ctx.createBuffer(2, n, sr);
  const taps = [0.011, 0.023, 0.034, 0.052, 0.067, 0.089];
  for (let ch = 0; ch < 2; ch++) {
    const r = new Rng(101 + ch);
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const a = 0.06 + 0.7 * Math.exp(-t * 2.4);
      y += a * (r.next() * 2 - 1 - y);
      d[i] = y * Math.exp(-t * 2.9) * Math.min(1, t * 60);
    }
    for (let k = 0; k < taps.length; k++) {
      const i = pre + Math.floor(sr * (taps[k] + ch * 0.0037 * (k + 1)));
      if (i < n) d[i] += (ch === k % 2 ? 0.55 : 0.4) * (1 - k / taps.length);
    }
  }
  return buf;
}

export function kit(ctx: BaseAudioContext): Kit {
  let k = kits.get(ctx);
  if (!k) {
    k = {
      white: makeNoise(ctx, 'white', 2, 0.5),
      pink: makeNoise(ctx, 'pink', 5, 0.3),
      brown: makeNoise(ctx, 'brown', 4, 0.35),
      ir: makeIr(ctx, 2.6),
    };
    kits.set(ctx, k);
  }
  return k;
}

/** Envelope ataque-queda: 0 -> pico (linear) -> silêncio (exponencial). Devolve o instante final. */
export function ad(p: AudioParam, t: number, att: number, peak: number, dec: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + att);
  p.exponentialRampToValueAtTime(1e-4, t + att + dec);
  return t + att + dec;
}

/** Um som: todos os nós são desconectados quando a última fonte termina (ou quando é cortado). */
export class Voice {
  readonly ctx: BaseAudioContext;
  /** Ganho de saída da voz (nível/distância). */
  readonly out: GainNode;
  /** Tempo do contexto em que foi criada. */
  readonly born: number;
  /** Maior instante de parada agendado. */
  end = 0;
  done = false;
  onDone: ((v: Voice) => void) | null = null;
  private readonly rvb: AudioNode | null;
  private readonly nodes: AudioNode[] = [];
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private live = 0;

  constructor(d: Dest, gain = 1, pan = 0) {
    this.ctx = d.ctx;
    this.born = d.ctx.currentTime;
    this.rvb = d.rvb;
    this.out = d.ctx.createGain();
    this.out.gain.value = gain;
    if (pan !== 0) {
      const p = d.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      this.out.connect(p);
      p.connect(d.out);
      this.nodes.push(p);
    } else this.out.connect(d.out);
  }

  gain(value = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    this.nodes.push(g);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    this.nodes.push(f);
    return f;
  }

  osc(type: OscillatorType, freq: number, t0: number, t1: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    this.play(o, t0, t1);
    return o;
  }

  noise(kind: NoiseKind, t0: number, t1: number, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    const buf = kit(this.ctx)[kind];
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    this.play(s, t0, t1, rand() * buf.duration);
    return s;
  }

  /** Envia `from` ao reverb com o nível dado. */
  send(from: AudioNode, amount: number): void {
    if (!this.rvb || amount <= 0) return;
    const g = this.gain(amount);
    from.connect(g);
    g.connect(this.rvb);
  }

  /** Nenhuma fonte agendada: libera já. */
  seal(): this {
    if (this.live === 0) this.release();
    return this;
  }

  /** Corta a voz com um fade curto (roubo de voz, cancelamentos). */
  kill(fade = 0.02): void {
    if (this.done) return;
    const now = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    const stopAt = now + fade + 0.005;
    if (stopAt < this.end) {
      for (let i = 0; i < this.srcs.length; i++) {
        try { this.srcs[i].stop(stopAt); } catch { /* já terminou */ }
      }
      this.end = stopAt;
    }
  }

  private play(src: AudioScheduledSourceNode, t0: number, t1: number, offset = 0): void {
    this.nodes.push(src);
    this.srcs.push(src);
    this.live++;
    src.onended = () => { if (--this.live <= 0) this.release(); };
    if (src instanceof AudioBufferSourceNode) src.start(t0, offset);
    else src.start(t0);
    src.stop(t1);
    if (t1 > this.end) this.end = t1;
  }

  release(): void {
    if (this.done) return;
    this.done = true;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n instanceof AudioScheduledSourceNode) n.onended = null;
      n.disconnect();
    }
    this.out.disconnect();
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.onDone?.(this);
  }
}
