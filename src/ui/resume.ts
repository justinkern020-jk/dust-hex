/**
 * Match safety net. The live match is saved after every step, so if the page
 * reloads mid-match (Android tab crash / memory kill, pull-to-refresh, app
 * switch) or a render error is caught, the player lands back in the same match
 * instead of on the title card.
 */
import type { Match } from '../game/types';
import type { BattleOpts } from './Battlefield';

export const LIVE_KEY = 'dusthex.liveMatch.v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface SavedMatch {
  opts: BattleOpts;
  m: Match;
  at: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export function saveLive(opts: BattleOpts, m: Match, s: Store | null = store(), now = Date.now()) {
  if (!s) return;
  try {
    if (m.winner) s.removeItem(LIVE_KEY);
    // Events are per-step animation hints; never replay them on resume.
    else s.setItem(LIVE_KEY, JSON.stringify({ opts: { ...opts, deal: undefined, money: undefined }, m: { ...m, events: [] }, at: now }));
  } catch {
    /* quota / private mode: no safety net, game still runs */
  }
}

export function loadLive(s: Store | null = store(), now = Date.now()): SavedMatch | null {
  if (!s) return null;
  try {
    const raw = s.getItem(LIVE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedMatch;
    if (!v?.m || !v.opts || v.m.winner || now - v.at > MAX_AGE_MS || !Array.isArray(v.m.board)) {
      s.removeItem(LIVE_KEY);
      return null;
    }
    return v;
  } catch {
    s.removeItem(LIVE_KEY);
    return null;
  }
}

export function clearLive(s: Store | null = store()) {
  try {
    s?.removeItem(LIVE_KEY);
  } catch {
    /* ignore */
  }
}
