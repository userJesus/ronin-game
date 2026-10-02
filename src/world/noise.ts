// Ruído de valor e texturas em tons de cinza para o cenário procedural.
import * as THREE from 'three';
import type { Rng } from '../core/math';

/** Ruído de valor que se repete a cada `period` células (textura sem emenda), em -1..1. */
export function tileNoise(rng: Rng, period: number): (u: number, v: number) => number {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng.range(-1, 1);
  const at = (i: number, j: number) => g[((j % period + period) % period) * period + ((i % period + period) % period)];
  const s = (t: number) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * period, y = v * period;
    const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Textura de tons de cinza (luminância 0..255 por pixel), filtro "nearest" e sem mipmaps (pixel art). */
export function grayTexture(lum: ArrayLike<number>, w: number, h: number, alpha?: ArrayLike<number>): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const g = Math.max(0, Math.min(255, Math.round(lum[i])));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g;
    data[i * 4 + 3] = alpha ? alpha[i] : 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
