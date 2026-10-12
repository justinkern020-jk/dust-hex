import type { GameEvent, Side } from './types';
import { maybeCard } from './cards';

/** One trap reveal shown big on screen after a trap springs. */
export interface TrapReveal {
  key: string;
  /** Card whose art/text is shown (trap card, or the printed-map stand-in). */
  cardId: string | null;
  title: string;
  text: string;
  line: string;
  outcome: 'killed' | 'hurt' | 'spared';
  /** Whose unit walked into it. */
  victimSide?: Side;
}

/** Map-printed traps borrow the art of the matching trap card. */
const ART_FOR: Record<string, string> = { snake: 'shaft-viper', shaft: 'mine-shaft', pit: 'deadfall', deadfall: 'deadfall', sink: 'alkali', cavein: 'cave-in', hidebehind: 'hidebehind' };

const MAP_TRAP: Record<string, [string, string, string]> = {
  // title, rules text, verb
  snake: ['Rattlesnake', 'A rattler coiled in the brush. The first unit to step here is destroyed.', 'struck'],
  shaft: ['Mine Shaft', 'An old shaft under loose boards. The first unit to step here falls in and is destroyed.', 'swallowed'],
  pit: ['Deadfall Pit', 'A staked pit under brush. The first unit to step here is destroyed.', 'caught'],
  deadfall: ['Deadfall', 'A log rigged to drop. The first unit here loses 2 Power and cannot strike this turn.', 'dropped on'],
  sink: ['Alkali Sink', 'Soft alkali mud. The first unit here loses 3 Power and cannot move on its next turn.', 'bogged down'],
  cavein: ['Cave-In', 'Rotten timbers overhead. The first unit here is destroyed.', 'buried'],
  cinders: ['Hot Cinders', 'Live coals left on the trail. The unit that rides in loses 2 Power.', 'scorched'],
  hidebehind: ['Hidebehind', 'Something was waiting on that tile. It deals 3 and steps out.', 'jumped'],
  hellrail: ['Runaway Rail', 'A loose rail jumps the track and hits whatever stands here.', 'hit'],
};

export function trapReveals(events: GameEvent[], seq = 0): TrapReveal[] {
  const out: TrapReveal[] = [];
  events.forEach((e, i) => {
    if (e.e !== 'trap') return;
    const base = MAP_TRAP[e.kind] ?? ['Trap', 'A hidden trap.', 'caught'];
    const own = e.cardId ? maybeCard(e.cardId) : undefined;
    const artId = own?.id ?? ART_FOR[e.kind] ?? null;
    const title = own?.name ?? base[0];
    const text = own?.text ?? base[1];
    const later = events.slice(i + 1);
    const killed = !!e.uid && later.some((x) => x.e === 'death' && x.uid === e.uid);
    const hurt = !!e.uid && later.some((x) => x.e === 'damage' && x.uid === e.uid && x.n > 0);
    const outcome: TrapReveal['outcome'] = killed ? 'killed' : hurt ? 'hurt' : 'spared';
    const who = e.victimName ?? 'a unit';
    const line =
      outcome === 'killed'
        ? `${title} ${base[2]} ${who} — ${who} is down.`
        : outcome === 'hurt'
          ? `${title} ${base[2]} ${who} — wounded, but still standing.`
          : `${who} walked into the ${title} and lived to tell it.`;
    out.push({ key: `trap-${seq}-${i}`, cardId: artId && maybeCard(artId) ? artId : null, title, text, line, outcome, victimSide: e.victimSide });
  });
  return out;
}
