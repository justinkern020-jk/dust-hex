/**
 * Drag-and-drop from the hand, as pure functions so they can be tested
 * without a browser. The UI only measures the gesture and asks these.
 */
import type { Action, Match, Side } from './types';
import { card } from './cards';
import { canAfford, deployTiles, targetOptions } from './engine';
import { unitAt } from './core';

export type Gesture = 'pending' | 'drag' | 'scroll';

/**
 * Decide what a pointer movement means once it has travelled far enough.
 * Toward the board (up, even on a slant of about 27 degrees or more): the card is dragged.
 * Mostly sideways: the hand is scrolled.
 */
export function classifyGesture(dx: number, dy: number, threshold = 8): Gesture {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return 'pending';
  if (dy < 0 && ay >= ax * 0.5) return 'drag';
  return ay >= ax * 1.2 ? 'drag' : 'scroll';
}

/** A sideways mouse scroll that then heads well up toward the board becomes a drag. */
export function scrollTurnsToDrag(dy: number, rise = 48): boolean {
  return dy <= -rise;
}

export type HandSource = number | 'leader';

/** The action a card dropped on tile (r, c) stands for, or null if the drop does nothing. */
export function dropAction(m: Match, side: Side, src: HandSource, r: number, c: number): Action | null {
  if (m.winner || m.side !== side || m.pending.length) return null;
  const t = m.tiles[r]?.[c];
  if (!t || t.k === 'void') return null;
  if (src === 'leader') {
    if (m.leaderAt[side] !== 'tray') return null;
    return deployTiles(m, side, m.leader[side]).some(([rr, cc]) => rr === r && cc === c) ? { t: 'deploy', i: 'leader', r, c } : null;
  }
  const id = m.hand[side][src];
  if (!id) return null;
  const k = card(id);
  if (!canAfford(m, side, id)) return null;
  if (k.kind === 'unit' || k.kind === 'leader') {
    return deployTiles(m, side, id).some(([rr, cc]) => rr === r && cc === c) ? { t: 'deploy', i: src, r, c } : null;
  }
  if (k.target && k.target.kind !== 'none') {
    const u = unitAt(m, r, c);
    const hit = targetOptions(m, side, k.target, k.kind === 'rite').find((o) => !o.gid && !o.did && ((o.r === r && o.c === c) || (u && o.uid === u.uid)));
    return hit ? { t: 'play', i: src, target: hit } : null;
  }
  // Untargeted cards play when dropped anywhere on the ground.
  return { t: 'play', i: src };
}

/** Where the hand should scroll for a slider value 0..1000. */
export function sliderToScroll(value: number, scrollWidth: number, clientWidth: number): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  return Math.round((Math.min(1000, Math.max(0, value)) / 1000) * max);
}
export function scrollToSlider(scrollLeft: number, scrollWidth: number, clientWidth: number): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  return max ? Math.round((scrollLeft / max) * 1000) : 0;
}
/** Vertical wheel turns become horizontal hand scrolling. */
export function wheelToScroll(deltaX: number, deltaY: number, deltaMode = 0): number {
  const d = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  return deltaMode === 1 ? d * 40 : deltaMode === 2 ? d * 400 : d;
}
