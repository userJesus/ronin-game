// O que o HUD de pedra mostra, calculado do estado do jogador (puro, sem DOM; testável).
// Um objeto só, reaproveitado a cada quadro (`fillStoneView` escreve por cima): nada de alocação por quadro
// além dos textos que de fato mudam.
import { DASH, IAIDO, KIAI, LION, PLAYER } from '../../config';
import type { Player } from '../../sim/types';
import type { IconId } from './icons';

export type StoneCharacter = 'ronin' | 'tomoe';
/** Teclas mostradas na barra de comandos (o toque esconde a barra; os botões dele são os comandos). */
export type StoneDevice = 'kb' | 'pad' | 'touch';
export type CommandId = 'move' | 'attack' | 'guard' | 'dash' | 'charge' | 'special' | 'transform';
export const COMMAND_IDS: readonly CommandId[] = ['move', 'attack', 'guard', 'dash', 'charge', 'special', 'transform'];

/** Barra de Fúria: enchendo, cheia, transformando, leão (o tempo que resta) e voltando. */
export type FuryState = 'fill' | 'ready' | 'transform' | 'lion' | 'revert';

export interface CommandView {
  id: CommandId;
  label: string;
  icon: IconId;
  key: string;
  /** O jogador está fazendo isto agora. */
  pressed: boolean;
  enabled: boolean;
  /** Pronto para usar (brilho): iaido/rugido, especial e leão. */
  ready: boolean;
  /** Carga pronta: solte agora. */
  release: boolean;
  /** Por que não dá (vazio se dá). */
  reason: string;
  /** 0..1 do anel de recarga (0 = sem recarga). */
  cooldown: number;
  /** Segundos que faltam, para o número do anel ('' sem recarga). */
  cooldownText: string;
  /** Fora da barra (o Leão, para a Tomoe). */
  hidden: boolean;
}

export interface StoneView {
  name: string;
  form: string;
  hp: number;
  maxHp: number;
  /** Vida crítica (≤ 25%). */
  low: boolean;
  ki: number;
  maxKi: number;
  /** Fração do custo do iaido (marca na barra). */
  kiMark: number;
  /** Na forma de leão (e virando/voltando) o Ki fica parado. */
  kiLocked: boolean;
  /** Ki suficiente para o iaido (a barra acende). */
  kiReady: boolean;
  fury: { show: boolean; value: number; max: number; state: FuryState; text: string; status: string; low: boolean };
  commands: CommandView[];
  /** Mesmo conteúdo de `commands`, por id. */
  byId: Record<CommandId, CommandView>;
}

/** Na forma de leão, abaixo desta fração do tempo a barra pisca (a volta está perto). */
export const FURY_LOW = 0.22;
/** Vida crítica a partir desta fração (como na referência). */
export const HP_LOW = 0.25;

const NAMES: Record<StoneCharacter, string> = { ronin: 'RONIN', tomoe: 'TOMOE' };
const SPECIAL: Record<StoneCharacter, { label: string; icon: IconId; name: string }> = {
  ronin: { label: 'KIAI', icon: 'sh-fire', name: 'Kiai' },
  tomoe: { label: 'HANAFUBUKI', icon: 'sh-petals', name: 'Hanafubuki' },
};
type Keys = Record<CommandId, string>;
const KEYS: Record<Exclude<StoneDevice, 'touch'>, Keys> = {
  kb: { move: 'WASD', attack: 'J', guard: 'K', dash: 'ESPAÇO', charge: 'L', special: 'Q', transform: 'R' },
  pad: { move: 'ANALÓG.', attack: 'X', guard: 'RT', dash: 'A', charge: 'B', special: 'Y', transform: 'R3' },
};
const TOUCH_KEYS: Keys = { move: '', attack: '', guard: '', dash: '', charge: '', special: '', transform: '' };

export function furyStateOf(p: Player): FuryState {
  return p.state === 'transform' ? 'transform'
    : p.state === 'revert' ? 'revert'
      : p.form === 'lion' ? 'lion'
        : p.fury >= LION.max && p.state !== 'dead' ? 'ready' : 'fill';
}

/** Segundos que faltam (recarga): uma casa decimal abaixo de 1 s, inteiro acima. */
export function cooldownLabel(s: number): string {
  if (s <= 0) return '';
  return s < 1 ? (Math.ceil(s * 10) / 10).toFixed(1).replace('.', ',') : String(Math.ceil(s));
}

function blankCommand(id: CommandId): CommandView {
  return { id, label: '', icon: 'sh-move', key: '', pressed: false, enabled: true, ready: false, release: false, reason: '', cooldown: 0, cooldownText: '', hidden: false };
}

export function createStoneView(): StoneView {
  const commands = COMMAND_IDS.map(blankCommand);
  const byId = Object.fromEntries(commands.map(c => [c.id, c])) as Record<CommandId, CommandView>;
  return {
    name: '', form: '', hp: 0, maxHp: PLAYER.maxHp, low: false, ki: 0, maxKi: PLAYER.maxKi,
    kiMark: IAIDO.cost / PLAYER.maxKi, kiLocked: false, kiReady: false,
    fury: { show: true, value: 0, max: LION.max, state: 'fill', text: '', status: '', low: false },
    commands, byId,
  };
}

function set(c: CommandView, label: string, icon: IconId, enabled: boolean, reason: string): void {
  c.label = label;
  c.icon = icon;
  c.enabled = enabled;
  c.reason = enabled ? '' : reason;
  c.ready = false;
  c.release = false;
  c.cooldown = 0;
  c.cooldownText = '';
  c.hidden = false;
}

/** Escreve em `v` o estado atual. `device` decide as teclas mostradas e o texto do aviso do leão. */
export function fillStoneView(v: StoneView, p: Player, character: StoneCharacter, device: StoneDevice): StoneView {
  const lion = p.form === 'lion';
  const busy = p.state === 'transform' || p.state === 'revert';
  const dead = p.state === 'dead';
  const hasLion = character === 'ronin';
  const keys = device === 'touch' ? TOUCH_KEYS : KEYS[device];
  const special = SPECIAL[character];
  const s = p.state;
  // motivo comum: morto ou no meio da transformação
  const block = dead ? 'Sem vida' : p.state === 'transform' ? 'Transformando' : p.state === 'revert' ? 'Voltando à forma humana' : '';

  v.name = NAMES[character];
  v.form = lion ? 'Forma de leão' : 'Forma humana';
  v.hp = Math.max(0, Math.ceil(p.hp));
  v.maxHp = PLAYER.maxHp;
  v.low = v.hp > 0 && v.hp / v.maxHp <= HP_LOW;
  v.ki = Math.floor(p.ki);
  v.kiLocked = lion || busy;
  v.kiReady = !v.kiLocked && p.ki >= IAIDO.cost;

  // Fúria (só o Ronin): como humano enche; na forma, esvazia mostrando o tempo que resta
  const f = v.fury;
  f.show = hasLion;
  f.state = furyStateOf(p);
  // na forma arredonda para cima: a barra só zera quando o tempo acaba
  f.value = f.state === 'lion' ? Math.ceil(p.fury) : Math.floor(p.fury);
  const secs = Math.ceil((p.fury / LION.max) * LION.duration);
  f.text = f.state === 'lion' ? `${secs} s` : `${Math.round((f.value / LION.max) * 100)}%`;
  const rKey = device === 'touch' ? '' : ` · ${KEYS[device].transform}`;
  f.status = f.state === 'ready' ? `Pronto${rKey}` : f.state === 'transform' ? 'Despertando'
    : f.state === 'lion' ? 'Transformado' : f.state === 'revert' ? 'Voltando' : 'Acumulando';
  f.low = f.state === 'lion' && p.fury <= LION.max * FURY_LOW;

  const c = v.byId;
  // mover
  set(c.move, 'MOVER', 'sh-move', !block, block);
  c.move.pressed = s === 'run';
  // corte / garra
  set(c.attack, lion ? 'GARRA' : 'CORTE', lion ? 'sh-paw' : 'sh-sword', !block, block);
  c.attack.pressed = s === 'attack' || s === 'claw';
  // defesa
  set(c.guard, 'DEFESA', 'sh-guard', !block && !lion, block || 'O leão não defende');
  c.guard.pressed = s === 'guard' || s === 'parry';
  // esquiva (recarga)
  const dashLeft = p.dashCd;
  set(c.dash, 'ESQUIVA', 'sh-dash', !block && !lion && dashLeft <= 0, block || (lion ? 'O leão não esquiva' : 'Esquiva recarregando'));
  c.dash.pressed = s === 'dash' || s === 'dashEnd';
  if (!lion && dashLeft > 0) {
    c.dash.cooldown = Math.min(1, dashLeft / (DASH.cooldown + DASH.dur));
    c.dash.cooldownText = cooldownLabel(dashLeft);
  }
  // iaido / rugido (segurar e soltar)
  if (lion) {
    const cd = p.roarCd;
    set(c.charge, 'RUGIDO', 'sh-roar', !block && cd <= 0 && s !== 'roar', block || 'Rugido recarregando');
    if (cd > 0) {
      c.charge.cooldown = Math.min(1, cd / (LION.roar.dur + LION.roar.cooldown));
      c.charge.cooldownText = s === 'roar' ? '' : cooldownLabel(cd);
    }
    c.charge.ready = c.charge.enabled;
    c.charge.pressed = s === 'roarCharge' || s === 'roar';
    c.charge.release = s === 'roarCharge' && p.chargeReady;
  } else {
    set(c.charge, 'IAIDO', 'sh-iaido', !block && p.ki >= IAIDO.cost, block || `Iaido precisa de ${IAIDO.cost} de Ki`);
    c.charge.ready = c.charge.enabled;
    c.charge.pressed = s === 'charge' || s === 'iaido';
    c.charge.release = s === 'charge' && p.chargeReady;
  }
  if (c.charge.release) c.charge.label = 'SOLTE!';
  // especial (Ki cheio)
  set(c.special, special.label, special.icon, !block && !lion && p.ki >= KIAI.cost,
    block || (lion ? 'Indisponível na forma de leão' : `${special.name} precisa de Ki cheio`));
  c.special.ready = c.special.enabled;
  c.special.pressed = s === 'kiai';
  // leão / humano (só o Ronin)
  set(c.transform, lion ? 'HUMANO' : 'LEÃO', lion ? 'sh-samurai' : 'sh-lion', !dead && !busy && (lion || p.fury >= LION.max),
    dead ? 'Sem vida' : busy ? block : 'Fúria incompleta');
  c.transform.ready = c.transform.enabled;
  c.transform.pressed = busy;
  c.transform.hidden = !hasLion;

  for (const cmd of v.commands) cmd.key = keys[cmd.id];
  return v;
}
