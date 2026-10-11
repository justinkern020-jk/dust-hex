import { describe, expect, it } from 'vitest';
import { applyAction, newMatch, MAPS } from './engine';
import { field, put, run, tryRun, deployCard, endTurn, settle } from './testkit';
import { buildDeck, CARDS, FACTIONS } from './cards';

describe('match setup', () => {
  it('starts every faction on every map with a 30-card deck and 5 in hand', () => {
    for (const f of FACTIONS) {
      for (const map of MAPS) {
        const m = newMatch({ mapId: map.id, blue: f.id, red: 'army', seed: 3 });
        expect(m.hand.blue).toHaveLength(5);
        expect(m.deck.blue.length + m.hand.blue.length).toBe(30);
        expect(m.money.blue).toBe(2);
        expect(m.w).toBe(map.tiles[0].length);
      }
    }
  });
  it('builds character-heavy decks', () => {
    for (const f of FACTIONS) {
      const d = buildDeck(f.id);
      expect(d).toHaveLength(30);
      const chars = d.filter((id) => CARDS.find((c) => c.id === id)!.kind === 'unit').length;
      expect(chars).toBeGreaterThanOrEqual(20);
    }
  });
  it('turns map deadfalls, shafts and snakes into hidden traps', () => {
    const m = newMatch({ mapId: 'long-cut', blue: 'gang', red: 'army', seed: 1 });
    expect(m.traps.length).toBe(4);
    expect(m.traps.every((t) => !t.known.blue && !t.known.red)).toBe(true);
    expect(m.goal).toBe(110);
  });
});

describe('deploy (the old vanishing-unit bug)', () => {
  it('a paid-for unit is on the board after deploy, every time, for both sides', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let m = field({ seed });
      m = deployCard(m, 'blue', 'baca', 4, 2);
      expect(m.board[4][2]).toBeTruthy();
      expect(m.money.blue).toBe(12);
      m = endTurn(m);
      m = deployCard(m, 'red', 'billy', 0, 1);
      expect(m.board[0][1]).toBeTruthy();
      expect(Object.values(m.units).map((u) => u.cardId).sort()).toEqual(['baca', 'billy']);
    }
  });
  it('only on your stronghold or a door you hold', () => {
    const m = field();
    m.hand.blue.push('baca');
    expect(tryRun(m, { t: 'deploy', i: 0, r: 2, c: 2 }).error).toMatch(/stronghold/);
    expect(tryRun(m, { t: 'deploy', i: 0, r: 0, c: 1 }).error).toMatch(/stronghold/);
    expect(tryRun(m, { t: 'deploy', i: 0, r: 4, c: 1 }).error).toBeNull();
  });
  it('costs money', () => {
    const m = field();
    m.money.blue = 1;
    m.hand.blue.push('wyatt');
    expect(tryRun(m, { t: 'deploy', i: 0, r: 4, c: 2 }).error).toMatch(/Not enough/);
  });
  it('applyAction never mutates the state it is given', () => {
    const m = field();
    m.hand.blue.push('baca');
    const before = JSON.stringify(m);
    applyAction(m, { t: 'deploy', i: 0, r: 4, c: 2 });
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe('movement', () => {
  it('moves one tile, claims it, and then is spent', () => {
    let m = field();
    const u = put(m, 'baca', 'blue', 3, 2);
    m = run(m, { t: 'move', uid: u.uid, r: 2, c: 2 });
    expect(m.board[2][2]).toBe(u.uid);
    expect(m.control[2][2]).toBe('blue');
    expect(tryRun(m, { t: 'move', uid: u.uid, r: 1, c: 2 }).error).toMatch(/moved/);
  });
  it('climbs one shelf at a time', () => {
    const m = field();
    m.tiles[2][2].h = 2;
    const u = put(m, 'baca', 'blue', 3, 2);
    expect(tryRun(m, { t: 'move', uid: u.uid, r: 2, c: 2 }).error).toMatch(/steep/);
    m.tiles[2][2].h = 1;
    expect(tryRun(m, { t: 'move', uid: u.uid, r: 2, c: 2 }).error).toBeNull();
  });
  it('a hidden shaft kills the unit that enters it', () => {
    const m = field();
    m.traps.push({ tid: 'tx', r: 2, c: 2, kind: 'shaft', owner: null, known: { blue: false, red: false } });
    const u = put(m, 'baca', 'blue', 3, 2);
    const s = run(m, { t: 'move', uid: u.uid, r: 2, c: 2 });
    expect(s.units[u.uid]).toBeUndefined();
    expect(s.traps).toHaveLength(0);
  });
  it('storming the rival stronghold wins', () => {
    const m = field();
    const u = put(m, 'baca', 'blue', 1, 2);
    const s = run(m, { t: 'move', uid: u.uid, r: 0, c: 2 });
    expect(s.winner).toBe('blue');
    expect(s.winKind).toBe('stronghold');
  });
});

describe('strikes', () => {
  it('normal strikes are simultaneous', () => {
    let m = field();
    const a = put(m, 'doc', 'blue', 2, 2, { power: 3 });
    const d = put(m, 'billy', 'red', 1, 2, { power: 3 });
    m.units[a.uid].kw = [];
    m.units[d.uid].kw = [];
    m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
    expect(m.units[a.uid]).toBeUndefined();
    expect(m.units[d.uid]).toBeUndefined();
  });
  it('fast strikes first and a kill is not answered; the winner advances', () => {
    let m = field();
    const a = put(m, 'doc', 'blue', 2, 2);
    const d = put(m, 'cole', 'red', 1, 2, { power: 2 });
    m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
    expect(m.units[d.uid]).toBeUndefined();
    expect(m.units[a.uid].power).toBe(2);
    expect(m.board[1][2]).toBe(a.uid);
  });
  it('tough refuses the first point of a blow', () => {
    let m = field();
    const a = put(m, 'cole', 'red', 1, 2);
    const d = put(m, 'baca', 'blue', 2, 2, { power: 5 });
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[d.uid].power).toBe(2);
  });
  it('ranged reaches two tiles in a line and is not answered, but never on a diagonal', () => {
    let m = field();
    const a = put(m, 'garrett', 'blue', 3, 2);
    const d = put(m, 'billy', 'red', 1, 2);
    put(m, 'billy', 'red', 2, 3);
    expect(tryRun(m, { t: 'strike', uid: a.uid, r: 2, c: 3 }).error).toMatch(/diagonal/);
    m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
    expect(m.units[d.uid]).toBeUndefined();
    expect(m.units[a.uid].power).toBe(2);
    expect(m.board[3][2]).toBe(a.uid);
    const m2 = field();
    const g = put(m2, 'garrett', 'blue', 3, 2);
    put(m2, 'billy', 'red', 2, 1);
    expect(tryRun(m2, { t: 'strike', uid: g.uid, r: 1, c: 1 }).error).toBeTruthy();
  });
  it('higher ground adds 1', () => {
    let m = field({ seed: 2 });
    m.tiles[3][2].h = 1;
    const a = put(m, 'baca', 'blue', 3, 2, { power: 2 });
    m.units[a.uid].kw = [];
    const d = put(m, 'cole', 'red', 2, 2, { power: 3 });
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[d.uid]).toBeUndefined();
  });
  it('a unit that moved cannot strike', () => {
    let m = field();
    const a = put(m, 'baca', 'blue', 3, 2);
    put(m, 'billy', 'red', 1, 2);
    m = run(m, { t: 'move', uid: a.uid, r: 2, c: 2 });
    expect(tryRun(m, { t: 'strike', uid: a.uid, r: 1, c: 2 }).error).toMatch(/cannot act/);
  });
});

describe('turns', () => {
  it('end of turn adds holdings to dominance; open banks and draws', () => {
    let m = field();
    m.money.red = 0;
    const handRed = m.hand.red.length;
    m = endTurn(m);
    expect(m.dom.blue).toBe(3);
    expect(m.side).toBe('red');
    expect(m.hand.red.length).toBe(handRed + 1);
    expect(m.money.red).toBe(3); // stronghold 2, +1 on red's first turn
  });
  it('reaching the goal wins', () => {
    let m = field();
    m.dom.blue = 58;
    m = endTurn(m);
    expect(m.winner).toBe('blue');
    expect(m.winKind).toBe('dominance');
  });
  it('a pending choice blocks other actions', () => {
    let m = field();
    put(m, 'baca', 'blue', 3, 2);
    m = deployCard(m, 'blue', 'riderless', 4, 2);
    expect(m.pending.length).toBe(1);
    expect(tryRun(m, { t: 'end' }).error).toMatch(/choice/);
    m = settle(m);
    expect(m.pending.length).toBe(0);
  });
});

describe('leaders', () => {
  it('deploy from the tray, and LEAD once per match', () => {
    let m = field({ blue: 'gang' });
    m = run(m, { t: 'deploy', i: 'leader', r: 4, c: 2 });
    expect(m.leaderAt.blue).toBe('board');
    const hand = m.hand.blue.length;
    m = run(m, { t: 'lead' });
    expect(m.hand.blue.length).toBe(hand + 1);
    expect(tryRun(m, { t: 'lead' }).error).toMatch(/already/);
  });
});
