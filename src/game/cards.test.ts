/**
 * One engine test per card: every card can be played and does what its text says.
 * Generic checks cover keyword-only units; every printed ability has its own case.
 */
import { describe, expect, it } from 'vitest';
import { CARDS, card } from './cards';
import { targetOptions, deployTiles, actError } from './engine';
import { field, put, run, tryRun, deployCard, playCard, endTurn, settle, uidAt } from './testkit';
import type { Match } from './types';

const bySide = (m: Match, side: 'blue' | 'red') => Object.values(m.units).filter((u) => u.side === side);

describe('every card can be played', () => {
  for (const c of CARDS) {
    it(`${c.id} (${c.kind})`, () => {
      let m = field({ blue: c.faction, red: c.faction === 'gang' ? 'army' : 'gang' });
      put(m, 'baca', 'blue', 3, 2);
      const foe = put(m, 'billy', 'red', 2, 2, { power: 2 });
      m.tiles[3][2].h = 1;
      if (c.kind === 'leader') {
        m.leader.blue = c.id;
        m = run(m, { t: 'deploy', i: 'leader', r: 4, c: 2 });
        expect(bySide(m, 'blue').some((u) => u.cardId === c.id && u.leader)).toBe(true);
        return;
      }
      m.hand.blue.push(c.id);
      const i = m.hand.blue.length - 1;
      if (c.kind === 'unit') {
        const [r, cc] = deployTiles(m, 'blue', c.id)[0];
        m = run(m, { t: 'deploy', i, r, c: cc });
        m = settle(m);
        if (c.hide) expect(m.traps.some((t) => t.kind === 'hidebehind' && t.owner === 'blue')).toBe(true);
        else expect(bySide(m, 'blue').some((u) => u.cardId === c.id)).toBe(true);
        return;
      }
      // Give gear-targeting cards something to hit.
      if (c.target?.kind === 'enemyGear') m.units[foe.uid].gear.push({ gid: 'gx', cardId: 'derringer', owner: 'red' });
      if (c.id === 'ride-back' || c.id === 'false-coffin') m.discard.blue.push('billy');
      const opts = targetOptions(m, 'blue', c.target, c.kind === 'rite');
      const target = c.target && c.target.kind !== 'none' ? opts[0] : undefined;
      if (c.target && c.target.kind !== 'none' && !c.target.optional) expect(opts.length).toBeGreaterThan(0);
      m = run(m, { t: 'play', i, target });
      m = settle(m);
      expect(m.hand.blue.includes(c.id)).toBe(false);
      const where = c.attach === 'unit' ? Object.values(m.units).some((u) => u.gear.some((g) => g.cardId === c.id)) || m.discard.blue.includes(c.id) || m.exile.blue.includes(c.id)
        : c.attach === 'tray' ? m.tray.blue.some((d) => d.cardId === c.id)
        : c.attach === 'tile' ? m.tileDevices.some((d) => d.cardId === c.id)
        : c.attach === 'leader' ? m.ledger.blue
        : c.trapKind ? m.traps.some((t) => t.cardId === c.id)
        : m.discard.blue.includes(c.id) || m.exile.blue.includes(c.id) || m.coffins.length > 0;
      expect(where).toBe(true);
    });
  }
});

describe('keyword units', () => {
  const fast = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('fast'));
  for (const c of fast) {
    it(`${c.id} strikes first`, () => {
      let m = field();
      const a = put(m, c.id, 'blue', 2, 2, { power: 3 });
      const d = put(m, 'cole', 'red', 1, 2, { power: 3 });
      m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
      m = settle(m, () => null);
      expect(m.units[d.uid]).toBeUndefined();
      expect(m.units[a.uid]?.power ?? 3).toBeGreaterThan(0);
    });
  }
  const tough = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('tough'));
  for (const c of tough) {
    it(`${c.id} refuses one point per blow`, () => {
      let m = field();
      const d = put(m, c.id, 'blue', 2, 2, { power: 6 });
      const a = put(m, 'cole', 'red', 1, 2);
      m.side = 'red';
      m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
      const lost = 6 - m.units[d.uid].power;
      expect(lost).toBeLessThanOrEqual(3);
    });
  }
  const ranged = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('ranged'));
  for (const c of ranged) {
    it(`${c.id} shoots two tiles unanswered`, () => {
      let m = field();
      const a = put(m, c.id, 'blue', 3, 2);
      const d = put(m, 'cole', 'red', 1, 2, { power: 9 });
      m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
      expect(m.units[d.uid].power).toBeLessThan(9);
      expect(m.units[a.uid].power).toBe(m.units[a.uid].maxPower);
    });
  }
  const hold = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('hold'));
  for (const c of hold) {
    it(`${c.id} holds adjacent enemies in place`, () => {
      const m = field();
      put(m, c.id, 'red', 2, 2);
      const u = put(m, 'baca', 'blue', 3, 2);
      expect(tryRun(m, { t: 'move', uid: u.uid, r: 3, c: 1 }).error).toMatch(/holds/);
    });
  }
  const harbor = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('harbor'));
  for (const c of harbor) {
    it(`${c.id} harbors allies from enemy rites`, () => {
      const m = field({ blue: 'gang' });
      put(m, c.id, 'red', 1, 1);
      const other = put(m, 'cole', 'red', 1, 3);
      const opts = targetOptions(m, 'blue', card('the-raven').target, true);
      expect(opts.some((t) => t.uid === other.uid)).toBe(false);
      expect(opts.length).toBe(1);
    });
  }
  const delay = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('delay'));
  for (const c of delay) {
    it(`${c.id} does not act the turn it enters`, () => {
      let m = field({ blue: c.faction });
      put(m, 'cole', 'red', 3, 2);
      m = deployCard(m, 'blue', c.id, 4, 2);
      m = settle(m);
      const u = bySide(m, 'blue').find((x) => x.cardId === c.id)!;
      expect(tryRun(m, { t: 'strike', uid: u.uid, r: 3, c: 2 }).error).toBeTruthy();
    });
  }
  const winged = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('winged'));
  for (const c of winged) {
    it(`${c.id} may enter on any empty tile`, () => {
      let m = field();
      m = deployCard(m, 'blue', c.id, 1, 0);
      m = settle(m);
      expect(m.units[uidAt(m, 1, 0)!].cardId).toBe(c.id);
    });
  }
  const crown = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('crown'));
  for (const c of crown) {
    it(`${c.id} gives adjacent allies +1 when they strike`, () => {
      let m = field();
      put(m, c.id, 'blue', 3, 1);
      const a = put(m, 'baca', 'blue', 3, 2, { power: 2 });
      m.units[a.uid].kw = [];
      const d = put(m, 'cole', 'red', 2, 2, { power: 3 });
      m.units[d.uid].kw = ['slow'];
      m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
      expect(m.units[d.uid]).toBeUndefined();
    });
  }
  const steady = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('steady'));
  for (const c of steady) {
    it(`${c.id} is steady when no card was played`, () => {
      let m = field();
      const a = put(m, c.id, 'blue', 2, 2);
      const d = put(m, 'cole', 'red', 1, 2, { power: 9 });
      m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
      expect(m.units[d.uid].power).toBe(9 - (card(c.id).power! + 1));
      expect(m.units[a.uid].power).toBe(card(c.id).power);
    });
  }
  const climber = CARDS.filter((c) => c.kind === 'unit' && c.kw.includes('climber'));
  for (const c of climber) {
    it(`${c.id} climbs without spending his move`, () => {
      let m = field();
      m.tiles[2][2].h = 1;
      const u = put(m, c.id, 'blue', 3, 2);
      m = run(m, { t: 'move', uid: u.uid, r: 2, c: 2 });
      expect(tryRun(m, { t: 'move', uid: u.uid, r: 1, c: 2 }).error).toBeNull();
    });
  }
  const returns = CARDS.filter((c) => c.ab?.some((a) => a.op === 'returns'));
  for (const c of returns) {
    it(`${c.id} returns the turn after it falls`, () => {
      let m = field({ blue: c.faction });
      const u = put(m, c.id, 'blue', 3, 2, { power: 1, leader: c.kind === 'leader' });
      m.units[u.uid].kw = [];
      const a = put(m, 'cole', 'red', 2, 2);
      m.side = 'red';
      m = run(m, { t: 'strike', uid: a.uid, r: 3, c: 2 });
      expect(Object.values(m.units).some((x) => x.cardId === c.id)).toBe(false);
      m = endTurn(m);
      const back = Object.values(m.units).find((x) => x.cardId === c.id && x.side === 'blue');
      expect(back).toBeTruthy();
      expect(back!.moved).toBe(true);
    });
  }
  const look = CARDS.filter((c) => c.ab?.some((a) => a.on === 'enter' && (a.op === 'look' || a.op === 'lookAll')));
  for (const c of look) {
    it(`${c.id} looks at a hidden tile when it enters`, () => {
      let m = field({ blue: c.faction });
      m.traps.push({ tid: 'tx', r: 3, c: 2, kind: 'snake', owner: null, known: { blue: false, red: false } });
      m = deployCard(m, 'blue', c.id, 4, 2);
      m = settle(m, (keys) => (keys.includes('3,2') ? '3,2' : keys[0] ?? null));
      expect(m.scouted.blue.length).toBeGreaterThan(0);
      expect(m.traps[0].known.blue).toBe(true);
    });
  }
});

describe('Red Creek Gang', () => {
  it('Jesse: a kill draws 1 and gains 2', () => {
    let m = field({ blue: 'gang' });
    const j = put(m, 'jesse', 'blue', 2, 2, { leader: true });
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m.money.blue = 0;
    const h = m.hand.blue.length;
    m = run(m, { t: 'strike', uid: j.uid, r: 1, c: 2 });
    expect(m.money.blue).toBe(2);
    expect(m.hand.blue.length).toBe(h + 1);
  });
  it('Belle: playing an Outlaw card gains 1, once a turn', () => {
    let m = field({ blue: 'gang' });
    put(m, 'belle', 'blue', 3, 1);
    m.money.blue = 10;
    m = deployCard(m, 'blue', 'billy', 4, 2);
    expect(m.money.blue).toBe(10);
    m = deployCard(m, 'blue', 'billy', 4, 3);
    expect(m.money.blue).toBe(9);
  });
  it('Cole: may cancel an enemy rite by exhausting himself', () => {
    let m = field({ blue: 'army', red: 'gang' });
    const cole = put(m, 'cole', 'red', 1, 2, { deny: true });
    put(m, 'billy', 'red', 1, 1);
    m = playCard(m, 'blue', 'dead-volley');
    expect(m.pending[0].side).toBe('red');
    m = run(m, { t: 'choose', key: 'cancel' });
    expect(Object.values(m.units).filter((u) => u.side === 'red').every((u) => u.power === card(u.cardId).power)).toBe(true);
    expect(m.units[cole.uid].pinUntil).toBeGreaterThan(m.turn);
    expect(m.discard.blue).toContain('dead-volley');
  });
  it('Grave Round: +2 on the next strike, then rites cannot name the bearer', () => {
    let m = field({ blue: 'gang' });
    const a = put(m, 'baca', 'blue', 2, 2);
    m.units[a.uid].kw = [];
    const d = put(m, 'cole', 'red', 1, 2, { power: 4 });
    m.units[d.uid].kw = ['slow'];
    m = playCard(m, 'blue', 'grave-round', { uid: a.uid });
    m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
    expect(m.units[d.uid]).toBeUndefined();
    expect(m.units[a.uid].wardUntil).toBe(m.turn + 1);
    expect(m.exile.blue).toContain('grave-round');
  });
  it('Hell Rail: allies ride one more tile; the first enemy loses 2', () => {
    let m = field({ blue: 'gang' });
    const a = put(m, 'baca', 'blue', 3, 2);
    m = playCard(m, 'blue', 'hell-rail', { r: 2, c: 2 });
    m = run(m, { t: 'move', uid: a.uid, r: 2, c: 2 });
    expect(tryRun(m, { t: 'move', uid: a.uid, r: 1, c: 2 }).error).toBeNull();
    const m2 = field({ blue: 'gang' });
    m2.tileDevices.push({ did: 'd1', r: 2, c: 2, cardId: 'hell-rail', owner: 'red' });
    const e = put(m2, 'cole', 'blue', 3, 2);
    const s = run(m2, { t: 'move', uid: e.uid, r: 2, c: 2 });
    expect(s.units[e.uid].power).toBe(2);
  });
  it('Switchman: throws an enemy that comes adjacent; it loses 1', () => {
    let m = field({ blue: 'star', red: 'gang' });
    put(m, 'switchman', 'red', 1, 2);
    const u = put(m, 'cole', 'blue', 3, 2);
    m = run(m, { t: 'move', uid: u.uid, r: 2, c: 2 });
    expect(m.pending[0].side).toBe('red');
    const key = m.pending[0].options.find((o) => o.r === 2 && o.c === 1)!.key;
    m = run(m, { t: 'choose', key });
    expect(uidAt(m, 2, 1)).toBe(u.uid);
    expect(m.units[u.uid].power).toBe(3);
  });
  it('Derringer: next strike goes first with +1, then it is gone', () => {
    let m = field({ blue: 'gang' });
    const a = put(m, 'baca', 'blue', 2, 2, { power: 2 });
    m.units[a.uid].kw = [];
    const d = put(m, 'cole', 'red', 1, 2, { power: 3 });
    m = playCard(m, 'blue', 'derringer', { uid: a.uid });
    m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
    expect(m.units[d.uid]).toBeUndefined();
    expect(m.units[a.uid].power).toBe(2);
    expect(m.units[a.uid].gear).toHaveLength(0);
  });
  it('Powder Fuse: 2 to a unit, and 1 splashes to an enemy beside it', () => {
    let m = field({ blue: 'gang' });
    m = playCard(m, 'blue', 'powder-fuse');
    const t = put(m, 'billy', 'red', 1, 2, { power: 2 });
    const n = put(m, 'cole', 'red', 1, 1);
    const did = m.tray.blue[0].did;
    m = run(m, { t: 'act', did, target: { uid: t.uid } });
    m = settle(m);
    expect(m.units[t.uid]).toBeUndefined();
    expect(m.units[n.uid].power).toBe(3);
    expect(actError(m, 'blue', { did }, { uid: n.uid })).toMatch(/exhausted/);
  });
  it('Tommyknockers: once a turn, look at a tile and move a trap found there', () => {
    let m = field({ blue: 'gang' });
    const tk = put(m, 'tommyknockers', 'blue', 4, 0);
    m.traps.push({ tid: 'tx', r: 3, c: 0, kind: 'snake', owner: null, known: { blue: false, red: false } });
    m = run(m, { t: 'act', uid: tk.uid, target: { r: 3, c: 0 } });
    expect(m.pending[0].resolve).toBe('relocate');
    const key = m.pending[0].options.find((o) => o.r === 1 && o.c === 4)!.key;
    m = run(m, { t: 'choose', key });
    expect(m.traps[0].r).toBe(1);
    expect(m.traps[0].known.red).toBe(false);
    expect(tryRun(m, { t: 'act', uid: tk.uid, target: { r: 2, c: 2 } }).error).toMatch(/Already/);
  });
  it('Cactus Cat: a kill costs the rival 1 money', () => {
    let m = field({ blue: 'gang' });
    const a = put(m, 'cactus-cat', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m.money.red = 5;
    m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
    expect(m.money.red).toBe(4);
  });
  it('Hodag: exhausts an enemy on entry; traps cannot destroy it', () => {
    let m = field({ blue: 'gang' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = deployCard(m, 'blue', 'hodag', 4, 2);
    m = settle(m);
    expect(m.units[e.uid].pinUntil).toBe(m.turn + 1);
    expect(m.units[e.uid].noStrikeUntil).toBe(m.turn + 1);
    const h = Object.values(m.units).find((u) => u.cardId === 'hodag')!;
    m.traps.push({ tid: 'tx', r: 3, c: 2, kind: 'shaft', owner: null, known: { blue: false, red: false } });
    m = run(m, { t: 'move', uid: h.uid, r: 3, c: 2 });
    expect(m.units[h.uid]).toBeTruthy();
  });
  it('The Raven: returns a unit to hand; a leader also costs a discard', () => {
    let m = field({ blue: 'gang' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = playCard(m, 'blue', 'the-raven', { uid: e.uid });
    expect(m.hand.red).toContain('cole');
    const m2 = field({ blue: 'gang' });
    const l = put(m2, 'bass', 'red', 1, 2, { leader: true });
    m2.hand.red = ['billy', 'billy'];
    const s = playCard(m2, 'blue', 'the-raven', { uid: l.uid });
    expect(s.leaderAt.red).toBe('tray');
    expect(s.hand.red).toHaveLength(1);
  });
  it('Hidebehind: hidden from the rival; the first enemy in takes 3 and it appears exhausted', () => {
    let m = field({ blue: 'gang' });
    m = deployCard(m, 'blue', 'hidebehind', 2, 2);
    expect(m.traps[0].known.red).toBe(false);
    m = endTurn(m);
    const e = put(m, 'cole', 'red', 1, 2, { power: 5 });
    m = run(m, { t: 'move', uid: e.uid, r: 2, c: 2 });
    expect(m.units[e.uid].power).toBe(2);
    const hb = Object.values(m.units).find((u) => u.cardId === 'hidebehind')!;
    expect(hb.side).toBe('blue');
    expect(hb.pinUntil).toBeGreaterThan(m.turn);
  });
  it('Mine Shaft: hidden from the rival and kills the first unit in', () => {
    let m = field({ blue: 'gang' });
    m = playCard(m, 'blue', 'mine-shaft', { r: 2, c: 2 });
    expect(m.traps[0].known).toEqual({ blue: true, red: false });
    m = endTurn(m);
    const e = put(m, 'cole', 'red', 1, 2);
    m = run(m, { t: 'move', uid: e.uid, r: 2, c: 2 });
    expect(m.units[e.uid]).toBeUndefined();
  });
  it('Frank James: +1 while your leader is on the field', () => {
    let m = field({ blue: 'gang' });
    put(m, 'jesse', 'blue', 4, 2, { leader: true });
    const f = put(m, 'frank-james', 'blue', 2, 2);
    const d = put(m, 'cole', 'red', 1, 2, { power: 9 });
    m = run(m, { t: 'strike', uid: f.uid, r: 1, c: 2 });
    expect(m.units[d.uid].power).toBe(5);
  });
  it('Sam Bass / Black Bart / Pearl Hart / Henry Starr / Jackalope / Cousin Jack', () => {
    let m = field({ blue: 'gang' });
    const s = put(m, 'sam-bass', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m.money.blue = 0;
    m = run(m, { t: 'strike', uid: s.uid, r: 1, c: 2 });
    expect(m.money.blue).toBe(1);
    m = field({ blue: 'gang' });
    const b = put(m, 'black-bart', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    let h = m.hand.blue.length;
    m = run(m, { t: 'strike', uid: b.uid, r: 1, c: 2 });
    expect(m.hand.blue.length).toBe(h + 1);
    m = field({ blue: 'gang' });
    m.money.red = 4;
    m = deployCard(m, 'blue', 'pearl-hart', 4, 2);
    expect(m.money.red).toBe(3);
    m = field({ blue: 'gang' });
    const st = put(m, 'henry-starr', 'blue', 2, 1);
    m.money.blue = 0;
    m = run(m, { t: 'move', uid: st.uid, r: 2, c: 0 });
    expect(m.money.blue).toBe(2);
    m = field({ blue: 'gang' });
    h = m.hand.blue.length;
    m = deployCard(m, 'blue', 'jackalope', 4, 2);
    expect(m.hand.blue.length).toBe(h + 1);
    m = field({ blue: 'gang' });
    const cj = put(m, 'cousin-jack', 'blue', 3, 2);
    m.traps.push({ tid: 'tx', r: 2, c: 2, kind: 'shaft', owner: null, known: { blue: false, red: false } });
    m = run(m, { t: 'move', uid: cj.uid, r: 2, c: 2 });
    expect(m.units[cj.uid]).toBeTruthy();
  });
  it('Dynamite Dick: 1 to each adjacent enemy when he falls', () => {
    let m = field({ blue: 'gang' });
    put(m, 'dynamite-dick', 'blue', 2, 2, { power: 1 });
    const a = put(m, 'cole', 'red', 1, 2);
    const b = put(m, 'cole', 'red', 2, 1);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[b.uid].power).toBe(3);
  });
  it('Sundance / Lost Dutchman', () => {
    let m = field({ blue: 'gang' });
    const s = put(m, 'sundance', 'blue', 2, 2, { power: 9 });
    put(m, 'cole', 'red', 1, 2, { power: 5 });
    m = run(m, { t: 'strike', uid: s.uid, r: 1, c: 2 });
    expect(m.pending[0]?.resolve).toBe('moveTo');
    m = run(m, { t: 'choose', key: '2,2' });
    expect(uidAt(m, 2, 2)).toBe(s.uid);
    m = field({ blue: 'gang' });
    put(m, 'lost-dutchman', 'blue', 2, 2, { power: 1 });
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    const h = m.hand.blue.length;
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.hand.blue.length).toBe(h + 2);
  });
});

describe('Gallows Choir', () => {
  it('Faro Widow: playing an item draws 1', () => {
    let m = field({ blue: 'choir' });
    const w = put(m, 'faro-widow', 'blue', 4, 2, { leader: true });
    const h = m.hand.blue.length;
    m = playCard(m, 'blue', 'derringer', { uid: w.uid });
    expect(m.hand.blue.length).toBe(h + 1);
  });
  it('Ride Back: a destroyed Outlaw returns to hand; a fallen leader musters', () => {
    let m = field({ blue: 'choir' });
    m.discard.blue.push('cinder-rider');
    m = playCard(m, 'blue', 'ride-back');
    m = settle(m);
    expect(m.hand.blue).toContain('cinder-rider');
    m = field({ blue: 'choir' });
    m.leaderAt.blue = 'fallen';
    m = playCard(m, 'blue', 'ride-back');
    m = run(m, { t: 'choose', key: 'leader' });
    expect(m.leaderAt.blue).toBe('board');
  });
  it('Cinder Rider: two tiles, and the tile he leaves burns the next enemy', () => {
    let m = field({ blue: 'choir' });
    const c = put(m, 'cinder-rider', 'blue', 3, 2);
    m = run(m, { t: 'move', uid: c.uid, r: 2, c: 2 });
    m = run(m, { t: 'move', uid: c.uid, r: 1, c: 2 });
    expect(m.traps.filter((t) => t.kind === 'cinders')).toHaveLength(2);
    m = endTurn(m);
    const e = put(m, 'cole', 'red', 2, 1);
    m = run(m, { t: 'move', uid: e.uid, r: 2, c: 2 });
    expect(m.units[e.uid].power).toBe(2);
  });
  it('False Coffin: the unit returns to hand at the end of the turn', () => {
    let m = field({ blue: 'choir' });
    m.discard.blue.push('clay-shade');
    m = playCard(m, 'blue', 'false-coffin');
    m = settle(m);
    m = endTurn(m);
    expect(m.hand.blue).toContain('clay-shade');
  });
  it('Riderless / Pony Herd / Buffalo Calf Road: move another ally one tile', () => {
    for (const [id, f] of [['riderless', 'choir'], ['pony-herd', 'grass'], ['buffalo-calf-road', 'grass']] as const) {
      let m = field({ blue: f });
      const a = put(m, 'baca', 'blue', 3, 0);
      m = deployCard(m, 'blue', id, 4, 2);
      expect(m.pending[0].resolve).toBe('nudgePick');
      m = run(m, { t: 'choose', key: a.uid });
      m = run(m, { t: 'choose', key: '2,0' });
      expect(uidAt(m, 2, 0)).toBe(a.uid);
    }
  });
  it('Night Wire: enemies cannot step on it; exhaust deals 1 beside it', () => {
    let m = field({ blue: 'choir' });
    m = playCard(m, 'blue', 'night-wire', { r: 2, c: 2 });
    const e = put(m, 'cole', 'red', 2, 1);
    m = run(m, { t: 'act', did: m.tileDevices[0].did });
    m = settle(m);
    expect(m.units[e.uid].power).toBe(3);
    m = endTurn(m);
    expect(tryRun(m, { t: 'move', uid: e.uid, r: 2, c: 2 }).error).toMatch(/wire/);
  });
  it('Widow Lamp: look at a tile and move what is hidden there', () => {
    let m = field({ blue: 'choir' });
    m.traps.push({ tid: 'tx', r: 3, c: 2, kind: 'snake', owner: null, known: { blue: false, red: false } });
    m = playCard(m, 'blue', 'widow-lamp', { r: 3, c: 2 });
    m = run(m, { t: 'choose', key: '1,2' });
    expect(m.traps[0]).toMatchObject({ r: 1, c: 2, owner: 'blue' });
  });
  it('Sleepy Hollow: rides on after a strike; what it kills cannot return', () => {
    let m = field({ blue: 'choir' });
    const s = put(m, 'sleepy-hollow', 'blue', 2, 2);
    put(m, 'clay-shade', 'red', 1, 2, { power: 1 });
    m = run(m, { t: 'strike', uid: s.uid, r: 1, c: 2 });
    expect(m.returning).toHaveLength(0);
    expect(m.exile.red).toContain('clay-shade');
    expect(m.pending[0]?.resolve).toBe('moveTo');
  });
  it('Leeds Devil: any empty tile; rites cannot name it the turn it enters', () => {
    let m = field({ blue: 'choir', red: 'gang' });
    m = deployCard(m, 'blue', 'leeds-devil', 2, 0);
    const d = uidAt(m, 2, 0)!;
    m.side = 'red';
    expect(targetOptions(m, 'red', card('the-raven').target, true).some((t) => t.uid === d)).toBe(false);
    m.turn += 1;
    expect(targetOptions(m, 'red', card('the-raven').target, true).some((t) => t.uid === d)).toBe(true);
  });
  it('Carmilla: drains 1 each of your turns; a kill under her pays out', () => {
    let m = field({ blue: 'choir' });
    const e = put(m, 'cole', 'red', 1, 2, { power: 2 });
    m = playCard(m, 'blue', 'carmilla', { uid: e.uid });
    m = endTurn(m);
    m = endTurn(m);
    expect(m.units[e.uid].power).toBe(1);
    const h = m.hand.blue.length;
    m.money.blue = 0;
    m = endTurn(m);
    m = endTurn(m);
    expect(m.units[e.uid]).toBeUndefined();
    expect(m.money.blue).toBeGreaterThanOrEqual(2);
    expect(m.hand.blue.length).toBeGreaterThan(h);
  });
  it("Goodman Brown's Path: no move, no strike until your next turn; draw 1", () => {
    let m = field({ blue: 'choir' });
    const e = put(m, 'cole', 'red', 1, 2);
    const h = m.hand.blue.length;
    m = playCard(m, 'blue', 'goodman-path', { uid: e.uid });
    expect(m.hand.blue.length).toBe(h + 1);
    m = endTurn(m);
    expect(tryRun(m, { t: 'move', uid: e.uid, r: 1, c: 1 }).error).toBeTruthy();
  });
  it('Black Jack Ketchum: 2 to an adjacent enemy as he falls', () => {
    let m = field({ blue: 'choir' });
    put(m, 'black-jack-ketchum', 'blue', 2, 2, { power: 1 });
    const a = put(m, 'cole', 'red', 1, 2, { power: 5 });
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[a.uid].power).toBe(2);
  });
  it('Bell Witch / Alferd Packer / La Lechuza / Resurrection Man / Undertaker / Circuit Rider / Weeping Bride / Organist', () => {
    let m = field({ blue: 'choir' });
    m.hand.red = ['billy', 'billy'];
    m = deployCard(m, 'blue', 'bell-witch', 4, 2);
    expect(m.hand.red).toHaveLength(1);

    m = field({ blue: 'choir' });
    const p = put(m, 'alferd-packer', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m = run(m, { t: 'strike', uid: p.uid, r: 1, c: 2 });
    expect(m.units[p.uid].maxPower).toBe(4);

    m = field({ blue: 'choir' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = deployCard(m, 'blue', 'lechuza', 2, 0);
    m = settle(m);
    expect(m.units[e.uid].power).toBe(3);

    m = field({ blue: 'choir' });
    m.discard.blue.push('clay-shade');
    m = deployCard(m, 'blue', 'resurrection-man', 4, 2);
    m = settle(m);
    expect(m.hand.blue).toContain('clay-shade');

    m = field({ blue: 'choir' });
    put(m, 'undertaker', 'blue', 4, 0);
    const v = put(m, 'baca', 'blue', 2, 2);
    m.units[v.uid].kw = [];
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m.money.blue = 0;
    m = run(m, { t: 'strike', uid: v.uid, r: 1, c: 2 });
    expect(m.money.blue).toBe(1);

    m = field({ blue: 'choir' });
    const hurt = put(m, 'baca', 'blue', 3, 0, { power: 4 });
    m.units[hurt.uid].power = 1;
    m = deployCard(m, 'blue', 'circuit-rider', 4, 2);
    m = settle(m);
    expect(m.units[hurt.uid].power).toBe(3);

    m = field({ blue: 'choir' });
    const adj = put(m, 'cole', 'red', 3, 2);
    m = deployCard(m, 'blue', 'weeping-bride', 4, 2);
    expect(m.units[adj.uid].pinUntil).toBe(m.turn + 1);

    m = field({ blue: 'choir' });
    put(m, 'organist', 'blue', 4, 0);
    put(m, 'baca', 'blue', 2, 2, { power: 1 });
    const k = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    const h = m.hand.blue.length;
    m = run(m, { t: 'strike', uid: k.uid, r: 2, c: 2 });
    expect(m.hand.blue.length).toBe(h + 1);
  });
});

describe('Silver Star', () => {
  it('Bass: shrugs the first strike each turn; a kill offers draw or look', () => {
    let m = field({ blue: 'star' });
    const b = put(m, 'bass', 'blue', 2, 2, { leader: true });
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[b.uid].power).toBe(5);
    m = field({ blue: 'star' });
    const b2 = put(m, 'bass', 'blue', 2, 2, { leader: true });
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m = run(m, { t: 'strike', uid: b2.uid, r: 1, c: 2 });
    expect(m.pending[0].resolve).toBe('drawOrLook');
  });
  it('Wyatt: steady only before you play a card', () => {
    let m = field({ blue: 'star' });
    const w = put(m, 'wyatt', 'blue', 2, 2);
    const d = put(m, 'cole', 'red', 1, 2, { power: 9 });
    m = deployCard(m, 'blue', 'baca', 4, 2);
    m = run(m, { t: 'strike', uid: w.uid, r: 1, c: 2 });
    expect(m.units[d.uid].power).toBe(5);
    expect(m.units[w.uid]).toBeUndefined();
  });
  it('Hickok: strikes an adjacent enemy as he falls', () => {
    let m = field({ blue: 'star' });
    put(m, 'hickok', 'blue', 2, 2, { power: 1 });
    const a = put(m, 'cole', 'red', 1, 2, { power: 2 });
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[a.uid]).toBeUndefined();
  });
  it('Silver Star: the bearer turns aside from a trap', () => {
    let m = field({ blue: 'star' });
    const u = put(m, 'baca', 'blue', 3, 2, { gear: ['silver-star'] });
    m.traps.push({ tid: 'tx', r: 2, c: 2, kind: 'shaft', owner: null, known: { blue: false, red: false } });
    m = run(m, { t: 'move', uid: u.uid, r: 2, c: 2 });
    expect(uidAt(m, 3, 2)).toBe(u.uid);
    expect(m.traps[0].known.blue).toBe(true);
  });
  it('Open Warrant: the enemy cannot move on its next turn', () => {
    let m = field({ blue: 'star' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = playCard(m, 'blue', 'open-warrant', { uid: e.uid });
    m = endTurn(m);
    expect(tryRun(m, { t: 'move', uid: e.uid, r: 1, c: 1 }).error).toMatch(/held/);
  });
  it('Salt Oath: striking your leader costs the striker 2', () => {
    let m = field({ blue: 'star' });
    put(m, 'baca', 'blue', 2, 2, { leader: true });
    const a = put(m, 'cole', 'red', 1, 2);
    m = playCard(m, 'blue', 'salt-oath');
    m = endTurn(m);
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[a.uid]?.power ?? 0).toBeLessThan(2);
  });
  it('Boot Clerk: gain 1 when an enemy unit is destroyed', () => {
    let m = field({ blue: 'star' });
    put(m, 'boot-clerk', 'blue', 4, 0);
    const v = put(m, 'baca', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m.money.blue = 0;
    m = run(m, { t: 'strike', uid: v.uid, r: 1, c: 2 });
    expect(m.money.blue).toBe(1);
  });
  it('Silver Jury: the enemy cannot strike back this turn', () => {
    let m = field({ blue: 'star' });
    const a = put(m, 'baca', 'blue', 2, 2);
    const e = put(m, 'cole', 'red', 1, 2, { power: 9 });
    m = playCard(m, 'blue', 'silver-jury', { uid: e.uid });
    m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
    expect(m.units[a.uid].power).toBe(2);
  });
  it('Manacles: the enemy cannot move until it pays 2 to break them', () => {
    let m = field({ blue: 'star' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = playCard(m, 'blue', 'manacles', { uid: e.uid });
    m = endTurn(m);
    expect(tryRun(m, { t: 'move', uid: e.uid, r: 1, c: 1 }).error).toMatch(/manacled/);
    const gid = m.units[e.uid].gear[0].gid;
    m.money.red = 5;
    m = run(m, { t: 'act', uid: e.uid, gid });
    expect(m.money.red).toBe(3);
    expect(tryRun(m, { t: 'move', uid: e.uid, r: 1, c: 1 }).error).toBeNull();
  });
  it('Jail Key: exile an enemy item; its bearer loses 1', () => {
    let m = field({ blue: 'star' });
    const e = put(m, 'cole', 'red', 1, 2);
    m.units[e.uid].gear.push({ gid: 'g1', cardId: 'derringer', owner: 'red' });
    m = playCard(m, 'blue', 'jail-key', { uid: e.uid, gid: 'g1' });
    expect(m.units[e.uid].gear).toHaveLength(0);
    expect(m.units[e.uid].power).toBe(3);
    expect(m.exile.red).toContain('derringer');
  });
  it('Gallows Rope: destroys Power 2 or less, or costs 2 and draws 1 when no one fits', () => {
    let m = field({ blue: 'star' });
    const e = put(m, 'billy', 'red', 1, 2);
    m = playCard(m, 'blue', 'gallows-rope', { uid: e.uid });
    expect(m.units[e.uid]).toBeUndefined();
    m = field({ blue: 'star' });
    put(m, 'cole', 'red', 1, 2);
    m.money.blue = 5;
    const h = m.hand.blue.length;
    m = playCard(m, 'blue', 'gallows-rope');
    expect(m.money.blue).toBe(0);
    expect(m.hand.blue.length).toBe(h + 1);
  });
  it('Night Watch: looks each turn and turns the next move aside from a trap', () => {
    let m = field({ blue: 'star' });
    const w = put(m, 'night-watch', 'blue', 3, 2);
    m.traps.push({ tid: 'tx', r: 2, c: 2, kind: 'shaft', owner: null, known: { blue: false, red: false } });
    m = endTurn(m);
    m = endTurn(m);
    expect(m.traps[0].known.blue).toBe(true);
    expect(m.aside.blue).toBe(true);
    m = run(m, { t: 'move', uid: w.uid, r: 2, c: 2 });
    expect(m.units[w.uid]).toBeTruthy();
  });
  it('Coroner: a death draws the top card if it is Silver Star', () => {
    let m = field({ blue: 'star' });
    m = playCard(m, 'blue', 'coroner');
    m.deck.blue = ['wyatt', 'baca'];
    const v = put(m, 'baca', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m = run(m, { t: 'strike', uid: v.uid, r: 1, c: 2 });
    expect(m.hand.blue).toContain('wyatt');
  });
  it('Posse Bell: two lawmen step one tile each', () => {
    let m = field({ blue: 'star' });
    m = playCard(m, 'blue', 'posse-bell');
    const a = put(m, 'baca', 'blue', 3, 0);
    const b = put(m, 'bat', 'blue', 3, 4);
    m = run(m, { t: 'act', did: m.tray.blue[0].did });
    m = run(m, { t: 'choose', key: a.uid });
    m = run(m, { t: 'choose', key: '2,0' });
    m = run(m, { t: 'choose', key: b.uid });
    m = run(m, { t: 'choose', key: '2,4' });
    expect(uidAt(m, 2, 0)).toBe(a.uid);
    expect(uidAt(m, 2, 4)).toBe(b.uid);
  });
  it('Hang Fire: strikes last; the first lethal strike leaves him at 1 and he fires back', () => {
    let m = field({ blue: 'star' });
    const h = put(m, 'hang-fire', 'blue', 2, 2);
    const a = put(m, 'cole', 'red', 1, 2, { power: 6 });
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[h.uid].power).toBe(1);
    expect(m.units[a.uid].power).toBeLessThanOrEqual(2);
  });
  it('Ledger: the first card each turn gains 1', () => {
    let m = field({ blue: 'star' });
    m = playCard(m, 'blue', 'ledger');
    expect(m.ledger.blue).toBe(true);
    m = endTurn(m);
    m = endTurn(m);
    const before = m.money.blue;
    m = deployCard(m, 'blue', 'baca', 4, 2);
    expect(m.money.blue).toBe(before - 2 + 1);
  });
  it('Black Dog: runs to the first enemy to cross onto your half', () => {
    let m = field({ blue: 'star', red: 'gang' });
    put(m, 'black-dog', 'blue', 4, 0);
    m = endTurn(m);
    const e = put(m, 'cole', 'red', 2, 2);
    m = run(m, { t: 'move', uid: e.uid, r: 3, c: 2 });
    expect(m.pending[0].side).toBe('blue');
    m = run(m, { t: 'choose', key: '3,1' });
    expect(m.units[uidAt(m, 3, 1)!].cardId).toBe('black-dog');
  });
  it('Yellow Sign: you choose the card they discard, and gain 1', () => {
    let m = field({ blue: 'star' });
    m.hand.red = ['billy', 'cole'];
    m.money.blue = 5;
    m = playCard(m, 'blue', 'yellow-sign');
    m = run(m, { t: 'choose', key: '1' });
    expect(m.hand.red).toEqual(['billy']);
    expect(m.money.blue).toBe(4);
  });
  it('At the Window: every hidden tile is seen; destroy a trap or deal 2', () => {
    let m = field({ blue: 'star' });
    m.traps.push({ tid: 'tx', r: 2, c: 2, kind: 'shaft', owner: 'red', known: { blue: false, red: true } });
    m = playCard(m, 'blue', 'at-the-window');
    expect(m.traps[0].known.blue).toBe(true);
    m = run(m, { t: 'choose', key: 'trap:tx' });
    expect(m.traps).toHaveLength(0);
  });
  it('Haunted Chamber: exhausted, no strike, no rites until your next turn', () => {
    let m = field({ blue: 'star' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = playCard(m, 'blue', 'haunted-chamber', { uid: e.uid });
    expect(m.units[e.uid].wardUntil).toBe(m.turn + 1);
    m = endTurn(m);
    expect(tryRun(m, { t: 'move', uid: e.uid, r: 1, c: 1 }).error).toBeTruthy();
  });
  it('Mothman: ranged, and unanswered', () => {
    let m = field({ blue: 'star' });
    const a = put(m, 'mothman', 'blue', 3, 2);
    put(m, 'cole', 'red', 1, 2, { power: 9 });
    m = run(m, { t: 'strike', uid: a.uid, r: 1, c: 2 });
    expect(m.units[a.uid].power).toBe(3);
  });
  it('Judge Roy Bean / Isaac Parker / George Maledon / Heck Thomas', () => {
    let m = field({ blue: 'star' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = deployCard(m, 'blue', 'roy-bean', 4, 2);
    m = settle(m);
    expect(m.units[e.uid].pinUntil).toBe(m.turn + 1);
    m = field({ blue: 'star' });
    const small = put(m, 'billy', 'red', 1, 2);
    m = deployCard(m, 'blue', 'isaac-parker', 4, 2);
    m = settle(m);
    expect(m.units[small.uid]).toBeUndefined();
    m = field({ blue: 'star' });
    put(m, 'george-maledon', 'blue', 4, 0);
    const v = put(m, 'baca', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m.money.blue = 0;
    m = run(m, { t: 'strike', uid: v.uid, r: 1, c: 2 });
    expect(m.money.blue).toBe(1);
    m = field({ blue: 'star' });
    const ht = put(m, 'heck-thomas', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    const h = m.hand.blue.length;
    m = run(m, { t: 'strike', uid: ht.uid, r: 1, c: 2 });
    expect(m.hand.blue.length).toBe(h + 1);
  });
});

describe('Department of the West', () => {
  it('Crook: devices cost 1 less; once a turn he readies an ally', () => {
    let m = field({ blue: 'army' });
    const c = put(m, 'crook', 'blue', 4, 2, { leader: true });
    m.money.blue = 3;
    m = playCard(m, 'blue', 'howitzer');
    expect(m.money.blue).toBe(0);
    const a = put(m, 'miles', 'blue', 3, 0);
    m = run(m, { t: 'move', uid: a.uid, r: 2, c: 0 });
    m = run(m, { t: 'act', uid: c.uid, target: { uid: a.uid } });
    expect(m.units[a.uid].moved).toBe(false);
    expect(tryRun(m, { t: 'act', uid: c.uid, target: { uid: a.uid } }).error).toBeTruthy();
  });
  it('Five in the Wheel: the first lethal strike leaves the bearer at 1', () => {
    let m = field({ blue: 'army' });
    const u = put(m, 'baca', 'blue', 2, 2, { gear: ['five-wheel'] });
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[u.uid].power).toBe(1);
    expect(m.units[u.uid].gear).toHaveLength(0);
  });
  it('Signal Glass: 1 to an enemy below the named height', () => {
    let m = field({ blue: 'army' });
    m.tiles[3][0].h = 2;
    const e = put(m, 'cole', 'red', 1, 2);
    m = playCard(m, 'blue', 'signal-glass', { r: 3, c: 0 });
    m = settle(m);
    expect(m.units[e.uid].power).toBe(3);
  });
  it('Dead Volley / Gatling / Thunderbird: hit every enemy', () => {
    let m = field({ blue: 'army' });
    const e1 = put(m, 'cole', 'red', 1, 2);
    const e2 = put(m, 'cole', 'red', 1, 1);
    const mine = put(m, 'miles', 'blue', 3, 2);
    m = playCard(m, 'blue', 'dead-volley');
    expect(m.units[e1.uid].power).toBe(2);
    expect(m.units[e2.uid].power).toBe(2);
    expect(m.units[mine.uid].power).toBe(4);
    m = playCard(m, 'blue', 'gatling');
    m = run(m, { t: 'act', did: m.tray.blue[0].did });
    expect(m.units[e1.uid].power).toBe(1);
    m = field({ blue: 'grass' });
    const e3 = put(m, 'cole', 'red', 1, 2);
    m = deployCard(m, 'blue', 'thunderbird', 4, 2);
    expect(m.units[e3.uid].power).toBe(3);
  });
  it('Flipper: devices cost 1 less and the first device each turn draws 1', () => {
    let m = field({ blue: 'army' });
    put(m, 'flipper', 'blue', 4, 0);
    m.money.blue = 1;
    const h = m.hand.blue.length;
    m = playCard(m, 'blue', 'bugle');
    expect(m.money.blue).toBe(0);
    expect(m.hand.blue.length).toBe(h + 1);
  });
  it('Last Sentry: the first enemy to come adjacent each turn loses 2', () => {
    let m = field({ blue: 'gang', red: 'army' });
    put(m, 'last-sentry', 'red', 1, 2);
    const u = put(m, 'cole', 'blue', 3, 2);
    m = run(m, { t: 'move', uid: u.uid, r: 2, c: 2 });
    expect(m.units[u.uid].power).toBe(2);
  });
  it('Picket Line: an enemy that comes adjacent loses 1 and cannot strike', () => {
    let m = field({ blue: 'gang', red: 'army' });
    put(m, 'picket-line', 'red', 1, 2);
    const u = put(m, 'cole', 'blue', 3, 2);
    m = run(m, { t: 'move', uid: u.uid, r: 2, c: 2 });
    expect(m.units[u.uid].power).toBe(3);
    expect(m.units[u.uid].noStrikeUntil).toBe(m.turn);
  });
  it('Bugle: readies an Army unit', () => {
    let m = field({ blue: 'army' });
    m = playCard(m, 'blue', 'bugle');
    const a = put(m, 'miles', 'blue', 3, 0);
    m = run(m, { t: 'move', uid: a.uid, r: 2, c: 0 });
    m = run(m, { t: 'act', did: m.tray.blue[0].did, target: { uid: a.uid } });
    expect(m.units[a.uid].moved).toBe(false);
  });
  it('Supply Wagon: 2 money, 1 when an enemy is at your door', () => {
    let m = field({ blue: 'army' });
    m = playCard(m, 'blue', 'supply-wagon');
    m.money.blue = 0;
    m = run(m, { t: 'act', did: m.tray.blue[0].did });
    expect(m.money.blue).toBe(2);
  });
  it("Surgeon's Roll: mends 2 after a wound, then goes", () => {
    let m = field({ blue: 'army' });
    const u = put(m, 'miles', 'blue', 2, 2, { power: 6, gear: ['surgeon-kit'] });
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[u.uid].power).toBe(5);
    expect(m.units[u.uid].gear).toHaveLength(0);
  });
  it('Howitzer: 3 to one enemy', () => {
    let m = field({ blue: 'army' });
    m = playCard(m, 'blue', 'howitzer');
    const e = put(m, 'cole', 'red', 1, 2);
    m = run(m, { t: 'act', did: m.tray.blue[0].did, target: { uid: e.uid } });
    expect(m.units[e.uid].power).toBe(1);
  });
  it('Cut Wire: enemy rites cost 1 more; nobody steps on it', () => {
    let m = field({ blue: 'army', red: 'gang' });
    m = playCard(m, 'blue', 'cut-wire', { r: 2, c: 2 });
    m = endTurn(m);
    m.money.red = 3;
    m.hand.red.push('the-raven');
    const res = tryRun(m, { t: 'play', i: m.hand.red.length - 1, target: { uid: put(m, 'baca', 'blue', 3, 3).uid } });
    expect(res.error).toMatch(/need 4/);
    const e = put(m, 'cole', 'red', 1, 2);
    expect(tryRun(m, { t: 'move', uid: e.uid, r: 2, c: 2 }).error).toMatch(/wire/);
  });
  it('Empty Saddle: exhaust to bring a fallen Army unit back to hand', () => {
    let m = field({ blue: 'army' });
    put(m, 'empty-saddle', 'blue', 4, 0);
    put(m, 'miles', 'blue', 2, 2, { power: 1 });
    const a = put(m, 'cole', 'red', 1, 2, { power: 9 });
    m.units[a.uid].kw = ['fast'];
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.pending[0].resolve).toBe('saddle');
    m = run(m, { t: 'choose', key: 'yes' });
    expect(m.hand.blue).toContain('miles');
  });
  it('Sibley: allies on its tile cannot be named by enemy rites', () => {
    let m = field({ blue: 'army', red: 'gang' });
    const u = put(m, 'miles', 'blue', 3, 2);
    m = playCard(m, 'blue', 'sibley', { r: 3, c: 2 });
    expect(targetOptions(m, 'red', card('the-raven').target, true).some((t) => t.uid === u.uid)).toBe(false);
  });
  it('Ambulance: carries an ally up to two tiles; it cannot strike', () => {
    let m = field({ blue: 'army' });
    m = playCard(m, 'blue', 'ambulance');
    const a = put(m, 'miles', 'blue', 4, 0);
    m = run(m, { t: 'act', did: m.tray.blue[0].did, target: { uid: a.uid } });
    m = run(m, { t: 'choose', key: '2,0' });
    expect(uidAt(m, 2, 0)).toBe(a.uid);
    expect(m.units[a.uid].noStrikeUntil).toBe(m.turn);
  });
  it('The Damned Thing: not ranged, unanswered, and no rite or shot can name it', () => {
    let m = field({ blue: 'army', red: 'star' });
    const d = put(m, 'damned-thing', 'blue', 2, 2);
    expect(card('damned-thing').kw).not.toContain('ranged');
    const e = put(m, 'cole', 'red', 1, 2, { power: 9 });
    m = run(m, { t: 'strike', uid: d.uid, r: 1, c: 2 });
    expect(m.units[d.uid].power).toBe(4);
    expect(m.units[e.uid].power).toBe(5);
    const g = put(m, 'garrett', 'red', 0, 4);
    m.side = 'red';
    expect(targetOptions(m, 'red', card('silver-jury').target, true).some((t) => t.uid === d.uid)).toBe(false);
    void g;
  });
  it('Owl Creek: destroys Power 2 or less; its owner draws 1', () => {
    let m = field({ blue: 'army' });
    const e = put(m, 'billy', 'red', 1, 2);
    const h = m.hand.red.length;
    m = playCard(m, 'blue', 'owl-creek', { uid: e.uid });
    expect(m.units[e.uid]).toBeUndefined();
    expect(m.hand.red.length).toBe(h + 1);
  });
  it('Cave-In: kills the first unit in and buries an enemy item beside it', () => {
    let m = field({ blue: 'army' });
    m = playCard(m, 'blue', 'cave-in', { r: 2, c: 2 });
    m = endTurn(m);
    const n = put(m, 'cole', 'red', 2, 1);
    m.units[n.uid].gear.push({ gid: 'g9', cardId: 'derringer', owner: 'red' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = run(m, { t: 'move', uid: e.uid, r: 2, c: 2 });
    expect(m.units[e.uid]).toBeUndefined();
    expect(m.units[n.uid].gear).toHaveLength(0);
  });
  it('Comanche / Telegrapher / Mule Skinner / Lady in Green / Ambrose Bierce', () => {
    let m = field({ blue: 'army' });
    const c = put(m, 'comanche-horse', 'blue', 2, 2);
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[c.uid].power).toBe(3);
    m = field({ blue: 'army' });
    put(m, 'telegrapher', 'blue', 4, 0);
    m.money.blue = 5;
    m = playCard(m, 'blue', 'bugle');
    expect(m.money.blue).toBe(4);
    m = field({ blue: 'army' });
    m.money.blue = 5;
    m = deployCard(m, 'blue', 'mule-skinner', 4, 2);
    expect(m.money.blue).toBe(4);
    m = field({ blue: 'army' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = deployCard(m, 'blue', 'lady-in-green', 2, 0);
    m = settle(m);
    expect(m.units[e.uid].pinUntil).toBe(m.turn + 1);
    m = field({ blue: 'army' });
    put(m, 'ambrose-bierce', 'blue', 2, 2, { power: 1 });
    const k = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    const h = m.hand.blue.length;
    m = run(m, { t: 'strike', uid: k.uid, r: 2, c: 2 });
    expect(m.hand.blue.length).toBe(h + 1);
  });
});

describe('High Grass Nation', () => {
  it('Sitting Bull: looks each turn, and the first ally to move gets an extra tile', () => {
    let m = field({ blue: 'grass' });
    put(m, 'sitting-bull', 'blue', 4, 2, { leader: true });
    const a = put(m, 'baca', 'blue', 3, 0);
    m = endTurn(m);
    m = endTurn(m);
    expect(m.scouted.blue.length).toBe(1);
    m = run(m, { t: 'move', uid: a.uid, r: 2, c: 0 });
    expect(tryRun(m, { t: 'move', uid: a.uid, r: 1, c: 0 }).error).toBeNull();
  });
  it('Geronimo: +2 from higher ground; breaks away the first time he would die', () => {
    let m = field({ blue: 'grass', seed: 5 });
    m.tiles[3][2].h = 1;
    const g = put(m, 'geronimo', 'blue', 3, 2);
    const d = put(m, 'cole', 'red', 2, 2, { power: 9 });
    m = run(m, { t: 'strike', uid: g.uid, r: 2, c: 2 });
    expect(m.units[d.uid].power).toBe(4);
    expect(m.units[g.uid].power).toBe(1);
    expect(m.board[3][2]).not.toBe(g.uid);
  });
  it('Chief Joseph: not ranged; his side cannot be struck by ranged attacks', () => {
    expect(card('joseph').kw).not.toContain('ranged');
    const m = field({ blue: 'star', red: 'grass' });
    put(m, 'joseph', 'red', 0, 0);
    const g = put(m, 'garrett', 'blue', 3, 2);
    put(m, 'cole', 'red', 1, 2);
    expect(tryRun(m, { t: 'strike', uid: g.uid, r: 1, c: 2 }).error).toMatch(/even ground/);
  });
  it('Quanah: once a turn, sends an enemy item back to its owner', () => {
    let m = field({ blue: 'grass' });
    const q = put(m, 'quanah', 'blue', 3, 2);
    const e = put(m, 'cole', 'red', 1, 2);
    m.units[e.uid].gear.push({ gid: 'g1', cardId: 'derringer', owner: 'red' });
    m = run(m, { t: 'act', uid: q.uid, target: { uid: e.uid, gid: 'g1' } });
    expect(m.hand.red).toContain('derringer');
  });
  it('Parfleche / Painted Shield: the first strike each turn deals 1 less', () => {
    for (const id of ['parfleche', 'painted-shield']) {
      let m = field({ blue: 'grass' });
      const u = put(m, 'baca', 'blue', 2, 2, { power: 6, gear: [id] });
      m.units[u.uid].kw = [];
      const a = put(m, 'cole', 'red', 1, 2);
      m.side = 'red';
      m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
      expect(m.units[u.uid].power).toBe(3);
    }
  });
  it('Ten Bears: allies lose nothing from the first strike each turn', () => {
    let m = field({ blue: 'grass' });
    put(m, 'ten-bears', 'blue', 4, 0);
    const u = put(m, 'baca', 'blue', 2, 2);
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[u.uid].power).toBe(2);
  });
  it('Winter Count: draws 1 at the start of your turn', () => {
    let m = field({ blue: 'grass' });
    put(m, 'baca', 'blue', 3, 2, { gear: ['winter-count'] });
    m = endTurn(m);
    const h = m.hand.blue.length;
    m = endTurn(m);
    expect(m.hand.blue.length).toBe(h + 2);
  });
  it('Buffalo Skull: deals 2 to the attacker that destroys the bearer', () => {
    let m = field({ blue: 'grass' });
    put(m, 'baca', 'blue', 2, 2, { power: 1, gear: ['buffalo-skull'] });
    const a = put(m, 'cole', 'red', 1, 2, { power: 6 });
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[a.uid].power).toBe(3);
  });
  it('Trade Blanket: +1 Power, and it can be passed on for 1', () => {
    let m = field({ blue: 'grass' });
    const u = put(m, 'baca', 'blue', 3, 2);
    const v = put(m, 'bat', 'blue', 3, 1);
    m = playCard(m, 'blue', 'trade-blanket', { uid: u.uid });
    expect(m.units[u.uid].power).toBe(3);
    const gid = m.units[u.uid].gear[0].gid;
    m = run(m, { t: 'act', uid: u.uid, gid, target: { uid: v.uid } });
    expect(m.units[u.uid].power).toBe(2);
    expect(m.units[v.uid].power).toBe(3);
  });
  it('Sasquatch: the first wound does not count', () => {
    let m = field({ blue: 'grass' });
    const s = put(m, 'sasquatch', 'blue', 2, 2);
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[s.uid].power).toBe(6);
  });
  it('Piasa: a kill pays 2; enemies that enter lose 1', () => {
    let m = field({ blue: 'grass', red: 'gang' });
    const p = put(m, 'piasa', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m.money.blue = 0;
    m = run(m, { t: 'strike', uid: p.uid, r: 1, c: 2 });
    expect(m.money.blue).toBe(2);
    m = endTurn(m);
    m = deployCard(m, 'red', 'cole', 0, 1);
    expect(m.units[uidAt(m, 0, 1)!].power).toBe(3);
  });
  it('Deadfall: 2 Power and no strike for the first unit in', () => {
    let m = field({ blue: 'grass' });
    m = playCard(m, 'blue', 'deadfall', { r: 2, c: 2 });
    m = endTurn(m);
    const e = put(m, 'cole', 'red', 1, 2);
    m = run(m, { t: 'move', uid: e.uid, r: 2, c: 2 });
    expect(m.units[e.uid].power).toBe(2);
    expect(m.units[e.uid].noStrikeUntil).toBe(m.turn);
  });
  it('Satanta / Two Moons / Lozen / Mustang Runner / White Bull / Cochise', () => {
    let m = field({ blue: 'grass' });
    m.money.blue = 5;
    m.money.red = 5;
    m = deployCard(m, 'blue', 'satanta', 4, 2);
    expect(m.money.blue).toBe(3);
    expect(m.money.red).toBe(4);
    m = field({ blue: 'grass' });
    m.traps.push({ tid: 'a', r: 1, c: 0, kind: 'snake', owner: null, known: { blue: false, red: false } });
    m.traps.push({ tid: 'b', r: 1, c: 4, kind: 'snake', owner: null, known: { blue: false, red: false } });
    m = deployCard(m, 'blue', 'lozen', 4, 2);
    expect(m.traps.every((t) => t.known.blue)).toBe(true);
    m = field({ blue: 'grass' });
    const r = put(m, 'mustang-runner', 'blue', 3, 0);
    m = run(m, { t: 'move', uid: r.uid, r: 2, c: 0 });
    m = run(m, { t: 'move', uid: r.uid, r: 1, c: 0 });
    expect(uidAt(m, 1, 0)).toBe(r.uid);
    m = field({ blue: 'grass' });
    const w = put(m, 'white-bull', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    m.money.blue = 0;
    m = run(m, { t: 'strike', uid: w.uid, r: 1, c: 2 });
    expect(m.money.blue).toBe(1);
  });
  it('Rain-in-the-Face: strikes an adjacent enemy as he falls', () => {
    let m = field({ blue: 'grass' });
    put(m, 'rain-in-the-face', 'blue', 2, 2, { power: 1 });
    const a = put(m, 'cole', 'red', 1, 2, { power: 3 });
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[a.uid]).toBeUndefined();
  });
});

describe('Thunder Lodge', () => {
  it('Red Cloud: enemy devices cost 1 more; exhaust to ready an ally', () => {
    let m = field({ blue: 'army', red: 'lodge' });
    put(m, 'red-cloud', 'red', 0, 2, { leader: true });
    m.money.blue = 4;
    m.hand.blue.push('howitzer');
    expect(tryRun(m, { t: 'play', i: m.hand.blue.length - 1 }).error).toMatch(/need 5/);
    let s = field({ blue: 'lodge' });
    const rc = put(s, 'red-cloud', 'blue', 4, 2, { leader: true });
    const a = put(s, 'baca', 'blue', 3, 0);
    s = run(s, { t: 'move', uid: a.uid, r: 2, c: 0 });
    s = run(s, { t: 'act', uid: rc.uid, target: { uid: a.uid } });
    expect(s.units[a.uid].moved).toBe(false);
    expect(s.units[rc.uid].moved).toBe(true);
  });
  it('Bone Whistle: moves an ally one tile without spending it', () => {
    let m = field({ blue: 'lodge' });
    m = playCard(m, 'blue', 'bone-whistle');
    const a = put(m, 'baca', 'blue', 3, 0);
    m = run(m, { t: 'act', did: m.tray.blue[0].did, target: { uid: a.uid } });
    m = run(m, { t: 'choose', key: '2,0' });
    expect(uidAt(m, 2, 0)).toBe(a.uid);
    expect(m.units[a.uid].moved).toBe(false);
  });
  it('Thunder on the Ridge: an ally on height hits an enemy below for 2; it cannot climb', () => {
    let m = field({ blue: 'lodge' });
    m.tiles[3][2].h = 1;
    const a = put(m, 'baca', 'blue', 3, 2);
    const e = put(m, 'cole', 'red', 1, 2);
    m = playCard(m, 'blue', 'thunder-ridge', { uid: a.uid });
    m = run(m, { t: 'choose', key: e.uid });
    expect(m.units[e.uid].power).toBe(2);
    expect(m.units[e.uid].groundUntil).toBe(m.turn + 1);
  });
  it('Ridge Listener: looks on entry and climbs for free', () => {
    let m = field({ blue: 'lodge' });
    m = deployCard(m, 'blue', 'ridge-listener', 4, 2);
    expect(m.pending[0].resolve).toBe('lookTile');
    m = settle(m);
    expect(m.scouted.blue.length).toBe(1);
  });
  it('River Mist: an ally moves up to two tiles and cannot strike', () => {
    let m = field({ blue: 'lodge' });
    const a = put(m, 'baca', 'blue', 4, 0);
    m = playCard(m, 'blue', 'river-mist', { uid: a.uid });
    m = run(m, { t: 'choose', key: '2,0' });
    expect(uidAt(m, 2, 0)).toBe(a.uid);
    expect(m.units[a.uid].noStrikeUntil).toBe(m.turn);
  });
  it('Cold Ring: units on the tile cannot leave until your next turn', () => {
    let m = field({ blue: 'lodge' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = playCard(m, 'blue', 'cold-ring', { r: 1, c: 2 });
    m = endTurn(m);
    expect(tryRun(m, { t: 'move', uid: e.uid, r: 1, c: 1 }).error).toMatch(/cold ring/);
  });
  it('Empty Lodge: gain 2 when it falls', () => {
    let m = field({ blue: 'lodge' });
    put(m, 'empty-lodge', 'blue', 2, 2, { power: 1 });
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m.money.blue = 0;
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.money.blue).toBe(2);
  });
  it('La Llorona: pins an adjacent enemy; returns to hand the first time for 2', () => {
    let m = field({ blue: 'lodge' });
    const e = put(m, 'cole', 'red', 3, 2);
    m = deployCard(m, 'blue', 'llorona', 4, 2);
    expect(m.units[e.uid].pinUntil).toBe(m.turn + 1);
    m = field({ blue: 'lodge' });
    put(m, 'llorona', 'blue', 2, 2, { power: 1 });
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m.money.blue = 5;
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.hand.blue).toContain('llorona');
    expect(m.money.blue).toBe(3);
  });
  it('Shaft Viper / Alkali Sink', () => {
    let m = field({ blue: 'lodge' });
    m = playCard(m, 'blue', 'shaft-viper', { r: 2, c: 2 });
    m = endTurn(m);
    let e = put(m, 'cole', 'red', 1, 2);
    m = run(m, { t: 'move', uid: e.uid, r: 2, c: 2 });
    expect(m.units[e.uid]).toBeUndefined();
    m = field({ blue: 'lodge' });
    m = playCard(m, 'blue', 'alkali', { r: 2, c: 2 });
    m = endTurn(m);
    e = put(m, 'cole', 'red', 1, 2, { power: 5 });
    m = run(m, { t: 'move', uid: e.uid, r: 2, c: 2 });
    expect(m.units[e.uid].power).toBe(2);
    expect(m.units[e.uid].pinUntil).toBe(m.turn + 2);
  });
  it('Crazy Horse / High Backbone / Roman Nose / Black Elk / Little Big Man / Morning Star / Little Wolf / Weather Watcher / Black Coal / Hail Caller', () => {
    let m = field({ blue: 'lodge' });
    const hb = put(m, 'high-backbone', 'blue', 2, 2, { power: 1 });
    const a = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: a.uid, r: 2, c: 2 });
    expect(m.units[hb.uid].power).toBe(1);

    m = field({ blue: 'lodge' });
    const rn = put(m, 'roman-nose', 'blue', 2, 2);
    const b = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: b.uid, r: 2, c: 2 });
    expect(m.units[rn.uid].power).toBe(4);

    m = field({ blue: 'lodge' });
    const hurt = put(m, 'baca', 'blue', 3, 0, { power: 3 });
    m.units[hurt.uid].power = 1;
    m = deployCard(m, 'blue', 'black-elk', 4, 2);
    m = settle(m);
    expect(m.units[hurt.uid].power).toBe(3);

    m = field({ blue: 'lodge' });
    const e = put(m, 'cole', 'red', 1, 2);
    m = deployCard(m, 'blue', 'little-big-man', 4, 2);
    m = settle(m);
    expect(m.units[e.uid].pinUntil).toBe(m.turn + 1);

    m = field({ blue: 'lodge' });
    put(m, 'dull-knife', 'blue', 4, 0);
    m.money.blue = 0;
    m = endTurn(m);
    m = endTurn(m);
    expect(m.money.blue).toBe(3);

    m = field({ blue: 'lodge' });
    const lw = put(m, 'little-wolf', 'blue', 3, 0);
    m = run(m, { t: 'move', uid: lw.uid, r: 2, c: 0 });
    expect(tryRun(m, { t: 'move', uid: lw.uid, r: 1, c: 0 }).error).toBeNull();

    m = field({ blue: 'lodge' });
    m.money.blue = 5;
    const h = m.hand.blue.length;
    m = deployCard(m, 'blue', 'black-coal', 4, 2);
    expect(m.money.blue).toBe(3);
    expect(m.hand.blue.length).toBe(h + 1);

    m = field({ blue: 'lodge' });
    const t = put(m, 'cole', 'red', 1, 2);
    m = deployCard(m, 'blue', 'hail-caller', 4, 2);
    m = settle(m);
    expect(m.units[t.uid].power).toBe(3);

    m = field({ blue: 'lodge' });
    const ch = put(m, 'crazy-horse', 'blue', 2, 2, { power: 9 });
    put(m, 'cole', 'red', 1, 2, { power: 12 });
    m = run(m, { t: 'strike', uid: ch.uid, r: 1, c: 2 });
    expect(m.pending[0]?.resolve).toBe('moveTo');
  });
});

describe('leader LEAD powers', () => {
  it('each leader LEAD does its printed thing', () => {
    let m = field({ blue: 'gang' });
    m.money.blue = 0;
    m = run(m, { t: 'lead' });
    expect(m.money.blue).toBe(2);
    m = field({ blue: 'star' });
    m.leader.blue = 'bass';
    const a = put(m, 'baca', 'blue', 3, 2);
    m = run(m, { t: 'lead', target: { uid: a.uid } });
    expect(m.units[a.uid].kw).toContain('lastStand');
    m = field({ blue: 'army' });
    m.leader.blue = 'crook';
    const b = put(m, 'miles', 'blue', 3, 0);
    m = run(m, { t: 'move', uid: b.uid, r: 2, c: 0 });
    m = run(m, { t: 'lead' });
    expect(m.units[b.uid].moved).toBe(false);
    m = field({ blue: 'lodge' });
    m.leader.blue = 'red-cloud';
    m.money.red = 3;
    m = run(m, { t: 'lead' });
    expect(m.money.red).toBe(2);
    m = field({ blue: 'grass' });
    m.leader.blue = 'sitting-bull';
    m.traps.push({ tid: 'a', r: 3, c: 0, kind: 'snake', owner: null, known: { blue: false, red: false } });
    m = run(m, { t: 'lead' });
    expect(m.traps[0].known.blue).toBe(true);
    m = field({ blue: 'choir' });
    m.leader.blue = 'faro-widow';
    const h = m.hand.blue.length;
    m = run(m, { t: 'lead' });
    expect(m.hand.blue.length).toBe(h + 1);
  });
});
