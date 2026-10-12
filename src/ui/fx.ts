/**
 * Battlefield feel: clashes, deaths, landings, trails and the turn banner.
 * planFx is pure (tested); runFx paints short-lived DOM layers over the board
 * that animate only transform/opacity, then remove themselves.
 */
import type { GameEvent } from '../game/types';
import type { Box } from './coinMotion';
import { DEPLOY_MS, STRIKE_FIRST_MS } from './coinMotion';

export type Fx =
  | { k: 'clash'; attacker: string; target: string; dx: number; dy: number; x: number; y: number; ranged: boolean; delay: number }
  | { k: 'death'; uid: string; cardId: string; box: Box; delay: number }
  | { k: 'land'; x: number; y: number; w: number; delay: number }
  | { k: 'trail'; from: { x: number; y: number }; to: { x: number; y: number }; delay: number }
  | { k: 'shake'; hard: boolean; delay: number };

export const LUNGE_MS = 300;
export const DEATH_MS = 1000;
export const CLASH_GAP = 340;

const mid = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** What to show for one batch of events. prev/now are coin boxes (grid-relative) before/after the action. */
export function planFx(events: GameEvent[], prev: Map<string, Box>, now: Map<string, Box>, reduced = false): Fx[] {
  const out: Fx[] = [];
  let t = 0;
  let clashAt = 0;
  for (const e of events) {
    if (e.e === 'strike') {
      const a = prev.get(e.uid) ?? now.get(e.uid);
      const b = prev.get(e.target) ?? now.get(e.target);
      if (!a || !b) continue;
      const pa = mid(a);
      const pb = mid(b);
      clashAt = t;
      out.push({ k: 'clash', attacker: e.uid, target: e.target, dx: pb.x - pa.x, dy: pb.y - pa.y, x: e.ranged ? pb.x : (pa.x + pb.x) / 2, y: e.ranged ? pb.y : (pa.y + pb.y) / 2, ranged: e.ranged, delay: t });
      if (!reduced) out.push({ k: 'shake', hard: false, delay: t + LUNGE_MS * 0.4 });
      t += CLASH_GAP;
    } else if (e.e === 'death') {
      const b = prev.get(e.uid);
      if (!b) continue;
      out.push({ k: 'death', uid: e.uid, cardId: e.cardId, box: b, delay: clashAt + (out.some((f) => f.k === 'clash') ? LUNGE_MS * 0.5 : 0) });
      if (!reduced) out.push({ k: 'shake', hard: true, delay: clashAt + LUNGE_MS * 0.5 });
    } else if (e.e === 'move') {
      const a = prev.get(e.uid);
      const b = now.get(e.uid);
      if (a && b && !reduced) out.push({ k: 'trail', from: mid(a), to: mid(b), delay: events.some((x) => x.e === 'strike') ? STRIKE_FIRST_MS : 0 });
    } else if (e.e === 'deploy') {
      const b = now.get(e.uid);
      if (b) out.push({ k: 'land', ...mid(b), w: b.w, delay: reduced ? 0 : DEPLOY_MS - 40 });
    }
  }
  return out;
}

/** How long the AI and input should wait for these effects. */
export function fxMs(fx: Fx[]): number {
  let t = 0;
  for (const f of fx) t = Math.max(t, f.delay + (f.k === 'death' ? DEATH_MS : f.k === 'clash' ? LUNGE_MS + 120 : f.k === 'land' ? 420 : 300));
  return t;
}

function layer(grid: HTMLElement, cls: string, x: number, y: number, delay: number, life: number, html = '') {
  const el = document.createElement('div');
  el.className = `fx ${cls}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.animationDelay = `${delay}ms`;
  el.style.setProperty('--fx-delay', `${delay}ms`);
  el.innerHTML = html;
  grid.appendChild(el);
  // (e2e frame capture can pin layers with window.__fxKeep while it scrubs paused animations)
  window.setTimeout(() => { if (!(window as unknown as { __fxKeep?: boolean }).__fxKeep) el.remove(); }, delay + life + 60);
  return el;
}

const motes = (n: number, cls: string) =>
  Array.from({ length: n }, (_, i) => {
    const a = (360 / n) * i + Math.random() * 24;
    const d = 70 + Math.random() * 60;
    return `<i class="${cls}" style="--a:${a.toFixed(0)}deg;--d:${d.toFixed(0)}%;--s:${(3 + Math.random() * 4).toFixed(1)}px"></i>`;
  }).join('');

export function runFx(grid: HTMLElement, fx: Fx[], art: (cardId: string) => string, reduced: boolean, onClash?: (f: Fx & { k: 'clash' }) => void) {
  const socket = grid.closest('.bf-board-socket') as HTMLElement | null;
  for (const f of fx) {
    if (f.k === 'clash') {
      const a = grid.querySelector<HTMLElement>(`[data-uid="${f.attacker}"]`);
      const b = grid.querySelector<HTMLElement>(`[data-uid="${f.target}"]`);
      const len = Math.hypot(f.dx, f.dy) || 1;
      const ux = f.dx / len;
      const uy = f.dy / len;
      const reach = f.ranged ? 6 : Math.min(len * 0.42, 40);
      if (!reduced && a && typeof a.animate === 'function')
        a.animate(
          [
            { transform: 'translate(0,0) scale(1)' },
            { transform: `translate(${-ux * 6}px,${-uy * 6}px) scale(1.04)`, offset: 0.22 },
            { transform: `translate(${ux * reach}px,${uy * reach}px) scale(1.1)`, offset: 0.45 },
            { transform: `translate(${-ux * reach * 0.18}px,${-uy * reach * 0.18}px) scale(1)`, offset: 0.7 },
            { transform: 'translate(0,0) scale(1)' },
          ],
          { duration: LUNGE_MS + 80, delay: f.delay, easing: 'cubic-bezier(.3,.7,.3,1)' },
        );
      if (!reduced && b && typeof b.animate === 'function')
        b.animate(
          [
            { transform: 'translate(0,0) rotate(0)' },
            { transform: `translate(${ux * 9}px,${uy * 9}px) rotate(${ux >= 0 ? 6 : -6}deg)`, offset: 0.35 },
            { transform: `translate(${-ux * 2}px,${-uy * 2}px) rotate(-2deg)`, offset: 0.7 },
            { transform: 'translate(0,0) rotate(0)' },
          ],
          { duration: 300, delay: f.delay + LUNGE_MS * 0.42, easing: 'ease-out' },
        );
      layer(grid, `fx-clash${f.ranged ? ' is-ranged' : ''}`, f.x, f.y, f.delay + LUNGE_MS * 0.42, 520, `<b class="fx-flash"></b>${reduced ? '' : motes(9, 'fx-spark') + motes(6, 'fx-dust')}`);
      if (onClash) window.setTimeout(() => onClash(f), f.delay + LUNGE_MS * 0.4);
    } else if (f.k === 'death') {
      const src = art(f.cardId);
      const img = `<img src="${src}" alt="" draggable="false">`;
      const el = layer(
        grid,
        'fx-death',
        f.box.x + f.box.w / 2,
        f.box.y + f.box.h / 2,
        f.delay,
        DEATH_MS,
        `<span class="fx-half fx-half-l">${img}</span><span class="fx-half fx-half-r">${img}</span><svg class="fx-crack" viewBox="0 0 100 100"><polyline points="52,0 46,22 57,37 43,54 55,70 48,100"/></svg>${reduced ? '' : motes(14, 'fx-grit')}`,
      );
      el.style.width = `${f.box.w}px`;
      el.style.height = `${f.box.h}px`;
    } else if (f.k === 'land') {
      const el = layer(grid, 'fx-land', f.x, f.y, f.delay, 420, reduced ? '' : motes(8, 'fx-dust'));
      el.style.width = `${f.w * 1.5}px`;
      el.style.height = `${f.w * 1.5}px`;
    } else if (f.k === 'trail') {
      const dx = f.to.x - f.from.x;
      const dy = f.to.y - f.from.y;
      const el = layer(grid, 'fx-trail', f.from.x, f.from.y, f.delay, 600);
      el.style.width = `${Math.hypot(dx, dy)}px`;
      el.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    } else if (f.k === 'shake' && socket) {
      window.setTimeout(() => {
        socket.classList.remove('fx-shake', 'fx-shake-hard');
        void socket.offsetWidth;
        socket.classList.add('fx-shake');
        if (f.hard) socket.classList.add('fx-shake-hard');
        window.setTimeout(() => socket.classList.remove('fx-shake', 'fx-shake-hard'), 340);
      }, f.delay);
    }
  }
}
