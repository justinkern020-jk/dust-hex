import { useEffect, useRef, useState } from 'react';
import { FACTIONS } from './game/cards';
import { MAPS } from './game/engine';
import type { Mind } from './game/ai';
import { Porch } from './ui/Porch';
import { Title } from './ui/Title';
import { launchScreen, type Screen } from './ui/launch';
import { Codex } from './ui/Codex';
import { Battlefield } from './ui/Battlefield';
import { playMenuMusic, preloadMenuAudio, unlockAudio } from './ui/sound';

const MIND_KEY = 'dusthex.mind';

export function App() {
  const [screen, setScreen] = useState<Screen>(() => launchScreen(window.location.search, import.meta.env.DEV));
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
    // Menus (title, porch, codex) play the Dust Devil loop; a match fades it out itself.
    if (screen.s !== 'battle') playMenuMusic();
  }, [screen.s]);
  // Browsers only allow audio after a user gesture: unlock on the first one.
  const screenRef = useRef(screen.s);
  screenRef.current = screen.s;
  useEffect(() => {
    preloadMenuAudio();
    const kinds = ['pointerdown', 'keydown', 'touchend', 'click'] as const;
    const unlock = () => {
      unlockAudio();
      if (screenRef.current !== 'battle') playMenuMusic();
      for (const k of kinds) window.removeEventListener(k, unlock, true);
    };
    for (const k of kinds) window.addEventListener(k, unlock, true);
    return () => {
      for (const k of kinds) window.removeEventListener(k, unlock, true);
    };
  }, []);

  // The title card shows once per fresh launch; leaving a match returns to the porch.
  if (screen.s === 'title') return <Title onDone={() => setScreen({ s: 'porch' })} />;
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
