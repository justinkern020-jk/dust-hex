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
import { MatchGuard } from './ui/MatchGuard';
import { clearLive, loadLive } from './ui/resume';
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
  const [screen, setScreen] = useState<Screen>(() => {
    const first = launchScreen(window.location.search, import.meta.env.DEV, (side) => deckForMatch(colRef.current, side));
    // A reload mid-match (tab killed, pull-to-refresh) picks the match back up instead of the title card.
    if (first.s === 'title') {
      const live = loadLive();
      if (live) return { s: 'battle', opts: { ...live.opts, resume: live.m }, key: 1 };
    }
    return first;
  });
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
  // History: the Codex and a match sit one step above the porch, so the in-app Back,
  // the Android back gesture and the browser's back button all land on the porch.
  // A deep link (?codex, ?side=...) gets a porch entry slipped in underneath it.
  useEffect(() => {
    const s0 = screen.s;
    const st = window.history.state as { dh?: string } | null;
    if ((s0 === 'codex' || s0 === 'battle' || s0 === 'shop' || s0 === 'decks') && st?.dh !== s0) {
      const here = window.location.pathname + window.location.search + window.location.hash;
      window.history.replaceState({ dh: 'porch' }, '', window.location.pathname);
      window.history.pushState({ dh: s0 }, '', here);
    } else if (!st?.dh) window.history.replaceState({ dh: s0 }, '', window.location.href);
    const onPop = () => {
      clearLive();
      setScreen((cur) => (cur.s === 'porch' ? cur : { s: 'porch' }));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (next: Screen) => {
    window.history.pushState({ dh: next.s }, '', window.location.pathname);
    setScreen(next);
  };
  /** Shop <-> deck editor: a sideways step, so Back still goes straight to the porch. */
  const swap = (next: Screen) => {
    window.history.replaceState({ dh: next.s }, '', window.location.pathname);
    setScreen(next);
  };
  const toPorch = () => {
    const st = window.history.state as { dh?: string } | null;
    if (st?.dh === 'codex' || st?.dh === 'battle' || st?.dh === 'shop' || st?.dh === 'decks') window.history.back(); // popstate brings the porch
    else {
      window.history.replaceState({ dh: 'porch' }, '', window.location.pathname);
      setScreen({ s: 'porch' });
    }
  };
  const crashes = useRef(0);
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
  if (screen.s === 'title')
    return (
      <Title
        onDone={() => {
          window.history.replaceState({ dh: 'porch' }, '', window.location.href);
          setScreen({ s: 'porch' });
        }}
      />
    );
  if (screen.s === 'codex') return <Codex onBack={toPorch} />;
  if (screen.s === 'shop')
    return <TradingPost col={col} setCol={setCol} side={side} setSide={setSide} onBack={toPorch} onDecks={() => swap({ s: 'decks' })} />;
  if (screen.s === 'decks')
    return <DeckEditor key={side} col={col} setCol={setCol} side={side} setSide={setSide} onBack={toPorch} onShop={() => swap({ s: 'shop' })} />;
  if (screen.s === 'battle')
    return (
      <MatchGuard
        key={screen.key}
        onCrash={() => {
          crashes.current += 1;
          const live = loadLive();
          if (live && crashes.current < 3) setScreen({ s: 'battle', opts: { ...live.opts, resume: live.m }, key: screen.key + 1 });
          else {
            clearLive();
            setScreen({ s: 'porch' });
          }
        }}
      >
        <Battlefield
          opts={screen.opts}
          onFinish={onFinish}
          gold={col.gold}
          onLeave={() => {
            clearLive();
            toPorch();
          }}
        />
      </MatchGuard>
    );
  return (
    <Porch
      col={col}
      onShop={() => open({ s: 'shop' })}
      onDecks={() => open({ s: 'decks' })}
      mind={mind}
      setMind={setMind}
      onCodex={() => open({ s: 'codex' })}
      onRide={(f) => {
        const rivals = FACTIONS.filter((x) => x.id !== f);
        const red = rivals[Math.floor(Math.random() * rivals.length)].id;
        const firsts = MAPS.filter((x) => x.era === 'first');
        const mapId = firsts[Math.floor(Math.random() * firsts.length)].id;
        setSide(f);
        open({ s: 'battle', opts: { blue: f, red, mind, mapId, deck: deckForMatch(colRef.current, f) }, key: Date.now() });
      }}
    />
  );
}
