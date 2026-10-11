import { FACTIONS } from '../game/cards';
import { resolveMapId } from '../game/engine';
import type { FactionId } from '../game/types';
import type { Mind } from '../game/ai';
import type { BattleOpts } from './Battlefield';

export type Screen =
  | { s: 'title' }
  | { s: 'porch' }
  | { s: 'codex' }
  | { s: 'shop' }
  | { s: 'decks' }
  | { s: 'battle'; opts: BattleOpts; key: number };

/**
 * Where a fresh launch lands. A plain visit opens on the title card; deep links
 * (?codex, ?shop, ?decks, or ?side=gang&rival=lodge&map=gallows-mesa&mind=expert) skip it.
 * `dev` enables the testing aids (opening hand, money).
 */
export function launchScreen(search: string, dev = false, deckFor?: (side: FactionId) => BattleOpts['deck']): Screen {
  try {
    const q = new URLSearchParams(search);
    if (q.get('codex') != null) return { s: 'codex' };
    if (q.get('shop') != null) return { s: 'shop' };
    if (q.get('decks') != null) return { s: 'decks' };
    const side = q.get('side') as FactionId | null;
    if (side && FACTIONS.some((f) => f.id === side)) {
      const rival = (q.get('rival') as FactionId | null) ?? FACTIONS.find((f) => f.id !== side)!.id;
      const map = resolveMapId(q.get('map')) ?? 'gallows-mesa';
      const mind = (q.get('mind') as Mind | null) ?? 'expert';
      const deal = dev ? q.get('deal')?.split(',').filter(Boolean) : undefined;
      const money = dev && q.get('money') != null ? Number(q.get('money')) : undefined;
      return { s: 'battle', opts: { blue: side, red: rival, mapId: map, mind, deal, money, deck: deckFor?.(side) }, key: 1 };
    }
  } catch {
    /* ignore */
  }
  return { s: 'title' };
}
