/** The printed-text pass: one vocabulary, and cards that do what they now say. */
import { readFileSync } from 'node:fs';
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

describe('Western wording pass: every card reads plainly', () => {
  const texts = CARDS.flatMap((c) => [[c.id, c.text], ...(c.lead ? [[`${c.id} (lead)`, c.lead.text]] : [])] as [string, string][]);
  it('every card has text that fits a phone card', () => {
    for (const c of CARDS) {
      expect(c.text.length, c.id).toBeGreaterThan(10);
      expect(c.text.length, c.id).toBeLessThanOrEqual(210);
    }
  });
  it('every card opens with a named ability (a short lead-in ending in a full stop)', () => {
    for (const c of CARDS) expect(c.text, c.id).toMatch(/^[A-Z][A-Za-z’'\- ]{1,30}\./);
  });
  it('no bare "his/her/its strikes": the card says who strikes', () => {
    for (const [id, t] of texts) expect(t, id).not.toMatch(/\b(his|her|its|their) strikes?\b/i);
  });
  it('damage is never written as Power given to someone', () => {
    for (const [id, t] of texts) {
      expect(t, id).not.toMatch(/\b\d+ Power (to|at|on)\b/i);
      expect(t, id).not.toMatch(/deals? (\+?\d+|his|her|its) Power\b/i);
      expect(t, id).not.toMatch(/Power to the attacker|attacker gains/i);
      expect(t, id).not.toMatch(/\bgets? \+\d/);
    }
  });
  it('no occult jargon in rules text', () => {
    const banned = /\b(occult\w*|rites?|ritual\w*|sigils?|covens?|grimoires?|spells?|incantations?|hex(es)?|curse[sd]?|summon\w*|arcane|demon\w*|s[eé]ance|pentagram|magic\w*|witchcraft|working|oaths?|muster\w*|plates?)\b/i;
    for (const [id, t] of texts) expect(t, id).not.toMatch(banned);
    for (const c of CARDS) if (c.lead?.label) expect(c.lead.label, c.id).not.toMatch(banned);
  });
  it('arrival abilities say "When you deploy"', () => {
    for (const c of CARDS.filter((x) => x.ab?.some((a) => a.on === 'enter'))) expect(c.text, c.id).toMatch(/When you deploy/);
    for (const [id, t] of texts) expect(t, id).not.toMatch(/\bwhen (he|she|it|they) enters?\b/i);
  });
  it('leader passives that only work on the board say so', () => {
    for (const id of ['crook', 'red-cloud', 'sitting-bull', 'faro-widow']) expect(card(id).text, id).toMatch(/is on the board/);
  });
  it('Frank James names himself as the one who hits harder, not the leader', () => {
    const t = card('frank-james').text;
    expect(t).toMatch(/While your leader is on the board, Frank James deals 1 extra damage when he strikes/);
    expect(card('frank-james').kind).toBe('unit');
  });
  it('ranged cards only promise no strike back for the two-tile shot', () => {
    for (const c of CARDS.filter((x) => x.kw.includes('ranged'))) {
      expect(c.text, c.id).toMatch(/two tiles away in a straight line, and that target cannot strike back/);
      expect(c.text, c.id).not.toMatch(/is not answered/);
    }
  });
  it('one name per keyword: Command cards say Command, and the glossary agrees', () => {
    for (const c of CARDS.filter((x) => x.kw.includes('crown'))) expect(c.text, c.id).toMatch(/^Command\./);
    for (const c of CARDS) expect(c.text, c.id).not.toMatch(/\bCrown\b/);
    const view = readFileSync(new URL('../ui/cardview.tsx', import.meta.url), 'utf8');
    expect(view).toMatch(/crown: \['Command'/);
    expect(view).toMatch(/ranged: \['Ranged', '[^']*answered as usual/);
  });
  it('Tough, Hold, Harbor, Returns and Fast read the same on every card', () => {
    const want: Record<string, RegExp> = {
      tough: /Tough\. .*takes 1 less/,
      hold: /Hold\. .*cannot move, though they can still strike|Hold\. Enemy units next to .* cannot move/,
      harbor: /Harbor\. .*enemy tricks cannot target your other units/,
      fast: /Fast\./,
    };
    for (const c of CARDS) for (const k of Object.keys(want)) if (c.kw.includes(k)) expect(c.text, `${c.id} ${k}`).toMatch(want[k]);
    for (const c of CARDS.filter((x) => x.ab?.some((a) => a.op === 'returns') && x.kind === 'unit'))
      expect(c.text, c.id).toMatch(/^Returns\. .*the first time (he|she|it) is destroyed, (he|she|it) rides back in at the start of your next turn, exhausted\.$/);
  });
  it('every leader has a Western Lead name and plain Lead text', () => {
    for (const c of CARDS.filter((x) => x.kind === 'leader')) {
      expect(c.lead?.label, c.id).toBeTruthy();
      expect(c.lead!.text, c.id).toMatch(/\.$/);
    }
    expect(card('bass').lead?.label).toBe('Deputize');
    expect(card('crook').lead?.label).toBe('Boots and Saddles');
  });
});
