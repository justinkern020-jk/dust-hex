import { describe, expect, it } from 'vitest';
import { planFx, fxMs, DEATH_MS } from './fx';
import type { Box } from './coinMotion';

const B = (x: number, y: number): Box => ({ x, y, w: 40, h: 40 });

describe('battlefield fx', () => {
  const prev = new Map([['a', B(0, 0)], ['b', B(50, 0)]]);
  const now = new Map([['a', B(0, 0)]]);
  it('a killing melee strike lunges toward the target, flashes between the coins, shakes, and crumbles the dead coin', () => {
    const fx = planFx([{ e: 'strike', uid: 'a', target: 'b', ranged: false }, { e: 'damage', uid: 'b', n: 3 }, { e: 'death', uid: 'b', cardId: 'billy', side: 'red' }], prev, now);
    const clash = fx.find((f) => f.k === 'clash')!;
    expect(clash).toMatchObject({ dx: 50, dy: 0, x: 45, y: 20 });
    const death = fx.find((f) => f.k === 'death')!;
    expect(death).toMatchObject({ uid: 'b', cardId: 'billy' });
    expect(death.delay).toBeGreaterThan(0);
    expect(fx.filter((f) => f.k === 'shake')).toHaveLength(2);
    expect(fxMs(fx)).toBeGreaterThan(DEATH_MS);
  });
  it('reduced motion drops shake and trails but keeps the clash, death and landing', () => {
    const fx = planFx([{ e: 'strike', uid: 'a', target: 'b', ranged: true }, { e: 'death', uid: 'b', cardId: 'x', side: 'red' }, { e: 'move', uid: 'a', from: [0, 0], to: [0, 1] }], prev, now, true);
    expect(fx.map((f) => f.k).sort()).toEqual(['clash', 'death']);
  });
  it('deploys get a landing puff after the flight, moves get a trail', () => {
    const fx = planFx([{ e: 'deploy', uid: 'a', side: 'blue' }], new Map([['z', B(0, 0)]]), now);
    expect(fx[0]).toMatchObject({ k: 'land', x: 20, y: 20 });
    const mv = planFx([{ e: 'move', uid: 'a', from: [0, 0], to: [0, 1] }], new Map([['a', B(0, 0)]]), new Map([['a', B(50, 0)]]));
    expect(mv[0].k).toBe('trail');
  });
  it('nothing to show is zero wait', () => expect(fxMs([])).toBe(0));
});
