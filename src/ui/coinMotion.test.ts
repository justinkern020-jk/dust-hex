import { describe, expect, it } from 'vitest';
import { DEPLOY_MS, FADE_MS, SLIDE_MS, STRIKE_FIRST_MS, flightMs, planSlides, slideKeyframes, slideTiming, type Box } from './coinMotion';

const box = (x: number, y: number, s = 50): Box => ({ x, y, w: s, h: s });

describe('coin slides', () => {
  it('a moved coin glides from its old tile', () => {
    const prev = new Map([['u1', box(0, 100)]]);
    const now = new Map([['u1', box(0, 40)]]);
    const s = planSlides(prev, now, [{ e: 'move', uid: 'u1', from: [2, 0], to: [1, 0] }], () => null);
    expect(s).toEqual([{ uid: 'u1', kind: 'move', dx: 0, dy: 60, delay: 0 }]);
  });
  it('coins that did not move stay put', () => {
    const prev = new Map([['u1', box(10, 10)], ['u2', box(70, 10)]]);
    const now = new Map([['u1', box(10, 10)], ['u2', box(70.5, 10)]]);
    expect(planSlides(prev, now, [], () => null)).toEqual([]);
  });
  it('a striker advancing into the tile it cleared waits for the blow', () => {
    const prev = new Map([['a', box(60, 120)], ['b', box(60, 60)]]);
    const now = new Map([['a', box(60, 60)]]);
    const ev = [
      { e: 'strike' as const, uid: 'a', target: 'b', ranged: false },
      { e: 'death' as const, uid: 'b', cardId: 'billy', side: 'red' as const },
      { e: 'move' as const, uid: 'a', from: [2, 1] as [number, number], to: [1, 1] as [number, number] },
    ];
    expect(planSlides(prev, now, ev, () => null)).toEqual([{ uid: 'a', kind: 'move', dx: 0, dy: 60, delay: STRIKE_FIRST_MS }]);
  });
  it('a pushed enemy slides too', () => {
    const prev = new Map([['a', box(60, 120)], ['b', box(60, 60)]]);
    const now = new Map([['a', box(60, 120)], ['b', box(60, 0)]]);
    expect(planSlides(prev, now, [], () => null)).toEqual([{ uid: 'b', kind: 'move', dx: 0, dy: 60, delay: 0 }]);
  });
  it('a deployed coin slides in from its launch point; unexplained new coins do not', () => {
    const now = new Map([['n', box(100, 200)], ['x', box(0, 0)]]);
    const s = planSlides(new Map(), now, [], (uid) => (uid === 'n' ? box(100, 400) : null));
    expect(s).toEqual([{ uid: 'n', kind: 'deploy', dx: 0, dy: 200, delay: 0 }]);
  });
  it('keyframes lift and land on the tile; reduced motion is a fade', () => {
    const k = slideKeyframes({ dx: 0, dy: 60, kind: 'move' }, false);
    expect(k[0].transform).toBe('translate(0.0px, 60.0px) scale(1)');
    expect(k[1].transform).toMatch(/scale\(1\.08\)/);
    expect(String(k[1].transform)).toContain('44.6px'); // lifted 7px above the path
    expect(k.at(-1)!.transform).toBe('translate(0px, 0px) scale(1)');
    expect(slideKeyframes({ dx: 0, dy: 60, kind: 'move' }, true)).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
  it('timings stay in the 250-400 ms window and set how long input is blocked', () => {
    expect(SLIDE_MS).toBeGreaterThanOrEqual(250);
    expect(DEPLOY_MS).toBeLessThanOrEqual(400);
    expect(slideTiming({ kind: 'move', delay: 0 }, false).duration).toBe(SLIDE_MS);
    expect(slideTiming({ kind: 'move', delay: 0 }, true).duration).toBe(FADE_MS);
    expect(flightMs([{ uid: 'a', kind: 'move', dx: 1, dy: 1, delay: STRIKE_FIRST_MS }], false)).toBe(SLIDE_MS + STRIKE_FIRST_MS);
    expect(flightMs([], false)).toBe(0);
  });
});
