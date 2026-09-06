import { describe, expect, it } from 'vitest';
import { scalePerServing, scalingPreview } from './recipes';

describe('SOP recipe scaling', () => {
  it('scales a 1-litre tea batch down to an 80 ml serving', () => {
    // 30 g tea powder in 1000 ml usable yield -> 2.4 g per 80 ml cup
    expect(scalePerServing(30, 1000, 80)).toBeCloseTo(2.4, 6);
    // 70 g sugar -> 5.6 g
    expect(scalePerServing(70, 1000, 80)).toBeCloseTo(5.6, 6);
  });

  it('reports theoretical / full servings and the expected remainder', () => {
    const p = scalingPreview(1000, 80);
    expect(p.theoreticalServings).toBeCloseTo(12.5, 6);
    expect(p.fullServings).toBe(12);
    expect(p.expectedRemainderBase).toBeCloseTo(40, 6);
  });

  it('rejects a non-positive batch yield', () => {
    expect(() => scalePerServing(10, 0, 5)).toThrow();
  });
});
