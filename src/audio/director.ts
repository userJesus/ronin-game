// Diretor de áudio: traduz eventos da simulação e o estado do jogo em sons (independe do tipo de contexto,
// para rodar igual ao vivo e num OfflineAudioContext de medição).
import { IAIDO, PLAYER, type EnemyKind, KIAI, LION } from '../config';
import type { Vec2 } from '../core/math';
import type { PlayerState, SimEvent } from '../sim/types';
import type { Bus, Engine } from './engine';
import { SFX, SFX_LEVEL, type SfxName, type SfxOpts } from './sfx';
import { rand, type Voice } from './voice';

/** O pedaço da simulação que o áudio lê (a `Sim` real satisfaz). */
export interface SimLike {
  readonly player: { readonly pos: Vec2; readonly hp: number; readonly state: PlayerState };
  readonly enemies: readonly { readonly id: number; readonly kind: EnemyKind }[];
  readonly alive: number;
  readonly over: boolean;
}

/** Agendamento adiante (s): tambores e coração são marcados com essa antecedência. */
const LOOKAHEAD = 0.25;
/** Inimigos vivos para a música chegar à intensidade máxima. */
const FULL_HORDE = 12;
const LOW_HP = PLAYER.maxHp * 0.3;

export class Director {
  readonly e: Engine;
  muted = false;
  private lastSim: SimLike | null = null;
  private intensity = 0;
  private sentDrone = -1;
  private musicOn = false;
  private nextStep = 0;
  private step = 0;
  private bar = 0;
  private paramTimer = 0;
  private nextHeart = 0;
  private gustTimer = 0;
  private muffled = false;
  private charge: Voice | null = null;
  /** Crescendo da transformação em leão (voz própria: o corte da carga não pode pegá-la). */
  private swell: Voice | null = null;
  /** Rosnado da carga do rugido do leão (segue até a onda sair ou a carga cair). */
  private growl: Voice | null = null;
  // posicionamento do último `place` (sem alocar)
  private pan = 0;
  private att = 1;

  constructor(e: Engine) { this.e = e; }

  handle(ev: SimEvent, sim: SimLike): void {
    const t = this.e.ctx.currentTime + 0.004;
    switch (ev.type) {
      case 'playerSwing':
        this.fire('playerSwing', 'swing', 3, t, { step: ev.step });
        break;
      case 'enemyHit': {
        this.place(ev.pos, sim);
        this.fire('enemyHit', 'hit', 4, t, { kind: ev.kind, heavy: ev.heavy, killed: ev.killed }, this.att, this.pan);
        // o "shing" é da lâmina: garra e rugido do leão não têm
        const st = sim.player.state;
        if ((ev.heavy || ev.killed) && st !== 'claw' && st !== 'roar') {
          this.fire('metal', 'metal', 3, t, { kind: ev.kind }, this.att * 0.9, this.pan);
        }
        break;
      }
      case 'enemyDeath':
        this.place(ev.pos, sim);
        this.fire('enemyDeath', 'death', 3, t, { kind: ev.kind }, this.att, this.pan);
        break;
      case 'enemyWindup':
        // pista de jogabilidade: pouca atenuação por distância e pouco "abafamento" de grupo
        this.place(ev.pos, sim, 0.6);
        this.fire('enemyWindup', 'windup', 4, t, { kind: this.kindOf(ev.id, sim) }, this.att, this.pan, 'sfx', 0.2);
        break;
      case 'enemySwing':
        this.place(ev.pos, sim, 0.4);
        this.fire('enemySwing', 'eswing', 3, t, { kind: this.kindOf(ev.id, sim) }, this.att, this.pan);
        break;
      case 'playerHurt':
        this.fire('playerHurt', 'hurt', 2, t, {});
        break;
      case 'playerDeath':
        this.stopCharge(0.05);
        this.stopSwell(0.05);
        this.stopGrowl(0.05);
        this.fire('playerDeath', 'pdeath', 1, t, {});
        this.muffled = true;
        this.e.setMuffle(true);
        break;
      case 'dash':
        this.fire('dash', 'dash', 2, t, {});
        break;
      case 'chargeStart':
        this.stopCharge(0.02);
        this.charge = this.fire('chargeStart', 'charge', 1, t, { dur: IAIDO.chargeTime });
        break;
      case 'chargeReady':
        this.fire('chargeReady', 'bell', 2, t, {});
        break;
      case 'chargeCancel':
        if (this.charge && !this.charge.done) {
          this.stopCharge(0.03);
          this.fire('chargeCancel', 'blip', 1, t, {});
        }
        break;
      case 'iaidoDash':
        this.stopCharge(0.015);
        this.e.duckFor(0.3);
        this.fire('iaidoSwell', 'iaido', 2, t, { dur: IAIDO.dur + 0.1 });
        break;
      case 'iaidoCut':
        this.fire('iaidoCut', 'iaido', 2, t, { hits: ev.hits, kills: ev.kills });
        break;
      case 'footstep':
        if (ev.paw) this.fire('paw', 'step', 2, t, {}, 1, 0, 'sfx', 0);
        else this.fire('footstep', 'step', 2, t, {}, 1, 0, 'sfx', 0);
        break;
      case 'waveStart':
        this.fire('waveStart', 'wave', 1, t, {});
        break;
      case 'waveClear':
        this.fire('waveClear', 'gong', 1, t, {});
        break;
      case 'spawn':
        // surgem fora da tela: silêncio (a horda já é anunciada pelo taiko da onda)
        break;
      case 'block':
        // lâmina contra lâmina: metal grave (brutamontes) sem o impacto de carne
        this.fire('metal', 'metal', 3, t, { kind: 'brute' }, 0.9, 0);
        break;
      case 'parry':
        // aparar: metal agudo + sino, com o ambiente abaixando um instante
        this.e.duckFor(0.15);
        this.fire('metal', 'metal', 3, t, { kind: 'swift' }, 1, 0);
        this.fire('chargeReady', 'bell', 2, t + 0.02, {});
        break;
      case 'guardStart':
        break;
      case 'kiaiStart':
        // concentração: o mesmo tom subindo do iaido, esticado até a explosão
        this.stopCharge(0.02);
        this.charge = this.fire('chargeStart', 'charge', 1, t, { dur: KIAI.gather });
        break;
      case 'kiaiBlast':
        this.stopCharge(0.01);
        this.e.duckFor(0.45);
        this.fire('iaidoCut', 'iaido', 2, t, { hits: Math.max(1, ev.kills), kills: ev.kills });
        this.fire('waveStart', 'wave', 1, t + 0.02, {});
        this.fire('metal', 'metal', 3, t, { kind: 'brute' }, 1, 0);
        break;
      case 'furyReady':
        this.fire('furyReady', 'fury', 1, t, {});
        break;
      case 'transformStart':
        this.stopSwell(0.02);
        this.swell = this.fire('lionSwell', 'lion', 1, t, { dur: LION.burstAt });
        break;
      case 'transformBurst':
        // o rugido toma o lugar do crescendo; ambiente e música abaixam enquanto ele soa
        this.stopSwell(0.04);
        this.e.duckFor(0.9);
        this.fire('roar', 'roar', 1, t, {});
        break;
      case 'transformEnd':
        break;
      case 'revertStart':
        this.stopSwell(0.03);
        this.stopGrowl(0.03);
        // na morte o samurai cai na hora: o som é o da morte
        if (ev.reason !== 'death') this.fire('revert', 'revert', 1, t, {});
        break;
      case 'revertEnd':
        break;
      case 'lionClaw':
        this.fire('claw', 'claw', 2, t, {});
        break;
      case 'lionRoarCharge':
        this.stopGrowl(0.02);
        this.growl = this.fire('growl', 'growl', 1, t, { dur: LION.roar.chargeTime });
        break;
      case 'lionRoarReady':
        // o sino da carga pronta do iaido, uma oitava abaixo: mesma pista, voz do leão
        this.fire('chargeReady', 'bell', 2, t, { pitch: 0.5 }, 1.2);
        break;
      case 'lionRoarCancel':
        if (this.growl && !this.growl.done) {
          this.stopGrowl(0.05);
          // morrendo no meio da carga, o som é o da morte
          if (sim.player.hp > 0) this.fire('snort', 'blip', 1, t, {});
        }
        break;
      case 'lionRoar':
        // o rugido toma o lugar do rosnado; ambiente e música abaixam. Um pouco abaixo do da transformação
        // (que é o grande momento) e com menos silêncio em volta: este se repete a cada poucos segundos
        this.stopGrowl(0.04);
        this.e.duckFor(0.6);
        this.fire('roar', 'roar', 1, t, {}, 0.85);
        break;
      default:
        ev satisfies never;
    }
  }

  /** Trovão com atraso de 0.3–2 s (mais forte = mais perto = mais cedo). */
  thunder(strength: number): void {
    const s = Math.max(0, Math.min(1, strength));
    const delay = Math.min(2, 0.3 + (1 - s) * 1.1 + rand() * 0.6);
    this.fire('thunder', 'thunder', 2, this.e.ctx.currentTime + delay, { strength: s }, 1, rand() * 0.6 - 0.3, 'amb', 0);
  }

  update(dt: number, sim: SimLike, playing: boolean): void {
    const e = this.e, now = e.ctx.currentTime;
    if (sim !== this.lastSim) {
      // nova partida
      this.lastSim = sim;
      this.intensity = 0;
      this.nextHeart = 0;
      this.stopCharge(0.03);
      this.stopSwell(0.03);
      this.stopGrowl(0.03);
    }
    const st = sim.player.state;
    if (this.charge && (this.charge.done || !playing || st !== 'charge')) this.stopCharge(0.04);
    if (this.swell && (this.swell.done || !playing || st !== 'transform')) this.stopSwell(0.04);
    // soltou o rugido: o rosnado segue até a onda (evento lionRoar); fora disso, cai junto com a carga
    if (this.growl && (this.growl.done || !playing || (st !== 'roarCharge' && st !== 'roar'))) this.stopGrowl(0.05);

    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      const len = 1.6 + rand() * 3.2;
      this.gustTimer = len;
      e.gust(len);
    }

    if (sim.over !== this.muffled) { this.muffled = sim.over; e.setMuffle(sim.over); }

    const on = playing && !sim.over && !this.muted;
    if (on !== this.musicOn) { this.musicOn = on; e.setMusicOn(on); }
    const target = on ? Math.min(1, sim.alive / FULL_HORDE) : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt * 0.6));
    this.paramTimer -= dt;
    if (this.paramTimer <= 0) {
      this.paramTimer = 0.1;
      if (Math.abs(this.intensity - this.sentDrone) > 0.01) { this.sentDrone = this.intensity; e.setDrone(this.intensity); }
    }
    if (on) this.scheduleDrums(now);
    else this.nextStep = 0;

    const hp = sim.player.hp;
    if (playing && !sim.over && !this.muted && hp > 0 && hp < LOW_HP) this.scheduleHeart(now, hp);
    else this.nextHeart = 0;
  }

  /** Corta o que está soando e não deve continuar (mudo). */
  silence(): void {
    this.stopCharge(0.03);
    this.stopSwell(0.03);
    this.stopGrowl(0.03);
  }

  private fire(name: SfxName, cat: string, max: number, t: number, o: SfxOpts,
    gain = 1, pan = 0, bus: Bus = 'sfx', crowd = 0.45): Voice {
    const v = this.e.voice(cat, max, bus, gain * SFX_LEVEL[name], pan, crowd);
    SFX[name](v, t, o);
    return v.seal();
  }

  private stopCharge(fade: number): void {
    if (this.charge) { this.charge.kill(fade); this.charge = null; }
  }

  private stopSwell(fade: number): void {
    if (this.swell) { this.swell.kill(fade); this.swell = null; }
  }

  private stopGrowl(fade: number): void {
    if (this.growl) { this.growl.kill(fade); this.growl = null; }
  }

  /** Panorâmica pela posição na tela e atenuação pela distância ao herói. */
  private place(pos: Vec2, sim: SimLike, minAtt = 0): void {
    const p = sim.player.pos;
    const dx = pos.x - p.x, dz = pos.z - p.z;
    // "direita da tela" no chão = (cos45, -sin45)
    const sx = (dx - dz) * Math.SQRT1_2;
    this.pan = Math.max(-0.7, Math.min(0.7, sx / 11));
    const d = Math.hypot(dx, dz);
    this.att = Math.max(minAtt, 1 / (1 + Math.max(0, d - 3) * 0.13));
  }

  private kindOf(id: number, sim: SimLike): EnemyKind {
    const list = sim.enemies;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i].kind;
    return 'ronin';
  }

  /** Taiko esparso: compasso de 8 colcheias, mais golpes (e mais rápido) com a horda maior. */
  private scheduleDrums(now: number): void {
    const stepDur = 60 / (64 + 36 * this.intensity) / 2;
    if (this.nextStep < now) { this.nextStep = now + 0.06; this.step = 0; }
    while (this.nextStep < now + LOOKAHEAD) {
      this.drumStep(this.step, this.bar, this.nextStep, this.intensity);
      this.nextStep += stepDur;
      if (++this.step >= 8) { this.step = 0; this.bar++; }
    }
  }

  private drumStep(s: number, bar: number, t: number, i: number): void {
    if (i < 0.05) return;
    const h = t + (rand() - 0.5) * 0.012;
    switch (s) {
      case 0: this.drum(h, 0.55 + 0.45 * i, 1); break;
      case 3: if (i > 0.6 && (bar & 1) === 1) this.drum(h, 0.3 + 0.2 * i, 1.1); break;
      case 4: if (i > 0.28) this.drum(h, 0.4 + 0.35 * i, 1.14); break;
      case 6: if (i > 0.7) this.fire('taikoKa', 'music', 8, h, { vel: 0.35 + 0.3 * i }, 1, 0.25, 'music', 0); break;
      case 7: if (i > 0.86 || (i > 0.5 && (bar & 3) === 3)) this.drum(h, 0.28 + 0.2 * i, 1.22); break;
    }
  }

  private drum(t: number, vel: number, pitch: number): void {
    this.fire('taiko', 'music', 8, t, { vel, pitch }, 1, 0, 'music', 0);
  }

  private scheduleHeart(now: number, hp: number): void {
    const k = hp / LOW_HP;
    const interval = 0.55 + 0.45 * k;
    if (this.nextHeart < now) this.nextHeart = now + 0.05;
    while (this.nextHeart < now + LOOKAHEAD) {
      this.fire('heartbeat', 'heart', 2, this.nextHeart, { vel: 0.7 + 0.3 * (1 - k) }, 1, 0, 'sfx', 0);
      this.nextHeart += interval;
    }
  }
}
