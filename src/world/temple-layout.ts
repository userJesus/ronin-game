// Planta do templo em coordenadas de tela no chão: u para a direita, v para cima (longe da câmera), em
// metros, com a arena (raio 36) centrada na origem. Tudo é alinhado à tela: fachadas de frente para a
// câmera, linhas do piso horizontais/verticais nítidas. O chão, as construções e os colisores leem daqui.
import { CAMERA } from '../config';
import { fromScreen } from '../render/pose';
import type { Vec2 } from '../core/math';

export interface Rect { u0: number; v0: number; u1: number; v1: number }
export interface Spot { u: number; v: number; r: number }

/** Posição no chão do mundo de um ponto (u, v) da planta. */
export const toWorld = (u: number, v: number): Vec2 => fromScreen(u, v);
/** Giro em y dos retângulos da planta no mundo (eixo u = direita da tela). */
export const LAYOUT_ROT = CAMERA.yaw;

export const START = { u: 0, v: 13 };

/** Salão principal (hondō) no alto: plataforma de pedra, escada, corpo, beiral. */
export const HALL = {
  platform: { u0: -9.5, v0: 18.5, u1: 9.5, v1: 29.5 },
  platformH: 1.1,
  steps: { u0: -3.2, v0: 16.4, u1: 3.2, v1: 18.5 },
  body: { u0: -8, v0: 20.2, u1: 8, v1: 28.5 },
  wallTop: 4.9,
  eave: { u0: -11, v0: 17.8, u1: 11, v1: 30.9 },
};

export const PLAZA: Rect = { u0: -14, v0: -2, u1: 14, v1: 16.4 };
export const SANDO: Rect = { u0: -1.8, v0: -44, u1: 1.8, v1: -2 };
export const GRAVEL: Rect = { u0: -31, v0: -35, u1: 31, v1: 33 };
export const GARDEN: Rect = { u0: -31, v0: -14, u1: -14, v1: 3.2 };
export const GARDEN_ROCKS: Spot[] = [
  { u: -22.5, v: -6.2, r: 1.3 }, { u: -20.6, v: -7.4, r: 0.75 }, { u: -23.9, v: -4.9, r: 0.55 },
  { u: -27.2, v: -10.8, r: 1.0 }, { u: -17.4, v: -1.3, r: 0.7 },
];
/** Cerca baixa de bambu na borda do jardim (duas partes, com passagem no meio). */
export const GARDEN_FENCE: Rect[] = [
  { u0: -13.9, v0: -14, u1: -13.7, v1: -7.2 },
  { u0: -13.9, v0: -3.8, u1: -13.7, v1: 3.2 },
];

export const LANTERNS: Spot[] = [
  ...[-27, -20, -13, -6].flatMap(v => [{ u: -3.4, v, r: 0.5 }, { u: 3.4, v, r: 0.5 }]),
  { u: -12.6, v: 3, r: 0.5 }, { u: 12.6, v: 3, r: 0.5 }, { u: -12.6, v: 12.6, r: 0.5 }, { u: 12.6, v: 12.6, r: 0.5 },
];
export const KOMAINU: Spot[] = [{ u: -4.5, v: 15.3, r: 0.75 }, { u: 4.5, v: 15.3, r: 0.75 }];
export const BURNER: Spot = { u: 0, v: 5.2, r: 1.05 };
export const TORII = { v: -31, pillarU: 3.2, r: 0.42 };
export const CHOZUYA = { u: 8.6, v: -21, basin: { hw: 1.0, hd: 0.5 }, posts: { hw: 1.4, hd: 0.9 } };
export const BELL = { u: -21, v: 20.5, half: 2.6 };
export const PAGODA = { u: 23, v: 23.5, half: 3.4 };
export const SHINBOKU: Spot = { u: -27.5, v: 9.5, r: 1.1 };
export const SAKURA: Spot = { u: 16, v: 1.5, r: 0.45 };
export const WELL: Spot = { u: 21.5, v: -9.5, r: 1.05 };
/** Barricada de escudos de madeira e o carro de bois quebrado (restos da batalha). */
export const SHIELDS = { u: 27, v: 7, n: 4 };
export const CART = { u: -10, v: -25 };
/** Estandartes (nobori) nos postes. */
export const BANNERS: { u: number; v: number }[] = [
  { u: -15.2, v: -0.5 }, { u: 15.2, v: -0.5 }, { u: -15.2, v: 8.5 }, { u: 15.2, v: 8.5 },
  { u: -5.6, v: -17 }, { u: 5.6, v: -9.5 },
];
/** Estandarte caído no pátio. */
export const FALLEN_BANNER = { u: -7.5, v: 1.2 };

/** Muro do recinto (tsuiji-bei) na metade de baixo, com a abertura do torii. */
export const WALL = { radius: 36.8, from: 200, to: 340, gap: 7 };
