import { describe, expect, it } from 'vitest';
import { field, put, run } from './testkit';
import { bankFor, holdings } from './engine';

describe('claiming money tiles', () => {
  it('stepping onto a cash/gold tile claims it, pays its income each turn, and emits a claim event', () => {
    let m = field({ blue: 'gang', red: 'star' });
    m.tiles[2][1] = { ...m.tiles[2][1], k: 'resource', sym: 2, h: 0 };
    m.control[2][1] = null;
    const before = bankFor(m, 'blue');
    const held = holdings(m, 'blue');
    const u = put(m, 'cole', 'blue', 3, 1);
    m = run(m, { t: 'move', uid: u.uid, r: 2, c: 1 });
    expect(m.control[2][1]).toBe('blue');
    expect(bankFor(m, 'blue')).toBe(before + 2);
    expect(holdings(m, 'blue')).toBeGreaterThan(held);
    expect(m.events).toContainEqual({ e: 'claim', r: 2, c: 1, side: 'blue', income: 2, from: null });
  });
});
