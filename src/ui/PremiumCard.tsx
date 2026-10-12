import { useEffect, useRef } from 'react';
import type { Card, FactionId } from '../game/types';
import { faction } from '../game/cards';
import { CardArt, KIND_LABEL } from './cardview';

/**
 * The card as a premium collectible: brass frame, rarity gem and border, embossed
 * name banner, cost and power medallions, parchment rules box, faction crest and a
 * foil sheen that follows the phone's tilt (pointer/drag on desktop).
 * Only CSS custom properties change per frame (transform + background position).
 */
const RARITY_LABEL: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', patron: 'Legend' };

const CREST: Record<FactionId, string> = {
  // gang: crossed revolvers
  gang: 'M6 26 L20 12 M20 12 l4 -2 l2 2 l-2 4 M26 26 L12 12 M12 12 l-4 -2 l-2 2 l2 4 M9 22 l3 3 M23 22 l-3 3',
  // choir: church bell
  choir: 'M16 5 v3 M10 22 c0 -9 1 -13 6 -13 s6 4 6 13 z M8 22 h16 M16 22 v3',
  // star: lawman badge
  star: 'M16 4 l3.5 7.5 8 1 -6 5.5 1.6 8 -7.1 -4 -7.1 4 1.6 -8 -6 -5.5 8 -1 z',
  // army: crossed sabres
  army: 'M6 6 L26 26 M26 6 L6 26 M4 9 l5 -5 M23 4 l5 5 M10 25 l-3 3 M22 25 l3 3',
  // grass: eagle feather
  grass: 'M22 4 C12 8 8 18 9 28 M22 4 C24 14 18 22 9 28 M13 20 l-4 -2 M15 15 l-4 -2 M17 10 l-3 -2',
  // lodge: thunderbolt
  lodge: 'M18 3 L9 17 h6 l-3 12 l11 -16 h-6 z',
};

export function FactionCrest({ id, className = '' }: { id: FactionId; className?: string }) {
  return (
    <svg className={`pc-crest ${className}`} viewBox="0 0 32 32" aria-label={faction(id).name} role="img">
      <circle cx="16" cy="16" r="15" className="pc-crest-disc" />
      <path d={CREST[id]} />
    </svg>
  );
}

function useFoilTilt(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let tx = 0.5;
    let ty = 0.35;
    const paint = () => {
      raf = 0;
      el.style.setProperty('--mx', `${(tx * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(ty * 100).toFixed(1)}%`);
      if (!reduced) {
        el.style.setProperty('--rx', `${((0.5 - ty) * 14).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${((tx - 0.5) * 16).toFixed(2)}deg`);
      }
    };
    const set = (x: number, y: number) => {
      tx = Math.max(0, Math.min(1, x));
      ty = Math.max(0, Math.min(1, y));
      if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    const onLeave = () => set(0.5, 0.35);
    // Phone tilt: gamma (left/right) and beta (front/back, ~45° is how a phone is held).
    let base: number | null = null;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      if (base == null) base = e.beta;
      set(0.5 + e.gamma / 50, 0.35 + (e.beta - base) / 50);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('deviceorientation', onTilt);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('deviceorientation', onTilt);
    };
  }, [ref]);
}

export function PremiumCard({ c, power }: { c: Card; power?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFoilTilt(ref);
  const f = faction(c.faction);
  const rarity = c.rarity ?? 'common';
  const hasPower = c.power != null && (c.kind === 'unit' || c.kind === 'leader');
  const live = power != null && hasPower && power !== c.power;
  return (
    <div className="pc-stage">
      <div ref={ref} className={`pc-card rarity-${rarity} kind-${c.kind}`} data-testid="premium-card" data-rarity={rarity}>
        <div className="pc-frame">
          <header className="pc-head">
            <span className="pc-medal pc-cost" title="Cost">
              <small>$</small>
              {c.cost}
            </span>
            <h2 className="pc-name">{c.name}</h2>
            <span className={`pc-gem gem-${rarity}`} title={RARITY_LABEL[rarity]} aria-label={`${RARITY_LABEL[rarity]} rarity`} />
          </header>
          <div className="pc-art">
            <CardArt c={c} alt={c.name} />
          </div>
          <div className="pc-type">
            <FactionCrest id={c.faction} />
            <span>
              {KIND_LABEL[c.kind] ?? c.kind}
              {c.mark ? ` — ${c.mark}` : ''}
            </span>
            <em>{f.short}</em>
          </div>
          <div className="pc-text">
            <p className="pc-rules">{c.text}</p>
            {c.lead && (
              <p className="pc-rules pc-lead">
                <strong>Lead · {c.lead.label}.</strong> {c.lead.text} Once a match.
              </p>
            )}
            {c.quote && (
              <p className="pc-flavor">
                “{c.quote}”{c.quoted && <span> — {c.quoted}</span>}
              </p>
            )}
          </div>
          <footer className="pc-foot">
            <span className="pc-set">
              Dust Hex · {RARITY_LABEL[rarity]} · {f.banner}
            </span>
            {hasPower && (
              <span className={`pc-medal pc-power${live ? (power! < c.power! ? ' is-hurt' : ' is-up') : ''}`} title="Power">
                <small>P</small>
                {live ? power : c.power}
              </span>
            )}
          </footer>
        </div>
        <div className="pc-foil" aria-hidden />
        <div className="pc-glare" aria-hidden />
      </div>
    </div>
  );
}
