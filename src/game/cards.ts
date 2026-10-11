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
  { id: 'lodge', name: 'The Thunder Lodge', short: 'Lodge', banner: 'Nations', tone: 'nation', line: 'Red Cloud and the spirit lodge. Not the bestiary.' },
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

/**
 * A 30-card deck: two copies of every character, one of every other card,
 * filled character-first and trimmed by cost so curves stay playable.
 */
export function buildDeck(f: FactionId, size = 30): string[] {
  const pool = factionPool(f);
  const chars = pool.filter((c) => c.kind === 'unit').sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  const other = pool.filter((c) => c.kind !== 'unit').sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  const out: string[] = [];
  // Characters fill about two thirds of the deck.
  const charSlots = Math.min(size - Math.min(other.length, Math.round(size / 3)), chars.length * 2);
  let i = 0;
  while (out.length < charSlots && chars.length) {
    const c = chars[i % chars.length];
    if (out.filter((x) => x === c.id).length < 2) out.push(c.id);
    i++;
    if (i > chars.length * 3) break;
  }
  for (const c of other) if (out.length < size) out.push(c.id);
  i = 0;
  while (out.length < size && chars.length) {
    out.push(chars[i % chars.length].id);
    i++;
  }
  return out;
}
