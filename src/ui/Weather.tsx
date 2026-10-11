import { useEffect, useRef } from 'react';

export const WEATHERS = ['rain', 'fog', 'moonlight', 'snow', 'dusk', 'clear'] as const;
export type Weather = (typeof WEATHERS)[number];
const LABEL: Record<Weather, string> = { rain: 'Rain', fog: 'Fog', moonlight: 'Moonlight', snow: 'Snow', dusk: 'Dusk', clear: 'Clear night' };

export function pickWeather(): Weather {
  try {
    const q = import.meta.env.DEV ? (new URLSearchParams(window.location.search).get('weather') as Weather | null) : null;
    if (q && WEATHERS.includes(q)) return q;
  } catch {
    /* ignore */
  }
  return WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
}

export function WeatherLayer({ kind }: { kind: Weather }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (kind !== 'rain' && kind !== 'snow') return;
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 1;
    let h = 1;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const size = () => {
      const r = cv.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
    ro?.observe(cv);
    const n = kind === 'rain' ? 120 : 80;
    const ps = Array.from({ length: n }, () => ({
      x: Math.random(),
      y: Math.random(),
      v: kind === 'rain' ? 0.9 + Math.random() * 0.6 : 0.05 + Math.random() * 0.08,
      l: kind === 'rain' ? 8 + Math.random() * 12 : 0.8 + Math.random() * 1.8,
      r: Math.random() * Math.PI * 2,
      d: 0.3 + Math.random() * 0.7,
    }));
    const paint = (dt: number) => {
      ctx.clearRect(0, 0, w, h);
      if (kind === 'rain') {
        ctx.strokeStyle = 'rgba(200, 216, 230, 0.5)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (const p of ps) {
          p.y += (p.v * dt) / 1000;
          p.x += (0.12 * p.v * dt) / 1000;
          if (p.y > 1.05) {
            p.y = -0.05;
            p.x = Math.random();
          }
          if (p.x > 1.02) p.x -= 1.04;
          ctx.moveTo(p.x * w, p.y * h);
          ctx.lineTo(p.x * w - p.l * 0.12, p.y * h - p.l);
        }
        ctx.stroke();
      } else {
        for (const p of ps) {
          p.y += (p.v * dt) / 1000;
          p.r += dt / 1400;
          if (p.y > 1.03) {
            p.y = -0.03;
            p.x = Math.random();
          }
          ctx.fillStyle = `rgba(235, 240, 245, ${0.35 + p.d * 0.45})`;
          ctx.beginPath();
          ctx.arc((p.x + Math.sin(p.r) * 0.012) * w, p.y * h, p.l * p.d + 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    if (reduce) {
      paint(0);
      return () => ro?.disconnect();
    }
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      if (!document.hidden) paint(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [kind]);
  return (
    <div className={`wx-layer wx-${kind}`} aria-hidden data-testid="weather-layer" data-weather={kind}>
      <div className="wx-wash" />
      {kind === 'fog' && (
        <>
          <div className="wx-fog wx-fog-a" />
          <div className="wx-fog wx-fog-b" />
        </>
      )}
      {kind === 'moonlight' && <div className="wx-moonbeam" />}
      {(kind === 'rain' || kind === 'snow') && <canvas ref={ref} className="wx-canvas" />}
      <span className="wx-tag">{LABEL[kind]}</span>
    </div>
  );
}
