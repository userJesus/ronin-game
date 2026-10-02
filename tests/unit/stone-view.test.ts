// HUD de pedra: o modelo de exibição (rótulos, ícones, disponibilidade, recargas e avisos) segue as regras do jogo.
import { describe, expect, it } from 'vitest';
import { DASH, IAIDO, KIAI, LION, PLAYER } from '../../src/config';
import { createStoneView, fillStoneView, cooldownLabel, type StoneCharacter, type StoneDevice } from '../../src/ui/stone/view';
import type { Player, PlayerState } from '../../src/sim/types';
import { makeSim } from './helpers';

function player(o: Partial<Player> = {}): Player {
  const p = makeSim({ waves: false }).player;
  return Object.assign(p, o);
}
const view = (p: Player, ch: StoneCharacter = 'ronin', dev: StoneDevice = 'kb') => fillStoneView(createStoneView(), p, ch, dev);

describe('HUD de pedra: barras', () => {
  it('vida, Ki e a marca do iaido; vida crítica a partir de 25%', () => {
    const v = view(player({ hp: 64.2, ki: 55.9 }));
    expect(v.hp).toBe(65);
    expect(v.maxHp).toBe(PLAYER.maxHp);
    expect(v.ki).toBe(55);
    expect(v.kiMark).toBeCloseTo(IAIDO.cost / PLAYER.maxKi);
    expect(v.kiReady).toBe(true);
    expect(v.low).toBe(false);
    expect(view(player({ hp: 25 })).low).toBe(true);
    expect(view(player({ hp: 26 })).low).toBe(false);
    expect(view(player({ hp: 0 })).low).toBe(false);
  });

  it('Fúria: enchendo, pronta (tecla do dispositivo), leão (segundos que restam, pisca no fim), voltando', () => {
    expect(view(player({ fury: 70 })).fury).toMatchObject({ state: 'fill', text: '70%', status: 'Acumulando', show: true });
    expect(view(player({ fury: LION.max })).fury).toMatchObject({ state: 'ready', status: 'Pronto · R' });
    expect(view(player({ fury: LION.max }), 'ronin', 'pad').fury.status).toBe('Pronto · R3');
    expect(view(player({ fury: LION.max }), 'ronin', 'touch').fury.status).toBe('Pronto');
    const lion = view(player({ form: 'lion', fury: LION.max * 0.5 })).fury;
    expect(lion).toMatchObject({ state: 'lion', text: `${Math.ceil(LION.duration / 2)} s`, low: false });
    expect(view(player({ form: 'lion', fury: LION.max * 0.2 })).fury.low).toBe(true);
    expect(view(player({ state: 'transform' })).fury.status).toBe('Despertando');
    expect(view(player({ state: 'revert', form: 'lion' })).fury.status).toBe('Voltando');
    // a Tomoe não tem a forma de leão
    expect(view(player(), 'tomoe').fury.show).toBe(false);
  });
});

describe('HUD de pedra: comandos', () => {
  it('humano: rótulos, ícones e teclas por dispositivo', () => {
    const v = view(player());
    expect(v.commands.map(c => c.label)).toEqual(['MOVER', 'CORTE', 'DEFESA', 'ESQUIVA', 'IAIDO', 'KIAI', 'LEÃO']);
    expect(v.byId.attack.icon).toBe('sh-sword');
    expect(v.byId.charge.icon).toBe('sh-iaido');
    expect(v.commands.map(c => c.key)).toEqual(['WASD', 'J', 'K', 'ESPAÇO', 'L', 'Q', 'R']);
    expect(view(player(), 'ronin', 'pad').commands.map(c => c.key)).toEqual(['ANALÓG.', 'X', 'RT', 'A', 'B', 'Y', 'R3']);
    expect(view(player(), 'ronin', 'touch').commands.every(c => c.key === '')).toBe(true);
  });

  it('Ki e Fúria decidem o que está pronto; o motivo explica o que falta', () => {
    const low = view(player({ ki: IAIDO.cost - 1, fury: LION.max - 1 }));
    expect(low.byId.charge).toMatchObject({ enabled: false, ready: false, reason: `Iaido precisa de ${IAIDO.cost} de Ki` });
    expect(low.byId.special).toMatchObject({ enabled: false, reason: 'Kiai precisa de Ki cheio' });
    expect(low.byId.transform).toMatchObject({ enabled: false, reason: 'Fúria incompleta' });
    const full = view(player({ ki: KIAI.cost, fury: LION.max }));
    for (const id of ['charge', 'special', 'transform'] as const) expect(full.byId[id]).toMatchObject({ enabled: true, ready: true, reason: '' });
  });

  it('em uso: cada estado acende o seu comando; carga pronta vira SOLTE!', () => {
    const pressed = (state: PlayerState, o: Partial<Player> = {}) =>
      view(player({ state, ...o })).commands.filter(c => c.pressed).map(c => c.id);
    expect(pressed('run')).toEqual(['move']);
    expect(pressed('attack')).toEqual(['attack']);
    expect(pressed('guard')).toEqual(['guard']);
    expect(pressed('parry')).toEqual(['guard']);
    expect(pressed('dash')).toEqual(['dash']);
    expect(pressed('kiai')).toEqual(['special']);
    expect(pressed('charge', { ki: 60 })).toEqual(['charge']);
    const ready = view(player({ state: 'charge', chargeReady: true, ki: 60 })).byId.charge;
    expect(ready).toMatchObject({ release: true, label: 'SOLTE!' });
  });

  it('recarga da esquiva: anel e segundos', () => {
    const half = (DASH.cooldown + DASH.dur) / 2;
    const c = view(player({ dashCd: half })).byId.dash;
    expect(c.enabled).toBe(false);
    expect(c.reason).toBe('Esquiva recarregando');
    expect(c.cooldown).toBeCloseTo(0.5);
    expect(c.cooldownText).toBe(cooldownLabel(half));
    expect(cooldownLabel(0.34)).toBe('0,4');
    expect(cooldownLabel(1.2)).toBe('2');
    expect(cooldownLabel(0)).toBe('');
  });

  it('leão: garra, rugido (recarga), humano; defesa, esquiva e especial travados com o motivo', () => {
    const v = view(player({ form: 'lion', fury: 50 }));
    expect(v.byId.attack).toMatchObject({ label: 'GARRA', icon: 'sh-paw', enabled: true });
    expect(v.byId.charge).toMatchObject({ label: 'RUGIDO', icon: 'sh-roar', enabled: true, ready: true });
    expect(v.byId.transform).toMatchObject({ label: 'HUMANO', icon: 'sh-samurai', enabled: true, ready: true });
    expect(v.byId.guard).toMatchObject({ enabled: false, reason: 'O leão não defende' });
    expect(v.byId.dash).toMatchObject({ enabled: false, reason: 'O leão não esquiva' });
    expect(v.byId.special).toMatchObject({ enabled: false, reason: 'Indisponível na forma de leão' });
    expect(v.kiLocked).toBe(true);
    expect(v.form).toBe('Forma de leão');
    // recarga do rugido
    const total = LION.roar.dur + LION.roar.cooldown;
    const cd = view(player({ form: 'lion', fury: 50, roarCd: total / 4 })).byId.charge;
    expect(cd).toMatchObject({ enabled: false, ready: false, reason: 'Rugido recarregando' });
    expect(cd.cooldown).toBeCloseTo(0.25);
    // carregando, pronto para soltar
    const rel = view(player({ form: 'lion', fury: 50, state: 'roarCharge', chargeReady: true })).byId.charge;
    expect(rel).toMatchObject({ pressed: true, release: true, label: 'SOLTE!' });
  });

  it('transformando e morto: tudo travado com o motivo', () => {
    const t = view(player({ state: 'transform', fury: LION.max }));
    for (const c of t.commands) expect(c.enabled, c.id).toBe(false);
    expect(t.byId.attack.reason).toBe('Transformando');
    expect(t.byId.transform.pressed).toBe(true);
    const d = view(player({ state: 'dead', hp: 0 }));
    for (const c of d.commands) expect(c.reason, c.id).toBe('Sem vida');
  });

  it('Tomoe: Hanafubuki com o ícone de pétalas e sem o comando Leão', () => {
    const v = view(player({ ki: KIAI.cost }), 'tomoe');
    expect(v.name).toBe('TOMOE');
    expect(v.byId.special).toMatchObject({ label: 'HANAFUBUKI', icon: 'sh-petals', ready: true });
    expect(v.byId.transform.hidden).toBe(true);
    expect(view(player({ ki: 0 }), 'tomoe').byId.special.reason).toBe('Hanafubuki precisa de Ki cheio');
  });

  it('o mesmo objeto é reaproveitado a cada quadro (sem alocar comandos novos)', () => {
    const v = createStoneView();
    const cmds = v.commands, first = v.commands[0];
    fillStoneView(v, player({ state: 'run' }), 'ronin', 'kb');
    fillStoneView(v, player({ form: 'lion', fury: 40 }), 'ronin', 'pad');
    expect(v.commands).toBe(cmds);
    expect(v.commands[0]).toBe(first);
    expect(v.byId.move).toBe(first);
  });
});
