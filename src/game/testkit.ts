/** Helpers for engine tests: a flat 5x5 field and quick unit placement. */
import { applyAction, newMatch } from './engine';
import { makeUnit, addGear } from './rules';
import type { Action, FactionId, Match, Side, Tile, Unit } from './types';
import { posOf } from './core';

/**
 * Flat field, blue home at the bottom.
 * row 0: s  g(r) S(r) g(r) s
 * rows 1-3: streets, with money tiles at (2,0) and (2,4)
 * row 4: s  g(b) S(b) g(b) s
 */
export function field(opts: { blue?: FactionId; red?: FactionId; seed?: number } = {}): Match {
  const m = newMatch({ mapId: 'twin-vaults', blue: opts.blue ?? 'star', red: opts.red ?? 'gang', seed: opts.seed ?? 7 });
  const t = (k: Tile['k'], home?: Side, sym?: 1 | 2): Tile => ({ k, ...(home ? { home } : {}), ...(sym ? { sym } : {}) });
  m.tiles = [
    [t('street'), t('gate', 'red'), t('stronghold', 'red'), t('gate', 'red'), t('street')],
    [t('street'), t('street'), t('street'), t('street'), t('street')],
    [t('resource', undefined, 1), t('street'), t('street'), t('street'), t('resource', undefined, 2)],
    [t('street'), t('street'), t('street'), t('street'), t('street')],
    [t('street'), t('gate', 'blue'), t('stronghold', 'blue'), t('gate', 'blue'), t('street')],
  ];
  m.control = m.tiles.map((row) => row.map((x) => x.home ?? null));
  m.traps = [];
  m.hand = { blue: [], red: [] };
  m.money = { blue: 14, red: 14 };
  m.deck = { blue: Array(20).fill('baca'), red: Array(20).fill('billy') };
  m.log = [];
  return m;
}

export function put(m: Match, cardId: string, side: Side, r: number, c: number, o: { power?: number; leader?: boolean; gear?: string[] } = {}): Unit {
  const u = makeUnit(m, cardId, side, { leader: o.leader, sick: false });
  u.enteredTurn = m.turn - 1;
  if (o.power != null) {
    u.power = o.power;
    u.maxPower = Math.max(u.maxPower, o.power);
  }
  m.units[u.uid] = u;
  m.board[r][c] = u.uid;
  if (u.leader) m.leaderAt[side] = 'board';
  for (const g of o.gear ?? []) addGear(m, u, g, side);
  return u;
}

export function run(m: Match, a: Action): Match {
  const res = applyAction(m, a);
  if (res.error) throw new Error(`${JSON.stringify(a)} -> ${res.error}`);
  return res.state;
}

export function tryRun(m: Match, a: Action) {
  return applyAction(m, a);
}

/** Answer every pending choice with the first option (or a key picked by `pick`). */
export function settle(m: Match, pick?: (keys: string[], prompt: string) => string | null): Match {
  let s = m;
  for (let i = 0; i < 20 && s.pending.length; i++) {
    const p = s.pending[0];
    const k = pick ? pick(p.options.map((o) => o.key), p.prompt) : p.options[0]?.key ?? null;
    s = k == null ? run(s, { t: 'skip' }) : run(s, { t: 'choose', key: k });
  }
  return s;
}

export function at(m: Match, uid: string) {
  return posOf(m, uid);
}

export function unit(m: Match, uid: string) {
  return m.units[uid];
}

export function handIndex(m: Match, side: Side, id: string) {
  const i = m.hand[side].indexOf(id);
  if (i < 0) throw new Error(`${id} not in hand`);
  return i;
}

/** Put a card in hand and play it. */
export function playCard(m: Match, side: Side, id: string, target?: Action extends never ? never : { uid?: string; r?: number; c?: number; gid?: string; did?: string }): Match {
  m.hand[side].push(id);
  return run(m, { t: 'play', i: m.hand[side].length - 1, target });
}

export function deployCard(m: Match, side: Side, id: string, r: number, c: number): Match {
  m.hand[side].push(id);
  return run(m, { t: 'deploy', i: m.hand[side].length - 1, r, c });
}

export function endTurn(m: Match) {
  return run(m, { t: 'end' });
}

export function uidAt(m: Match, r: number, c: number) {
  return m.board[r][c];
}
