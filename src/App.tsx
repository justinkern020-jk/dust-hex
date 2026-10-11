import { useEffect, useRef, useState } from 'react';
import { FACTIONS } from './game/cards';
import { MAPS } from './game/engine';
import type { Mind } from './game/ai';
import { Porch } from './ui/Porch';
import { Title } from './ui/Title';
import { launchScreen, type Screen } from './ui/launch';
import { Codex } from './ui/Codex';
import { Battlefield } from './ui/Battlefield';
import { TradingPost } from './ui/TradingPost';
import { DeckEditor } from './ui/DeckEditor';
import { loadCollection, saveCollection } from './ui/collectionStore';
import { awardMatch, deckForMatch, type Collection, type GoldAward, type MatchResult } from './game/collection';
import type { FactionId } from './game/types';
import { playMenuMusic, preloadMenuAudio, unlockAudio } from './ui/sound';

const MIND_KEY = 'dusthex.mind';

export function App() {
  // The card collection (localStorage for now; see collectionStore).
  const [col, setColState] = useState<Collection>(() => loadCollection());
  const colRef = useRef(col);
  const setCol = (c: Collection) => {
    colRef.current = c;
    setColState(c);
    saveCollection(c);
  };
  const [screen, setScreen] = useState<Screen>(() =>
    launchScreen(window.location.search, import.meta.env.DEV, (side) => deckForMatch(colRef.current, side)),
  );
  const [side, setSide] = useState<FactionId>(FACTIONS[0].id);
  // A finished match pays once; StrictMode or a re-render asking again gets the same answer.
  const awards = useRef(new Map<string, GoldAward>());
  const onFinish = (r: MatchResult, matchId: string): GoldAward => {
    const seen = awards.current.get(matchId);
    if (seen) return seen;
    const res = awardMatch(colRef.current, r, new Date(), matchId);
    awards.current.set(matchId, res.award);
    if (!res.repeat) setCol(res.col);
    return res.award;
  };
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
  if (screen.s === 'shop')
    return <TradingPost col={col} setCol={setCol} side={side} setSide={setSide} onBack={() => setScreen({ s: 'porch' })} onDecks={() => setScreen({ s: 'decks' })} />;
  if (screen.s === 'decks')
    return <DeckEditor key={side} col={col} setCol={setCol} side={side} setSide={setSide} onBack={() => setScreen({ s: 'porch' })} onShop={() => setScreen({ s: 'shop' })} />;
  if (screen.s === 'battle')
    return <Battlefield key={screen.key} opts={screen.opts} onLeave={() => setScreen({ s: 'porch' })} onFinish={onFinish} gold={col.gold} />;
  return (
    <Porch
      col={col}
      onShop={() => setScreen({ s: 'shop' })}
      onDecks={() => setScreen({ s: 'decks' })}
      mind={mind}
      setMind={setMind}
      onCodex={() => setScreen({ s: 'codex' })}
      onRide={(f) => {
        const rivals = FACTIONS.filter((x) => x.id !== f);
        const red = rivals[Math.floor(Math.random() * rivals.length)].id;
        const firsts = MAPS.filter((x) => x.era === 'first');
        const mapId = firsts[Math.floor(Math.random() * firsts.length)].id;
        setSide(f);
        setScreen({ s: 'battle', opts: { blue: f, red, mind, mapId, deck: deckForMatch(colRef.current, f) }, key: Date.now() });
      }}
    />
  );
}
