// Cenários selecionáveis no menu (dados puros: a interface usa sem depender do three).
export type StageId = 'field' | 'temple';

export const STAGE_IDS: readonly StageId[] = ['field', 'temple'];

export interface StageInfo {
  name: string;
  kanji: string;
  blurb: string;
}

export const STAGES: Record<StageId, StageInfo> = {
  field: { name: 'Campo de batalha', kanji: '野', blurb: 'lama e chuva, nada onde se esconder' },
  temple: { name: 'Templo', kanji: '寺', blurb: 'pátio de pedra, lanternas e pagode' },
};

export const isStageId = (v: unknown): v is StageId => v === 'field' || v === 'temple';
