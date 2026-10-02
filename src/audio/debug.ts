// Medição de níveis sem ouvir: renderiza um SFX (ou a mistura inteira) num OfflineAudioContext e mede pico/RMS.
// Carregado sob demanda (import dinâmico) pelos ganchos de teste de audio.ts.
import { LION, type EnemyKind } from '../config';
import type { PlayerState, SimEvent } from '../sim/types';
import { Director, type SimLike } from './director';
import { Engine, MIX } from './engine';
import { SFX, SFX_LEN, SFX_LEVEL, type SfxName, type SfxOpts } from './sfx';
import { Voice, kit, reseedAudio } from './voice';

export interface LevelStats {
  name: string;
  /** Pico amostral (dBFS). */
  peakDb: number;
  /** Maior RMS em janelas de 50 ms (dBFS): "volume percebido" de curto prazo. */
  rmsDb: number;
  /** RMS médio do trecho audível (dBFS). */
  avgDb: number;
  /** Volume percebido: maior loudness momentânea (janela 400 ms, ponderação K), ≈ LUFS-M. */
  lufs: number;
  /** Até quando fica acima de -60 dBFS (s). */
  lenS: number;
}

/** Biquad em JS (coeficientes RBJ normalizados) aplicado no lugar. */
function biquad(x: Float32Array, b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): void {
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
}

/** Ponderação K (BS.1770): prateleira +4 dB em 1681 Hz e passa-altas em 38 Hz. */
function kWeight(d: Float32Array, sr: number): Float32Array {
  const y = new Float32Array(d);
  {
    const A = Math.pow(10, 4 / 40), w = (2 * Math.PI * 1681) / sr, c = Math.cos(w), al = (Math.sin(w) / 2) * Math.SQRT2, sa = 2 * Math.sqrt(A) * al;
    biquad(y, A * (A + 1 + (A - 1) * c + sa), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - sa),
      A + 1 - (A - 1) * c + sa, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - sa);
  }
  {
    const w = (2 * Math.PI * 38) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * 0.5);
    biquad(y, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }
  return y;
}

function loudness(data: Float32Array[], sr: number): number {
  const k = data.map(d => kWeight(d, sr));
  const win = Math.round(sr * 0.4), hop = Math.round(sr * 0.1), n = data[0].length;
  let best = 0;
  for (let i0 = 0; i0 + win <= Math.max(n, win); i0 += hop) {
    let s = 0;
    for (const y of k) {
      let m = 0;
      const i1 = Math.min(n, i0 + win);
      for (let i = i0; i < i1; i++) m += y[i] * y[i];
      s += m / win;
    }
    if (s > best) best = s;
  }
  return best > 0 ? Math.round((-0.691 + 10 * Math.log10(best)) * 10) / 10 : -120;
}

export type MixScene = 'ambient' | 'music' | 'stress' | 'lion';

const SR = 44100;
const db = (x: number): number => (x > 1e-6 ? Math.round(200 * Math.log10(x)) / 10 : -120);

function measure(name: string, buf: AudioBuffer): LevelStats {
  const win = Math.round(buf.sampleRate * 0.05), n = buf.length, chs = buf.numberOfChannels;
  const data: Float32Array[] = [];
  for (let c = 0; c < chs; c++) data.push(buf.getChannelData(c));
  let peak = 0, maxMs = 0, last = 0, first = -1, sum = 0;
  for (let i0 = 0; i0 < n; i0 += win) {
    const i1 = Math.min(n, i0 + win);
    let s = 0;
    for (const d of data) {
      for (let i = i0; i < i1; i++) {
        const x = d[i], a = x < 0 ? -x : x;
        s += x * x;
        if (a > peak) peak = a;
        if (a > 0.001) { last = i; if (first < 0) first = i; }
      }
    }
    sum += s;
    const ms = s / ((i1 - i0) * chs);
    if (ms > maxMs) maxMs = ms;
  }
  const span = Math.max(1, last - Math.max(0, first));
  return {
    name,
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(maxMs)),
    avgDb: db(Math.sqrt(sum / (span * chs))),
    lufs: loudness(data, buf.sampleRate),
    lenS: Math.round((last / buf.sampleRate) * 100) / 100,
  };
}

/**
 * Um SFX isolado. `post` = false: antes do master (barramento + reverb), como entra na mistura;
 * `post` = true: pelo grafo completo (master + compressor), comparável a renderMix('ambient').
 */
export async function renderSfx(name: SfxName, opts: SfxOpts = {}, seed = 1, post = false): Promise<LevelStats> {
  if (!(name in SFX)) throw new Error(`SFX desconhecido: ${name}`);
  // pelo grafo: começa em 0,6 s (o detector do compressor tem um transitório inicial num contexto novo)
  const t0 = post ? 0.6 : 0.01;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (SFX_LEN[name] + t0)), SR);
  reseedAudio(seed);
  if (post) {
    const bus = name === 'thunder' ? 'amb' : name === 'taiko' || name === 'taikoKa' ? 'music' : 'sfx';
    const eng = new Engine(ctx, false);
    if (bus === 'music') eng.bus.music.gain.value = MIX.music;
    const pv = eng.voice(name, 1, bus, SFX_LEVEL[name]);
    SFX[name](pv, t0, opts);
    pv.seal();
    return measure(name, await ctx.startRendering());
  }
  const out = ctx.createGain();
  out.gain.value = name === 'thunder' ? MIX.amb : name === 'taiko' || name === 'taikoKa' ? MIX.music : MIX.sfx;
  out.connect(ctx.destination);
  const rvbIn = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = kit(ctx).ir;
  const ret = ctx.createGain();
  ret.gain.value = MIX.reverb;
  rvbIn.connect(conv);
  conv.connect(ret);
  ret.connect(out);
  const v = new Voice({ ctx, out, rvb: rvbIn }, SFX_LEVEL[name]);
  SFX[name](v, 0.01, opts);
  v.seal();
  return measure(name, await ctx.startRendering());
}

/** Simulação mínima para dirigir o áudio offline (o estado do herói pode mudar no meio da cena). */
function fakeSim(alive: number, hp: number): SimLike & { player: { state: PlayerState } } {
  const enemies: { id: number; kind: EnemyKind }[] = [];
  for (let i = 0; i < alive; i++) enemies.push({ id: i + 1, kind: i % 5 === 0 ? 'brute' : i % 3 === 0 ? 'swift' : 'ronin' });
  return { player: { pos: { x: 0, z: 0 }, hp, state: 'idle' }, enemies, alive, over: false };
}

/**
 * Mistura completa pelo grafo real (camas, música, compressor) dirigida pelo Diretor em passos de 0,1 s.
 * 'ambient': só chuva/vento; 'music': horda cheia + vida baixa; 'stress': tudo de uma vez (pior caso);
 * 'lion': horda cheia + Fúria pronta, transformação com rugido, galope do leão, duas garras que acertam,
 * o rugido carregado (rosnado, carga pronta, onda) e a volta a humano.
 */
export async function renderMix(scene: MixScene = 'stress'): Promise<LevelStats> {
  const len = scene === 'lion' ? 9 : scene === 'stress' ? 7 : 6;
  const ctx = new OfflineAudioContext(2, SR * len, SR);
  reseedAudio(3);
  const eng = new Engine(ctx, false);
  eng.startBeds();
  const dir = new Director(eng);
  const sim = fakeSim(scene === 'ambient' ? 0 : 14, scene === 'ambient' || scene === 'lion' ? 100 : 20);
  const playing = scene !== 'ambient';
  const at = (x: number, z: number) => ({ x, z });
  const burst = (): void => {
    const evs: SimEvent[] = [
      { type: 'playerSwing', step: 2, pos: at(0, 0), dir: at(1, 0), range: 2.8, halfArc: 1 },
      { type: 'iaidoCut', from: at(0, 0), to: at(7, 0), dir: at(1, 0), hits: 5, kills: 5 },
      { type: 'playerHurt', pos: at(0, 0), dir: at(1, 0), damage: 20, hp: 20 },
      { type: 'waveStart', wave: 3, total: 20 },
    ];
    for (let i = 0; i < 6; i++) {
      const p = at(Math.cos(i) * 1.5, Math.sin(i) * 1.5);
      evs.push({ type: 'enemyHit', id: i + 1, kind: 'brute', pos: p, dir: at(1, 0), damage: 6, heavy: true, killed: true });
      evs.push({ type: 'enemyDeath', id: i + 1, kind: 'brute', pos: p, dir: at(1, 0), score: 100 });
      evs.push({ type: 'enemyWindup', id: i + 1, pos: p, dir: at(1, 0), duration: 0.5, reach: 2, halfArc: 1 });
      evs.push({ type: 'enemySwing', id: i + 1, pos: p, dir: at(1, 0), reach: 2, halfArc: 1 });
    }
    for (const ev of evs) dir.handle(ev, sim);
    dir.thunder(1);
  };
  // roteiro da cena do leão (s): o rugido sai LION.burstAt depois do início (arredondado à grade de 0,1 s)
  const tStart = 1, tBurst = tStart + Math.round(LION.burstAt * 10) / 10, tEnd = tStart + Math.round(LION.transformDur * 10) / 10;
  // ataques do leão: duas garras, depois carga do rugido -> pronta -> soltar -> onda
  const grid = (x: number): number => Math.round(x * 10) / 10;
  const tClaws = [tEnd + 0.4, tEnd + 1];
  const tCharge = tEnd + 1.8, tReady = grid(tCharge + LION.roar.chargeTime), tRelease = tReady + 0.1;
  const tRoar = grid(tRelease + LION.roar.blastAt), tRoarEnd = grid(tRelease + LION.roar.dur);
  const tRevert = 7.4, tBack = tRevert + LION.revertDur;
  const near = (t: number, at: number): boolean => Math.abs(t - at) < 1e-6;
  const lionHits = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const p = at(Math.cos(i) * 3, Math.sin(i) * 3);
      dir.handle({ type: 'enemyHit', id: i + 1, kind: 'ronin', pos: p, dir: at(1, 0), damage: 4, heavy: true, killed: true }, sim);
      dir.handle({ type: 'enemyDeath', id: i + 1, kind: 'ronin', pos: p, dir: at(1, 0), score: 100 }, sim);
    }
  };
  const lion = (t: number): void => {
    const pos = sim.player.pos, dir0 = at(1, 0);
    if (near(t, 0.5)) dir.handle({ type: 'furyReady', pos }, sim);
    if (near(t, tStart)) {
      sim.player.state = 'transform';
      dir.handle({ type: 'transformStart', pos, dir: dir0 }, sim);
    }
    if (near(t, tBurst)) dir.handle({ type: 'transformBurst', pos, radius: LION.burstRadius, pushed: 6 }, sim);
    if (near(t, tEnd)) {
      sim.player.state = 'run';
      dir.handle({ type: 'transformEnd', pos }, sim);
    }
    if (t > tEnd && t < tCharge && Math.round(t * 10) % 3 === 0) dir.handle({ type: 'footstep', pos, paw: true }, sim);
    for (const tc of tClaws) {
      if (near(t, tc)) {
        sim.player.state = 'claw';
        dir.handle({ type: 'lionClaw', pos, dir: dir0, range: LION.claw.range, halfArc: LION.claw.halfArc }, sim);
        lionHits(2);
      }
      if (near(t, grid(tc + LION.claw.dur))) sim.player.state = 'run';
    }
    if (near(t, tCharge)) {
      sim.player.state = 'roarCharge';
      dir.handle({ type: 'lionRoarCharge', pos }, sim);
    }
    if (near(t, tReady)) dir.handle({ type: 'lionRoarReady', pos }, sim);
    if (near(t, tRelease)) sim.player.state = 'roar';
    if (near(t, tRoar)) {
      dir.handle({ type: 'lionRoar', pos, dir: dir0, radius: LION.roar.radius, hits: 5, kills: 5 }, sim);
      lionHits(5);
    }
    if (near(t, tRoarEnd)) sim.player.state = 'idle';
    if (near(t, tRevert)) {
      sim.player.state = 'revert';
      dir.handle({ type: 'revertStart', pos, reason: 'timeout' }, sim);
    }
    if (near(t, tBack)) {
      sim.player.state = 'idle';
      dir.handle({ type: 'revertEnd', pos }, sim);
    }
  };
  const step = 0.1;
  for (let k = 1; k * step < len - 0.05; k++) {
    const t = k * step;
    void ctx.suspend(t).then(() => {
      if (scene === 'lion') lion(t);
      dir.update(step, sim, playing);
      if (scene === 'stress' && (Math.abs(t - 1) < 1e-6 || Math.abs(t - 3) < 1e-6)) burst();
      if (scene === 'stress' && Math.abs(t - 3.5) < 1e-6) dir.handle({ type: 'waveClear', wave: 3, heal: 25 }, sim);
      if (scene === 'music' && Math.round(t * 10) % 3 === 0) dir.handle({ type: 'footstep', pos: sim.player.pos }, sim);
      return ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const st = measure(`mix:${scene}`, buf);
  return st;
}

/** Todos os SFX, na ordem da tabela. */
export async function renderAll(post = false): Promise<LevelStats[]> {
  const out: LevelStats[] = [];
  const cases: [SfxName, SfxOpts][] = [
    ['playerSwing', { step: 0 }], ['playerSwing', { step: 1 }], ['playerSwing', { step: 2 }],
    ['enemyHit', {}], ['enemyHit', { kind: 'brute', killed: true }], ['metal', {}], ['enemyDeath', {}],
    ['enemyWindup', {}], ['enemyWindup', { kind: 'brute' }], ['enemyWindup', { kind: 'swift' }],
    ['enemySwing', {}], ['playerHurt', {}], ['playerDeath', {}], ['dash', {}], ['chargeStart', {}],
    ['chargeReady', {}], ['chargeCancel', {}], ['iaidoSwell', {}], ['iaidoCut', { hits: 3 }], ['footstep', {}],
    ['waveStart', {}], ['waveClear', {}], ['thunder', { strength: 1 }], ['thunder', { strength: 0.3 }],
    ['heartbeat', {}], ['taiko', { vel: 1 }], ['taikoKa', { vel: 0.6 }],
    ['furyReady', {}], ['lionSwell', { dur: LION.burstAt }], ['roar', {}], ['revert', {}], ['paw', {}],
    ['claw', {}], ['growl', { dur: LION.roar.chargeTime }], ['chargeReady', { pitch: 0.5 }], ['snort', {}],
  ];
  for (const [name, o] of cases) {
    const s = await renderSfx(name, o, 1, post);
    const tag = o.step !== undefined ? `:${o.step}` : o.kind ? `:${o.kind}` : o.strength !== undefined ? `:${o.strength}`
      : o.pitch !== undefined ? `:${o.pitch}` : '';
    out.push({ ...s, name: name + tag });
  }
  return out;
}
