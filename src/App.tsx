import { useEffect, useRef, useState } from 'react';
import { FACTIONS } from './game/cards';
import { MAPS, resolveMapId } from './game/engine';
import type { FactionId } from './game/types';
import type { Mind } from './game/ai';
import { Porch } from './ui/Porch';
import { Codex } from './ui/Codex';
import { Battlefield, type BattleOpts } from './ui/Battlefield';
import { TradingPost } from './ui/TradingPost';
import { DeckEditor } from './ui/DeckEditor';
import { loadCollection, saveCollection } from './ui/collectionStore';
import { awardMatch, deckForMatch, type Collection, type GoldAward, type MatchResult } from './game/collection';
import { playMenuMusic, preloadMenuAudio, unlockAudio } from './ui/sound';

type Screen = { s: 'porch' } | { s: 'codex' } | { s: 'shop' } | { s: 'decks' } | { s: 'battle'; opts: BattleOpts; key: number };
const MIND_KEY = 'dusthex.mind';

function initialScreen(col: Collection): Screen {
  // Deep links for testing and sharing: ?side=gang&rival=lodge&map=gallows-mesa&mind=expert
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('codex') != null) return { s: 'codex' };
    if (q.get('shop') != null) return { s: 'shop' };
    if (q.get('decks') != null) return { s: 'decks' };
    const side = q.get('side') as FactionId | null;
    if (side && FACTIONS.some((f) => f.id === side)) {
      const rival = (q.get('rival') as FactionId | null) ?? FACTIONS.find((f) => f.id !== side)!.id;
      const map = resolveMapId(q.get('map')) ?? 'gallows-mesa';
      const mind = (q.get('mind') as Mind | null) ?? 'expert';
      // Testing aids (opening hand, money) exist only in dev builds.
      const dev = import.meta.env.DEV;
      const deal = dev ? q.get('deal')?.split(',').filter(Boolean) : undefined;
      const money = dev && q.get('money') != null ? Number(q.get('money')) : undefined;
      return { s: 'battle', opts: { blue: side, red: rival, mapId: map, mind, deal, money, deck: deckForMatch(col, side) }, key: 1 };
    }
  } catch {
    /* ignore */
  }
  return { s: 'porch' };
}

export function App() {
  // The card collection (localStorage for now; see collectionStore).
  const [col, setColState] = useState<Collection>(() => loadCollection());
  const colRef = useRef(col);
  const setCol = (c: Collection) => {
    colRef.current = c;
    setColState(c);
    saveCollection(c);
  };
  const [screen, setScreen] = useState<Screen>(() => initialScreen(colRef.current));
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
    // Menus (porch, codex) play the Dust Devil loop; a match fades it out itself.
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
