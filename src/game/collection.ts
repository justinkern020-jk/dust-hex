/**
 * The card collection: starter decks, gold from matches, Trading Post packs and
 * singles, saved decks and deck rules. Pure functions over a plain JSON object,
 * so the same state can live in localStorage today and on an account later.
 */
import { FACTIONS, autoDeck, card, cardValue, factionPool, leaderOf, maxCopies, maybeCard } from './cards';
import type { Card, FactionId } from './types';
import type { Mind } from './ai';
import {
  DAILY_WIN_BONUS,
  DECK_SIZE,
  FILL_ODDS,
  LOSS_GOLD,
  LOSS_MIN_TURN,
  PACK_PRICE,
  PACK_SIZE,
  SINGLE_PRICE,
  SPARE_GOLD,
  TOP_ODDS,
  WIN_GOLD,
  type Rarity,
} from './economy';

export interface SavedDeck {
  id: string;
  name: string;
  cards: string[];
}

export interface Collection {
  v: 1;
  gold: number;
  /** Copies owned per card id. Leaders are always owned and never listed. */
  owned: Record<string, number>;
  decks: Partial<Record<FactionId, SavedDeck[]>>;
  /** The deck id each side rides with. */
  active: Partial<Record<FactionId, string>>;
  /** Sides whose starter deck has been granted. */
  starters: FactionId[];
  /** Local calendar day (YYYY-MM-DD) of the last first-win bonus. */
  bonusDay?: string;
  stats: { wins: number; losses: number; earned: number; packs: number };
  /** Id of the last match paid out, so a match never pays twice. */
  lastMatch?: string;
}

export const MAX_DECKS_PER_SIDE = 5;
export const STARTER_DECK_ID = 'starter';

export function emptyCollection(): Collection {
  return { v: 1, gold: 0, owned: {}, decks: {}, active: {}, starters: [], stats: { wins: 0, losses: 0, earned: 0, packs: 0 } };
}

/** Accept anything that looks like a saved collection; repair what is missing. */
export function normalizeCollection(raw: unknown): Collection {
  const base = emptyCollection();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Collection>;
  const owned: Record<string, number> = {};
  for (const [id, n] of Object.entries(r.owned ?? {})) {
    const c = maybeCard(id);
    if (c && c.kind !== 'leader' && Number.isFinite(n) && n > 0) owned[id] = Math.min(maxCopies(c), Math.floor(n));
  }
  const decks: Collection['decks'] = {};
  for (const f of FACTIONS) {
    const ds = (r.decks?.[f.id] ?? []).filter((d) => d && typeof d.id === 'string' && Array.isArray(d.cards));
    if (ds.length) decks[f.id] = ds.slice(0, MAX_DECKS_PER_SIDE).map((d) => ({ id: d.id, name: String(d.name || 'Deck').slice(0, 28), cards: d.cards.filter((x) => typeof x === 'string') }));
  }
  return {
    v: 1,
    gold: Math.max(0, Math.floor(Number(r.gold) || 0)),
    owned,
    decks,
    active: { ...(r.active ?? {}) },
    starters: (r.starters ?? []).filter((f) => FACTIONS.some((x) => x.id === f)),
    bonusDay: typeof r.bonusDay === 'string' ? r.bonusDay : undefined,
    lastMatch: typeof r.lastMatch === 'string' ? r.lastMatch : undefined,
    stats: { ...base.stats, ...(r.stats ?? {}) },
  };
}

// ------------------------------------------------------------------ deck rules

export function count(cards: string[]): Record<string, number> {
  const n: Record<string, number> = {};
  for (const id of cards) n[id] = (n[id] ?? 0) + 1;
  return n;
}

/** Problems with a deck, in plain words. Empty means it is legal. */
export function deckProblems(f: FactionId, cards: string[], owned?: Record<string, number>): string[] {
  const out: string[] = [];
  if (cards.length !== DECK_SIZE) out.push(cards.length < DECK_SIZE ? `Add ${DECK_SIZE - cards.length} more card${DECK_SIZE - cards.length === 1 ? '' : 's'} (a deck holds ${DECK_SIZE}).` : `Take out ${cards.length - DECK_SIZE} card${cards.length - DECK_SIZE === 1 ? '' : 's'} (a deck holds ${DECK_SIZE}).`);
  for (const [id, n] of Object.entries(count(cards))) {
    const c = maybeCard(id);
    if (!c) {
      out.push(`Unknown card ${id}.`);
      continue;
    }
    if (c.kind === 'leader') out.push(`${c.name} leads from the tray and cannot go in the deck.`);
    else if (c.faction !== f) out.push(`${c.name} rides for another side.`);
    else if (n > maxCopies(c)) out.push(`${c.name}: at most ${maxCopies(c)} ${maxCopies(c) === 1 ? 'copy (Legendary)' : 'copies'}.`);
    else if (owned && n > (owned[id] ?? 0)) out.push(`${c.name}: you own ${owned[id] ?? 0}.`);
  }
  return out;
}

export function canAdd(f: FactionId, cards: string[], id: string, owned: Record<string, number>): string | null {
  const c = maybeCard(id);
  if (!c || c.faction !== f || c.kind === 'leader') return 'Not for this side.';
  if (cards.length >= DECK_SIZE) return `The deck is full (${DECK_SIZE}).`;
  const have = cards.filter((x) => x === id).length;
  if (have >= maxCopies(c)) return maxCopies(c) === 1 ? 'Legendary: one copy per deck.' : 'Two copies is the limit.';
  if (have >= (owned[id] ?? 0)) return (owned[id] ?? 0) === 0 ? 'You do not own this card yet.' : `You own ${owned[id]}.`;
  return null;
}

/** The best legal deck your collection can make for a side. */
export function bestDeck(f: FactionId, owned: Record<string, number>): string[] {
  return autoDeck(f, { avail: owned, prefer: cardValue });
}

// ------------------------------------------------------------------ starter decks

/**
 * The starter deck: every Common and Uncommon the side has (characters twice,
 * the rest once), filled out with single Rares along the cost curve. The Rares
 * picked are the plainer ones, so the Trading Post still has plenty to sell.
 */
export function starterDeck(f: FactionId): string[] {
  const avail: Record<string, number> = {};
  for (const c of factionPool(f)) {
    if (c.rarity === 'patron') continue;
    avail[c.id] = c.rarity === 'rare' ? 1 : c.kind === 'unit' ? 2 : 1;
  }
  const plain = (c: Card) => (c.rarity === 'rare' ? -cardValue(c) : 100 - c.cost);
  return autoDeck(f, { avail, prefer: plain });
}

/** Grant the starter deck for every side not yet granted (first launch, or an upgrade). */
export function grantStarters(col: Collection, sides: FactionId[] = FACTIONS.map((x) => x.id)): Collection {
  let next = col;
  for (const f of sides) {
    if (next.starters.includes(f)) continue;
    const deck = starterDeck(f);
    const owned = { ...next.owned };
    for (const [id, n] of Object.entries(count(deck))) owned[id] = Math.min(maxCopies(card(id)), Math.max(owned[id] ?? 0, n));
    const decks = { ...next.decks };
    const mine = decks[f] ? [...decks[f]!] : [];
    if (!mine.some((d) => d.id === STARTER_DECK_ID)) mine.unshift({ id: STARTER_DECK_ID, name: 'Starter deck', cards: deck });
    decks[f] = mine.slice(0, MAX_DECKS_PER_SIDE);
    next = { ...next, owned, decks, active: { ...next.active, [f]: next.active[f] ?? STARTER_DECK_ID }, starters: [...next.starters, f] };
  }
  return next;
}

/** The deck you actually ride with: the active saved deck if it is legal, else your best legal deck. */
export function deckForMatch(col: Collection, f: FactionId): string[] {
  const ds = col.decks[f] ?? [];
  const d = ds.find((x) => x.id === col.active[f]) ?? ds[0];
  if (d && deckProblems(f, d.cards, col.owned).length === 0) return [...d.cards];
  const best = bestDeck(f, col.owned);
  return best.length === DECK_SIZE ? best : starterDeck(f);
}

export function activeDeck(col: Collection, f: FactionId): SavedDeck | undefined {
  const ds = col.decks[f] ?? [];
  return ds.find((x) => x.id === col.active[f]) ?? ds[0];
}

export function saveDeck(col: Collection, f: FactionId, deck: SavedDeck, makeActive = true): Collection {
  const ds = [...(col.decks[f] ?? [])];
  const i = ds.findIndex((d) => d.id === deck.id);
  if (i >= 0) ds[i] = { ...deck, cards: [...deck.cards] };
  else {
    if (ds.length >= MAX_DECKS_PER_SIDE) return col;
    ds.push({ ...deck, cards: [...deck.cards] });
  }
  return { ...col, decks: { ...col.decks, [f]: ds }, active: makeActive ? { ...col.active, [f]: deck.id } : col.active };
}

export function deleteDeck(col: Collection, f: FactionId, id: string): Collection {
  const ds = (col.decks[f] ?? []).filter((d) => d.id !== id);
  if (!ds.length) return col;
  const active = col.active[f] === id ? ds[0].id : col.active[f];
  return { ...col, decks: { ...col.decks, [f]: ds }, active: { ...col.active, [f]: active } };
}

// ------------------------------------------------------------------ gold

export interface MatchResult {
  won: boolean;
  mind: Mind;
  turn: number;
  winKind: 'claims' | 'stronghold' | 'yield' | null;
}

export interface GoldAward {
  total: number;
  parts: { label: string; n: number }[];
  daily: boolean;
}

export function localDay(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function matchGold(r: MatchResult, bonusDay: string | undefined, now: Date): GoldAward {
  const parts: { label: string; n: number }[] = [];
  let daily = false;
  if (r.won) {
    parts.push({ label: 'Victory', n: WIN_GOLD[r.mind] ?? WIN_GOLD.experienced });
    if (bonusDay !== localDay(now)) {
      parts.push({ label: 'First win of the day', n: DAILY_WIN_BONUS });
      daily = true;
    }
  } else if (!(r.winKind === 'yield' && r.turn < LOSS_MIN_TURN)) {
    parts.push({ label: 'Trail wages', n: LOSS_GOLD });
  }
  return { total: parts.reduce((s, p) => s + p.n, 0), parts, daily };
}

/** Pay out a finished match. The same match id pays only once. */
export function awardMatch(col: Collection, r: MatchResult, now = new Date(), matchId?: string): { col: Collection; award: GoldAward; repeat?: boolean } {
  if (matchId && col.lastMatch === matchId) return { col, award: { total: 0, parts: [], daily: false }, repeat: true };
  const award = matchGold(r, col.bonusDay, now);
  return {
    award,
    col: {
      ...col,
      lastMatch: matchId ?? col.lastMatch,
      gold: col.gold + award.total,
      bonusDay: award.daily ? localDay(now) : col.bonusDay,
      stats: { ...col.stats, wins: col.stats.wins + (r.won ? 1 : 0), losses: col.stats.losses + (r.won ? 0 : 1), earned: col.stats.earned + award.total },
    },
  };
}

// ------------------------------------------------------------------ the Trading Post

export function priceOf(c: Card): number {
  return SINGLE_PRICE[c.rarity];
}

/** Cards the Trading Post sells for a side (everything but the leader). */
export function shopPool(f: FactionId): Card[] {
  return factionPool(f);
}

export function buySingle(col: Collection, id: string): { col: Collection } | { error: string } {
  const c = maybeCard(id);
  if (!c || c.kind === 'leader') return { error: 'That card is not for sale.' };
  const have = col.owned[id] ?? 0;
  if (have >= maxCopies(c)) return { error: `You already have ${have}, the most a deck can use.` };
  const price = priceOf(c);
  if (col.gold < price) return { error: `You need ${price - col.gold} more gold.` };
  return { col: { ...col, gold: col.gold - price, owned: { ...col.owned, [id]: have + 1 } } };
}

export interface PackPull {
  id: string;
  rarity: Rarity;
  /** Already at the limit: traded back for gold. */
  spare: boolean;
  gold: number;
  isNew: boolean;
}

function roll(odds: [Rarity, number][], rng: () => number): Rarity {
  let x = rng();
  for (const [r, p] of odds) {
    if (x < p) return r;
    x -= p;
  }
  return odds[odds.length - 1][0];
}

const STEP_DOWN: Record<Rarity, Rarity[]> = {
  patron: ['patron', 'rare', 'uncommon', 'common'],
  rare: ['rare', 'uncommon', 'patron', 'common'],
  uncommon: ['uncommon', 'common', 'rare', 'patron'],
  common: ['common', 'uncommon', 'rare', 'patron'],
};

/**
 * One pull of a rolled rarity. A side with no cards of that rarity steps to the
 * nearest rarity it has. Cards you can still use always come first: when every
 * card of the rolled rarity is at the limit, the pull moves to the nearest rarity
 * you still need. Only a complete side turns up spares (traded for gold).
 */
function pullOne(f: FactionId, want: Rarity, owned: Record<string, number>, rng: () => number): PackPull {
  const pool = shopPool(f);
  let rarity = want;
  let tier: Card[] = [];
  for (const r of STEP_DOWN[want]) {
    tier = pool.filter((c) => c.rarity === r);
    if (tier.length) {
      rarity = r;
      break;
    }
  }
  let open = tier.filter((c) => (owned[c.id] ?? 0) < maxCopies(c));
  // Every card of that rarity at the limit: give the nearest rarity you still need.
  if (!open.length)
    for (const r of STEP_DOWN[want]) {
      const need = pool.filter((c) => c.rarity === r && (owned[c.id] ?? 0) < maxCopies(c));
      if (need.length) {
        rarity = r;
        tier = pool.filter((c) => c.rarity === r);
        open = need;
        break;
      }
    }
  const from = open.length ? open : tier;
  const c = from[Math.floor(rng() * from.length) % from.length];
  const spare = (owned[c.id] ?? 0) >= maxCopies(c);
  return { id: c.id, rarity, spare, gold: spare ? SPARE_GOLD[rarity] : 0, isNew: (owned[c.id] ?? 0) === 0 };
}

export function openPack(f: FactionId, owned: Record<string, number>, rng: () => number = Math.random): { pulls: PackPull[]; owned: Record<string, number>; gold: number } {
  const next = { ...owned };
  const pulls: PackPull[] = [];
  let gold = 0;
  for (let i = 0; i < PACK_SIZE; i++) {
    const p = pullOne(f, roll(i === PACK_SIZE - 1 ? TOP_ODDS : FILL_ODDS, rng), next, rng);
    if (!p.spare) next[p.id] = (next[p.id] ?? 0) + 1;
    gold += p.gold;
    pulls.push(p);
  }
  return { pulls, owned: next, gold };
}

export function buyPack(col: Collection, f: FactionId, rng: () => number = Math.random): { col: Collection; pulls: PackPull[]; refund: number } | { error: string } {
  if (col.gold < PACK_PRICE) return { error: `You need ${PACK_PRICE - col.gold} more gold.` };
  const r = openPack(f, col.owned, rng);
  return {
    pulls: r.pulls,
    refund: r.gold,
    col: { ...col, gold: col.gold - PACK_PRICE + r.gold, owned: r.owned, stats: { ...col.stats, packs: col.stats.packs + 1 } },
  };
}

/** Owned vs the full set (every card at the deck limit) for one side. */
export function sideProgress(col: Collection, f: FactionId): { have: number; full: number; missingGold: number } {
  let have = 0;
  let full = 0;
  let missingGold = 0;
  for (const c of shopPool(f)) {
    const m = maxCopies(c);
    const h = Math.min(m, col.owned[c.id] ?? 0);
    have += h;
    full += m;
    missingGold += (m - h) * priceOf(c);
  }
  return { have, full, missingGold };
}

export function leaderFor(f: FactionId): Card {
  return leaderOf(f);
}
