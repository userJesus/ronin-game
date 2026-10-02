// Utilitários numéricos puros: diferença angular, distância a segmento e PRNG.
import { describe, expect, it } from 'vitest';
import { Rng, angleDiff, distToSegment } from '../../src/core/math';

const PI = Math.PI;

describe('angleDiff', () => {
  it('casos básicos com sinal', () => {
    expect(angleDiff(0, PI / 2)).toBeCloseTo(PI / 2, 12);
    expect(angleDiff(PI / 2, 0)).toBeCloseTo(-PI / 2, 12);
    expect(angleDiff(0, 0)).toBe(0);
  });

  it('pega o caminho mais curto ao cruzar ±PI', () => {
    expect(angleDiff(PI - 0.1, -PI + 0.1)).toBeCloseTo(0.2, 12);
    expect(angleDiff(-PI + 0.1, PI - 0.1)).toBeCloseTo(-0.2, 12);
    expect(angleDiff(0, (3 * PI) / 2)).toBeCloseTo(-PI / 2, 12);
    expect(angleDiff(0, (-3 * PI) / 2)).toBeCloseTo(PI / 2, 12);
  });

  it('meia-volta dá +PI (intervalo (-PI, PI])', () => {
    expect(angleDiff(0, PI)).toBeCloseTo(PI, 12);
    expect(angleDiff(0, -PI)).toBeCloseTo(PI, 12);
  });

  it('ignora voltas inteiras', () => {
    expect(angleDiff(0.3, 0.3 + 4 * PI)).toBeCloseTo(0, 9);
    expect(angleDiff(0.3, 0.5 - 6 * PI)).toBeCloseTo(0.2, 9);
  });

  it('propriedade: resultado em (-PI, PI] e a + d ≡ b', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 2000; i++) {
      const a = rng.range(-20, 20), b = rng.range(-20, 20);
      const d = angleDiff(a, b);
      expect(d).toBeGreaterThan(-PI - 1e-12);
      expect(d).toBeLessThanOrEqual(PI + 1e-12);
      expect(Math.cos(a + d)).toBeCloseTo(Math.cos(b), 9);
      expect(Math.sin(a + d)).toBeCloseTo(Math.sin(b), 9);
    }
  });
});

describe('distToSegment', () => {
  const a = { x: 0, z: 0 }, b = { x: 4, z: 0 };

  it('projeção no meio do segmento = distância perpendicular', () => {
    expect(distToSegment({ x: 2, z: 3 }, a, b)).toBeCloseTo(3, 12);
    expect(distToSegment({ x: 1, z: -0.5 }, a, b)).toBeCloseTo(0.5, 12);
  });

  it('além das pontas mede até a ponta mais próxima', () => {
    expect(distToSegment({ x: -3, z: 4 }, a, b)).toBeCloseTo(5, 12);
    expect(distToSegment({ x: 7, z: 4 }, a, b)).toBeCloseTo(5, 12);
  });

  it('ponto sobre o segmento dá zero', () => {
    expect(distToSegment({ x: 2.5, z: 0 }, a, b)).toBeCloseTo(0, 12);
    expect(distToSegment(b, a, b)).toBeCloseTo(0, 12);
  });

  it('segmento degenerado (a = b) vira distância ao ponto', () => {
    expect(distToSegment({ x: 3, z: 4 }, a, a)).toBeCloseTo(5, 12);
  });

  it('segmento diagonal', () => {
    const d = distToSegment({ x: 0, z: 2 }, { x: 0, z: 0 }, { x: 2, z: 2 });
    expect(d).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe('Rng', () => {
  it('mesma semente, mesma sequência', () => {
    const r1 = new Rng(1234), r2 = new Rng(1234);
    for (let i = 0; i < 500; i++) expect(r1.next()).toBe(r2.next());
  });

  it('sementes diferentes divergem', () => {
    const r1 = new Rng(1), r2 = new Rng(2);
    const s1 = Array.from({ length: 8 }, () => r1.next());
    const s2 = Array.from({ length: 8 }, () => r2.next());
    expect(s1).not.toEqual(s2);
  });

  it('semente 0 é tratada como 1 (não trava em zero)', () => {
    const r0 = new Rng(0), r1 = new Rng(1);
    for (let i = 0; i < 20; i++) expect(r0.next()).toBe(r1.next());
  });

  it('next em [0, 1) e média perto de 0.5', () => {
    const r = new Rng(99);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
  });

  it('int(a, b) é inclusivo e cobre todo o intervalo', () => {
    const r = new Rng(5);
    const seen = new Map<number, number>();
    for (let i = 0; i < 6000; i++) {
      const v = r.int(1, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.set(v, (seen.get(v) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual([1, 2, 3]);
    for (const n of seen.values()) expect(n).toBeGreaterThan(1600);
  });

  it('range, pick e sign ficam nos limites', () => {
    const r = new Rng(77);
    const arr = ['a', 'b', 'c'] as const;
    let neg = 0;
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
      expect(arr).toContain(r.pick(arr));
      const s = r.sign();
      expect(Math.abs(s)).toBe(1);
      if (s < 0) neg++;
    }
    expect(neg).toBeGreaterThan(400);
    expect(neg).toBeLessThan(600);
  });
});
