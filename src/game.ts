// Orquestra tudo: telas, laço de passo fixo, entrada -> simulação -> eventos -> apresentação.
import * as THREE from 'three';
import { ANIM, ARENA, LION, PLAYER, SIM_DT } from './config';
import { createAudio, type AudioSystem } from './audio/audio';
import { Rng } from './core/math';
import { createEffects, type Effects } from './fx/effects';
import { Input } from './input/input';
import { IsoCamera } from './render/camera';
import { ANIM_SETS, TOMOE_STEP, fromScreen, type CharacterId } from './render/pose';
import { PixelRenderer } from './render/renderer';
import { View } from './render/view';
import { Sim } from './sim/sim';
import { idleInput, type SimInput } from './sim/types';
import { createHud, type Hud, type RunStats, type Screen } from './ui/hud';
import { createEnvironment, type Environment } from './world/environment';
import { STAGE_IDS, type StageId } from './world/stages';

const BEST_KEY = 'ronin-game:best';

/** Cenário sorteado para a partida da semente `seed` (a mesma semente sorteia o mesmo cenário). */
const stageFor = (seed: number): StageId => new Rng((seed ^ 0x51ed270b) >>> 0).pick(STAGE_IDS);

function loadBest(): { score: number; wave: number } {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null');
    if (v && typeof v.score === 'number' && typeof v.wave === 'number') return v;
  } catch { /* armazenamento indisponível */ }
  return { score: 0, wave: 0 };
}
function saveBest(v: { score: number; wave: number }): void {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(v)); } catch { /* ignora */ }
}

export interface GameOptions {
  seed?: number;
  /** Começa a partida direto (testes). */
  autostart?: boolean;
  /** Personagem já escolhido (o título abre com ele marcado e "Jogar" à mostra). Sem ele, o jogador escolhe. */
  character?: CharacterId;
  /** Cenário fixo em todas as partidas. Sem ele, cada partida sorteia o seu. */
  stage?: StageId;
}

export class Game {
  screen: Screen = 'loading';
  readonly scene = new THREE.Scene();
  readonly renderer: PixelRenderer;
  readonly cam = new IsoCamera();
  env: Environment;
  readonly view: View;
  readonly fx: Effects;
  readonly audio: AudioSystem;
  readonly hud: Hud;
  readonly input: Input;
  sim!: Sim;
  /** Tempo real acumulado (s). */
  time = 0;
  private acc = 0;
  private last = 0;
  private pendingAttack = false;
  private pendingDash = false;
  private pendingSpecial = false;
  private pendingTransform = false;
  private deathTimer = -1;
  private timeScale = 1;
  /** Relógio das animações dos personagens: só anda com o jogo rodando (no título e na pausa ficam imóveis). */
  private animTime = 0;
  private runTime = 0;
  private seed: number;
  private best = loadBest();
  private raf = 0;
  /** Quadros por segundo medidos (média móvel). */
  fps = 60;
  /** Personagem jogável escolhido no menu. */
  character: CharacterId = 'ronin';
  /** Cenário da partida (sorteado a cada uma, salvo `fixedStage`). */
  stage: StageId;
  /** Cenário pedido na URL (`?stage=`): vale para todas as partidas. */
  private readonly fixedStage: StageId | null;

  constructor(root: HTMLElement, atlas: THREE.Texture, opts: GameOptions = {}) {
    this.seed = opts.seed ?? ((Date.now() ^ 0x5bd1e995) >>> 0);
    this.renderer = new PixelRenderer(root);
    this.input = new Input(this.renderer.canvas);
    this.fixedStage = opts.stage ?? null;
    // o título não mostra o cenário: o sorteio da primeira partida já sai aqui, sem refazer nada ao jogar
    this.stage = this.fixedStage ?? stageFor(this.seed);
    this.env = createEnvironment(this.scene, { arenaRadius: ARENA.radius, seed: this.seed, stage: this.stage });
    this.view = new View(this.scene, atlas);
    this.fx = createEffects(this.scene);
    this.audio = createAudio();
    this.hud = createHud(root, {
      onStart: () => this.startRun(),
      onResume: () => this.setScreen('playing'),
      onRestart: () => this.startRun(),
      onToggleMute: () => this.toggleMute(),
      onSelectCharacter: id => this.setCharacter(id),
    }, this.input);
    this.setCharacter(opts.character ?? 'ronin', !!opts.character);
    this.hud.setMuted(this.audio.muted);
    this.env.onLightning = s => this.audio.thunder(s);
    this.hud.setProjector((x, y, z) => this.renderer.worldToCss(this.cam, new THREE.Vector3(x, y, z)));
    this.scene.background = new THREE.Color(0xbcbcbc);

    this.newSim(this.seed);
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.screen === 'playing') this.setScreen('paused'); });

    if (opts.autostart) this.startRun();
    else this.setScreen('title');
    this.last = performance.now();
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  private newSim(seed: number): void {
    const env = this.env;
    this.sim = new Sim({
      seed, arenaRadius: ARENA.radius, spawnRadius: this.spawnRadius(), colliders: env.colliders, boxes: env.boxes, start: env.start,
      transform: this.character === 'ronin',
    });
    this.applyFootstep();
    this.view.reset();
    this.fx.clear();
    this.cam.jump(this.sim.player.pos);
    this.acc = 0;
    this.deathTimer = -1;
    this.timeScale = 1;
    this.runTime = 0;
  }

  /** Respingos dos passos no quadro de apoio do ciclo lateral de cada personagem. */
  private applyFootstep(): void {
    if (!this.sim) return;
    if (this.character === 'tomoe') this.sim.footstep = { length: TOMOE_STEP, phase: 0 };
    else this.sim.footstep = { length: ANIM.strideSide * ANIM.sideFrames, phase: ANIM.strideSide * ANIM.sideContact };
  }

  private spawnRadius(): number {
    return Math.min(this.cam.visibleRadius() + 1.5, ARENA.radius * 0.9);
  }

  private onResize(): void {
    if (this.renderer.resize(this.cam)) {
      this.view.batch.setResolution(this.renderer.resW, this.renderer.resH);
      if (this.sim) this.sim.opts.spawnRadius = this.spawnRadius();
      const r = this.cam.visibleRadius();
      this.renderer.params.fogNear = r * 0.5;
      this.renderer.params.fogFar = r * 0.98;
    }
  }

  /** Nova partida ("Jogar", "Recomeçar", "Lutar de novo"): semente nova e cenário sorteado de novo. */
  startRun(): void {
    this.audio.unlock();
    // a partida montada para o título ainda não começou: aproveita semente e cenário
    const fresh = this.screen === 'title' && this.sim.tick === 0;
    if (!fresh) this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const stage = this.fixedStage ?? stageFor(this.seed);
    if (stage !== this.stage) this.setStage(stage);
    else if (!fresh) this.newSim(this.seed);
    this.setScreen('playing');
  }

  setScreen(s: Screen, stats?: RunStats): void {
    this.screen = s;
    this.hud.setScreen(s, stats);
    if (s === 'playing') { this.acc = 0; this.last = performance.now(); }
  }

  /** Troca o personagem jogável. `picked`: escolhido no título (marca o samurai e mostra "Jogar"). */
  setCharacter(id: CharacterId, picked = true): void {
    this.character = id;
    this.view.setPlayerSet(ANIM_SETS[id]);
    this.fx.setStyle(id === 'tomoe' ? 'sakura' : 'kiai');
    this.applyFootstep();
    // só o Ronin vira leão (o título reaproveita a partida ainda não começada)
    if (this.sim) this.sim.canTransform = id === 'ronin';
    this.hud.setCharacter(id, picked);
  }

  /** Troca o cenário: descarta o atual (memória de vídeo inclusive) e refaz a partida ainda não começada. */
  setStage(id: StageId): void {
    if (id === this.stage) return;
    this.stage = id;
    this.env.dispose();
    this.env = createEnvironment(this.scene, { arenaRadius: ARENA.radius, seed: this.seed, stage: id });
    this.env.onLightning = s => this.audio.thunder(s);
    this.newSim(this.seed);
  }

  toggleMute(): void {
    this.audio.setMuted(!this.audio.muted);
    this.hud.setMuted(this.audio.muted);
  }

  private stats(): RunStats {
    const s = this.sim;
    const newBest = s.score > this.best.score;
    if (newBest || s.wave > this.best.wave) {
      this.best = { score: Math.max(s.score, this.best.score), wave: Math.max(s.wave, this.best.wave) };
      saveBest(this.best);
    }
    return { score: s.score, kills: s.kills, wave: s.wave, bestCombo: s.bestCombo, time: this.runTime, best: { ...this.best }, newBest };
  }

  private frame(now: number): void {
    this.raf = requestAnimationFrame(t => this.frame(t));
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (dt > 0) this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    this.time += dt;
    this.tick(dt);
  }

  /** Um quadro de jogo com `dt` real (exposto para os testes avançarem o tempo). */
  tick(dt: number): void {
    const f = this.input.frame();
    if (f.mute) this.toggleMute();
    if (f.pause) {
      if (this.screen === 'playing') this.setScreen('paused');
      else if (this.screen === 'paused') this.setScreen('playing');
    }
    // no título quem decide é a interface (só joga com um personagem escolhido): ver o fim do quadro
    if (f.confirm && !f.pause) {
      if (this.screen === 'over') this.startRun();
      else if (this.screen === 'paused' && f.device !== 'mouse') this.setScreen('playing');
    }

    const sim = this.sim;
    if (this.screen === 'playing') {
      this.runTime += dt;
      // ação indisponível apertada (Ki ou Fúria faltando, recarga, travada no leão): aviso no HUD
      this.hud.input(f);
      if (f.attack) this.pendingAttack = true;
      if (f.dash) this.pendingDash = true;
      if (f.special) this.pendingSpecial = true;
      if (f.transform) this.pendingTransform = true;
      const inp: SimInput = idleInput();
      if (!sim.over) {
        inp.move = fromScreen(f.move.x, f.move.y);
        inp.aim = f.aim ? fromScreen(f.aim.x, f.aim.y) : null;
        inp.charge = f.charge;
        inp.guard = f.guard;
      }
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 8) {
        inp.attack = this.pendingAttack && !sim.over;
        inp.dash = this.pendingDash && !sim.over;
        inp.special = this.pendingSpecial && !sim.over;
        inp.transform = this.pendingTransform && !sim.over;
        this.pendingAttack = this.pendingDash = this.pendingSpecial = this.pendingTransform = false;
        sim.step(inp);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === 8) this.acc = 0;
      for (const ev of sim.drainEvents()) {
        this.fx.handle(ev, sim);
        this.audio.handle(ev, sim);
        this.hud.handle(ev, sim);
        this.view.handle(ev);
        if (ev.type === 'playerDeath') { this.deathTimer = 2.4; this.timeScale = 0.35; }
      }
      if (this.deathTimer > 0) {
        this.deathTimer -= dt;
        this.timeScale = Math.min(1, this.timeScale + dt * 0.25);
        if (this.deathTimer <= 0) this.setScreen('over', this.stats());
      }
    } else {
      this.pendingAttack = this.pendingDash = this.pendingSpecial = this.pendingTransform = false;
    }

    const alpha = this.screen === 'playing' ? Math.min(1, this.acc / SIM_DT) : 1;
    const p = sim.player;
    const px = p.prev.x + (p.pos.x - p.prev.x) * alpha, pz = p.prev.z + (p.pos.z - p.prev.z) * alpha;
    const running = this.screen === 'playing' || this.screen === 'over';
    const vdt = running ? dt : 0;

    this.fx.update(vdt, this.time, sim);
    const fb = this.fx.feedback;
    if (fb.shake > 0) this.cam.shake(fb.shake);
    // a câmera adianta pela velocidade máxima da forma atual (o leão corre mais)
    const top = p.form === 'lion' ? LION.speed : PLAYER.speed;
    const lead = { x: p.vel.x / top, z: p.vel.z / top };
    this.cam.update(dt, { x: px, z: pz }, lead);
    this.env.update(dt, this.time, { x: px, z: pz });
    this.animTime += vdt;
    this.view.update(sim, alpha, vdt, this.animTime);
    this.audio.update(dt, sim, this.screen === 'playing');
    this.hud.update(sim, dt);

    const post = this.renderer.params;
    post.flash = Math.max(fb.flash, this.env.lightning * 0.55);
    post.invert = fb.invert;
    const low = 1 - p.hp / PLAYER.maxHp;
    post.hurt = Math.max(0, low - 0.55) * 1.2 * (0.75 + 0.25 * Math.sin(this.time * 6));
    // no título a paisagem cobre a tela inteira: a cena 3D fica sem desenhar (poupa a placa de vídeo)
    if (this.screen !== 'title') this.renderer.render(this.scene, this.cam, { x: px, z: pz }, this.time);

    const o = this.renderer.worldToCss(this.cam, new THREE.Vector3(px, 0.9, pz));
    this.input.setAimOrigin(o.x, o.y);

    // título: ←/→ escolhem o samurai, confirmar joga. Por último, para a partida que começa aqui não
    // receber neste mesmo quadro a tecla que confirmou (J também é corte)
    if (this.screen === 'title') this.hud.input(f);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.renderer.renderer.dispose();
  }
}
