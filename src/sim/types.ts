import type { Vec2 } from '../core/math';
import type { EnemyDef, EnemyKind } from '../config';

/** Comandos de um passo de simulação. `move` e `aim` já estão no espaço do mundo (x, z). */
export interface SimInput {
  /** Direção de movimento, comprimento 0..1. */
  move: Vec2;
  /** Direção de mira unitária (mouse/analógico direito) ou null para usar movimento/frente. */
  aim: Vec2 | null;
  /** Pressionado neste passo (borda). */
  attack: boolean;
  /** Pressionado neste passo (borda). */
  dash: boolean;
  /** Mantido pressionado (carregar o iaido). */
  charge: boolean;
  /** Mantido pressionado (defesa; o aperto abre a janela de parry). */
  guard: boolean;
  /** Pressionado neste passo (borda): golpe especial Kiai. */
  special: boolean;
  /** Pressionado neste passo (borda): forma de leão (Fúria cheia) ou voltar a humano. */
  transform: boolean;
}

export const idleInput = (): SimInput => ({ move: { x: 0, z: 0 }, aim: null, attack: false, dash: false, charge: false, guard: false, special: false, transform: false });

export interface Circle { x: number; z: number; r: number }
/** Obstáculo retangular no chão: centro, meia-largura (x local), meia-profundidade (z local) e giro em y (como o three). */
export interface Box { x: number; z: number; hw: number; hd: number; rot: number }

export type PlayerState =
  | 'idle' | 'run' | 'attack' | 'dash' | 'dashEnd' | 'guard' | 'parry' | 'charge' | 'iaido' | 'kiai' | 'hurt' | 'dead'
  /** Virando leão (invulnerável) e voltando a humano. */
  | 'transform' | 'revert'
  /** Ataques do leão: garra (básico), carregando o rugido e o rugido (carregado, em área). */
  | 'claw' | 'roarCharge' | 'roar';

/** Corpo atual: o Ronin vira leão com a Fúria cheia. */
export type PlayerForm = 'human' | 'lion';

export interface Player {
  pos: Vec2;
  /** Posição no passo anterior (interpolação de renderização). */
  prev: Vec2;
  vel: Vec2;
  /** Direção para onde o corpo está virado (unitária). */
  facing: Vec2;
  radius: number;
  hp: number;
  ki: number;
  state: PlayerState;
  /** Tempo no estado atual. */
  t: number;
  comboStep: number;
  /** Janela para emendar o próximo golpe do combo depois que um termina. */
  comboWindow: number;
  attackDir: Vec2;
  hitIds: Set<number>;
  dashDir: Vec2;
  dashCd: number;
  invuln: number;
  attackBuf: number;
  dashBuf: number;
  chargeReady: boolean;
  iaidoFrom: Vec2;
  iaidoTo: Vec2;
  iaidoTargets: number[];
  iaidoResolved: boolean;
  /** Distância percorrida correndo (ciclo de animação e passos). */
  stride: number;
  /** A guarda atual começou com janela de parry. */
  parryReady: boolean;
  /** Segundos desde que a defesa foi solta (controla a recarga do parry). */
  sinceGuard: number;
  /** Segundos desde o último bloqueio (pose de impacto). */
  sinceBlock: number;
  parryTarget: number;
  riposteDone: boolean;
  specialBuf: number;
  kiaiDone: boolean;
  form: PlayerForm;
  /** Barra de Fúria 0..LION.max (na forma de leão, o tempo que resta). */
  fury: number;
  transformBuf: number;
  /** Onda de choque da transformação já saiu. */
  burstDone: boolean;
  /** Recarga do rugido do leão (s). O rugido usa `chargeReady` para a carga pronta. */
  roarCd: number;
  /** A onda do rugido atual já saiu. */
  roarDone: boolean;
}

export type EnemyState = 'spawn' | 'chase' | 'circle' | 'windup' | 'strike' | 'recover' | 'stagger' | 'parried' | 'dying';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  /** Atributos já escalados pela onda. */
  def: EnemyDef;
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  facing: Vec2;
  hp: number;
  state: EnemyState;
  t: number;
  token: boolean;
  tokenCd: number;
  strikeDir: Vec2;
  strikeHit: boolean;
  poiseLeft: number;
  orbitDir: number;
  /** Contorno de obstáculo em andamento: lado escolhido (±1, 0 = nenhum) e quanto tempo ainda vale. */
  avoidSide: number;
  avoidT: number;
  ringOffset: number;
  /** Clarão branco ao ser atingido (segundos restantes). */
  flash: number;
  stride: number;
  /** Direção do golpe que o matou (queda do corpo). */
  deathDir: Vec2;
}

export type WaveState = 'pre' | 'active';

export type SimEvent =
  | { type: 'waveStart'; wave: number; total: number }
  | { type: 'waveClear'; wave: number; heal: number }
  | { type: 'spawn'; id: number; kind: EnemyKind; pos: Vec2 }
  | { type: 'playerSwing'; step: number; pos: Vec2; dir: Vec2; range: number; halfArc: number }
  | { type: 'enemyHit'; id: number; kind: EnemyKind; pos: Vec2; dir: Vec2; damage: number; heavy: boolean; killed: boolean }
  | { type: 'enemyDeath'; id: number; kind: EnemyKind; pos: Vec2; dir: Vec2; score: number }
  | { type: 'enemyWindup'; id: number; pos: Vec2; dir: Vec2; duration: number; reach: number; halfArc: number }
  | { type: 'enemySwing'; id: number; pos: Vec2; dir: Vec2; reach: number; halfArc: number }
  | { type: 'playerHurt'; pos: Vec2; dir: Vec2; damage: number; hp: number }
  | { type: 'playerDeath'; pos: Vec2 }
  | { type: 'dash'; pos: Vec2; dir: Vec2 }
  | { type: 'chargeStart'; pos: Vec2 }
  | { type: 'chargeReady'; pos: Vec2 }
  | { type: 'chargeCancel'; pos: Vec2 }
  | { type: 'iaidoDash'; from: Vec2; to: Vec2; dir: Vec2 }
  | { type: 'iaidoCut'; from: Vec2; to: Vec2; dir: Vec2; hits: number; kills: number }
  | { type: 'footstep'; pos: Vec2; paw?: boolean }
  | { type: 'guardStart'; pos: Vec2; parry: boolean }
  | { type: 'block'; id: number; pos: Vec2; dir: Vec2; damage: number; hp: number }
  | { type: 'parry'; id: number; pos: Vec2; dir: Vec2; enemyPos: Vec2 }
  | { type: 'kiaiStart'; pos: Vec2 }
  | { type: 'kiaiBlast'; pos: Vec2; radius: number; kills: number }
  /** A barra de Fúria acabou de encher. */
  | { type: 'furyReady'; pos: Vec2 }
  | { type: 'transformStart'; pos: Vec2; dir: Vec2 }
  /** O leão completo surge rugindo: empurra a horda em volta. */
  | { type: 'transformBurst'; pos: Vec2; radius: number; pushed: number }
  /** Transformação concluída: agora é leão. */
  | { type: 'transformEnd'; pos: Vec2 }
  | { type: 'revertStart'; pos: Vec2; reason: 'timeout' | 'manual' | 'death' }
  | { type: 'revertEnd'; pos: Vec2 }
  /** Garra do leão (ataque básico): sai quando a janela ativa abre (LION.claw.activeFrom). */
  | { type: 'lionClaw'; pos: Vec2; dir: Vec2; range: number; halfArc: number }
  /** Rugido do leão (ataque carregado): começou a carregar, carga pronta, desistiu (soltou cedo, acabou a forma). */
  | { type: 'lionRoarCharge'; pos: Vec2 }
  | { type: 'lionRoarReady'; pos: Vec2 }
  | { type: 'lionRoarCancel'; pos: Vec2 }
  /** A onda do rugido saiu (LION.roar.blastAt depois de soltar): atingiu `hits` inimigos no raio, `kills` morreram. */
  | { type: 'lionRoar'; pos: Vec2; dir: Vec2; radius: number; hits: number; kills: number };

export type SimEventType = SimEvent['type'];

export interface SimOptions {
  seed: number;
  arenaRadius: number;
  /** Distância do jogador em que os inimigos surgem (fora da tela). */
  spawnRadius: number;
  colliders: Circle[];
  /** Construções e muros (retângulos girados). */
  boxes?: Box[];
  /** Onde o jogador começa (padrão: centro da arena). */
  start?: Vec2;
  /** O personagem tem a forma de leão (só o Ronin; padrão true). */
  transform?: boolean;
}
