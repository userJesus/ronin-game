// Ícones de giz do HUD (traço irregular, falhas pela máscara #sh-chalk). Os da referência entram como vieram;
// iaido (katana saindo da bainha) e pétalas (Hanafubuki da Tomoe) foram desenhados no mesmo traço.
// Os detalhes em #171717 são "cortes" no desenho (escuros sobre o branco do giz).

export type IconId =
  | 'sh-sword' | 'sh-guard' | 'sh-parry' | 'sh-dash' | 'sh-fire' | 'sh-lion' | 'sh-samurai' | 'sh-move'
  | 'sh-paw' | 'sh-roar' | 'sh-iaido' | 'sh-petals';

const G = (body: string) => `<g mask="url(#sh-chalk)" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

/** Pétala de cerejeira com o entalhe na ponta, centrada na origem (para os transforms). */
const PETAL = 'M0 9C-6 4-6-4-2-9L0-6 2-9C6-4 6 4 0 9Z';

const ICONS: Record<IconId, string> = {
  'sh-sword': G('<path d="M13 49 49 8l5-3-1 7-35 41-5-4Z" fill="currentColor"/><path d="m10 44 13 12m-10-5-8 9" stroke="currentColor" stroke-width="4" fill="none"/><path d="m21 43 28-32" stroke="#171717" stroke-width="1.1"/>'),
  'sh-guard': G('<path d="m32 5 21 8-2 25c-2 10-9 16-20 21C19 52 12 46 10 36L9 14Z" stroke="currentColor" stroke-width="3.5" fill="none"/><path d="m32 14 12 5-1 15c-1 7-5 12-12 16-7-5-12-10-13-17l-1-14Z" fill="currentColor"/>'),
  'sh-parry': G('<path d="m5 9 23 25m12 7 18 18M56 7 10 56m-7-9 15 15" stroke="currentColor" stroke-width="3.5" fill="none"/><path d="m34 3 3 14 13 3-13 4-4 14-4-15-12-3 13-3Z" fill="currentColor"/>'),
  'sh-dash': G('<path d="m36 6 19 24-23 27 8-20-18 2 14-12-9-5Z" fill="currentColor"/><path d="M7 19h15M4 31h14M9 45h15" stroke="currentColor" stroke-width="3"/>'),
  'sh-fire': G('<path d="M36 4c4 15-14 18-11 30 4-3 9-8 8-14 16 12 23 21 15 33-7 11-27 10-34-1-7-11 2-22 7-28 0 8 2 11 5 10C18 19 34 19 36 4Z" fill="currentColor"/><path d="M32 37c3 8 12 14 4 18-8 4-13-5-4-18Z" fill="#191919"/>'),
  'sh-lion': G('<path d="m23 4 18 1 7 7 9 4-1 13 5 7-8 12-8 4-6 9-14-1-8-8-10-5-5-13 4-10-1-10 11-4Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="m20 17 10 4 4-1 10-4 5 13-8 19-10 6-11-7-6-19Z" fill="currentColor"/><path d="m20 28 8 2-2 5-7-4m17-1 9-3-2 5-6 3m-10 4h10l-5 7Z" fill="#171717"/><path d="m32 43-1 6m-5 0 5 2 7-3" stroke="#171717" stroke-width="2" fill="none"/>'),
  'sh-samurai': G('<path d="M6 5 12 18l8-3 4-8h15l7 9 6-5 5-8-1 22 6 8H2l8-10Zm8 32 35-1-4 17-13 8-13-8Z" fill="currentColor"/><path d="m19 40 10 3m6 0 10-4m-18 13 10-1" stroke="#171717" stroke-width="3"/>'),
  'sh-move': G('<path d="M17 6c-6 0-11 8-9 14l4 16 10-3 2-13c1-7-2-13-7-14Zm-5 34 2 11c2 6 8 5 10 0l-1-13ZM43 18c6-1 12 6 12 12l-1 16-11 1-5-12c-3-7 0-14 5-17Zm1 33 1 9c1 6 9 5 10-1v-9Z" fill="currentColor"/>'),
  'sh-paw': G('<path d="M10 9c6 0 8 15 4 18S2 11 10 9Zm15-6c7 0 9 19 3 22S17 4 25 3Zm16 1c8 1 6 21 0 22S33 3 41 4Zm14 9c7 2 0 20-5 19s-3-22 5-19ZM22 31c6-5 15-4 20 2l12 16c5 11-5 13-12 9-7-4-14-3-19 1-9 5-20-1-15-10Z" fill="currentColor"/>'),
  'sh-roar': G('<path d="m8 25 12-1 13-15 1 48-14-15H9ZM41 22c6 7 7 15 0 23m9-31c13 13 13 27 1 39" stroke="currentColor" stroke-width="3.5" fill="none"/>'),
  // katana saindo da bainha: bainha grossa embaixo, tsuba, lâmina fina para cima e dois riscos do saque
  'sh-iaido': G('<path d="M7 57 27 37" stroke="currentColor" stroke-width="8" fill="none"/><path d="m11 53 12-12" stroke="#171717" stroke-width="1.4" fill="none"/><path d="m22 31 11 11" stroke="currentColor" stroke-width="4.5" fill="none"/><path d="M30 35 54 7l5-2-1 5-24 29Z" fill="currentColor"/><path d="M38 49c9 0 16-5 20-12M45 59c7-1 12-5 15-10" stroke="currentColor" stroke-width="3" fill="none"/>'),
  // pétalas caindo num sopro de vento
  'sh-petals': G(`<path d="M5 47c14-4 22 4 36-2 7-3 12-9 18-10" stroke="currentColor" stroke-width="3" fill="none"/><g fill="currentColor"><path d="${PETAL}" transform="translate(20 15) rotate(-25) scale(1.15)"/><path d="${PETAL}" transform="translate(44 18) rotate(35)"/><path d="${PETAL}" transform="translate(31 33) rotate(-70) scale(.9)"/><path d="${PETAL}" transform="translate(13 32) rotate(15) scale(.7)"/><path d="${PETAL}" transform="translate(50 52) rotate(60) scale(.75)"/></g>`),
};

/** Todos os ícones como <symbol> (vão uma vez no <defs> compartilhado). */
export function iconSymbols(): string {
  return (Object.keys(ICONS) as IconId[]).map(id => `<symbol id="${id}" viewBox="0 0 64 64">${ICONS[id]}</symbol>`).join('');
}

/** Um ícone para usar no HTML (o <defs> com os símbolos precisa estar na página). */
export function iconSvg(id: IconId, cls = 'sh-ico'): string {
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
}
