import { describe, expect, it } from 'vitest';
import { FACTIONS, buildDeck, card, factionPool, maxCopies } from './cards';
import {
  awardMatch,
  bestDeck,
  buyPack,
  buySingle,
  canAdd,
  count,
  deckForMatch,
  deckProblems,
  emptyCollection,
  grantStarters,
  matchGold,
  normalizeCollection,
  openPack,
  saveDeck,
  starterDeck,
  STARTER_DECK_ID,
} from './collection';
import { DAILY_WIN_BONUS, DECK_SIZE, LOSS_GOLD, PACK_PRICE, PACK_SIZE, SINGLE_PRICE, SPARE_GOLD, WIN_GOLD } from './economy';
import { newMatch } from './engine';
import { nextRand } from './rng';
import { collectionKey, loadCollection, saveCollection } from '../ui/collectionStore';

const seeded = (s0: number) => {
  let s = s0;
  return () => {
    const [v, n] = nextRand(s);
    s = n;
    return v;
  };
};
const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const day = new Date(2026, 9, 11, 15, 0);

describe('buildDeck: a cost curve, not cheapest-first', () => {
  it('30 cards, two thirds characters, all three cost bands, legal', () => {
    for (const f of FACTIONS) {
      const d = buildDeck(f.id);
      expect(d).toHaveLength(30);
      const units = d.map(card).filter((c) => c.kind === 'unit');
      expect(units.length).toBeGreaterThanOrEqual(20);
      expect(units.filter((c) => c.cost <= 2).length, f.id).toBeGreaterThanOrEqual(5);
      expect(units.filter((c) => c.cost === 3).length, f.id).toBeGreaterThanOrEqual(5);
      expect(units.filter((c) => c.cost >= 4).length, f.id).toBeGreaterThanOrEqual(4);
      expect(deckProblems(f.id, d)).toEqual([]);
    }
  });
  it('every card in every pool shows up in some rival deck across seeds', () => {
    for (const f of FACTIONS) {
      const seen = new Set<string>();
      for (let s = 1; s <= 60; s++) for (const id of buildDeck(f.id, 30, seeded(s))) seen.add(id);
      const missing = factionPool(f.id).filter((c) => !seen.has(c.id)).map((c) => c.id);
      expect(missing, f.id).toEqual([]);
    }
  });
  it('the engine uses the deck it is given, and seeds a rival deck otherwise', () => {
    const mine = starterDeck('gang');
    const m = newMatch({ blue: 'gang', red: 'lodge', seed: 5, blueDeck: mine });
    expect([...m.deck.blue, ...m.hand.blue].sort()).toEqual([...mine].sort());
    const a = newMatch({ blue: 'gang', red: 'lodge', seed: 5 });
    const b = newMatch({ blue: 'gang', red: 'lodge', seed: 5 });
    expect(a.deck.red).toEqual(b.deck.red);
  });
});

describe('starter decks', () => {
  it('every side gets a legal 30-card starter with a balanced curve, mostly characters', () => {
    for (const f of FACTIONS) {
      const d = starterDeck(f.id);
      expect(d).toHaveLength(DECK_SIZE);
      expect(deckProblems(f.id, d)).toEqual([]);
      const cs = d.map(card);
      expect(cs.filter((c) => c.kind === 'unit').length).toBeGreaterThanOrEqual(20);
      expect(cs.some((c) => c.rarity === 'patron')).toBe(false);
      // Commons and Uncommons first (some sides have few, so Rares fill the rest)
      expect(cs.filter((c) => c.rarity === 'common' || c.rarity === 'uncommon').length, f.id).toBeGreaterThanOrEqual(12);
      // rares only as single copies
      for (const [id, n] of Object.entries(count(d))) if (card(id).rarity === 'rare') expect(n).toBe(1);
      expect(cs.filter((c) => c.kind === 'unit' && c.cost >= 4).length, f.id).toBeGreaterThanOrEqual(3);
    }
  });
  it('first launch grants all six starters, owned and active', () => {
    const col = grantStarters(emptyCollection());
    expect(col.starters.sort()).toEqual(FACTIONS.map((f) => f.id).sort());
    for (const f of FACTIONS) {
      expect(col.active[f.id]).toBe(STARTER_DECK_ID);
      expect(deckProblems(f.id, deckForMatch(col, f.id), col.owned)).toEqual([]);
    }
  });
  it('granting is idempotent and keeps what you already own', () => {
    const once = grantStarters(emptyCollection());
    expect(grantStarters(once)).toBe(once);
    const old = normalizeCollection({ gold: 77, owned: { 'crazy-horse': 1 } });
    const up = grantStarters(old);
    expect(up.gold).toBe(77);
    expect(up.owned['crazy-horse']).toBe(1);
  });
  it('existing players (no save yet) get starters on load; the save round-trips under a profile key', () => {
    const st = memStore();
    const col = loadCollection(st);
    expect(col.starters).toHaveLength(6);
    expect(st.m.has(collectionKey('local'))).toBe(true);
    saveCollection({ ...col, gold: 123 }, st);
    expect(loadCollection(st).gold).toBe(123);
    st.setItem(collectionKey('local'), '{broken');
    expect(loadCollection(st).starters).toHaveLength(6);
  });
});

describe('gold', () => {
  it('a win pays by rival, plus the first win of the day once', () => {
    const a = matchGold({ won: true, mind: 'expert', turn: 12, winKind: 'claims' }, undefined, day);
    expect(a.total).toBe(WIN_GOLD.expert + DAILY_WIN_BONUS);
    expect(a.daily).toBe(true);
    let col = grantStarters(emptyCollection());
    col = awardMatch(col, { won: true, mind: 'easy', turn: 10, winKind: 'claims' }, day).col;
    expect(col.gold).toBe(WIN_GOLD.easy + DAILY_WIN_BONUS);
    const second = awardMatch(col, { won: true, mind: 'easy', turn: 10, winKind: 'claims' }, day);
    expect(second.award.total).toBe(WIN_GOLD.easy);
    const nextDay = awardMatch(second.col, { won: true, mind: 'easy', turn: 10, winKind: 'claims' }, new Date(2026, 9, 12, 9));
    expect(nextDay.award.daily).toBe(true);
  });
  it('a loss pays a little, but not for yielding early', () => {
    expect(matchGold({ won: false, mind: 'expert', turn: 14, winKind: 'claims' }, undefined, day).total).toBe(LOSS_GOLD);
    expect(matchGold({ won: false, mind: 'expert', turn: 2, winKind: 'stronghold' }, undefined, day).total).toBe(LOSS_GOLD);
    expect(matchGold({ won: false, mind: 'expert', turn: 2, winKind: 'yield' }, undefined, day).total).toBe(0);
    expect(matchGold({ won: false, mind: 'expert', turn: 8, winKind: 'yield' }, undefined, day).total).toBe(LOSS_GOLD);
  });
  it('the same match never pays twice', () => {
    const col = grantStarters(emptyCollection());
    const r = { won: true, mind: 'expert' as const, turn: 10, winKind: 'claims' as const };
    const a = awardMatch(col, r, day, 'm1');
    const b = awardMatch(a.col, r, day, 'm1');
    expect(b.repeat).toBe(true);
    expect(b.col.gold).toBe(a.col.gold);
    expect(awardMatch(a.col, r, day, 'm2').col.gold).toBe(a.col.gold + WIN_GOLD.expert);
    expect(a.col.stats.wins).toBe(1);
  });
});

describe('Trading Post', () => {
  it('singles cost by rarity, stop at the deck limit, and need the gold', () => {
    let col = { ...grantStarters(emptyCollection()), gold: 1000 };
    const rare = factionPool('star').find((c) => c.rarity === 'rare' && !col.owned[c.id])!;
    let r = buySingle(col, rare.id);
    if ('error' in r) throw new Error(r.error);
    expect(r.col.gold).toBe(1000 - SINGLE_PRICE.rare);
    expect(r.col.owned[rare.id]).toBe(1);
    col = r.col;
    r = buySingle(col, rare.id);
    if ('error' in r) throw new Error(r.error);
    col = r.col;
    expect('error' in buySingle(col, rare.id)).toBe(true);
    expect('error' in buySingle({ ...col, gold: 0 }, factionPool('star').find((c) => !col.owned[c.id])!.id)).toBe(true);
    expect('error' in buySingle(col, 'jesse')).toBe(true);
    const legend = card('crazy-horse');
    const l = buySingle({ ...col, gold: 500 }, legend.id);
    if ('error' in l) throw new Error(l.error);
    expect(l.col.gold).toBe(500 - SINGLE_PRICE.patron);
    expect('error' in buySingle(l.col, legend.id)).toBe(true);
  });
  it('a pack costs its price and gives 5 cards of the side, the last Rare or better', () => {
    for (const f of FACTIONS)
      for (let s = 1; s <= 40; s++) {
        const r = openPack(f.id, {}, seeded(s));
        expect(r.pulls).toHaveLength(PACK_SIZE);
        for (const p of r.pulls) expect(card(p.id).faction).toBe(f.id);
        expect(['rare', 'patron']).toContain(r.pulls[PACK_SIZE - 1].rarity);
        expect(r.pulls.every((p) => card(p.id).kind !== 'leader')).toBe(true);
      }
    const col = { ...grantStarters(emptyCollection()), gold: 250 };
    const b = buyPack(col, 'gang', seeded(3));
    if ('error' in b) throw new Error(b.error);
    expect(b.col.gold).toBe(250 - PACK_PRICE + b.refund);
    expect(b.col.stats.packs).toBe(1);
    expect('error' in buyPack({ ...col, gold: PACK_PRICE - 1 }, 'gang')).toBe(true);
  });
  it('pack odds land near the table over many packs', () => {
    const tally: Record<string, number> = {};
    const rng = seeded(99);
    const N = 4000;
    for (let i = 0; i < N; i++) for (const p of openPack('lodge', {}, rng).pulls.slice(0, 4)) tally[p.rarity] = (tally[p.rarity] ?? 0) + 1;
    expect(tally.common / (4 * N)).toBeCloseTo(0.2, 1);
    expect(tally.uncommon / (4 * N)).toBeCloseTo(0.45, 1);
    expect(tally.rare / (4 * N)).toBeCloseTo(0.35, 1);
    let legends = 0;
    for (let i = 0; i < N; i++) if (openPack('lodge', {}, rng).pulls[4].rarity === 'patron') legends++;
    expect(legends / N).toBeGreaterThan(0.06);
    expect(legends / N).toBeLessThan(0.14);
  });
  it('a side with no Legendary gives a Rare in the top slot; spares at the limit trade for gold', () => {
    const full: Record<string, number> = {};
    for (const c of factionPool('gang')) full[c.id] = maxCopies(c);
    const r = openPack('gang', full, seeded(7));
    expect(r.pulls.every((p) => p.spare)).toBe(true);
    expect(r.gold).toBe(r.pulls.reduce((s, p) => s + SPARE_GOLD[p.rarity], 0));
    expect(r.owned).toEqual(full);
    expect(r.pulls[4].rarity).toBe('rare');
  });
  it('packs never push a card past the limit', () => {
    let owned: Record<string, number> = {};
    const rng = seeded(11);
    for (let i = 0; i < 60; i++) owned = openPack('army', owned, rng).owned;
    for (const [id, n] of Object.entries(owned)) expect(n).toBeLessThanOrEqual(maxCopies(card(id)));
  });
});

describe('deck rules', () => {
  const col = grantStarters(emptyCollection());
  it('30 cards, two copies, one Legendary, own side only, cards you own', () => {
    const d = starterDeck('lodge');
    expect(deckProblems('lodge', d, col.owned)).toEqual([]);
    expect(deckProblems('lodge', d.slice(1), col.owned)[0]).toMatch(/Add 1 more card/);
    expect(deckProblems('lodge', [...d, d[0]], col.owned)[0]).toMatch(/Take out 1/);
    const u = factionPool('lodge').find((c) => c.kind === 'unit' && c.rarity !== 'patron')!.id;
    const three = [...d.slice(0, 27), u, u, u];
    expect(deckProblems('lodge', three).join()).toMatch(/at most 2/);
    expect(deckProblems('lodge', [...d.slice(0, 28), 'crazy-horse', 'crazy-horse']).join()).toMatch(/at most 1/);
    expect(deckProblems('lodge', [...d.slice(0, 29), 'billy']).join()).toMatch(/another side/);
    expect(deckProblems('lodge', [...d.slice(0, 29), 'crazy-horse'], col.owned).join()).toMatch(/you own 0/);
    expect(deckProblems('lodge', [...d.slice(0, 29), 'red-cloud']).join()).toMatch(/tray/);
  });
  it('canAdd explains why not', () => {
    expect(canAdd('lodge', [], 'crazy-horse', col.owned)).toMatch(/do not own/);
    expect(canAdd('lodge', starterDeck('lodge'), starterDeck('lodge')[0], col.owned)).toMatch(/full/);
    expect(canAdd('lodge', [], 'billy', col.owned)).toMatch(/Not for this side/);
  });
  it('auto-build makes a legal deck from what you own, and uses new cards when better', () => {
    for (const f of FACTIONS) expect(deckProblems(f.id, bestDeck(f.id, col.owned), col.owned)).toEqual([]);
    const all: Record<string, number> = {};
    for (const c of factionPool('lodge')) all[c.id] = maxCopies(c);
    const best = bestDeck('lodge', all);
    expect(deckProblems('lodge', best, all)).toEqual([]);
    expect(best).toContain('crazy-horse');
  });
  it('the saved, active deck is the deck you ride with; a broken save falls back to a legal deck', () => {
    const rich = { ...col, owned: { ...col.owned, 'crazy-horse': 1 } };
    const mine = [...starterDeck('lodge').slice(0, 29), 'crazy-horse'];
    const saved = saveDeck(rich, 'lodge', { id: 'd1', name: 'Horse', cards: mine });
    expect(saved.active.lodge).toBe('d1');
    expect(deckForMatch(saved, 'lodge')).toEqual(mine);
    const broken = saveDeck(col, 'lodge', { id: 'd2', name: 'Bad', cards: mine.slice(3) });
    expect(deckProblems('lodge', deckForMatch(broken, 'lodge'), broken.owned)).toEqual([]);
  });
});
