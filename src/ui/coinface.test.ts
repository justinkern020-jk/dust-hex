import { describe, expect, it } from 'vitest';
import { CARDS } from '../game/cards';
import { coinCrop, hasCoinFace } from './coinface';

const n = (s: string) => parseFloat(s) / 100;

describe('portrait coins', () => {
  it('every unit and leader has a placed portrait crop', () => {
    const missing = CARDS.filter((c) => (c.kind === 'unit' || c.kind === 'leader') && !hasCoinFace(c.id)).map((c) => c.id);
    expect(missing).toEqual([]);
  });
  it('the art always covers the whole coin', () => {
    for (const c of CARDS.filter((x) => x.kind === 'unit' || x.kind === 'leader')) {
      const { width, left, top } = coinCrop(c.id);
      const w = n(width);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(n(left)).toBeLessThanOrEqual(0);
      expect(n(left) + w).toBeGreaterThanOrEqual(0.999);
      expect(n(top)).toBeLessThanOrEqual(0);
      expect(n(top) + 1.5 * w).toBeGreaterThanOrEqual(0.999);
    }
  });
  it('faces sit in the top half of the art, so the crop leans up', () => {
    const { top } = coinCrop('jesse');
    expect(n(top)).toBeLessThan(0);
    expect(coinCrop('no-such-card').width).toBe('125.00%');
  });
});
