import raw from '../data/cards.json';
import type { Card, FactionId } from './types';

export const CARDS: Card[] = raw as Card[];
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function card(id: string): Card {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`Unknown card ${id}`);
  return c;
}

export function maybeCard(id: string): Card | undefined {
  return BY_ID.get(id);
}

export const FACTIONS: { id: FactionId; name: string; short: string; banner: string; tone: string; line: string }[] = [
  { id: 'gang', name: 'The Red Creek Gang', short: 'Gang', banner: 'Outlaws', tone: 'outlaw', line: 'Jesse James and the riders the law already buried.' },
  { id: 'choir', name: 'The Gallows Choir', short: 'Choir', banner: 'Outlaws', tone: 'outlaw', line: 'The night church. Widows, shades, and songs that do not stay dead.' },
  { id: 'star', name: 'The Silver Star', short: 'Star', banner: 'Lawmen', tone: 'law', line: 'Bass Reeves and the warrants that still work after dark.' },
  { id: 'army', name: 'The Department of the West', short: 'Army', banner: 'The army', tone: 'army', line: 'Crook’s column. Cavalry, rail guns, and the machines.' },
  { id: 'grass', name: 'The High Grass Nation', short: 'Grass', banner: 'Nations', tone: 'nation', line: 'Sitting Bull and the riders of the grass.' },
  { id: 'lodge', name: 'The Thunder Lodge', short: 'Lodge', banner: 'Nations', tone: 'nation', line: 'Red Cloud’s warriors and the storm on the plains.' },
];

export function faction(id: FactionId) {
  return FACTIONS.find((f) => f.id === id)!;
}

export function leaderOf(f: FactionId): Card {
  const c = CARDS.find((x) => x.faction === f && x.kind === 'leader');
  if (!c) throw new Error(`No leader for ${f}`);
  return c;
}

export function factionPool(f: FactionId): Card[] {
  return CARDS.filter((c) => c.faction === f && c.kind !== 'leader');
}

export function isCharacter(c: Card): boolean {
  return c.kind === 'unit' || c.kind === 'leader';
}

/** Outlaw banner: Gang and Choir. */
export function isOutlaw(c: Card): boolean {
  return c.faction === 'gang' || c.faction === 'choir';
}

/** Most copies of a card one deck may hold: one for Patron (legendary) cards, two otherwise. */
export function maxCopies(c: Card): number {
  return c.rarity === 'patron' ? 1 : 2;
}

const RARITY_RANK: Record<Card['rarity'], number> = { common: 0, uncommon: 1, rare: 2, patron: 3 };

/** A rough strength score for picking the best cards from a collection. */
export function cardValue(c: Card): number {
  let v = RARITY_RANK[c.rarity] * 1.5 + (c.ab?.length ?? 0) * 0.5 ;
  if (c.kind === 'unit') v += (c.power ?? 0) - c.cost * 0.75 + c.kw.length * 0.3;
  return v;
}

export interface DeckBuildOpts {
  size?: number;
  /** With an rng the order inside each cost band is shuffled, so every card can show up. */
  rng?: () => number;
  /** Copies available per card id (a collection). Defaults to the deck limit for every card. */
  avail?: Record<string, number>;
  /** Higher goes in first. When set, the best cards go in two at a time. */
  prefer?: (c: Card) => number;
}

/** Character share of each cost band: cheap (1-2), middle (3), heavy (4+). */
const CURVE: { test: (cost: number) => boolean; share: number }[] = [
  { test: (x) => x <= 2, share: 0.4 },
  { test: (x) => x === 3, share: 0.35 },
  { test: (x) => x >= 4, share: 0.25 },
];

/**
 * Build a deck from a faction pool along a cost curve: about two thirds
 * characters spread across cheap, middle and heavy costs, the rest tricks,
 * items, devices and traps. Without `prefer` it spreads one copy of each card
 * before doubling up, so the whole pool gets a turn.
 */
export function autoDeck(f: FactionId, o: DeckBuildOpts = {}): string[] {
  const size = o.size ?? 30;
  const pool = factionPool(f);
  const left = new Map<string, number>();
  for (const c of pool) left.set(c.id, Math.max(0, Math.min(maxCopies(c), o.avail ? (o.avail[c.id] ?? 0) : maxCopies(c))));
  const order = (cs: Card[]) => {
    const a = [...cs].sort((x, y) => (o.prefer ? o.prefer(y) - o.prefer(x) : 0) || x.cost - y.cost || x.id.localeCompare(y.id));
    if (o.rng && !o.prefer)
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(o.rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
    return a;
  };
  const out: string[] = [];
  const take = (cs: Card[], n: number) => {
    let got = 0;
    if (o.prefer) {
      for (const c of order(cs))
        while (got < n && (left.get(c.id) ?? 0) > 0) {
          out.push(c.id);
          left.set(c.id, left.get(c.id)! - 1);
          got++;
        }
      return got;
    }
    const a = order(cs);
    for (let round = 0; round < 2 && got < n; round++)
      for (const c of a) {
        if (got >= n) break;
        if ((left.get(c.id) ?? 0) > 0) {
          out.push(c.id);
          left.set(c.id, left.get(c.id)! - 1);
          got++;
        }
      }
    return got;
  };
  const copies = (cs: Card[]) => cs.reduce((s, c) => s + (left.get(c.id) ?? 0), 0);
  const units = pool.filter((c) => c.kind === 'unit');
  const other = pool.filter((c) => c.kind !== 'unit');
  const otherSlots = Math.min(copies(other), size - Math.min(copies(units), Math.round((size * 2) / 3)));
  const unitSlots = Math.min(copies(units), size - otherSlots);
  let placed = 0;
  CURVE.forEach((band, i) => {
    const want = i === CURVE.length - 1 ? unitSlots - placed : Math.round(unitSlots * band.share);
    placed += take(units.filter((c) => band.test(c.cost)), Math.max(0, want));
  });
  // A thin band spills into the rest of the curve, nearest the middle first.
  if (placed < unitSlots) {
    const byMid = [...units].sort((a, b) => Math.abs(a.cost - 3) - Math.abs(b.cost - 3));
    placed += take(byMid, unitSlots - placed);
  }
  take(other, size - out.length);
  if (out.length < size) take(pool, size - out.length);
  return out;
}

/**
 * The rival's (and the default) 30-card deck from the full faction pool. Pass an
 * rng for a fresh mix every match; without one the deck is fixed.
 */
export function buildDeck(f: FactionId, size = 30, rng?: () => number): string[] {
  return autoDeck(f, { size, rng });
}
