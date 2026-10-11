/** Small helpers over a Match. No rules live here, only lookups and bookkeeping. */
import { card } from './cards';
import { nextRand } from './rng';
import type { Ability, Match, Pending, Side, Tile, Trap, Unit, TileDevice } from './types';

export const MONEY_CAP = 14;
export const HAND_CAP = 7;
export const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');
export const sideName = (s: Side) => (s === 'blue' ? 'You' : 'The rival');

export function log(m: Match, s: string) {
  m.log.push(s);
  if (m.log.length > 400) m.log.splice(0, m.log.length - 400);
}

export function rand(m: Match): number {
  const [v, seed] = nextRand(m.seed);
  m.seed = seed;
  return v;
}

export function pick<T>(m: Match, xs: T[]): T | undefined {
  if (!xs.length) return undefined;
  return xs[Math.floor(rand(m) * xs.length)];
}

export function inBounds(m: Match, r: number, c: number) {
  return r >= 0 && c >= 0 && r < m.h && c < m.w;
}

export function tileAt(m: Match, r: number, c: number): Tile | undefined {
  return m.tiles[r]?.[c];
}

export function isVoid(m: Match, r: number, c: number) {
  const t = tileAt(m, r, c);
  return !t || t.k === 'void';
}

export function heightAt(m: Match, r: number, c: number) {
  return tileAt(m, r, c)?.h ?? 0;
}

export function posOf(m: Match, uid: string): { r: number; c: number } | null {
  for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) if (m.board[r][c] === uid) return { r, c };
  return null;
}

export function unitAt(m: Match, r: number, c: number): Unit | undefined {
  const id = m.board[r]?.[c];
  return id ? m.units[id] : undefined;
}

export function neighbors(m: Match, r: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dr, dc] of DIRS) {
    const rr = r + dr;
    const cc = c + dc;
    if (inBounds(m, rr, cc) && !isVoid(m, rr, cc)) out.push([rr, cc]);
  }
  return out;
}

export function adjacentUnits(m: Match, r: number, c: number): Unit[] {
  const out: Unit[] = [];
  for (const [rr, cc] of neighbors(m, r, c)) {
    const u = unitAt(m, rr, cc);
    if (u) out.push(u);
  }
  return out;
}

export function dist(a: { r: number; c: number }, b: { r: number; c: number }) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

export function hasKw(u: Unit, k: string) {
  return u.kw.includes(k);
}

export function abilitiesOf(cardId: string): Ability[] {
  return card(cardId).ab ?? [];
}

export function hasStatic(u: Unit, op: string) {
  return abilitiesOf(u.cardId).some((a) => a.on === 'static' && a.op === op);
}

export function unitsOf(m: Match, side: Side): Unit[] {
  return Object.values(m.units).filter((u) => u.side === side);
}

export function nameOf(u: Unit) {
  return card(u.cardId).name;
}

/** The turn number of `side`'s next turn (its current one counts as already started). */
export function nextTurnOf(m: Match, side: Side) {
  return m.side === side ? m.turn + 2 : m.turn + 1;
}

export function draw(m: Match, side: Side, n: number) {
  for (let i = 0; i < n; i++) {
    if (m.hand[side].length >= HAND_CAP) {
      log(m, `${sideName(side)}: hand is full.`);
      return;
    }
    const id = m.deck[side].shift();
    if (!id) {
      log(m, `${sideName(side)}: the deck is dry.`);
      return;
    }
    m.hand[side].push(id);
  }
}

export function bank(m: Match, side: Side, n: number) {
  m.money[side] = Math.min(MONEY_CAP, m.money[side] + n);
}

export function loseMoney(m: Match, side: Side, n: number) {
  const lost = Math.min(n, m.money[side]);
  m.money[side] -= lost;
  return lost;
}

export function pushPending(m: Match, p: Omit<Pending, 'optional' | 'data'> & Partial<Pick<Pending, 'optional' | 'data'>>) {
  if (!p.options.length) return;
  m.pending.push({ optional: false, data: {}, ...p });
}

export function isPaintable(t: Tile | undefined) {
  return !!t && (t.k === 'street' || t.k === 'gate' || t.k === 'resource');
}

export function strongholdOf(m: Match, side: Side): { r: number; c: number } | null {
  for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) {
    const t = m.tiles[r][c];
    if (t.k === 'stronghold' && t.home === side) return { r, c };
  }
  return null;
}

/** True when (r,c) lies on `side`'s half of the field (closer to its own stronghold). */
export function onHalf(m: Match, side: Side, r: number, c: number) {
  const mine = strongholdOf(m, side);
  const theirs = strongholdOf(m, other(side));
  if (!mine || !theirs) return false;
  return dist({ r, c }, mine) < dist({ r, c }, theirs);
}

export function canDeployOn(m: Match, side: Side, r: number, c: number) {
  const t = tileAt(m, r, c);
  if (!t || t.k === 'void') return false;
  if (t.k === 'stronghold') return t.home === side;
  if (t.k === 'gate') return m.control[r][c] === side;
  return false;
}

export function trapAt(m: Match, r: number, c: number): Trap | undefined {
  return m.traps.find((t) => t.r === r && t.c === c);
}

export function tileDeviceAt(m: Match, r: number, c: number): TileDevice | undefined {
  return m.tileDevices.find((d) => d.r === r && d.c === c);
}

/** Empty: on the field, no unit, no trap, no placed device. */
export function isEmptyTile(m: Match, r: number, c: number) {
  return !isVoid(m, r, c) && !m.board[r][c] && !trapAt(m, r, c) && !tileDeviceAt(m, r, c);
}

export function allTiles(m: Match): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) if (!isVoid(m, r, c)) out.push([r, c]);
  return out;
}

export function key(r: number, c: number) {
  return `${r},${c}`;
}

export function leaderUnit(m: Match, side: Side): Unit | undefined {
  return Object.values(m.units).find((u) => u.side === side && u.leader);
}

export function countOnBoard(m: Match, side: Side, op: string) {
  return unitsOf(m, side).filter((u) => hasStatic(u, op)).length;
}
