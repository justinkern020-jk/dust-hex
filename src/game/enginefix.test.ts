/** Engine fixes, Oct 2026: one test per bug from the wording pass. */
import { describe, expect, it } from 'vitest';
import { card } from './cards';
import { HAND_CAP } from './core';
import { damage } from './rules';
import { nextRand } from './rng';
import { field, put, run, playCard, deployCard, endTurn, settle } from './testkit';
import type { Match, Side } from './types';

const trap = (m: Match, r: number, c: number, kind: string, owner: Side) =>
  m.traps.push({ tid: `t${r}${c}`, r, c, kind, owner, known: { blue: owner === 'blue', red: owner === 'red' } });

describe('engine fixes', () => {
  it('1. moving the rival’s trap: its owner still knows where it is', () => {
    let m = field({ blue: 'choir', red: 'gang' });
    trap(m, 2, 1, 'shaft', 'red');
    m = playCard(m, 'blue', 'widow-lamp', { r: 2, c: 1 });
    expect(m.pending[0].resolve).toBe('relocate');
    m = run(m, { t: 'choose', key: '2,3' });
    const t = m.traps.find((x) => x.r === 2 && x.c === 3)!;
    expect(t.owner).toBe('red');
    expect(t.known.red).toBe(true);
    expect(t.known.blue).toBe(true);
    // Moving your own trap still hides it from the rival.
    let n = field({ blue: 'choir', red: 'gang' });
    trap(n, 2, 1, 'shaft', 'blue');
    n = playCard(n, 'blue', 'widow-lamp', { r: 2, c: 1 });
    n = run(n, { t: 'choose', key: '1,1' });
    const u = n.traps.find((x) => x.r === 1 && x.c === 1)!;
    expect(u.known.blue).toBe(true);
    expect(u.known.red).toBe(false);
  });

  it('2. traps spare their owner’s units and still spring on enemies', () => {
    for (const kind of ['shaft', 'snake', 'cavein', 'deadfall', 'sink']) {
      let m = field({ blue: 'gang', red: 'star' });
      trap(m, 2, 1, kind, 'blue');
      const mine = put(m, 'cole', 'blue', 3, 1, { power: 4 });
      m = run(m, { t: 'move', uid: mine.uid, r: 2, c: 1 });
      expect(m.units[mine.uid].power, kind).toBe(4);
      expect(m.traps.length, kind).toBe(1);
      // The rival walks into it.
      m.board[2][1] = null;
      m.board[4][0] = mine.uid;
      m.side = 'red';
      const foe = put(m, 'baca', 'red', 1, 1, { power: 5 });
      m = run(m, { t: 'move', uid: foe.uid, r: 2, c: 1 });
      expect(m.traps.length, kind).toBe(0);
      expect(m.units[foe.uid]?.power ?? 0, kind).toBeLessThan(5);
    }
  });

  it('3. a strike that misses up a ridge still spends Grave Round and lets Ride On fire', () => {
    let m = field({ blue: 'gang', red: 'star' });
    m.tiles[2][2] = { ...m.tiles[2][2], h: 1 };
    const a = put(m, 'sundance', 'blue', 3, 2, { gear: ['grave-round'] });
    put(m, 'baca', 'red', 2, 2, { power: 1 });
    let s = 1;
    while (nextRand(s)[0] >= 1 / 3) s++;
    m.seed = s;
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.log.some((l) => /misses/.test(String(l)))).toBe(true);
    expect(m.units[a.uid].gear).toHaveLength(0);
    expect(m.exile.blue).toContain('grave-round');
    expect(m.pending[0]?.resolve).toBe('moveTo');
    expect(m.pending[0]?.source).toBe('sundance');
  });

  it('4. Night Ledger pays only while your leader is on the board', () => {
    let m = field({ blue: 'star' });
    m = playCard(m, 'blue', 'ledger');
    m = endTurn(endTurn(m));
    const before = m.money.blue;
    m = deployCard(m, 'blue', 'baca', 4, 2);
    expect(m.money.blue).toBe(before - card('baca').cost);
  });

  it('5. Cole cancels a trick even after he moved or struck on his own turn, once a round', () => {
    let m = field({ blue: 'army', red: 'gang' });
    const cole = put(m, 'cole', 'red', 1, 2, { deny: true });
    m.units[cole.uid].moved = true;
    m.units[cole.uid].attacked = true;
    m = playCard(m, 'blue', 'dead-volley');
    expect(m.pending[0]?.resolve).toBe('deny');
    m = run(m, { t: 'choose', key: 'cancel' });
    expect(m.discard.blue).toContain('dead-volley');
    // Second trick the same turn: Cole has used his cancel this round.
    m = playCard(m, 'blue', 'goodman-path', { uid: cole.uid });
    expect(m.pending.some((p) => p.resolve === 'deny')).toBe(false);
    // Next round he may call the bluff again.
    m = endTurn(endTurn(m));
    m = playCard(m, 'blue', 'dead-volley');
    expect(m.pending[0]?.resolve).toBe('deny');
  });

  it('6. Sitting Bull’s extra tile expires at the end of the turn', () => {
    let m = field({ blue: 'grass' });
    put(m, 'sitting-bull', 'blue', 4, 0, { leader: true });
    m = endTurn(endTurn(m));
    m = settle(m);
    expect(m.visionStep.blue).toBe(true);
    m = endTurn(m);
    expect(m.visionStep.blue).toBe(false);
    m = endTurn(m);
    // A new turn grants a fresh step; the unused one never stacks.
    expect(m.visionStep.blue).toBe(true);
  });

  it('7. La Llorona with a full hand goes to the top of the deck, not the discard', () => {
    const m = field({ blue: 'star', red: 'lodge' });
    const l = put(m, 'llorona', 'red', 1, 2);
    m.hand.red = Array(HAND_CAP).fill('billy');
    const money = m.money.red;
    damage(m, l.uid, 99);
    expect(m.units[l.uid]).toBeUndefined();
    expect(m.deck.red[0]).toBe('llorona');
    expect(m.discard.red).not.toContain('llorona');
    expect(m.money.red).toBe(money - 2);
  });
});
