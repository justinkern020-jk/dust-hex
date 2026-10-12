import { describe, expect, it } from 'vitest';
import { showdownIntensity } from './sound';

describe('showdown music trigger (same shape as the sister game battle layer)', () => {
  const at = (blue: number, red: number, turn = 6, over = false) => showdownIntensity({ dom: { blue, red }, goal: 60, turn, over });
  it('silent early, rises past ~62% of the goal, full near the line, either side', () => {
    expect(at(10, 20)).toBe(0);
    expect(at(37, 10)).toBe(0);
    expect(at(46, 10)).toBeGreaterThan(0.3);
    expect(at(10, 56)).toBe(1);
  });
  it('a long match adds some tension, capped at half', () => {
    expect(at(0, 0, 24)).toBe(0.5);
    expect(at(0, 0, 60)).toBe(0.5);
  });
  it('stops when the match is over', () => expect(at(59, 59, 30, true)).toBe(0));
});
