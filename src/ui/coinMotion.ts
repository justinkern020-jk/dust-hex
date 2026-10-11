/**
 * Coin motion: coins glide between tiles instead of snapping.
 * FLIP: after React has moved a coin to its new tile, measure where it was
 * and where it is, start it translated back to the old spot, and animate the
 * transform to zero. Layout never jumps; only transform and opacity animate.
 * The planning and keyframes are pure so they can be tested without a browser.
 */
import type { GameEvent } from '../game/types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Slide {
  uid: string;
  kind: 'move' | 'deploy';
  dx: number;
  dy: number;
  delay: number;
}

export const SLIDE_MS = 320;
export const DEPLOY_MS = 360;
export const STRIKE_FIRST_MS = 220;
export const FADE_MS = 160;

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * Which coins should glide, and from where (as an offset from where they now sit).
 * prev/now: coin boxes by unit id, relative to the board grid.
 * launch: where a deploy comes from for each new unit (hand card, drop point, stronghold).
 */
export function planSlides(prev: Map<string, Box>, now: Map<string, Box>, events: GameEvent[], launch: (uid: string) => Box | null): Slide[] {
  const out: Slide[] = [];
  const struck = new Set(events.filter((e) => e.e === 'strike').map((e) => (e as { uid: string }).uid));
  const killed = events.some((e) => e.e === 'death');
  for (const [uid, b] of now) {
    const p = prev.get(uid);
    if (p) {
      const a = centre(p);
      const z = centre(b);
      const dx = a.x - z.x;
      const dy = a.y - z.y;
      if (Math.hypot(dx, dy) < 2) continue;
      // A striker that advances into the tile it cleared waits for the blow to land.
      out.push({ uid, kind: 'move', dx, dy, delay: struck.has(uid) || (killed && struck.size > 0) ? STRIKE_FIRST_MS : 0 });
    } else {
      const from = launch(uid);
      if (!from) continue;
      const a = centre(from);
      const z = centre(b);
      out.push({ uid, kind: 'deploy', dx: a.x - z.x, dy: a.y - z.y, delay: 0 });
    }
  }
  return out;
}

/** Keyframes for one glide: lift off, travel, settle. Reduced motion gets a short fade in place. */
export function slideKeyframes(s: Pick<Slide, 'dx' | 'dy' | 'kind'>, reduced: boolean): Keyframe[] {
  if (reduced) return [{ opacity: 0 }, { opacity: 1 }];
  const t = (f: number, lift: number, scale: number) => `translate(${(s.dx * f).toFixed(1)}px, ${(s.dy * f - lift).toFixed(1)}px) scale(${scale})`;
  const shadow = (n: number) => `drop-shadow(0 ${n}px ${n * 1.6}px rgba(0,0,0,.55))`;
  return [
    { transform: t(1, 0, s.kind === 'deploy' ? 0.82 : 1), filter: shadow(2), opacity: s.kind === 'deploy' ? 0.6 : 1, offset: 0 },
    { transform: t(0.86, 7, 1.08), filter: shadow(12), opacity: 1, offset: 0.18 },
    { transform: t(0.06, 4, 1.05), filter: shadow(9), offset: 0.82 },
    { transform: 'translate(0px, 0px) scale(1)', filter: shadow(2), offset: 1 },
  ];
}

export function slideTiming(s: Pick<Slide, 'kind' | 'delay'>, reduced: boolean): KeyframeAnimationOptions {
  if (reduced) return { duration: FADE_MS, delay: s.delay ? 80 : 0, easing: 'ease-out', fill: 'backwards' };
  return { duration: s.kind === 'deploy' ? DEPLOY_MS : SLIDE_MS, delay: s.delay, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'backwards' };
}

/** How long input stays blocked for a set of slides. */
export function flightMs(slides: Slide[], reduced: boolean): number {
  let t = 0;
  for (const s of slides) {
    const o = slideTiming(s, reduced);
    t = Math.max(t, Number(o.duration) + Number(o.delay ?? 0));
  }
  return t;
}
