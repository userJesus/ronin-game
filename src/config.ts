// Ajustes de jogo. Unidades: metros, segundos, radianos (graus convertidos com DEG).
export const DEG = Math.PI / 180;

export const SIM_DT = 1 / 60;

/** Densidade da pixel art: 1 texel do sprite = 1/32 m = 1 pixel da tela em baixa resolução. */
export const TEXELS_PER_METER = 32;

export const CAMERA = {
  yaw: 45 * DEG,
  /** 30° dá o isométrico 2:1 clássico da pixel art. */
  pitch: 30 * DEG,
  distance: 60,
  /** Altura alvo (px) do buffer em baixa resolução; a escala de ampliação é inteira. */
  targetRows: 480,
  follow: 7,
  lookAhead: 0.9,
};

/**
 * Animação de locomoção: metros percorridos por quadro de cada ciclo, medidos na arte
 * (o pé apoiado recua ~7 texels por quadro no ciclo lateral = 0,22 m).
 */
export const ANIM = {
  strideSide: 0.22,
  strideVertical: 0.3,
  strideDiagonal: 0.26,
  /** Ciclo lateral: 5 quadros por passo; a outra perna pousa no quadro 3. */
  sideFrames: 5,
  sideContact: 3,
};

export const ARENA = {
  radius: 36,
};

export const PLAYER = {
  radius: 0.42,
  speed: 5.4,
  accel: 42,
  maxHp: 100,
  maxKi: 100,
  hurtTime: 0.28,
  hurtInvuln: 0.85,
  hurtKnock: 7,
  healPerKill: 0.5,
  healPerWave: 25,
  attackBuffer: 0.22,
  dashBuffer: 0.14,
  /** Ajuda de mira: se há inimigo dentro deste cone/alcance, o golpe vira para ele. */
  aimAssistRange: 3.6,
  aimAssistCone: 55 * DEG,
  comboReset: 0.38,
};

export interface AttackDef {
  dur: number;
  activeFrom: number;
  activeTo: number;
  range: number;
  halfArc: number;
  damage: number;
  knock: number;
  lunge: number;
  /** A partir deste instante o golpe pode ser cancelado em outro golpe ou esquiva. */
  cancelAt: number;
  hitstop: number;
}

export const COMBO: AttackDef[] = [
  { dur: 0.3, activeFrom: 0.04, activeTo: 0.13, range: 2.35, halfArc: 66 * DEG, damage: 1, knock: 5, lunge: 6, cancelAt: 0.16, hitstop: 0.045 },
  { dur: 0.3, activeFrom: 0.04, activeTo: 0.13, range: 2.35, halfArc: 66 * DEG, damage: 1, knock: 5, lunge: 6, cancelAt: 0.16, hitstop: 0.045 },
  { dur: 0.44, activeFrom: 0.07, activeTo: 0.17, range: 2.85, halfArc: 58 * DEG, damage: 2, knock: 10, lunge: 9.5, cancelAt: 0.27, hitstop: 0.08 },
];

export const DASH = {
  speed: 15.5,
  dur: 0.17,
  /** Aterrissagem depois da investida (derrapagem curta; dá para cortar ou defender). */
  land: 0.09,
  invuln: 0.26,
  cooldown: 0.5,
};

export const IAIDO = {
  cost: 40,
  chargeTime: 0.45,
  /** Andar enquanto carrega (fração da velocidade). */
  chargeMove: 0.18,
  distance: 7.2,
  dur: 0.15,
  width: 1.35,
  damage: 6,
  recover: 0.36,
  invulnAfter: 0.25,
  hitstop: 0.14,
};

export const KI = {
  perHit: 2,
  perKill: 7,
};

/** Defesa (segurar) e aparar/parry (apertar no instante do golpe inimigo). */
export const GUARD = {
  /** Janela de parry a partir do aperto da defesa. */
  parryWindow: 0.26,
  /** Tolerância para quem aperta um pouco tarde: o golpe que chegou há menos disso ainda pode ser aparado. */
  lateGrace: 0.07,
  /** Soltar e apertar de novo antes disso não abre nova janela (evita "metralhar" o botão). */
  parryCooldown: 0.25,
  /** Meio-ângulo frontal que a guarda cobre. */
  halfArc: 105 * DEG,
  /** Fração do dano que passa pela guarda (brutamontes empurram mais). */
  chip: 0.2,
  chipBrute: 0.45,
  /** Empurrão (m/s) do golpe bloqueado — a única coisa que desloca o jogador na guarda. */
  knock: 4.5,
  /** Duração da pose de impacto do bloqueio (só visual/áudio). */
  blockTime: 0.16,
};

/** Kiai: golpe especial (tecla Q). Explosão de espírito que mata tudo em volta. */
export const KIAI = {
  /** Exige a barra de Ki cheia e a esvazia. */
  cost: 100,
  /** Concentração até a explosão (invulnerável). */
  gather: 0.62,
  /** Animação inteira (concentração + explosão + dissipação). */
  dur: 1.25,
  /** Todo inimigo dentro deste raio morre. */
  radius: 4.6,
  /** Além do raio, até aqui: empurrados e atordoados. */
  pushRadius: 8,
  push: 9,
  invulnAfter: 0.3,
  hitstop: 0.16,
};

/**
 * Forma de leão do Ronin (tecla R com a Fúria cheia). A Fúria é uma barra separada do Ki: enche lutando
 * como humano (acertos, abates, parry e dano recebido) e, na forma, esvazia com o tempo até ele voltar.
 */
export const LION = {
  max: 100,
  perHit: 1.5,
  /** Por abate, vezes o `ki` do inimigo (ronin 1, brutamontes 2). */
  perKill: 4,
  perParry: 10,
  /** Por ponto de vida perdido como humano (a raiva também conta). */
  perHurt: 0.6,
  /** Quanto tempo um R apertado espera por uma brecha (s). */
  buffer: 0.3,
  /** Transformação inteira (invulnerável). */
  transformDur: 2.2,
  /** O leão completo surge rugindo aqui (quadro tf15 do clipe em pose.ts): onda de choque que empurra e atordoa (sem matar). */
  burstAt: 1.48,
  burstRadius: 5.5,
  burstPush: 11,
  burstHitstop: 0.12,
  /** Proteção depois da transformação e da volta. */
  invulnAfter: 0.3,
  /** Segundos na forma (a barra esvazia nesse tempo); R de novo volta antes. */
  duration: 14,
  revertDur: 1.0,
  radius: 0.6,
  speed: 7.6,
  accel: 55,
  /** Abaixo disso (analógico pela metade) anda em vez de galopar (m/s). */
  walkBelow: 3.6,
  /**
   * Metros por ciclo (passada completa) do galope e do andar; cada vista divide o ciclo pelos seus 5 ou 6
   * quadros (pose.ts). A arte quase não mexe as patas (nos perfis a apoiada recua só 2-4 texels por quadro):
   * casar o pé daria 60+ quadros/s. O ciclo segue a cadência: ~3 passadas/s galopando a `speed` (15-18 quadros/s).
   */
  strideRun: 2.5,
  strideWalk: 1.25,
  /** Respingo das patas: duas batidas por ciclo de galope (meio ciclo), nos apoios dos perfis (fases 0,1 e 0,6). */
  footstep: { length: 1.25, phase: 0.25 },
  /**
   * Garra (ataque básico, botão de corte): leque à frente com alcance de 5 m a partir do centro do leão.
   * Pesado (fura a guarda/poise da horda). Apertar de novo depois de `cancelAt` emenda outra garra.
   */
  claw: { dur: 0.56, activeFrom: 0.16, activeTo: 0.26, range: 5, halfArc: 45 * DEG, damage: 3, knock: 9, lunge: 6, cancelAt: 0.36, hitstop: 0.07 } as AttackDef,
  /** Meio-ângulo do cone da ajuda de mira da garra (40° para cada lado). */
  clawAssistCone: 40 * DEG,
  /**
   * Rugido (ataque carregado: segurar e soltar o botão do iaido): onda em volta do leão — fere, empurra e
   * atordoa todos no raio. Soltar antes de `chargeTime` desiste; depois do rugido, `cooldown` até o próximo.
   */
  roar: { chargeTime: 0.6, dur: 1.0, blastAt: 0.2, radius: 6, damage: 4, push: 12, hitstop: 0.12, cooldown: 2.5 },
};

export const PARRY = {
  /** Pose de deflexão + contra-ataque automático. */
  dur: 0.42,
  riposteAt: 0.12,
  riposteDamage: 3,
  riposteRange: 3.2,
  /** A partir daqui pode emendar corte/esquiva/defesa. */
  cancelAt: 0.28,
  invuln: 0.5,
  /** Tempo que o inimigo aparado fica sem guarda. */
  stun: 1.3,
  ki: 12,
  hitstop: 0.11,
};

export type EnemyKind = 'ronin' | 'brute' | 'swift';

export interface EnemyDef {
  hp: number;
  speed: number;
  radius: number;
  windup: number;
  strike: number;
  recover: number;
  reach: number;
  halfArc: number;
  damage: number;
  lunge: number;
  /** Golpes absorvidos sem ser interrompido durante preparação/ataque. */
  poise: number;
  score: number;
  ki: number;
  stagger: number;
  knockResist: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  ronin: { hp: 3, speed: 3.3, radius: 0.42, windup: 0.5, strike: 0.24, recover: 0.66, reach: 2.0, halfArc: 68 * DEG, damage: 12, lunge: 7.5, poise: 1, score: 100, ki: 1, stagger: 0.36, knockResist: 0 },
  brute: { hp: 8, speed: 2.55, radius: 0.5, windup: 0.86, strike: 0.3, recover: 0.95, reach: 2.45, halfArc: 88 * DEG, damage: 22, lunge: 6.5, poise: 3, score: 400, ki: 2, stagger: 0.3, knockResist: 0.6 },
  swift: { hp: 1, speed: 4.9, radius: 0.38, windup: 0.38, strike: 0.2, recover: 0.52, reach: 1.75, halfArc: 60 * DEG, damage: 9, lunge: 10, poise: 0, score: 150, ki: 1, stagger: 0.36, knockResist: 0 },
};

export const AI = {
  /** Alcance da sonda de desvio de obstáculos (m). */
  avoidLook: 1.6,
  /** Quanto tempo o lado escolhido para contornar vale depois da última batida da sonda (s). */
  avoidHold: 0.5,
  /** Folga mínima entre um ponto de surgimento e qualquer obstáculo (m). */
  spawnClearance: 1,
  engageRadius: 6,
  ringRadius: 3.4,
  ringJitter: 0.9,
  orbitSpeed: 0.45,
  accel: 14,
  tokenCooldown: [0.8, 1.9] as [number, number],
  spawnTime: 0.55,
  deathTime: 1.1,
  /** Fração da preparação em que o inimigo ainda gira para seguir o jogador. */
  trackUntil: 0.6,
  /** A pista visual do golpe (contorno branco + brilho na lâmina) aparece este tempo antes do fim da
   *  preparação — fixo para todos os tipos, para caber no tempo de reação e na janela de parry. */
  cueLead: 0.3,
};

export const WAVES = {
  firstDelay: 1.6,
  intermission: 3.6,
  size: (n: number) => Math.min(8 + 5 * (n - 1), 72),
  maxAlive: (n: number) => Math.min(9 + 3 * n, 40),
  brutes: (n: number) => (n >= 3 ? Math.floor((n - 1) / 2) : 0),
  swifts: (n: number) => (n >= 4 ? Math.min(2 * (n - 3), 14) : 0),
  maxAttackers: (n: number) => Math.min(1 + Math.ceil(n / 2), 5),
  spawnEvery: (n: number) => Math.max(0.55, 1.7 - 0.09 * n),
  speedMul: (n: number) => Math.min(1 + 0.025 * (n - 1), 1.35),
  windupMul: (n: number) => Math.max(0.7, 1 - 0.025 * (n - 1)),
  damageMul: (n: number) => Math.min(1 + 0.04 * (n - 1), 1.6),
};

export const SCORE = {
  comboTimeout: 2.6,
  multiplier: (combo: number) => Math.min(1 + Math.floor(combo / 10) * 0.25, 3),
};
