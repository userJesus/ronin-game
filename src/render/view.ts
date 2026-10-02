// Liga a simulação aos sprites: pose, tom de cada tipo de inimigo, clarões, queda e dissolução,
// sombras em bolha e rastros (afterimages) da esquiva e do iaido.
import * as THREE from 'three';
import { AI, CAMERA, IAIDO, PLAYER, TEXELS_PER_METER, type EnemyKind } from '../config';
import type { Sim } from '../sim/sim';
import type { Enemy, SimEvent } from '../sim/types';
import { RONIN_ANIM, enemyPose, playerPose, toScreen, type AnimSet, type FrameName, type PoseMemory } from './pose';
import { SpriteBatch, makeInstance, type SpriteInstance } from './sprites';

/** Tom (cor * mul + add) que diferencia os inimigos repetidos do herói. */
export const TONES: Record<EnemyKind, { mul: number; add: number; shadow: number }> = {
  ronin: { mul: 0.92, add: 0.07, shadow: 0.55 },
  brute: { mul: 0.5, add: 0.0, shadow: 0.75 },
  swift: { mul: 0.62, add: 0.34, shadow: 0.48 },
};

interface Ghost { s: SpriteInstance; life: number; max: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Altura no mundo que sobe o sprite 1 texel na tela (billboard esticado por 1/cos(pitch)). */
const LIFT_TEXEL = 1 / TEXELS_PER_METER / Math.cos(CAMERA.pitch);

export class View {
  readonly batch: SpriteBatch;
  private readonly shadows: THREE.InstancedMesh;
  private readonly shadowDummy = new THREE.Object3D();
  private playerMem: PoseMemory = { left: false };
  private playerSet: AnimSet = RONIN_ANIM;
  private enemyMem = new Map<number, PoseMemory>();
  private ghosts: Ghost[] = [];
  private ghostTimer = 0;
  private hurtClock = 99;
  /** Posição interpolada do jogador no último quadro desenhado. */
  readonly playerPos = { x: 0, z: 0 };
  /** Quadro desenhado do jogador no último update (revisão e testes). */
  playerFrame: FrameName | null = null;

  constructor(scene: THREE.Scene, atlas: THREE.Texture) {
    this.batch = new SpriteBatch(atlas, 320);
    scene.add(this.batch.mesh, this.batch.occludedMesh);
    const geo = new THREE.CircleGeometry(1, 20);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    this.shadows = new THREE.InstancedMesh(geo, mat, 160);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 0;
    this.shadows.count = 0;
    scene.add(this.shadows);
  }

  /** Personagem escolhido no menu (a horda continua com o Ronin). */
  setPlayerSet(set: AnimSet): void {
    this.playerSet = set;
    this.playerMem = { left: false };
  }

  reset(): void {
    // fase do ciclo do leão e direção não passam de uma partida para outra
    this.playerMem = { left: false };
    this.ghosts = [];
    this.enemyMem.clear();
    this.hurtClock = 99;
  }

  handle(ev: SimEvent): void {
    if (ev.type === 'playerHurt') this.hurtClock = 0;
  }

  update(sim: Sim, alpha: number, dt: number, time: number): void {
    const b = this.batch;
    b.begin();
    let sc = 0;
    const shadow = (x: number, z: number, r: number) => {
      if (sc >= 160) return;
      this.shadowDummy.position.set(x, 0.015, z);
      this.shadowDummy.scale.set(r, 1, r);
      this.shadowDummy.updateMatrix();
      this.shadows.setMatrixAt(sc++, this.shadowDummy.matrix);
    };

    // ---- rastros
    for (const g of this.ghosts) g.life -= dt;
    this.ghosts = this.ghosts.filter(g => g.life > 0);
    for (const g of this.ghosts) {
      // silhueta cinza que se desfaz (os quadros da esquiva já têm linhas de velocidade)
      const k = 1 - g.life / g.max;
      b.push({ ...g.s, flash: 0, toneMul: 0.25, toneAdd: 0.42 + k * 0.12, dissolve: 0.3 + k * 0.7, outline: 0 });
    }

    // ---- jogador
    const p = sim.player;
    const px = lerp(p.prev.x, p.pos.x, alpha), pz = lerp(p.prev.z, p.pos.z, alpha);
    this.playerPos.x = px; this.playerPos.z = pz;
    const pose = playerPose(p, this.playerMem, time, dt, this.playerSet);
    this.playerFrame = pose.frame;
    const ps = makeInstance();
    ps.x = px; ps.z = pz; ps.frame = pose.frame; ps.flip = pose.flip; ps.outline = 1;
    ps.y = (pose.lift ?? 0) * LIFT_TEXEL;
    this.hurtClock += dt;
    // carregando o iaido ou o rugido do leão: clareia e, pronto, pulsa
    if (p.state === 'charge' || p.state === 'roarCharge') ps.flash = p.chargeReady ? 0.25 + 0.2 * Math.sin(time * 30) : Math.min(0.3, p.t);
    // pisca durante a invulnerabilidade do golpe, por cima do brilho da carga (o leão segue carregando o rugido)
    if (this.hurtClock < PLAYER.hurtInvuln && p.state !== 'dead' && Math.floor(this.hurtClock / 0.07) % 2 === 0) ps.flash = 0.75;
    if (p.state === 'dead') {
      const k = Math.min(1, p.t / 0.6);
      const side = toScreen(p.facing).sx >= 0 ? 1 : -1;
      ps.rot = side * k * k * 1.45;
      ps.outline = 0.5 * (1 - k);
    }
    if (p.state === 'dash' || (p.state === 'iaido' && p.t < IAIDO.dur)) {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) {
        this.ghostTimer = p.state === 'iaido' ? 0.03 : 0.055;
        this.ghosts.push({ s: { ...ps }, life: 0.2, max: 0.2 });
      }
    }
    b.push(ps);
    // o leão (LION_H = 56 texels no três-quartos, ~2 m de focinho à cauda de perfil) é mais comprido que o samurai
    shadow(px, pz, p.form === 'lion' ? 0.7 : 0.5);

    // ---- inimigos
    for (const e of sim.enemies) {
      let mem = this.enemyMem.get(e.id);
      if (!mem) { mem = { left: toScreen(e.facing).sx < 0 }; this.enemyMem.set(e.id, mem); }
      b.push(this.enemyInstance(e, mem, alpha, time, p.state === 'kiai' || p.state === 'transform'));
      if (e.state !== 'dying' || e.t < 0.6) shadow(lerp(e.prev.x, e.pos.x, alpha), lerp(e.prev.z, e.pos.z, alpha), TONES[e.kind].shadow * (e.state === 'spawn' ? Math.min(1, e.t / AI.spawnTime) : 1));
    }
    if (this.enemyMem.size > sim.enemies.length + 64) {
      const live = new Set(sim.enemies.map(e => e.id));
      for (const id of this.enemyMem.keys()) if (!live.has(id)) this.enemyMem.delete(id);
    }

    b.end();
    this.shadows.count = sc;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  /** `quiet`: durante o golpe especial, sem clarão branco nos atingidos (não tapa o desenho do golpe). */
  private enemyInstance(e: Enemy, mem: PoseMemory, alpha: number, time: number, quiet = false): SpriteInstance {
    const s = makeInstance();
    s.x = lerp(e.prev.x, e.pos.x, alpha);
    s.z = lerp(e.prev.z, e.pos.z, alpha);
    const pose = enemyPose(e, mem, time);
    s.frame = pose.frame;
    s.flip = pose.flip;
    s.y = (pose.lift ?? 0) * LIFT_TEXEL;
    const tone = TONES[e.kind];
    s.toneMul = tone.mul;
    s.toneAdd = tone.add;
    // clarão do acerto: forte no impacto e some rápido
    s.flash = e.flash > 0 && !quiet ? 0.35 + 0.55 * Math.min(1, e.flash / 0.12) : 0;
    switch (e.state) {
      case 'spawn':
        s.dissolve = 1 - Math.min(1, e.t / AI.spawnTime);
        break;
      case 'windup': {
        // contorno branco AI.cueLead antes do golpe: "vai golpear agora" (mesma hora do brilho na lâmina)
        if (e.t >= e.def.windup - AI.cueLead) s.outline = 0.9;
        break;
      }
      case 'stagger':
        s.x += Math.sin(e.t * 90) * 0.03;
        break;
      case 'parried':
        // sem guarda: treme no começo e pisca de leve
        if (e.t < 0.3) s.x += Math.sin(e.t * 80) * 0.04;
        s.flash = Math.max(s.flash, e.t > 0.2 && Math.floor(e.t / 0.16) % 2 === 0 ? 0.12 : 0);
        break;
      case 'dying': {
        const k = Math.min(1, e.t / 0.38);
        const side = toScreen(e.deathDir).sx >= 0 ? -1 : 1;
        s.rot = side * k * k * 1.42;
        s.dissolve = Math.min(1, Math.max(0, (e.t - 0.38) / (AI.deathTime - 0.45)));
        s.flash = !quiet && e.t < 0.08 ? 1 : 0;
        break;
      }
    }
    return s;
  }
}
