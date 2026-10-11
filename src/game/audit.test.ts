/**
 * One test per bug in /workspace/dusthex_audit.md (the grok.me mirror audit).
 * Per-card ability tests live in cards.test.ts; these pin the audit's headline failures.
 */
import { describe, expect, it } from 'vitest';
import { CARDS, card, buildDeck, FACTIONS, factionPool } from './cards';
import { applyAction, newMatch, deployTiles, targetOptions, MAPS } from './engine';
import { playTurn } from './ai';
import { field, put, run, deployCard, playCard, settle, uidAt } from './testkit';

describe('audit 2a: deployed units stay on the board (the deploy race)', () => {
  it('every unit in every faction stays after it is paid for, for both sides', () => {
    for (const c of CARDS.filter((x) => x.kind === 'unit' && !x.hide)) {
      for (const side of ['blue', 'red'] as const) {
        let m = field({ blue: c.faction, red: c.faction === 'gang' ? 'star' : 'gang' });
        m.side = side;
        const winged = c.kw.includes('winged');
        const r = side === 'blue' ? (winged ? 3 : 4) : winged ? 1 : 0;
        const before = m.money[side];
        m = deployCard(m, side, c.id, r, 2);
        m = settle(m);
        const uid = uidAt(m, r, 2);
        expect(uid, `${c.id} (${side})`).toBeTruthy();
        expect(m.units[uid!].cardId).toBe(c.id);
        expect(m.money[side]).toBeLessThanOrEqual(before - c.cost + 2);
      }
    }
  });
  it('the AI musters and its units stay (40 seeds)', () => {
    for (let s = 1; s <= 40; s++) {
      const f = FACTIONS[s % 6].id;
      let m = newMatch({ blue: FACTIONS[(s + 1) % 6].id, red: f, seed: s, mapId: 'boot-hill' });
      m = run(m, { t: 'end' });
      const before = Object.values(m.units).filter((u) => u.side === 'red').length;
      m = playTurn(m, 'expert', () => 0.5);
      const reds = Object.values(m.units).filter((u) => u.side === 'red');
      expect(reds.length, `seed ${s} (${f})`).toBeGreaterThan(before);
    }
  });
});

describe('audit 2b: items, devices and attachments stay', () => {
  it('an item stays on its bearer and a tray device stays in the tray', () => {
    let m = field({ blue: 'gang' });
    const a = put(m, 'billy', 'blue', 3, 2);
    m = playCard(m, 'blue', 'derringer', { uid: a.uid });
    expect(m.units[a.uid].gear.map((g) => g.cardId)).toEqual(['derringer']);
    m = playCard(m, 'blue', 'powder-fuse');
    expect(m.tray.blue.map((d) => d.cardId)).toEqual(['powder-fuse']);
    m = playCard(m, 'blue', 'hell-rail', { r: 2, c: 2 });
    expect(m.tileDevices.map((d) => d.cardId)).toEqual(['hell-rail']);
  });
});

describe('audit 2c: cards that could not be played', () => {
  it('leaders take the field from the tray, and their printed passive applies (Crook: devices cost 1 less)', () => {
    let m = field({ blue: 'army' });
    m = run(m, { t: 'deploy', i: 'leader', r: 4, c: 2 });
    expect(m.units[uidAt(m, 4, 2)!].cardId).toBe('crook');
    const money = m.money.blue;
    m = playCard(m, 'blue', 'bugle');
    expect(m.money.blue).toBe(money - (card('bugle').cost - 1));
  });
  it('Thunder on the Ridge and Signal Glass work on a flat map', () => {
    let m = field({ blue: 'lodge' });
    const a = put(m, 'baca', 'blue', 3, 2);
    const e = put(m, 'cole', 'red', 1, 2);
    m = playCard(m, 'blue', 'thunder-ridge', { uid: a.uid });
    m = run(m, { t: 'choose', key: e.uid });
    expect(m.units[e.uid].power).toBe(2);
    expect(targetOptions(field({ blue: 'army' }), 'blue', card('signal-glass').target, false).length).toBeGreaterThan(0);
  });
  it('the 7 Territory cards belong to a side and reach decks', () => {
    for (const id of ['shaft-viper', 'mine-shaft', 'alkali', 'deadfall', 'cave-in', 'goodman-path', 'carmilla']) {
      const c = card(id);
      expect(FACTIONS.map((f) => f.id)).toContain(c.faction);
      expect(buildDeck(c.faction)).toContain(id);
    }
  });
});

describe('audit 1: decks are mostly characters', () => {
  it('every pool has 20+ characters and every 30-card deck is at least 2/3 characters', () => {
    for (const f of FACTIONS) {
      const chars = factionPool(f.id).filter((c) => c.kind === 'unit');
      expect(chars.length, f.id).toBeGreaterThanOrEqual(20);
      const deck = buildDeck(f.id);
      expect(deck.length).toBe(30);
      expect(deck.filter((id) => card(id).kind === 'unit').length, f.id).toBeGreaterThanOrEqual(20);
    }
  });
  it('every card has a quote and a source, never blank', () => {
    for (const c of CARDS) {
      expect(c.quote.trim().length, c.id).toBeGreaterThan(8);
      expect(c.quoted.trim().length, c.id).toBeGreaterThan(2);
    }
  });
});

describe('audit 4: other major problems', () => {
  it('4.1 passives are real: Switchman, Ten Bears, Picket Line, Last Sentry have ops', () => {
    for (const id of ['switchman', 'ten-bears', 'picket-line', 'last-sentry', 'black-dog', 'hang-fire']) {
      const c = card(id);
      expect((c.ab ?? []).length + (c.act ? 1 : 0), id).toBeGreaterThan(0);
    }
  });
  it('4.2 Chief Joseph and The Damned Thing are not ranged; Tommyknockers have delay', () => {
    expect(card('joseph').kw).not.toContain('ranged');
    expect(card('damned-thing').kw).not.toContain('ranged');
    expect(card('tommyknockers').kw).toContain('delay');
  });
  it('4.3 no act buttons on cards without a real act', () => {
    for (const id of ['clay-shade', 'hodag', 'hidebehind', 'empty-saddle', 'haunted-chamber', 'ride-back']) {
      const c = card(id);
      expect(c.act, id).toBeUndefined();
    }
    for (const c of CARDS) if (c.act) expect(typeof c.act.op).toBe('string');
  });
  it('4.4 "choose" effects ask the player: Yellow Sign, Hodag, False Coffin', () => {
    let m = field({ blue: 'star', red: 'gang' });
    m.hand.red = ['billy', 'cole', 'belle'];
    m = playCard(m, 'blue', 'yellow-sign');
    expect(m.pending[0].side).toBe('blue');
    expect(m.pending[0].options.length).toBe(3);
    m = run(m, { t: 'choose', key: m.pending[0].options[2].key });
    expect(m.hand.red).toEqual(['billy', 'cole']);

    let h = field({ blue: 'gang' });
    const e1 = put(h, 'baca', 'red', 1, 1);
    const e2 = put(h, 'bat', 'red', 1, 3);
    h = deployCard(h, 'blue', 'hodag', 4, 2);
    expect(h.pending[0].options.map((o) => o.uid).sort()).toEqual([e1.uid, e2.uid].sort());
    h = run(h, { t: 'choose', key: e2.uid });
    expect(h.units[e2.uid].pinUntil).toBeGreaterThanOrEqual(h.turn);
    expect(h.units[e1.uid].pinUntil ?? 0).toBeLessThan(h.turn);

    let f = field({ blue: 'choir' });
    f.discard.blue = ['clay-shade', 'belle', 'billy'];
    f = playCard(f, 'blue', 'false-coffin');
    expect(f.pending[0].side).toBe('blue');
    expect(f.pending[0].options.length).toBeGreaterThan(1);
  });
  it('4.7 the AI deploys in every scripted opening (6 factions x 3 maps)', () => {
    for (const map of ['boot-hill', 'gallows-mesa', 'twin-claims'])
      for (const f of FACTIONS) {
        let m = newMatch({ blue: 'gang', red: f.id, seed: 3, mapId: map });
        m = run(m, { t: 'end' });
        m = playTurn(m, 'expert', () => 0.5);
        expect(Object.values(m.units).some((u) => u.side === 'red'), `${f.id} on ${map}`).toBe(true);
      }
  });
  it('every map deploys on its own stronghold', () => {
    for (const map of MAPS) {
      const m = newMatch({ blue: 'gang', red: 'star', seed: 1, mapId: map.id });
      expect(deployTiles(m, 'blue', 'billy').length, map.id).toBeGreaterThan(0);
      expect(applyAction(m, { t: 'end' }).error).toBeNull();
    }
  });
});
