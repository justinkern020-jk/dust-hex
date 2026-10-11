/** The printed-text pass: one vocabulary, and cards that do what they now say. */
import { describe, expect, it } from 'vitest';
import { CARDS, card } from './cards';
import { field, put, run, playCard, settle, tryRun } from './testkit';

describe('card text vocabulary', () => {
  const texts = CARDS.flatMap((c) => [[c.id, c.text], ...(c.lead ? [[`${c.id} (lead)`, c.lead.text]] : [])] as [string, string][]);
  it('damage never reads as giving Power', () => {
    for (const [id, t] of texts) {
      expect(t, id).not.toMatch(/deals? (\+?\d|his|its) Power/i);
      expect(t, id).not.toMatch(/\+\d Power/);
      expect(t, id).not.toMatch(/is dealt \d/);
      expect(t, id).not.toMatch(/Power to (the|one|each|an?)\b/);
      expect(t, id).not.toMatch(/\bget \+1\b/);
    }
  });
  it('no Occult Wars or engine words leak into text', () => {
    for (const [id, t] of texts) {
      expect(t, id).not.toMatch(/\b(Resource|plate|allied unit plate|Ready one allied)\b/);
      expect(t, id).not.toMatch(/\bready (one|every)\b/i);
    }
  });
  it('every delay unit says it cannot move or strike the turn it enters', () => {
    for (const c of CARDS.filter((x) => x.kw.includes('delay'))) expect(c.text, c.id).toMatch(/cannot move or strike the turn/);
  });
  it('people are not "it"', () => {
    for (const id of ['joaquin', 'lester-moore', 'brother-lazarus', 'seth-bullock', 'cochise', 'young-man-afraid', 'tall-bull', 'dog-soldier', 'american-horse', 'lodge-keeper', 'deaconess'])
      expect(card(id).text, id).not.toMatch(/\bit (stands|is destroyed)|next to it cannot/);
  });
  it('leaders whose LEAD names a unit ask for one', () => {
    for (const id of ['bass', 'sitting-bull', 'red-cloud']) expect(card(id).lead?.target?.kind, id).toBe('ally');
  });
});

describe('cards fixed in the sense pass', () => {
  it('Buffalo Skull: the attacker that destroys the bearer takes 2 damage', () => {
    let m = field({ blue: 'grass' });
    const mine = put(m, 'pony-herd', 'blue', 2, 2, { power: 1, gear: ['buffalo-skull'] });
    const foe = put(m, 'cole', 'red', 1, 2);
    m.side = 'red';
    m = run(m, { t: 'strike', uid: foe.uid, r: 2, c: 2 });
    expect(m.units[mine.uid]).toBeUndefined();
    expect(m.units[foe.uid].power).toBe(1); // 4, less 1 from the answer, less 2 from the skull
  });
  it('Jail Key: freeing your own unit from an enemy item does not hurt it', () => {
    let m = field({ blue: 'star' });
    const mine = put(m, 'baca', 'blue', 3, 2);
    m.units[mine.uid].gear.push({ gid: 'g1', cardId: 'manacles', owner: 'red' });
    m = playCard(m, 'blue', 'jail-key', { uid: mine.uid, gid: 'g1' });
    expect(m.units[mine.uid].gear).toHaveLength(0);
    expect(m.units[mine.uid].power).toBe(2);
  });
  it('Signal Glass looks at the tile you name', () => {
    let m = field({ blue: 'army' });
    m.traps.push({ tid: 'x', r: 2, c: 0, kind: 'snake', owner: 'red', known: { blue: false, red: true } });
    m = playCard(m, 'blue', 'signal-glass', { r: 2, c: 0 });
    m = settle(m);
    expect(m.traps[0].known.blue).toBe(true);
  });
  it('Faro Widow: a rite, item or device draws 1, once a turn', () => {
    let m = field({ blue: 'choir' });
    put(m, 'faro-widow', 'blue', 4, 2, { leader: true });
    const e = put(m, 'cole', 'red', 1, 2);
    const h = m.hand.blue.length;
    m = playCard(m, 'blue', 'goodman-path', { uid: e.uid }); // rite: +1 from the widow, +1 printed
    expect(m.hand.blue.length).toBe(h + 2);
    m = playCard(m, 'blue', 'widow-lamp', { r: 2, c: 2 }); // second card this turn: no widow draw
    m = settle(m);
    expect(m.hand.blue.length).toBe(h + 2);
  });
  it('Bass Reeves LEAD: the named unit gains Tough and a last stand; you draw', () => {
    let m = field({ blue: 'star' });
    m.leader.blue = 'bass';
    const a = put(m, 'doc', 'blue', 3, 2);
    const h = m.hand.blue.length;
    m = run(m, { t: 'lead', target: { uid: a.uid } });
    expect(m.units[a.uid].kw).toContain('tough');
    expect(m.hand.blue.length).toBe(h + 1);
    let n = field({ blue: 'star' });
    n.leader.blue = 'bass';
    const h2 = n.hand.blue.length;
    n = run(n, { t: 'lead' }); // no unit on the field: still draws
    expect(n.hand.blue.length).toBe(h2 + 1);
  });
  it('Sitting Bull and Red Cloud LEAD let a unit that acted act again', () => {
    for (const leader of ['sitting-bull', 'red-cloud']) {
      let m = field({ blue: leader === 'red-cloud' ? 'lodge' : 'grass' });
      m.leader.blue = leader;
      const a = put(m, 'pony-herd', 'blue', 3, 0);
      m = run(m, { t: 'move', uid: a.uid, r: 2, c: 0 });
      expect(tryRun(m, { t: 'move', uid: a.uid, r: 1, c: 0 }).error).toBeTruthy();
      m = run(m, { t: 'lead', target: { uid: a.uid } });
      expect(tryRun(m, { t: 'move', uid: a.uid, r: 1, c: 0 }).error, leader).toBeNull();
    }
  });
});
