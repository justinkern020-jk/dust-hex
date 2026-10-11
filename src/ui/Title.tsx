import { useCallback, useEffect, useRef, useState } from 'react';
import { version } from '../../package.json';
import { playMenuMusic, unlockAudio } from './sound';

/** Length of the dust wipe into the porch (ms). Kept in step with title.css. */
export const TITLE_WIPE_MS = 600;
const REDUCED_WIPE_MS = 220;

// Dust motes: a fixed scatter (no per-render randomness), drawn and animated by CSS.
const MOTES = Array.from({ length: 18 }, (_, i) => {
  const r = (n: number) => ((Math.sin((i + 1) * 9301 + n * 49297) * 233280) % 1 + 1) % 1;
  return {
    left: `${(r(1) * 100).toFixed(1)}%`,
    size: `${(1.5 + r(2) * 3).toFixed(1)}px`,
    dur: `${(11 + r(3) * 12).toFixed(1)}s`,
    delay: `${(-r(4) * 20).toFixed(1)}s`,
    drift: `${((r(5) - 0.5) * 18).toFixed(1)}vw`,
    ember: r(6) > 0.72,
  };
});

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Title({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);
  const root = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const ride = useCallback(() => {
    if (left.current) return;
    left.current = true;
    // The first gesture unlocks audio and starts the Dust Devil loop.
    unlockAudio();
    playMenuMusic();
    setLeaving(true);
    timer.current = window.setTimeout(onDone, reducedMotion() ? REDUCED_WIPE_MS : TITLE_WIPE_MS);
  }, [onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      ride();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ride]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Gentle pointer parallax on mouse screens (rAF-throttled; off for reduced motion).
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion() || !window.matchMedia?.('(pointer: fine)').matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty('--px', ((e.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
        el.style.setProperty('--py', ((e.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main
      ref={root}
      className={`dh-title${leaving ? ' is-leaving' : ''}`}
      data-testid="title-screen"
      data-leaving={leaving ? 'true' : undefined}
      onPointerDown={ride}
    >
      <div className="dh-title-art" aria-hidden>
        <picture>
          <source media="(orientation: portrait)" srcSet="/assets/titles/keyart-tall.webp" type="image/webp" />
          <source media="(orientation: portrait)" srcSet="/assets/titles/keyart-tall.jpg" />
          <source srcSet="/assets/titles/keyart-wide.webp" type="image/webp" />
          <img src="/assets/titles/keyart-wide.jpg" alt="" decoding="async" fetchPriority="high" />
        </picture>
      </div>
      <div className="dh-title-vignette" aria-hidden />
      <div className="dh-title-motes" aria-hidden>
        {MOTES.map((m, i) => (
          <span
            key={i}
            className={m.ember ? 'is-ember' : undefined}
            style={{ left: m.left, width: m.size, height: m.size, animationDuration: m.dur, animationDelay: m.delay, ['--drift' as string]: m.drift }}
          />
        ))}
      </div>

      <header className="dh-title-head">
        <p className="dh-title-presents">Kern presents</p>
        <h1 className="dh-logo" aria-label="Dust Hex">
          <span>Dust</span> <span>Hex</span>
        </h1>
        <p className="dh-title-sub">
          <span className="dh-title-star" aria-hidden>✦</span> A Frontier War on Six Sides <span className="dh-title-star" aria-hidden>✦</span>
        </p>
      </header>

      <button type="button" className="dh-title-prompt" data-testid="title-start" onClick={ride}>
        <span className="for-touch">Tap to Ride</span>
        <span className="for-keys">Press any key to ride</span>
      </button>

      <footer className="dh-title-foot">
        v{version} · © 2026 Kern · All rights reserved
      </footer>
      <div className="dh-title-wipe" aria-hidden />
    </main>
  );
}
