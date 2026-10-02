// Grafo de áudio: barramentos sfx/ambiente/música, reverb por convolução, "abafar" (morte), master e compressor.
// Também as camas contínuas (chuva, vento, drone) e o limite de vozes por tipo.
//   sfx ─────────────┐
//   amb ──┐          ├─> muffle (passa-baixa) -> master (mudo) -> compressor -> destino
//   music ┴─> duck ──┤
//   rvbIn -> convolver -> rvbOut ┘
import { Voice, kit, rand, type Dest } from './voice';

export type Bus = 'sfx' | 'amb' | 'music';

/** Mixagem (ganhos lineares). Ajustados com as medições de debug.ts. */
export const MIX = {
  master: 0.45,
  sfx: 1,
  amb: 1,
  music: 0.55,
  reverb: 0.5,
  rain: 0.1,
  patter: 0.018,
  wind: 0.1,
};

/** Cancela automações futuras mantendo o valor atual (sem salto). */
function hold(p: AudioParam, now: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
  else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
}

export class Engine {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly comp: DynamicsCompressorNode;
  readonly muffle: BiquadFilterNode;
  /** Abaixa ambiente + música (silêncio do iaido). */
  readonly duck: GainNode;
  readonly bus: Record<Bus, GainNode>;
  readonly rvbIn: GainNode;
  /** Vozes criadas / liberadas (vazamento = diferença que só cresce). */
  created = 0;
  released = 0;
  private readonly dest: Record<Bus, Dest>;
  private readonly pools = new Map<string, Voice[]>();
  private readonly onRelease = (): void => { this.released++; };
  // camas contínuas
  private readonly rainHp: BiquadFilterNode;
  private readonly rainLp: BiquadFilterNode;
  private readonly rainGain: GainNode;
  private readonly patterGain: GainNode;
  private readonly windBp: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly droneLp: BiquadFilterNode;
  private readonly droneGain: GainNode;
  private readonly fifthGain: GainNode;
  private bedsOn = false;

  constructor(ctx: BaseAudioContext, muted = false) {
    this.ctx = ctx;
    const c = ctx;
    const comp = c.createDynamicsCompressor();
    // razão alta: o ganho de compensação automático do compressor não deixa o pico passar de ~-1.5 dBFS
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.001;
    comp.release.value = 0.2;
    this.comp = comp;
    this.master = c.createGain();
    this.master.gain.value = muted ? 0 : MIX.master;
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0;
    this.muffle.connect(this.master);
    this.master.connect(comp);
    comp.connect(c.destination);

    this.duck = c.createGain();
    this.duck.connect(this.muffle);
    const sfx = c.createGain(), amb = c.createGain(), music = c.createGain();
    sfx.gain.value = MIX.sfx;
    amb.gain.value = MIX.amb;
    music.gain.value = 0;
    sfx.connect(this.muffle);
    amb.connect(this.duck);
    music.connect(this.duck);
    this.bus = { sfx, amb, music };

    const conv = c.createConvolver();
    conv.buffer = kit(c).ir;
    const rvbOut = c.createGain();
    rvbOut.gain.value = MIX.reverb;
    this.rvbIn = c.createGain();
    this.rvbIn.connect(conv);
    conv.connect(rvbOut);
    rvbOut.connect(this.muffle);
    this.dest = {
      sfx: { ctx: c, out: sfx, rvb: this.rvbIn },
      amb: { ctx: c, out: amb, rvb: this.rvbIn },
      music: { ctx: c, out: music, rvb: this.rvbIn },
    };

    // chuva: dois ruídos rosa (estéreo descorrelacionado) + chuvisco agudo; vento: marrom em passa-banda
    this.rainHp = c.createBiquadFilter();
    this.rainHp.type = 'highpass';
    this.rainHp.frequency.value = 380;
    this.rainLp = c.createBiquadFilter();
    this.rainLp.type = 'lowpass';
    this.rainLp.frequency.value = 5000;
    this.rainGain = c.createGain();
    this.rainGain.gain.value = MIX.rain;
    this.rainHp.connect(this.rainLp);
    this.rainLp.connect(this.rainGain);
    this.rainGain.connect(amb);
    this.patterGain = c.createGain();
    this.patterGain.gain.value = MIX.patter;
    this.patterGain.connect(amb);
    this.windBp = c.createBiquadFilter();
    this.windBp.type = 'bandpass';
    this.windBp.frequency.value = 280;
    this.windBp.Q.value = 1.3;
    this.windGain = c.createGain();
    this.windGain.gain.value = MIX.wind * 0.6;
    this.windBp.connect(this.windGain);
    this.windGain.connect(amb);

    // drone grave da música (a intensidade abre o filtro e soma a quinta)
    this.droneLp = c.createBiquadFilter();
    this.droneLp.type = 'lowpass';
    this.droneLp.frequency.value = 150;
    this.droneLp.Q.value = 3;
    this.droneGain = c.createGain();
    this.droneGain.gain.value = 0;
    this.fifthGain = c.createGain();
    this.fifthGain.gain.value = 0;
    this.fifthGain.connect(this.droneLp);
    this.droneLp.connect(this.droneGain);
    this.droneGain.connect(music);
  }

  /** Liga as fontes contínuas (uma vez). */
  startBeds(): void {
    if (this.bedsOn) return;
    this.bedsOn = true;
    const c = this.ctx, k = kit(c), t = c.currentTime + 0.02;
    const loop = (buf: AudioBuffer, offset: number, to: AudioNode, pan = 0, rate = 1): void => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      if (pan !== 0) {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        s.connect(p);
        p.connect(to);
      } else s.connect(to);
      s.start(t, offset);
    };
    loop(k.pink, 0, this.rainHp, -0.65);
    loop(k.pink, 2.4, this.rainHp, 0.65, 0.97);
    const pb = c.createBiquadFilter();
    pb.type = 'bandpass';
    pb.frequency.value = 3400;
    pb.Q.value = 0.8;
    pb.connect(this.patterGain);
    loop(k.white, 0.7, pb);
    loop(k.brown, 1.3, this.windBp);

    const saw = (f: number, to: AudioNode, g: number): void => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const gn = c.createGain();
      gn.gain.value = g;
      o.connect(gn);
      gn.connect(to);
      o.start(t);
    };
    saw(55, this.droneLp, 0.5);
    saw(55.23, this.droneLp, 0.5);
    saw(82.41, this.fifthGain, 1);
    const sub = c.createOscillator();
    sub.frequency.value = 27.5;
    const sg = c.createGain();
    sg.gain.value = 0.35;
    sub.connect(sg);
    sg.connect(this.droneLp);
    sub.start(t);
    // respiração lenta do filtro
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = c.createGain();
    lg.gain.value = 40;
    lfo.connect(lg);
    lg.connect(this.droneLp.frequency);
    lfo.start(t);
  }

  /**
   * Nova voz no barramento, respeitando o limite `max` do tipo `cat` (a mais antiga é cortada).
   * Vozes do mesmo tipo disparadas quase juntas somam menos (`crowd`), para grupos não estourarem.
   */
  voice(cat: string, max: number, bus: Bus, gain = 1, pan = 0, crowd = 0.45): Voice {
    const now = this.ctx.currentTime;
    let list = this.pools.get(cat);
    if (!list) { list = []; this.pools.set(cat, list); }
    for (let i = list.length - 1; i >= 0; i--) if (list[i].done) list.splice(i, 1);
    while (list.length >= max) list.shift()!.kill(0.015);
    let recent = 0;
    for (let i = 0; i < list.length; i++) if (now - list[i].born < 0.05) recent++;
    const v = new Voice(this.dest[bus], gain / (1 + crowd * recent), pan);
    v.onDone = this.onRelease;
    this.created++;
    list.push(v);
    return v;
  }

  /** Vozes vivas por tipo (depuração). */
  poolSizes(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, list] of this.pools) {
      let n = 0;
      for (const v of list) if (!v.done) n++;
      out[k] = n;
    }
    return out;
  }

  setMuted(m: boolean): void {
    const now = this.ctx.currentTime;
    hold(this.master.gain, now);
    this.master.gain.setTargetAtTime(m ? 0 : MIX.master, now, 0.03);
  }

  /** Morte: tudo vai ficando abafado; ao voltar, reabre. */
  setMuffle(on: boolean): void {
    const now = this.ctx.currentTime, f = this.muffle.frequency;
    hold(f, now);
    f.setTargetAtTime(on ? 480 : 20000, now, on ? 0.5 : 0.25);
  }

  /** Silêncio súbito do ambiente e da música por `dur` segundos (iaido). */
  duckFor(dur: number): void {
    const now = this.ctx.currentTime, g = this.duck.gain;
    hold(g, now);
    g.linearRampToValueAtTime(0.05, now + 0.025);
    g.setValueAtTime(0.05, now + dur);
    g.linearRampToValueAtTime(1, now + dur + 0.7);
  }

  /** Nova rajada de chuva/vento que dura ~`len` segundos. */
  gust(len: number): void {
    const now = this.ctx.currentTime, tau = len * 0.35;
    this.rainGain.gain.setTargetAtTime(MIX.rain * (0.72 + rand() * 0.45), now, tau);
    this.rainLp.frequency.setTargetAtTime(3600 + rand() * 2600, now, tau);
    this.patterGain.gain.setTargetAtTime(MIX.patter * (0.6 + rand() * 0.8), now, tau);
    this.windGain.gain.setTargetAtTime(MIX.wind * (0.3 + rand() * 0.9), now, tau);
    this.windBp.frequency.setTargetAtTime(170 + rand() * 280, now, tau);
  }

  /** Liga/desliga a música (fade suave). */
  setMusicOn(on: boolean): void {
    const now = this.ctx.currentTime, g = this.bus.music.gain;
    hold(g, now);
    g.setTargetAtTime(on ? MIX.music : 0, now, on ? 0.9 : 0.45);
  }

  /** Intensidade 0..1 do drone. */
  setDrone(i: number): void {
    const now = this.ctx.currentTime, tau = 0.35;
    this.droneGain.gain.setTargetAtTime(0.09 + 0.13 * i, now, tau);
    this.droneLp.frequency.setTargetAtTime(150 + 560 * i, now, tau);
    this.fifthGain.gain.setTargetAtTime(0.45 * i, now, tau);
  }
}
