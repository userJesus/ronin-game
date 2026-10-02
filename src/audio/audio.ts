// Áudio procedural (Web Audio, sem arquivos): golpes, impactos, passos, chuva, vento, trovão, taiko e drone.
// Antes do unlock (gesto do usuário) tudo é no-op; nada aqui lança exceção se o Web Audio faltar.
import type { Sim } from '../sim/sim';
import type { SimEvent } from '../sim/types';
import type { LevelStats, MixScene } from './debug';
import { Director } from './director';
import { Engine } from './engine';
import type { SfxName, SfxOpts } from './sfx';

export interface AudioSystem {
  /** Chamar dentro de um gesto do usuário (clique/tecla) para liberar o AudioContext. */
  unlock(): void;
  handle(ev: SimEvent, sim: Sim): void;
  /** Ambiente contínuo (chuva, vento, tambor da onda). `playing` = partida em andamento. */
  update(dt: number, sim: Sim, playing: boolean): void;
  /** Trovão distante (sincronizado com o relâmpago do cenário), força 0..1. */
  thunder(strength: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

/** Ganchos de teste (fora do contrato): `window.__game.audio.debugRender('enemyHit')` etc. */
export interface AudioDebug {
  /** Renderiza um SFX num OfflineAudioContext e mede pico/RMS (dBFS); `post` inclui master + compressor. */
  debugRender(name: SfxName, opts?: SfxOpts, post?: boolean): Promise<LevelStats | null>;
  /** Todos os SFX de uma vez. */
  debugRenderAll(post?: boolean): Promise<LevelStats[] | null>;
  /** Mistura completa pelo grafo real, compressor incluso. */
  debugMix(scene?: MixScene): Promise<LevelStats | null>;
  debugState(): {
    ctx: string; muted: boolean; created: number; released: number; pools: Record<string, number>; error: string;
    /** Valores atuais: corte do abafador (Hz), silêncio do iaido, música e master (ganho). */
    params: { muffle: number; duck: number; music: number; master: number } | null;
  };
}

const MUTED_KEY = 'ronin-game:muted';

function loadMuted(): boolean {
  try { return localStorage.getItem(MUTED_KEY) === '1'; } catch { return false; }
}
function saveMuted(m: boolean): void {
  try { localStorage.setItem(MUTED_KEY, m ? '1' : '0'); } catch { /* armazenamento indisponível */ }
}

type AudioCtor = typeof AudioContext;
function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

export function createAudio(): AudioSystem {
  let muted = loadMuted();
  let ctx: AudioContext | null = null;
  let dir: Director | null = null;
  /** Web Audio ausente ou quebrado: desiste de vez. */
  let broken = false;
  let hiddenSuspend = false;
  let lastError = '';

  const report = (err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === lastError) return;
    lastError = msg;
    console.warn('[áudio]', err);
  };
  const running = (): boolean => dir !== null && ctx !== null && ctx.state === 'running';

  const onGesture = (): void => sys.unlock();
  const listen = (on: boolean): void => {
    if (typeof window === 'undefined') return;
    for (const g of GESTURES) {
      if (on) window.addEventListener(g, onGesture, { capture: true, passive: true });
      else window.removeEventListener(g, onGesture, { capture: true });
    }
  };

  const sys: AudioSystem & AudioDebug = {
    unlock() {
      if (broken) return;
      try {
        if (!ctx) {
          const AC = audioCtor();
          if (!AC) { broken = true; listen(false); return; }
          // sem gesto ainda (ex.: ?autostart): os ouvintes de gesto tentam de novo
          const ua = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
          if (ua && !ua.hasBeenActive) return;
          const c = new AC({ latencyHint: 'interactive' });
          ctx = c;
          const eng = new Engine(c, muted);
          eng.startBeds();
          dir = new Director(eng);
          dir.muted = muted;
          c.onstatechange = () => { if (c.state === 'running') listen(false); };
          // iOS: tocar um buffer vazio dentro do gesto destrava a saída
          const s = c.createBufferSource();
          s.buffer = c.createBuffer(1, 1, c.sampleRate);
          s.connect(c.destination);
          s.onended = () => s.disconnect();
          s.start();
        }
        if (ctx.state === 'running') listen(false);
        else if (ctx.state !== 'closed' && !document.hidden) void ctx.resume().catch(() => { /* sem gesto: tenta no próximo */ });
      } catch (err) {
        if (!ctx) { broken = true; listen(false); }
        report(err);
      }
    },

    handle(ev, sim) {
      if (muted || !running()) return;
      try { dir!.handle(ev, sim); } catch (err) { report(err); }
    },

    update(dt, sim, playing) {
      if (!running()) return;
      try { dir!.update(dt, sim, playing); } catch (err) { report(err); }
    },

    thunder(strength) {
      if (muted || !running()) return;
      try { dir!.thunder(strength); } catch (err) { report(err); }
    },

    setMuted(m) {
      muted = m;
      saveMuted(m);
      if (!dir) return;
      try {
        dir.muted = m;
        dir.e.setMuted(m);
        if (m) dir.silence();
      } catch (err) { report(err); }
    },

    get muted() { return muted; },

    async debugRender(name, opts, post) {
      if (typeof OfflineAudioContext === 'undefined') return null;
      return (await import('./debug')).renderSfx(name, opts, 1, post);
    },
    async debugRenderAll(post) {
      if (typeof OfflineAudioContext === 'undefined') return null;
      return (await import('./debug')).renderAll(post);
    },
    async debugMix(scene) {
      if (typeof OfflineAudioContext === 'undefined') return null;
      return (await import('./debug')).renderMix(scene);
    },
    debugState() {
      const e = dir?.e;
      return {
        ctx: ctx?.state ?? (broken ? 'unavailable' : 'none'),
        muted,
        created: e?.created ?? 0,
        released: e?.released ?? 0,
        pools: e?.poolSizes() ?? {},
        error: lastError,
        params: e ? {
          muffle: Math.round(e.muffle.frequency.value),
          duck: Math.round(e.duck.gain.value * 100) / 100,
          music: Math.round(e.bus.music.gain.value * 100) / 100,
          master: Math.round(e.master.gain.value * 100) / 100,
        } : null,
      };
    },
  };

  listen(true);
  if (typeof document !== 'undefined') {
    // aba escondida: suspende (a chuva não fica tocando no fundo); volta ao reaparecer
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) {
        if (ctx.state === 'running') { hiddenSuspend = true; void ctx.suspend().catch(() => {}); }
      } else if (hiddenSuspend) {
        hiddenSuspend = false;
        void ctx.resume().catch(() => {});
      }
    });
  }
  return sys;
}
