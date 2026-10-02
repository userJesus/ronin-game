// Cenário "Campo de batalha": só o chão molhado (lama, poças, pedrinhas) em baixo contraste.
// Além do clima, a textura presa ao mundo é a referência de movimento que faz o passo "assentar".
import * as THREE from 'three';
import { TEXELS_PER_METER } from '../config';
import { Rng } from '../core/math';
import type { StageBuilder } from './environment';
import { grayTexture, tileNoise } from './noise';

function groundTexture(seed: number): { tex: THREE.Texture; tileMeters: number } {
  const N = 1024; // 1 px = 1 texel = 1/32 m -> ladrilho de 32 m
  const rng = new Rng(seed ^ 0x9e3779b9);
  const macro = tileNoise(rng, 8), mid = tileNoise(rng, 32), fine = tileNoise(rng, 128);
  const lum = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const m = macro(u, v), md = mid(u, v), f = fine(u, v);
    let g = 136 + m * 12 + md * 6 + f * 3;
    // poças: fundo mais escuro (água parada) com borda clara molhada
    if (m < -0.5) g = 110 + md * 3;
    else if (m < -0.44) g = 156;
    // posteriza em degraus de 4 (pixel art, sem gradiente contínuo)
    lum[y * N + x] = Math.round(g / 4) * 4;
  }
  // pedrinhas: ponto escuro com brilho em cima; tufos: risquinhos verticais nas áreas mais altas
  const put = (x: number, y: number, g: number) => { lum[(((y % N) + N) % N) * N + (((x % N) + N) % N)] = g; };
  for (let i = 0; i < 900; i++) {
    const x = rng.int(0, N - 1), y = rng.int(0, N - 1);
    if (macro(x / N, y / N) < -0.44) continue;
    const big = rng.next() < 0.25;
    put(x, y, 96); if (big) { put(x + 1, y, 100); put(x, y + 1, 104); }
    put(x, y - 1, 168);
  }
  for (let i = 0; i < 1400; i++) {
    const x = rng.int(0, N - 1), y = rng.int(0, N - 1);
    if (macro(x / N, y / N) < 0.15) continue;
    const h = rng.int(1, 2);
    for (let k = 0; k <= h; k++) put(x, y - k, 112 - k * 4);
  }
  const tex = grayTexture(lum, N, N);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return { tex, tileMeters: N / TEXELS_PER_METER };
}

export const buildField: StageBuilder = (group, opts) => {
  const size = (opts.arenaRadius + 40) * 2;
  const { tex, tileMeters } = groundTexture(opts.seed);
  tex.repeat.set(size / tileMeters, size / tileMeters);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  return { colliders: [], boxes: [], start: { x: 0, z: 0 }, shadows: false };
};
