import { useEffect, useState } from 'react';
import { FACTIONS } from './game/cards';
import { MAPS, resolveMapId } from './game/engine';
import type { FactionId } from './game/types';
import type { Mind } from './game/ai';
import { Porch } from './ui/Porch';
import { Codex } from './ui/Codex';
import { Battlefield, type BattleOpts } from './ui/Battlefield';
import { playMusic } from './ui/sound';

type Screen = { s: 'porch' } | { s: 'codex' } | { s: 'battle'; opts: BattleOpts; key: number };
const MIND_KEY = 'dusthex.mind';

function initialScreen(): Screen {
  // Deep links for testing and sharing: ?side=gang&rival=lodge&map=gallows-mesa&mind=expert
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('codex') != null) return { s: 'codex' };
    const side = q.get('side') as FactionId | null;
    if (side && FACTIONS.some((f) => f.id === side)) {
      const rival = (q.get('rival') as FactionId | null) ?? FACTIONS.find((f) => f.id !== side)!.id;
      const map = resolveMapId(q.get('map')) ?? 'gallows-mesa';
      const mind = (q.get('mind') as Mind | null) ?? 'expert';
      // Testing aids (opening hand, money) exist only in dev builds.
      const dev = import.meta.env.DEV;
      const deal = dev ? q.get('deal')?.split(',').filter(Boolean) : undefined;
      const money = dev && q.get('money') != null ? Number(q.get('money')) : undefined;
      return { s: 'battle', opts: { blue: side, red: rival, mapId: map, mind, deal, money }, key: 1 };
    }
  } catch {
    /* ignore */
  }
  return { s: 'porch' };
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [mind, setMindState] = useState<Mind>(() => {
    try {
      const v = localStorage.getItem(MIND_KEY) as Mind | null;
      return v === 'easy' || v === 'experienced' || v === 'expert' ? v : 'expert';
    } catch {
      return 'expert';
    }
  });
  const setMind = (x: Mind) => {
    setMindState(x);
    try {
      localStorage.setItem(MIND_KEY, x);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    document.body.dataset.screen = screen.s;
    if (screen.s === 'porch') {
      const start = () => playMusic('frontier-horn');
      window.addEventListener('pointerdown', start, { once: true });
      return () => window.removeEventListener('pointerdown', start);
    }
  }, [screen.s]);

  if (screen.s === 'codex') return <Codex onBack={() => setScreen({ s: 'porch' })} />;
  if (screen.s === 'battle')
    return <Battlefield key={screen.key} opts={screen.opts} onLeave={() => setScreen({ s: 'porch' })} />;
  return (
    <Porch
      mind={mind}
      setMind={setMind}
      onCodex={() => setScreen({ s: 'codex' })}
      onRide={(f) => {
        const rivals = FACTIONS.filter((x) => x.id !== f);
        const red = rivals[Math.floor(Math.random() * rivals.length)].id;
        const firsts = MAPS.filter((x) => x.era === 'first');
        const mapId = firsts[Math.floor(Math.random() * firsts.length)].id;
        setScreen({ s: 'battle', opts: { blue: f, red, mind, mapId }, key: Date.now() });
      }}
    />
  );
}
