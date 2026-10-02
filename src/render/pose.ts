// Animação dos sprites (puro, testável): estado da simulação -> quadro do atlas + espelhamento.
// Locomoção em 8 direções com ciclos presos à distância percorrida (o pé não "patina");
// ações (golpes, defesa, parry, esquiva) são clipes com tempo por quadro.
// Cada personagem jogável tem o seu conjunto (AnimSet); a horda usa sempre o do Ronin.
import { ANIM, CAMERA, GUARD, IAIDO, KIAI, LION } from '../config';
import atlasMeta from '../assets/sprites/samurai.json';
import type { Vec2 } from '../core/math';
import type { Enemy, EnemyState, Player, PlayerState } from '../sim/types';

export type FrameName = keyof typeof atlasMeta.frames;

export interface Pose {
  frame: FrameName;
  flip: boolean;
  /** Quique vertical (texels) — fase de voo da corrida. */
  lift?: number;
}

const SY = Math.sin(CAMERA.yaw), CY = Math.cos(CAMERA.yaw);

/** Direção do mundo -> tela: sx para a direita, sy para cima (longe da câmera). */
export function toScreen(d: Vec2): { sx: number; sy: number } {
  return { sx: d.x * CY - d.z * SY, sy: -(d.x * SY + d.z * CY) };
}

/** Tela (sx direita, sy cima) -> direção no chão do mundo. */
export function fromScreen(sx: number, sy: number): Vec2 {
  return { x: CY * sx - SY * sy, z: -SY * sx - CY * sy };
}

// ------------------------------------------------------------------ direções
export type Dir8 = 'E' | 'NE' | 'N' | 'NW' | 'W' | 'SW' | 'S' | 'SE';
/** Índice k = ângulo k·45° na tela (anti-horário, 0 = direita). */
export const DIRS: readonly Dir8[] = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
const OCT = Math.PI / 4;
/** Margem além da fronteira do setor antes de trocar de direção. */
const DIR_HYST = 10 * Math.PI / 180;

export function dir8(facing: Vec2, prev?: Dir8): Dir8 {
  const { sx, sy } = toScreen(facing);
  const a = Math.atan2(sy, sx);
  if (prev) {
    const c = DIRS.indexOf(prev) * OCT;
    let d = Math.abs(a - c) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d <= OCT / 2 + DIR_HYST) return prev;
  }
  return DIRS[((Math.round(a / OCT) % 8) + 8) % 8];
}

/** Lado na tela para quadros de perfil; perto da vertical mantém o anterior. */
export function sideLeft(facing: Vec2, prevLeft: boolean): boolean {
  const { sx } = toScreen(facing);
  return Math.abs(sx) < 0.2 ? prevLeft : sx < 0;
}

// ------------------------------------------------------------------ quadros
const range = (prefix: string, a: number, b: number): FrameName[] => {
  const out: FrameName[] = [];
  for (let i = a; i <= b; i++) out.push(`${prefix}${String(i).padStart(2, '0')}` as FrameName);
  return out;
};

/** Para onde o desenho original olha: R direita (padrão), L esquerda, S simétrico (nunca espelha). */
const NATIVE_LEFT = new Set<FrameName>([
  'walkNW0', 'walkNW1', 'walkNW2', 'walkNW3', 'crouch', 'slash',
  ...range('m2d', 11, 15),
  // Tomoe: perfis para a esquerda desenhados de verdade (lado esquerdo da folha)
  ...range('tmC', 0, 5), ...range('tmD', 0, 5), ...range('tmE', 0, 5), ...range('tmF', 0, 5),
  // passagens geradas a partir desses perfis (scripts/extract-sprites.mjs) também olham para a esquerda
  'tmPassL0', 'tmPassL1',
  // corrida de frente levemente virada: o rosto vai para a esquerda da tela
  ...range('tmB', 0, 5),
]);
const SYMMETRIC = new Set<FrameName>([
  'walkS0', 'walkS1', 'walkS2', 'walkN0', 'walkN1', 'walkN2', 'walkN3', 'walkN4', 'walkN5', 'front',
  ...range('m2c', 0, 10),
  // o Kiai é desenhado de frente: espelhar trocaria o punho e as chamas de lado
  'kiai0', 'kiai1', 'kiai2', 'kiai3', 'kiai4', 'kiai5', 'kiai6', 'kiai7', 'kiai8',
  'kiaiBlast0', 'kiaiBlast1', 'kiaiBlast2', 'kiaiBlast3', 'kiaiBlast4', 'kiaiBlast5',
  // Tomoe de frente e de costas
  ...range('tmA', 0, 11),
  // movimentação do leão: as 8 direções desenhadas (perfis dos dois lados também), nada espelha.
  // A garra e o rugido (lclaw, lroar) olham para a direita e espelham pelo lado, como os golpes humanos.
  ...range('lwS', 0, 5), ...range('lrS', 0, 5), ...range('lwN', 0, 5), ...range('lrN', 0, 5),
  ...range('lwW', 0, 4), ...range('lrW', 0, 4), ...range('lwE', 0, 4), ...range('lrE', 0, 4),
  ...range('lNW', 0, 5), ...range('lNE', 0, 5), ...range('lSW', 0, 5), ...range('lSE', 0, 5),
  // o começo da transformação (samurai de frente)
  ...range('tf', 0, 4),
]);

/** Quadro de perfil virado para o lado pedido. */
export function faced(frame: FrameName, left: boolean): Pose {
  if (SYMMETRIC.has(frame)) return { frame, flip: false };
  return { frame, flip: NATIVE_LEFT.has(frame) ? !left : left };
}

export interface Cycle {
  frames: FrameName[];
  left: boolean;
  /** Metros por quadro (casado com o recuo do pé apoiado na arte). */
  stride: number;
  /** Metros de cada quadro, quando não são iguais (sobrepõe `stride`). */
  strides?: readonly number[];
  /** Quique por quadro (texels), só na corrida lateral. */
  lift?: readonly number[];
}

/** Clipe temporal: [quadro, até t (s)] — o último vale até o fim. */
export type Clip = readonly (readonly [FrameName, number])[];

function clipFrame(clip: Clip, t: number): FrameName {
  for (const [f, until] of clip) if (t < until) return f;
  return clip[clip.length - 1][0];
}

/**
 * Concentração até KIAI.gather (tempo igual por quadro) e explosão/dissipação até KIAI.dur,
 * com peso opcional por quadro (o auge do golpe fica mais tempo na tela).
 */
function specialClip(gather: FrameName[], blast: FrameName[], weights?: readonly number[]): Clip {
  const w = weights ?? blast.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  return [
    ...gather.map((f, i) => [f, (KIAI.gather * (i + 1)) / gather.length] as const),
    ...blast.map((f, i) => { acc += w[i]; return [f, KIAI.gather + ((KIAI.dur - KIAI.gather) * acc) / total] as const; }),
  ];
}

export type CharacterId = 'ronin' | 'tomoe';

/** Tudo que o jogador precisa para ser desenhado. */
export interface AnimSet {
  id: CharacterId;
  locomotion: Record<Dir8, Cycle>;
  idle: Record<Dir8, Cycle>;
  /** Os três golpes do combo (ver COMBO em config.ts). */
  attack: readonly Clip[];
  dash: Clip;
  dashLand: FrameName;
  guard: Clip;
  guardBlock: FrameName;
  guardExit: FrameName;
  parry: Clip;
  parryFinish: FrameName;
  /** Pose de concentração do iaido. */
  charge: FrameName;
  iaido: Clip;
  /** Golpe especial (tecla Q). */
  special: Clip;
  hurt: FrameName;
  dead: FrameName;
}

// ------------------------------------------------------------------ Ronin
// folha de movimentação natural (assets-src/movement2.png): pernas alternando de verdade
const RUN_E: FrameName[] = range('m2c', 16, 20);
/** Apoio no meio do passo (quadro 0), voo antes da outra perna pousar (quadro 3). */
const RUN_LIFT = [0, 1, 2, 1, 0];
const still = (frames: FrameName[], left = false): Cycle => ({ frames, left, stride: 0 });

export const RONIN_ANIM: AnimSet = {
  id: 'ronin',
  locomotion: {
    E: { frames: RUN_E, left: false, stride: ANIM.strideSide, lift: RUN_LIFT },
    W: { frames: RUN_E, left: true, stride: ANIM.strideSide, lift: RUN_LIFT },
    N: { frames: range('m2c', 6, 10), left: false, stride: ANIM.strideVertical },
    S: { frames: range('m2c', 0, 5), left: false, stride: ANIM.strideVertical },
    SE: { frames: range('m2b', 0, 3), left: false, stride: ANIM.strideDiagonal },
    SW: { frames: range('m2b', 0, 3), left: true, stride: ANIM.strideDiagonal },
    NW: { frames: range('m2d', 11, 15), left: true, stride: ANIM.strideDiagonal },
    NE: { frames: range('m2d', 11, 15), left: false, stride: ANIM.strideDiagonal },
  },
  /** Parado: postura de luta de perfil, frente/costas e três-quartos (com respiração). */
  idle: {
    E: still(['atkStance']),
    W: still(['atkStance'], true),
    N: still(['walkN0']),
    S: still(['front']),
    SE: still(['idleSE0', 'idleSE1', 'idleSE2', 'idleSE1']),
    SW: still(['idleSE0', 'idleSE1', 'idleSE2', 'idleSE1'], true),
    NW: still(['walkNW0'], true),
    NE: still(['walkNW0']),
  },
  attack: [
    [['atkRaise', 0.045], ['atkSlash', 0.11], ['atkArc', 0.19], ['atkFinish', Infinity]],
    [['parryReady', 0.05], ['parryRiposte', 0.17], ['parryFinish', Infinity]],
    [['raise', 0.09], ['slash', 0.3], ['atkFinish', Infinity]],
  ],
  dash: [['dash0', 0.03], ['dash1', 0.08], ['dash2', 0.13], ['dash3', Infinity]],
  dashLand: 'dashLand',
  guard: [['guardRaise', 0.06], ['guardHold', Infinity]],
  guardBlock: 'guardBlock',
  guardExit: 'guardExit',
  parry: [['parrySpark', 0.12], ['parryRiposte', 0.26], ['parryFinish', Infinity]],
  parryFinish: 'parryFinish',
  charge: 'crouch',
  iaido: [['dash1', IAIDO.dur / 3], ['dash2', IAIDO.dur * 2 / 3], ['dash3', IAIDO.dur], ['slash', Infinity]],
  special: specialClip(
    ['kiai0', 'kiai1', 'kiai2', 'kiai3', 'kiai4', 'kiai5', 'kiai6', 'kiai7', 'kiai8'],
    ['kiaiBlast0', 'kiaiBlast1', 'kiaiBlast2', 'kiaiBlast3', 'kiaiBlast4', 'kiaiBlast5'],
  ),
  hurt: 'guardExit',
  dead: 'crouch',
};

// ------------------------------------------------------------------ Tomoe
// perfis: os quadros da folha só têm a passada aberta; os de passagem (pernas sob o corpo) são gerados
// pelo extrator a partir deles. Ciclo = apoio, passagem, apoio, passagem (dois passos), lados desenhados.
const TOMOE_RUN_E: FrameName[] = ['tmC06', 'tmPassR0', 'tmD06', 'tmPassR1'];
const TOMOE_RUN_W: FrameName[] = ['tmC00', 'tmPassL0', 'tmD00', 'tmPassL1'];
/** Metros de cada quadro = recuo do pé apoiado até o próximo (+13 -> 0 -> -17 texels...). */
const TOMOE_STRIDES = [0.41, 0.55, 0.47, 0.64];
/** Corpo mais alto na passagem (perna de apoio esticada sob o corpo). */
const TOMOE_LIFT = [0, 2, 0, 2];
const tomoeSide = (left: boolean): Cycle => ({
  frames: left ? TOMOE_RUN_W : TOMOE_RUN_E, left, stride: 0.52, strides: TOMOE_STRIDES, lift: TOMOE_LIFT,
});
/** Passo da Tomoe (m) — o jogo usa para os respingos coincidirem com o apoio. */
export const TOMOE_STEP = TOMOE_STRIDES[0] + TOMOE_STRIDES[1];
// diagonais como as do Ronin (três-quartos, não perfil): a corrida de frente/costas da folha é desenhada
// levemente virada — a de frente olhando para baixo-esquerda, a de costas para cima-direita
const TOMOE_DIAG_S: FrameName[] = range('tmB', 0, 5);
const TOMOE_DIAG_N: FrameName[] = range('tmB', 6, 11);
const tomoeDiag = (frames: FrameName[], left: boolean): Cycle => ({ frames, left, stride: ANIM.strideDiagonal });

export const TOMOE_ANIM: AnimSet = {
  id: 'tomoe',
  locomotion: {
    E: tomoeSide(false),
    W: tomoeSide(true),
    N: { frames: range('tmA', 6, 11), left: false, stride: ANIM.strideVertical },
    S: { frames: range('tmA', 0, 5), left: false, stride: ANIM.strideVertical },
    SE: tomoeDiag(TOMOE_DIAG_S, false),
    SW: tomoeDiag(TOMOE_DIAG_S, true),
    NE: tomoeDiag(TOMOE_DIAG_N, false),
    NW: tomoeDiag(TOMOE_DIAG_N, true),
  },
  idle: {
    E: still(['tcA00']),
    W: still(['tcA00'], true),
    N: still(['tmA06']),
    S: still(['tmA00']),
    // parada na diagonal (inclusive a posição inicial): postura de luta de perfil, de lado como o Ronin —
    // os quadros de corrida de frente/costas, parados, deixavam ela de frente
    SE: still(['tcA00']),
    SW: still(['tcA00'], true),
    NE: still(['tcA00']),
    NW: still(['tcA00'], true),
  },
  attack: [
    [['tcA01', 0.045], ['tcA02', 0.1], ['tcA03', 0.16], ['tcA04', 0.22], ['tcA05', Infinity]],
    [['tcC03', 0.06], ['tcC04', 0.18], ['tcA05', Infinity]],
    [['tcA01', 0.09], ['tcA03', 0.2], ['tcA04', 0.3], ['tcA05', Infinity]],
  ],
  dash: [['tcD00', 0.03], ['tcD01', 0.08], ['tcD02', 0.13], ['tcD03', Infinity]],
  dashLand: 'tcD04',
  guard: [['tcB01', 0.06], ['tcB02', Infinity]],
  guardBlock: 'tcC01',
  guardExit: 'tcB04',
  parry: [['tcC01', 0.06], ['tcC02', 0.12], ['tcC03', 0.2], ['tcC04', Infinity]],
  parryFinish: 'tcC05',
  // mão no cabo, inclinada para sacar: a pose de arranque da esquiva serve de concentração do iaido
  charge: 'tcD00',
  iaido: [['tcD01', IAIDO.dur / 3], ['tcD02', IAIDO.dur * 2 / 3], ['tcD03', IAIDO.dur], ['tcA04', Infinity]],
  // Hanafubuki: 9 quadros de concentração (até o golpe no chão) e 8 da explosão de pétalas
  special: specialClip(
    [...range('tsA', 0, 5), 'tsB00', 'tsB01', 'tsB02'],
    ['tsB03', 'tsB04', 'tsB05', ...range('tsC', 0, 4)],
    // o auge (explosão de flores e as pétalas assentando) fica bem mais tempo que o resto
    [0.7, 0.9, 2.6, 2.0, 1.3, 0.8, 0.6, 0.6],
  ),
  hurt: 'tcB04',
  dead: 'tcD00',
};

export const ANIM_SETS: Record<CharacterId, AnimSet> = { ronin: RONIN_ANIM, tomoe: TOMOE_ANIM };

// ------------------------------------------------------------------ Leão (forma do Ronin)
// Folha assets-src/lion-movement.png: as 8 direções desenhadas, nada espelha. Frente, costas e os dois perfis
// têm andar e galope; os três-quartos de costas (cima-esquerda/direita) e de frente (baixo-esquerda/direita)
// têm um passo só, que serve aos dois. Fora do ciclo, os quadros com duas caudas (a cauda trocando de lado,
// desenhada dos dois lados ao mesmo tempo): lwS02, lrS02, lwN03, lrN03 e lNE05.
const without = (frames: FrameName[], out: FrameName): FrameName[] => frames.filter(f => f !== out);
const LION_DIAG = { NW: range('lNW', 0, 5), NE: range('lNE', 0, 4), SW: range('lSW', 0, 5), SE: range('lSE', 0, 5) };
export type LionGait = 'run' | 'walk';
/** Quadros por direção e metros por ciclo: cada vista divide o mesmo ciclo pelos seus 5 ou 6 quadros. */
export const LION_GAITS: Record<LionGait, { frames: Record<Dir8, FrameName[]>; cycle: number }> = {
  run: {
    frames: {
      S: without(range('lrS', 0, 5), 'lrS02'), N: without(range('lrN', 0, 5), 'lrN03'),
      W: range('lrW', 0, 4), E: range('lrE', 0, 4), ...LION_DIAG,
    },
    cycle: LION.strideRun,
  },
  walk: {
    frames: {
      S: without(range('lwS', 0, 5), 'lwS02'), N: without(range('lwN', 0, 5), 'lwN03'),
      W: range('lwW', 0, 4), E: range('lwE', 0, 4), ...LION_DIAG,
    },
    cycle: LION.strideWalk,
  },
};
/** Parado: um quadro calmo de cada vista (patas no chão, uma cauda só). */
export const LION_IDLE: Record<Dir8, FrameName> = {
  S: 'lwS00', N: 'lwN05', W: 'lwW00', E: 'lwE00', NW: 'lNW02', NE: 'lNE02', SW: 'lSW05', SE: 'lSE00',
};

/** Trecho de clipe: os quadros dividem [from, to), com peso opcional por quadro. */
function span(frames: readonly FrameName[], from: number, to: number, weights?: readonly number[]): Clip {
  const w = weights ?? frames.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  return frames.map((f, i) => { acc += w[i]; return [f, from + ((to - from) * acc) / total] as const; });
}
const weightedClip = (frames: readonly (readonly [FrameName, number])[], dur: number): Clip =>
  span(frames.map(([f]) => f), 0, dur, frames.map(([, w]) => w));

/** Transformação: [quadro, peso]. O leão completo (tf15, rugindo) começa em LION.burstAt. */
const TRANSFORM_WEIGHTS: readonly (readonly [FrameName, number])[] = [
  ['tf00', 0.6], ['tf01', 0.8], ['tf02', 0.8], ['tf03', 0.9], ['tf04', 1.4], // aura crescendo, antecipação
  ['tf05', 1.3], ['tf06', 1.0], ['tf07', 0.9], // quebra da pose: vira para baixo-direita rugindo
  ['tf08', 1.0], ['tf09', 1.4], ['tf10', 0.8], ['tf11', 1.0], ['tf12', 0.8], ['tf13', 0.8], ['tf14', 1.1], // homem-fera
  // tf16 (compacto, ainda com farrapo) antes de tf15: a silhueta cresce em vez de pulsar
  ['tf16', 0.8], ['tf15', 1.6], ['tf17', 1.0], ['tf18', 0.9], ['tf19', 1.0], ['tf20', 3.0],
];
export const TRANSFORM_CLIP: Clip = weightedClip(TRANSFORM_WEIGHTS, LION.transformDur);
/** Volta a humano: a transformação ao contrário, encurtada. */
export const REVERT_CLIP: Clip = weightedClip([
  ['tf20', 1], ['tf19', 1], ['tf17', 1], ['tf15', 1.5], ['tf14', 1], ['tf12', 1], ['tf10', 1], ['tf08', 1],
  ['tf06', 1], ['tf04', 1], ['tf02', 1], ['tf00', 1.5],
], LION.revertDur);

const CLAW = LION.claw;
/** O arco maior (07-08) fica um pouco além da janela ativa, para ser visto. */
const CLAW_ARC_END = CLAW.activeTo + 0.04;
const CLAW_SETTLE = (CLAW_ARC_END + CLAW.dur) / 2;
/**
 * Garra (desenhada para a direita): agacha e arma a pata até o golpe sair (activeFrom); o arco branco (05-08)
 * cobre a janela ativa; depois o acompanhamento rente ao chão (09-12) e a volta à guarda (13-17) até dur.
 * Fora os quase repetidos lclaw02 e lclaw16; a postura (lclaw00) fica de fora para o golpe sair na hora.
 */
export const LION_CLAW_CLIP: Clip = [
  ...span(['lclaw01', 'lclaw03', 'lclaw04'], 0, CLAW.activeFrom),
  ...span(['lclaw05', 'lclaw06', 'lclaw07', 'lclaw08'], CLAW.activeFrom, CLAW_ARC_END, [0.8, 0.8, 1.2, 1.2]),
  ...span(['lclaw09', 'lclaw10', 'lclaw11', 'lclaw12'], CLAW_ARC_END, CLAW_SETTLE),
  ...span(['lclaw13', 'lclaw14', 'lclaw15', 'lclaw17'], CLAW_SETTLE, CLAW.dur),
];
const ROAR = LION.roar;
/** Carga do rugido (desenhada para a direita): agacha enchendo o peito (lroar00-03) e segura o agachado. */
export const LION_ROAR_CHARGE_CLIP: Clip = span(['lroar00', 'lroar01', 'lroar02', 'lroar03'], 0, ROAR.chargeTime * 0.55, [0.4, 1, 1, 1]);
/** Carga pronta: treme 1 texel (vezes por segundo que sobe). */
const ROAR_TREMBLE_HZ = 12;
/**
 * Rugido: cabeça para cima (lroar04) até o estouro; a primeira onda (05) entra em LION.roar.blastAt, quando a
 * simulação fere e empurra; a maior (07) fica mais tempo; as ondas somem e ele volta à guarda até dur.
 */
export const LION_ROAR_CLIP: Clip = [
  ['lroar04', ROAR.blastAt],
  ...span(range('lroar', 5, 12), ROAR.blastAt, ROAR.dur, [0.8, 0.9, 2.0, 1.0, 0.9, 0.9, 0.8, 0.7]),
];

/** Direção do leão; o lado fica lembrado para a garra e o rugido (que espelham como os golpes humanos). */
function lionDir(facing: Vec2, mem: PoseMemory): Dir8 {
  const d = (mem.dir = dir8(facing, mem.dir));
  if (d !== 'N' && d !== 'S') mem.left = d === 'W' || d === 'NW' || d === 'SW';
  return d;
}

/**
 * Locomoção do leão: a fase do ciclo vem da distância percorrida (p.stride) e o ciclo é o mesmo em todas as
 * vistas — virar não pula a passada, e os respingos das patas (LION.footstep, contados na mesma distância)
 * caem nos apoios. Andar e galope têm ciclos próprios: trocar de passo já troca os desenhos.
 */
function lionLocomotion(p: Player, mem: PoseMemory): Pose {
  const d = lionDir(p.facing, mem);
  const speed = Math.hypot(p.vel.x, p.vel.z);
  // histerese entre andar e galopar
  const gait = mem.gait === 'run' ? (speed < LION.walkBelow * 0.85 ? 'walk' : 'run') : (speed > LION.walkBelow ? 'run' : 'walk');
  mem.gait = gait;
  const g = LION_GAITS[gait], frames = g.frames[d];
  const phase = (mem.phase = (((p.stride / g.cycle) % 1) + 1) % 1);
  return faced(frames[Math.floor(phase * frames.length) % frames.length], mem.left);
}

function lionPose(p: Player, mem: PoseMemory): Pose {
  switch (p.state) {
    case 'run': return lionLocomotion(p, mem);
    case 'claw': return action(clipFrame(LION_CLAW_CLIP, p.t), p.attackDir, mem);
    case 'roarCharge': {
      const pose = action(clipFrame(LION_ROAR_CHARGE_CLIP, p.t), p.facing, mem);
      if (p.chargeReady && Math.floor(p.t * ROAR_TREMBLE_HZ * 2) % 2 === 1) pose.lift = 1;
      return pose;
    }
    case 'roar': return action(clipFrame(LION_ROAR_CLIP, p.t), p.facing, mem);
    // parado, e qualquer outro estado (o leão não tem pose de ferido)
    default: return faced(LION_IDLE[lionDir(p.facing, mem)], mem.left);
  }
}

// aliases do conjunto do Ronin (usados pela horda e pelos testes)
export const LOCOMOTION = RONIN_ANIM.locomotion;
export const IDLE = RONIN_ANIM.idle;
export const ATTACK_CLIPS = RONIN_ANIM.attack;
export const DASH_CLIP = RONIN_ANIM.dash;
export const GUARD_CLIP = RONIN_ANIM.guard;
export const PARRY_CLIP = RONIN_ANIM.parry;
export const IAIDO_CLIP = RONIN_ANIM.iaido;
export const KIAI_CLIP = RONIN_ANIM.special;
/** Metros por quadro do ciclo lateral do Ronin. */
export const STRIDE = ANIM.strideSide;
const IDLE_FPS = 3;

const STRIKE_CLIP: Clip = [['atkSlash', 0.06], ['atkArc', 0.14], ['atkFinish', Infinity]];

export interface PoseMemory {
  left: boolean;
  dir?: Dir8;
  /** Último estado visto e há quanto tempo mudou (para transições). */
  state?: PlayerState | EnemyState;
  exit?: readonly [FrameName, number];
  exitT?: number;
  /** Leão: fase 0..1 do ciclo (da distância percorrida) e passo atual. */
  phase?: number;
  gait?: LionGait;
}

function locomotion(set: AnimSet, dir: Vec2, stride: number, mem: PoseMemory): Pose {
  const d = (mem.dir = dir8(dir, mem.dir));
  const c = set.locomotion[d];
  if (d !== 'N' && d !== 'S') mem.left = c.left;
  let i: number;
  if (c.strides) {
    const cycle = c.strides.reduce((a, b) => a + b, 0);
    let d = stride % cycle;
    i = 0;
    while (i < c.strides.length - 1 && d >= c.strides[i]) { d -= c.strides[i]; i++; }
  } else i = Math.floor(stride / c.stride) % c.frames.length;
  const pose = faced(c.frames[i], c.left);
  if (c.lift) pose.lift = c.lift[i];
  return pose;
}

function idle(set: AnimSet, facing: Vec2, time: number, mem: PoseMemory): Pose {
  const d = (mem.dir = dir8(facing, mem.dir));
  const c = set.idle[d];
  if (d !== 'N' && d !== 'S') mem.left = c.left;
  return faced(c.frames[Math.floor(time * IDLE_FPS) % c.frames.length], c.left);
}

/** Quadro de ação de perfil virado para `dir`. */
function action(frame: FrameName, dir: Vec2, mem: PoseMemory): Pose {
  mem.left = sideLeft(dir, mem.left);
  return faced(frame, mem.left);
}

/** Transição curta ao sair de um estado (quadro, duração). */
function exitPose(set: AnimSet, prev: PlayerState | undefined): readonly [FrameName, number] | undefined {
  if (prev === 'guard') return [set.guardExit, 0.1];
  if (prev === 'parry') return [set.parryFinish, 0.06];
  return undefined;
}

/** `time` = relógio visual (s), só para a respiração parada; `dt` avança as transições. */
export function playerPose(p: Player, mem: PoseMemory, time = 0, dt = 0, set: AnimSet = RONIN_ANIM): Pose {
  if (mem.state !== p.state) {
    mem.exit = exitPose(set, mem.state as PlayerState | undefined);
    mem.exitT = 0;
    mem.state = p.state;
  } else mem.exitT = (mem.exitT ?? 0) + dt;
  // transformação e volta: clipes próprios (começa de frente, termina em três-quartos virado para o lado)
  if (p.state === 'transform') return action(clipFrame(TRANSFORM_CLIP, p.t), p.facing, mem);
  if (p.state === 'revert') return action(clipFrame(REVERT_CLIP, p.t), p.facing, mem);
  if (p.form === 'lion' && p.state !== 'dead') return lionPose(p, mem);
  switch (p.state) {
    case 'run': return locomotion(set, p.facing, p.stride, mem);
    case 'attack': return action(clipFrame(set.attack[p.comboStep] ?? set.attack[0], p.t), p.attackDir, mem);
    case 'dash': return action(clipFrame(set.dash, p.t), p.dashDir, mem);
    case 'dashEnd': return action(set.dashLand, p.dashDir, mem);
    case 'guard': return action(p.sinceBlock < GUARD.blockTime ? set.guardBlock : clipFrame(set.guard, p.t), p.facing, mem);
    case 'parry': return action(clipFrame(set.parry, p.t), p.facing, mem);
    case 'charge': return action(set.charge, p.facing, mem);
    case 'iaido': return action(clipFrame(set.iaido, p.t), p.attackDir, mem);
    case 'kiai': return action(clipFrame(set.special, p.t), p.facing, mem);
    case 'hurt': return action(set.hurt, p.facing, mem);
    case 'dead': return action(set.dead, p.facing, mem);
    default: {
      if (mem.exit && (mem.exitT ?? 0) < mem.exit[1]) return action(mem.exit[0], p.facing, mem);
      return idle(set, p.facing, time, mem);
    }
  }
}

export function enemyPose(e: Enemy, mem: PoseMemory, time = 0): Pose {
  mem.state = e.state;
  const speed = Math.hypot(e.vel.x, e.vel.z);
  switch (e.state) {
    case 'chase':
    case 'circle':
      if (speed > (e.state === 'chase' ? 0.8 : 0.45)) return locomotion(RONIN_ANIM, { x: e.vel.x / speed, z: e.vel.z / speed }, e.stride, mem);
      return idle(RONIN_ANIM, e.facing, time + e.id * 0.37, mem);
    case 'windup': return action(e.t < e.def.windup * 0.22 ? 'atkStance' : 'atkRaise', e.strikeDir, mem);
    case 'strike': return action(clipFrame(STRIKE_CLIP, e.t), e.strikeDir, mem);
    case 'recover': return action(e.t < 0.22 ? 'atkFinish' : 'atkStance', e.strikeDir, mem);
    case 'stagger': return action('guardExit', e.facing, mem);
    case 'parried': return action('crouch', e.facing, mem);
    case 'dying': return action('crouch', { x: -e.deathDir.x, z: -e.deathDir.z }, mem);
    default: return idle(RONIN_ANIM, e.facing, time + e.id * 0.37, mem);
  }
}
