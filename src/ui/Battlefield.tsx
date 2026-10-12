import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Action, Card, FactionId, Match, Side, Target, TargetSpec, Unit } from '../game/types';
import { card, faction, leaderOf, maybeCard } from '../game/cards';
import { MAPS, actError, applyAction, bankFor, canAfford, deployTiles, holdings, mapById, moveTargets, newMatch, playCost, strikeTargets, targetOptions } from '../game/engine';
import { chooseAction, choosePending, type Mind } from '../game/ai';
import { isSpent } from '../game/rules';
import { posOf, unitAt } from '../game/core';
import { CardArt, CardPeek, CoinFace, KIND_LABEL } from './cardview';
import { HOLD_TO_DRAG_MS, HOLD_TO_READ_MS, TOUCH_LIFT, classifyGesture, dropAction, legalDrops, nearestLegal, scrollTurnsToDrag, type TileSpot, scrollToSlider, sliderToScroll, wheelToScroll, type HandSource } from '../game/drop';
import { MINDS } from './Porch';
import { trapReveals, type TrapReveal } from '../game/trapReveal';

/** Read at load, before the launch code tidies the URL. */
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __dhFx: unknown }).__dhFx = { planFx, runFx };
const TRAP_DEMO = import.meta.env.DEV && new URLSearchParams(window.location.search).has('trapdemo');
import { WeatherLayer, pickWeather } from './Weather';
import { planFx, fxMs, runFx } from './fx';
import { flightMs, planSlides, slideKeyframes, slideTiming, type Box } from './coinMotion';
import { playMatchSting, playMusic, sfx, soundEvents, stopMenuMusic } from './sound';

const ME: Side = 'blue';
const AI_DELAY = (() => {
  try {
    return import.meta.env.DEV && new URLSearchParams(window.location.search).get('fast') != null ? 40 : 520;
  } catch {
    return 520;
  }
})();

type Sel =
  | { k: 'unit'; uid: string }
  | { k: 'hand'; i: number }
  | { k: 'leader' }
  | { k: 'act'; a: { uid?: string; gid?: string; did?: string }; label: string; spec?: TargetSpec }
  | { k: 'lead'; spec?: TargetSpec }
  | null;

export const PRIMER = [
  'Each side owns one stronghold. It banks 2 money every turn, you can always deploy a unit there, and it counts as a claim.',
  'Gates you hold, and your stronghold, are the only places a unit can enter. A claim you take stays yours and banks its money.',
  'At the end of each round both sides add 1 to their Claims for every claim they hold (your stronghold counts), so going first banks no lead. Reach the number beside the score to win.',
  'A card costs the one number printed on it. If the bank can pay that number, you may play it.',
  'Each unit either moves or strikes once a turn. Melee strikes are answered; fast lands first and a killing stroke is not answered. Power is health and strength as one number: damage lowers it, and a unit at 0 is destroyed.',
  'Ranged units can also strike two tiles away in a straight line, never on a diagonal, and those shots are not answered. High ground adds 1. A unit striking up a ridge in melee misses one blow in three.',
  'Take the enemy stronghold to end the fight at once. You may yield the ground if the hour turns against you.',
  'The range is haunted. Hidden deaths — a rattler, a shaft, a deadfall — are not marked until someone finds them.',
  'Your leader waits in the tray. Deploy them like a unit. Once a match, Lead calls on their power.',
];
const SEEN = 'dusthex.seenPrimer';


function targetLabel(m: Match, t: Target) {
  if (t.did) {
    const d = [...m.tray.blue, ...m.tray.red, ...m.tileDevices].find((x) => x.did === t.did);
    return d ? card(d.cardId).name : 'device';
  }
  if (t.gid && t.uid) {
    const u = m.units[t.uid];
    const g = u?.gear.find((x) => x.gid === t.gid);
    return g && u ? `${card(g.cardId).name} on ${card(u.cardId).name}` : 'item';
  }
  if (t.uid) return m.units[t.uid] ? card(m.units[t.uid].cardId).name : 'unit';
  return `tile ${t.r},${t.c}`;
}

const terrainLabel = (h: number) => (h >= 2 ? 'Mesa' : h === 1 ? 'Ridge' : '');
const TRAP_LABEL: Record<string, string> = { snake: 'Rattler', shaft: 'Shaft', deadfall: 'Deadfall', pit: 'Deadfall', sink: 'Sink', cavein: 'Cave-in', hidebehind: 'Something', cinders: 'Cinders', hellrail: 'Hell rail' };

export interface BattleOpts {
  blue: FactionId;
  red: FactionId;
  mind: Mind;
  mapId: string;
  /** Testing aid (?deal=a,b&money=n): these cards open your hand. */
  deal?: string[];
  money?: number;
}

function startMatch(o: BattleOpts, mapId: string): Match {
  const m = newMatch({ blue: o.blue, red: o.red, mapId, seed: (Date.now() & 0x7fffffff) || 7 });
  if (!import.meta.env.DEV) return m;
  const deal = (o.deal ?? []).filter((id) => maybeCard(id) && maybeCard(id)!.kind !== 'leader');
  if (deal.length) m.hand.blue = [...deal, ...m.hand.blue].slice(0, 7);
  if (o.money != null) m.money.blue = Math.max(0, Math.min(14, o.money));
  return m;
}

export function Battlefield({ opts, onLeave }: { opts: BattleOpts; onLeave: () => void }) {
  const [mapId, setMapId] = useState(opts.mapId);
  const [m, setM] = useState<Match>(() => startMatch(opts, opts.mapId));
  const [sel, setSel] = useState<Sel>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [turnBanner, setTurnBanner] = useState<{ id: number; side: Side } | null>(null);
  const [reveals, setReveals] = useState<TrapReveal[]>([]);
  const revealSeq = useRef(0);
  const [peek, setPeek] = useState<{ c: Card; power?: number } | null>(null);
  const [hits, setHits] = useState<{ id: number; uid: string; text: string }[]>([]);
  const [yieldAsk, setYieldAsk] = useState(false);
  const [drag, setDrag] = useState<{ src: HandSource; x: number; y: number; over: string | null } | null>(null);
  const [rail, setRail] = useState({ overflow: false, atStart: true, atEnd: true, value: 0 });
  const rowRef = useRef<HTMLDivElement | null>(null);
  // While a card is dragged the banner slot keeps its height, so the board never jumps under the finger.
  const slotRef = useRef<HTMLDivElement | null>(null);
  const slotH = useRef(0);
  const [primer, setPrimer] = useState(() => {
    try {
      return localStorage.getItem(SEEN) !== '1';
    } catch {
      return false;
    }
  });
  const weather = useMemo(() => pickWeather(), [m.seed]);
  const hitId = useRef(1);
  const mRef = useRef(m);
  mRef.current = m;
  // Coin motion (FLIP): last measured coin boxes, where the next deploy launches from, and the flight clock.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const coinBoxes = useRef(new Map<string, Box>());
  const launchRef = useRef<DOMRect | null>(null);
  const flightUntil = useRef(0);
  const inFlight = () => performance.now() < flightUntil.current;

  useEffect(() => {
    // Match start: the menu loop fades out, the sting plays, the battle track comes in under it.
    stopMenuMusic(900);
    playMatchSting();
    playMusic('ghost-town');
  }, []);

  const after = useCallback((next: Match) => {
    soundEvents(next.events, ME, next);
    const turnEv = next.events.find((e) => e.e === 'turn') as { side: Side } | undefined;
    if (turnEv && !next.winner) setTurnBanner({ id: Date.now(), side: turnEv.side });
    const tr = trapReveals(next.events, revealSeq.current++);
    if (tr.length) setReveals((q) => [...q, ...tr]);
    const fresh: { id: number; uid: string; text: string }[] = [];
    for (const e of next.events) if (e.e === 'damage' && e.n > 0) fresh.push({ id: hitId.current++, uid: e.uid, text: `-${e.n}` });
    if (fresh.length) {
      setHits((h) => [...h, ...fresh]);
      window.setTimeout(() => setHits((h) => h.filter((x) => !fresh.includes(x))), 1000);
    }
  }, []);

  const act = useCallback(
    (a: Action) => {
      const r = applyAction(mRef.current, a);
      if (r.error) {
        setToast(r.error);
        sfx('cock', 0.25);
        return false;
      }
      setToast(null);
      setSel(null);
      setM(r.state);
      after(r.state);
      return true;
    },
    [after],
  );

  // The rival's hand.
  const pendingMine = m.pending[0]?.side === ME ? m.pending[0] : null;
  const aiToMove = !m.winner && (m.pending.length ? m.pending[0].side === 'red' : m.side === 'red');
  useEffect(() => {
    if (!aiToMove || primer || reveals.length) return;
    const wait = Math.max(AI_DELAY, flightUntil.current - performance.now() + 140);
    const id = window.setTimeout(() => {
      const cur = mRef.current;
      const a = cur.pending.length ? choosePending(cur) : chooseAction(cur, opts.mind);
      let r = applyAction(cur, a);
      if (r.error) r = applyAction(cur, cur.pending.length ? { t: 'skip' } : { t: 'end' });
      if (r.error) r = applyAction(cur, { t: 'end' });
      if (!r.error) {
        setM(r.state);
        after(r.state);
      }
    }, wait);
    return () => window.clearTimeout(id);
  }, [m, aiToMove, opts.mind, after, primer, reveals.length]);

  useEffect(() => {
    // Dev-only test param: ?trapdemo shows a sample reveal queue (e2e screenshots).
    if (!TRAP_DEMO) return;
    setReveals(trapReveals([
      { e: 'trap', r: 2, c: 2, kind: 'snake', uid: 'demo1', victimName: 'Frank James', victimSide: 'blue', owner: 'red', cardId: 'shaft-viper' },
      { e: 'death', uid: 'demo1', cardId: 'frank-james', side: 'blue' },
      { e: 'trap', r: 3, c: 2, kind: 'sink', uid: 'demo2', victimName: 'Belle Starr', victimSide: 'red', owner: 'blue', cardId: 'alkali' },
      { e: 'damage', uid: 'demo2', n: 3 },
    ], 999));
  }, []);

  // Trap reveal queue: each card shows ~1.8s, tap to dismiss.
  const reveal = reveals[0];
  useEffect(() => {
    if (!reveal) return;
    const id = window.setTimeout(() => setReveals((q) => q.slice(1)), TRAP_DEMO ? 6000 : 1800);
    return () => window.clearTimeout(id);
  }, [reveal?.key]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const g = grid.getBoundingClientRect();
    const rel = (r: DOMRect): Box => ({ x: r.left - g.left, y: r.top - g.top, w: r.width, h: r.height });
    const els = new Map<string, HTMLElement>();
    const now = new Map<string, Box>();
    grid.querySelectorAll<HTMLElement>('[data-uid]').forEach((el) => {
      const uid = el.dataset.uid!;
      els.set(uid, el);
      now.set(uid, rel(el.getBoundingClientRect()));
    });
    const prev = coinBoxes.current;
    coinBoxes.current = now;
    const reducedFx = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prev.size && m.events.length) {
      const fx = planFx(m.events, prev, now, reducedFx);
      if (fx.length) {
        runFx(grid, fx, (id) => maybeCard(id)?.art ?? '', reducedFx);
        flightUntil.current = Math.max(flightUntil.current, performance.now() + fxMs(fx));
      }
    }
    if (!prev.size && !m.events.some((e) => e.e === 'deploy')) return;
    const deployed = new Set(m.events.filter((e) => e.e === 'deploy').map((e) => (e as { uid: string }).uid));
    const launch = (uid: string): Box | null => {
      if (!deployed.has(uid)) return null;
      const u = m.units[uid];
      if (!u) return null;
      if (u.side === ME && launchRef.current) return rel(launchRef.current);
      // The rival's coins (and leaders riding back) come out of their stronghold.
      for (let r = 0; r < m.h; r++)
        for (let c = 0; c < m.w; c++) {
          const t = m.tiles[r][c];
          if (t.k !== 'stronghold' || t.home !== u.side) continue;
          const el = grid.querySelector(`[data-tile-r="${r}"][data-tile-c="${c}"]`);
          if (!el) continue;
          const b = rel(el.getBoundingClientRect());
          const here = now.get(uid)!;
          // Deploying onto the stronghold itself: drop in from that side's edge.
          return Math.abs(b.x - here.x) + Math.abs(b.y - here.y) < 4 ? { ...b, y: b.y + (u.side === ME ? 1 : -1) * b.h * 0.9 } : b;
        }
      return null;
    };
    const slides = planSlides(prev, now, m.events, launch);
    launchRef.current = null;
    if (!slides.length) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wrap = grid.closest('.board-wrap') as HTMLElement | null;
    const deploying = slides.some((x) => x.kind === 'deploy') && !reduced;
    // A deploy from the hand flies over the hand rail and the frame: lift the board above them for the flight.
    const socket = grid.closest('.bf-board-socket') as HTMLElement | null;
    if (deploying && wrap) wrap.style.overflow = 'visible';
    if (deploying && socket) socket.style.zIndex = '40';
    for (const sl of slides) {
      const el = els.get(sl.uid);
      if (!el || typeof el.animate !== 'function') continue;
      const tile = el.closest('.stone') as HTMLElement | null;
      if (tile) tile.style.zIndex = '30';
      el.classList.add('is-flying');
      const anim = el.animate(slideKeyframes(sl, reduced), slideTiming(sl, reduced));
      const done = () => {
        el.classList.remove('is-flying');
        if (tile) tile.style.zIndex = '';
      };
      anim.onfinish = done;
      anim.oncancel = done;
    }
    const ms = flightMs(slides, reduced);
    flightUntil.current = Math.max(flightUntil.current, performance.now() + ms);
    if (deploying)
      window.setTimeout(() => {
        if (wrap) wrap.style.overflow = '';
        if (socket) socket.style.zIndex = '';
      }, ms + 20);
  }, [m]);

  const myTurn = m.side === ME && !m.winner && !m.pending.length;

  // ---- what lights up
  const lit = useMemo(() => {
    const tiles = new Set<string>();
    const moves = new Set<string>();
    const strikes = new Set<string>();
    let options: Target[] = [];
    if (pendingMine) {
      for (const o of pendingMine.options) {
        if (o.r != null && o.c != null) tiles.add(`${o.r},${o.c}`);
        else if (o.uid) {
          const p = posOf(m, o.uid);
          if (p) tiles.add(`${p.r},${p.c}`);
        }
      }
      return { tiles, moves, strikes, options };
    }
    if (!myTurn || !sel) return { tiles, moves, strikes, options };
    if (sel.k === 'unit') {
      for (const [r, c] of moveTargets(m, sel.uid)) moves.add(`${r},${c}`);
      for (const [r, c] of strikeTargets(m, sel.uid)) strikes.add(`${r},${c}`);
    } else if (sel.k === 'leader') {
      for (const [r, c] of deployTiles(m, ME, m.leader[ME])) tiles.add(`${r},${c}`);
    } else if (sel.k === 'hand') {
      const c = card(m.hand[ME][sel.i]);
      if (c.kind === 'unit') for (const [r, cc] of deployTiles(m, ME, c.id)) tiles.add(`${r},${cc}`);
      else if (c.target && c.target.kind !== 'none') options = targetOptions(m, ME, c.target, c.kind === 'rite');
    } else if (sel.k === 'act' || sel.k === 'lead') {
      if (sel.spec && sel.spec.kind !== 'none') options = targetOptions(m, ME, sel.spec, false);
      if (sel.k === 'act' && sel.a.uid && card(m.units[sel.a.uid]?.cardId ?? 'jesse').act?.op === 'readyAlly') options = options.filter((o) => o.uid !== sel.a.uid);
    }
    for (const o of options) {
      if (o.gid || o.did) continue;
      if (o.r != null && o.c != null) tiles.add(`${o.r},${o.c}`);
      else if (o.uid) {
        const p = posOf(m, o.uid);
        if (p) tiles.add(`${p.r},${p.c}`);
      }
    }
    return { tiles, moves, strikes, options };
  }, [m, sel, myTurn, pendingMine]);

  const fireTarget = (t: Target | undefined) => {
    if (!sel) return;
    if (sel.k === 'hand') act({ t: 'play', i: sel.i, target: t });
    else if (sel.k === 'act') act({ t: 'act', ...sel.a, target: t });
    else if (sel.k === 'lead') act({ t: 'lead', target: t });
  };

  const handRect = (i: number | 'leader') => document.querySelector(i === 'leader' ? '[data-testid="hand-leader"]' : `[data-testid="hand-${i}"]`)?.getBoundingClientRect() ?? null;
  const tileRef = useRef((_r: number, _c: number) => {});
  const onTile = (r: number, c: number) => {
    // Coins still in the air: take the tap as soon as they land instead of dropping it.
    if (inFlight()) {
      window.setTimeout(() => tileRef.current(r, c), flightUntil.current - performance.now() + 10);
      return;
    }
    const key = `${r},${c}`;
    const u = unitAt(m, r, c);
    if (pendingMine) {
      const o = pendingMine.options.find((x) => (x.r === r && x.c === c) || (u && x.uid === u.uid));
      if (o) act({ t: 'choose', key: o.key });
      else if (u) setPeek({ c: card(u.cardId), power: u.power });
      return;
    }
    if (!myTurn) {
      if (u) setPeek({ c: card(u.cardId), power: u.power });
      return;
    }
    if (sel && (sel.k === 'hand' || sel.k === 'act' || sel.k === 'lead') && lit.options.length) {
      const hit = lit.options.filter((o) => !o.gid && !o.did && ((o.r === r && o.c === c) || (u && o.uid === u.uid)));
      if (hit.length) return fireTarget(hit[0]);
    }
    if (sel?.k === 'hand' && card(m.hand[ME][sel.i]).kind === 'unit' && lit.tiles.has(key)) {
      launchRef.current = handRect(sel.i);
      return void act({ t: 'deploy', i: sel.i, r, c });
    }
    if (sel?.k === 'leader' && lit.tiles.has(key)) {
      launchRef.current = handRect('leader');
      return void act({ t: 'deploy', i: 'leader', r, c });
    }
    if (sel?.k === 'unit') {
      if (lit.strikes.has(key)) return void act({ t: 'strike', uid: sel.uid, r, c });
      if (lit.moves.has(key)) return void act({ t: 'move', uid: sel.uid, r, c });
    }
    if (u && u.side === ME) {
      // A second tap on your picked coin reads its card (phones have no double-click).
      if (sel?.k === 'unit' && sel.uid === u.uid) {
        setSel(null);
        return setPeek({ c: card(u.cardId), power: u.power });
      }
      return setSel({ k: 'unit', uid: u.uid });
    }
    if (u) return setPeek({ c: card(u.cardId), power: u.power });
    setSel(null);
  };

  tileRef.current = onTile;
  /** A tap that lands between tiles (or on a tile's rim) goes to the nearest lit tile close by. */
  const onGridGap = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.stone')) return;
    const all = new Set([...lit.tiles, ...lit.moves, ...lit.strikes]);
    const key = nearestLegal(e.clientX, e.clientY, tileSpots(), all, 0.8);
    if (key) {
      const [r, c] = key.split(',').map(Number);
      onTile(r, c);
    } else if (sel) setSel(null);
  };
  /** A tap on bare ground away from the board, hand and buttons puts a picked card back. */
  const onBackdrop = (e: React.MouseEvent) => {
    if (!sel || drag) return;
    if ((e.target as Element).closest('button, input, select, a, [role="button"], [role="grid"], .hand-rail, .dh-tray, .bf-banner-slot, .bf-hud, .primer-veil, .match-veil')) return;
    setSel(null);
  };

  const onHand = (i: number) => {
    if (!myTurn) return setPeek({ c: card(m.hand[ME][i]) });
    if (sel?.k === 'hand' && sel.i === i) return setSel(null);
    const c = card(m.hand[ME][i]);
    if (!canAfford(m, ME, c.id)) {
      setToast(`${c.name} costs ${playCost(m, ME, c)}. You have ${m.money[ME]}.`);
      return;
    }
    setToast(null);
    setSel({ k: 'hand', i });
  };

  // ---- usable acts (dead buttons are not drawn)
  const usableActs = useMemo(() => {
    const out: { a: { uid?: string; gid?: string; did?: string }; label: string; spec?: TargetSpec; name: string }[] = [];
    if (!myTurn) return out;
    const ok = (a: { uid?: string; gid?: string; did?: string }, spec?: TargetSpec) => {
      const e = actError(m, ME, a);
      if (!e) return true;
      if (e === 'Choose a target.' && spec) return targetOptions(m, ME, spec, false).filter((t) => t.uid !== a.uid || card(m.units[a.uid!]?.cardId ?? 'jesse').act?.op !== 'readyAlly').length > 0;
      return false;
    };
    for (const d of [...m.tray[ME], ...m.tileDevices.filter((x) => x.owner === ME)]) {
      const a = card(d.cardId).act;
      if (a && ok({ did: d.did }, a.target)) out.push({ a: { did: d.did }, label: a.label, spec: a.target, name: card(d.cardId).name });
    }
    for (const u of Object.values(m.units)) {
      const a = card(u.cardId).act;
      if (a && u.side === ME && ok({ uid: u.uid }, a.target)) out.push({ a: { uid: u.uid }, label: a.label, spec: a.target, name: card(u.cardId).name });
      for (const g of u.gear) {
        const ga = card(g.cardId).act;
        if (ga && ok({ uid: u.uid, gid: g.gid }, ga.target)) out.push({ a: { uid: u.uid, gid: g.gid }, label: ga.label, spec: ga.target, name: card(g.cardId).name });
      }
    }
    return out;
  }, [m, myTurn]);

  const startAct = (x: (typeof usableActs)[number]) => {
    if (!x.spec || x.spec.kind === 'none') return void act({ t: 'act', ...x.a });
    setSel({ k: 'act', a: x.a, label: `${x.name}: ${x.label}`, spec: x.spec });
  };

  const leaderCard = card(m.leader[ME]);
  const foeLeader = card(m.leader.red);
  const canLead = myTurn && !m.leadUsed[ME] && !!leaderCard.lead;
  const startLead = () => {
    const spec = leaderCard.lead?.target;
    if (!spec || spec.kind === 'none') {
      setSel({ k: 'lead' });
      return;
    }
    setSel({ k: 'lead', spec });
  };

  const restart = (map = mapId) => {
    setSel(null);
    setToast(null);
    setYieldAsk(false);
    playMatchSting();
    setM(startMatch({ ...opts, deal: undefined, money: undefined }, map));
  };

  // ---- dragging from the hand and scrolling it
  // Hand cards take every touch themselves (touch-action: none) and capture the pointer,
  // so nothing (the hand scroller, a re-render, the page) can steal a drag half way.
  // Sideways swipes of the hand (with a little fling) and page pulls are done here.
  // While dragging, the coin rides above the finger and snaps to the nearest lit tile
  // (magnetic, ~1.2 tiles of reach); letting go anywhere near it deploys there.
  type G = {
    id: number;
    src: HandSource;
    c: Card;
    x0: number;
    y0: number;
    t0: number;
    mode: 'pending' | 'drag' | 'scroll' | 'page' | 'none';
    scroll0: number;
    page0: number;
    touch: boolean;
    hold: number;
    lx: number;
    ly: number;
    raf: number;
    vx: number;
    vy: number;
    t: number;
    lift: number;
    legal: Set<string>;
    over: string | null;
    moved: boolean;
    held: boolean;
    el: HTMLElement | null;
  };
  const gesture = useRef<G | null>(null);
  const fling = useRef(0);
  const swallowClick = useRef(false);
  // Window listeners must be the same functions to add and remove; they call the latest handlers.
  const live = useRef({ move: (_e: PointerEvent) => {}, up: (_e: PointerEvent) => {}, cancel: () => {} });
  const stable = useMemo(
    () => ({ move: (e: PointerEvent) => live.current.move(e), up: (e: PointerEvent) => live.current.up(e), cancel: () => live.current.cancel() }),
    [],
  );
  const canDrag = (src: HandSource) => {
    const cur = mRef.current;
    if (cur.winner || cur.side !== ME || cur.pending.length) return false;
    return src === 'leader' ? cur.leaderAt[ME] === 'tray' && canAfford(cur, ME, cur.leader[ME]) : canAfford(cur, ME, cur.hand[ME][src]);
  };
  const buzz = (ms: number) => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
    } catch {
      /* ignore */
    }
  };
  const tileSpots = (): TileSpot[] => {
    const out: TileSpot[] = [];
    gridRef.current?.querySelectorAll<HTMLElement>('[data-tile-r]').forEach((el) => {
      const b = el.getBoundingClientRect();
      out.push({ key: `${el.dataset.tileR},${el.dataset.tileC}`, x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width });
    });
    return out;
  };
  /** Back over the cards in the hand (finger or coin): the drag is being called off. */
  const overHand = (g: G) => {
    const b = document.querySelector('.hand-scroller')?.getBoundingClientRect();
    const inside = (x: number, y: number) => !!b && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    return inside(g.lx, g.ly) || inside(g.lx, g.ly - g.lift);
  };
  /** The coin snaps first; a fingertip resting right on a lit tile counts too. */
  const snapKey = (g: G) => {
    const spots = tileSpots();
    return nearestLegal(g.lx, g.ly - g.lift, spots, g.legal) ?? (g.lift ? nearestLegal(g.lx, g.ly, spots, g.legal, 0.6) : null);
  };
  /** Re-aim the dragged coin: snap to the nearest legal tile around the coin (not the fingertip). */
  const aim = (g: G) => {
    const cx = g.lx;
    const cy = g.ly - g.lift;
    const key = overHand(g) ? null : snapKey(g);
    if (key !== g.over) {
      g.over = key;
      if (key) buzz(8);
    }
    setDrag({ src: g.src, x: cx, y: cy, over: key });
  };
  // Near the top edge mid-drag, the page scrolls up so the whole board can be reached.
  const edgeSpeed = (y: number) => {
    const edge = 72;
    // Only upward: the board is always above the hand.
    return y < edge ? -Math.ceil((edge - y) / 4) : 0;
  };
  const edgeTick = () => {
    const g = gesture.current;
    if (!g || g.mode !== 'drag') return;
    const v = edgeSpeed(g.ly - g.lift);
    if (!v || window.scrollY <= 0) {
      g.raf = 0;
      return;
    }
    window.scrollBy(0, v);
    aim(g);
    g.raf = window.requestAnimationFrame(edgeTick);
  };
  const beginDrag = (g: G, held: boolean) => {
    window.clearTimeout(g.hold);
    g.mode = 'drag';
    g.held = held;
    g.legal = legalDrops(mRef.current, ME, g.src);
    slotH.current = slotRef.current?.offsetHeight ?? 0;
    swallowClick.current = true;
    setSel(g.src === 'leader' ? { k: 'leader' } : { k: 'hand', i: g.src });
    setToast(null);
    buzz(10);
    aim(g);
  };
  const endGesture = () => {
    const g = gesture.current;
    if (g) {
      window.clearTimeout(g.hold);
      if (g.raf) window.cancelAnimationFrame(g.raf);
      try {
        if (g.el?.hasPointerCapture?.(g.id)) g.el.releasePointerCapture(g.id);
      } catch {
        /* ignore */
      }
    }
    gesture.current = null;
    window.removeEventListener('pointermove', stable.move);
    window.removeEventListener('pointerup', stable.up);
    window.removeEventListener('pointercancel', stable.cancel);
  };
  /** Act now, or as soon as the coins in the air have landed. */
  const actWhenLanded = (a: Action, launch: DOMRect | null) => {
    const go = () => {
      launchRef.current = launch;
      if (act(a)) buzz(15);
    };
    const wait = flightUntil.current - performance.now();
    if (wait > 0) window.setTimeout(go, wait + 10);
    else go();
  };
  function onGestureMove(e: PointerEvent) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.mode === 'pending') {
      const k = classifyGesture(dx, dy);
      if (k === 'pending') return;
      window.clearTimeout(g.hold);
      swallowClick.current = true;
      if (k === 'drag' && canDrag(g.src)) {
        g.lx = e.clientX;
        g.ly = e.clientY;
        beginDrag(g, false);
      } else if (k === 'scroll') {
        g.mode = 'scroll';
        g.scroll0 = rowRef.current?.scrollLeft ?? 0;
      } else if (g.touch) {
        // A pull down (or a drag that cannot be played) moves the page, as a native pan would.
        g.mode = 'page';
        g.page0 = window.scrollY;
      } else {
        g.mode = 'none';
      }
    }
    // Finger speed, for the fling when a touch swipe lets go.
    const now = performance.now();
    const dt = Math.max(1, now - g.t);
    g.vx = 0.8 * ((e.clientX - g.lx) / dt) + 0.2 * g.vx;
    g.vy = 0.8 * ((e.clientY - g.ly) / dt) + 0.2 * g.vy;
    g.t = now;
    g.lx = e.clientX;
    g.ly = e.clientY;
    if (g.mode === 'page') {
      window.scrollTo(window.scrollX, g.page0 - dy);
    } else if (g.mode === 'drag') {
      e.preventDefault();
      if (Math.hypot(dx, dy) > 12) g.moved = true;
      aim(g);
      if (!g.raf && edgeSpeed(e.clientY - g.lift)) g.raf = window.requestAnimationFrame(edgeTick);
    } else if (g.mode === 'scroll' && rowRef.current) {
      if (scrollTurnsToDrag(dy) && canDrag(g.src)) {
        rowRef.current.scrollLeft = g.scroll0;
        g.moved = true;
        beginDrag(g, false);
      } else rowRef.current.scrollLeft = g.scroll0 - dx;
    }
  }
  function onGestureUp(e: PointerEvent) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    if (g.mode === 'drag') {
      g.lx = e.clientX;
      g.ly = e.clientY;
      const cx = e.clientX;
      const cy = e.clientY - g.lift;
      if (!g.moved && g.held) {
        // Pressed, held and let go in place: a long hold reads the card; a shorter one leaves it picked for a tap on a tile.
        if (performance.now() - g.t0 >= HOLD_TO_READ_MS) {
          setSel(null);
          setPeek({ c: g.c });
        }
      } else if (overHand(g)) {
        // Put back in the hand: the drag is called off.
        setSel(null);
      } else {
        const key = snapKey(g);
        const [r, c] = key ? key.split(',').map(Number) : [-1, -1];
        const a = key ? dropAction(mRef.current, ME, g.src, r, c) : null;
        if (a) {
          // The coin settles from where it was let go.
          actWhenLanded(a, a.t === 'deploy' ? new DOMRect(cx - 28, cy - 28, 56, 56) : null);
        } else setToast('Too far from a lit tile. Drop it on or near one, or tap a lit tile.');
      }
      setDrag(null);
    } else if (g.touch && (g.mode === 'scroll' || g.mode === 'page') && performance.now() - g.t < 90) {
      // Let a quick touch swipe coast, like a native fling.
      const row = rowRef.current;
      let vx = g.vx;
      let vy = g.mode === 'page' ? g.vy : 0;
      if (g.mode !== 'scroll') vx = 0;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(40, now - last);
        last = now;
        if (row && vx) row.scrollLeft -= vx * dt;
        if (vy) window.scrollBy(0, -vy * dt);
        const k = Math.pow(0.995, dt);
        vx *= k;
        vy *= k;
        fling.current = Math.abs(vx) + Math.abs(vy) > 0.03 ? window.requestAnimationFrame(step) : 0;
      };
      window.cancelAnimationFrame(fling.current);
      fling.current = window.requestAnimationFrame(step);
    }
    endGesture();
    window.setTimeout(() => (swallowClick.current = false), 0);
  }
  function onGestureCancel() {
    // The browser took the pointer back (rare with touch-action: none and capture).
    setDrag(null);
    endGesture();
    swallowClick.current = false;
  }
  live.current = { move: onGestureMove, up: onGestureUp, cancel: onGestureCancel };
  const startGesture = (src: HandSource, c: Card) => (e: React.PointerEvent) => {
    if (e.button !== 0 || gesture.current) return;
    const touch = e.pointerType !== 'mouse';
    swallowClick.current = false;
    window.cancelAnimationFrame(fling.current);
    fling.current = 0;
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const g: G = {
      id: e.pointerId,
      src,
      c,
      x0: e.clientX,
      y0: e.clientY,
      t0: performance.now(),
      mode: 'pending',
      scroll0: 0,
      page0: window.scrollY,
      vx: 0,
      vy: 0,
      t: performance.now(),
      lx: e.clientX,
      ly: e.clientY,
      raf: 0,
      touch,
      lift: touch ? TOUCH_LIFT : 0,
      legal: new Set(),
      over: null,
      moved: false,
      held: false,
      el,
      hold: 0,
    };
    // Press and hold lifts a playable card for a drag in any direction;
    // on a card you cannot play yet (touch), holding reads it.
    g.hold = canDrag(src)
      ? window.setTimeout(() => {
          if (gesture.current === g && g.mode === 'pending') beginDrag(g, true);
        }, HOLD_TO_DRAG_MS)
      : touch
        ? window.setTimeout(() => {
            if (gesture.current !== g || g.mode !== 'pending') return;
            swallowClick.current = true;
            setPeek({ c });
            endGesture();
            window.setTimeout(() => (swallowClick.current = false), 400);
          }, HOLD_TO_READ_MS)
        : 0;
    gesture.current = g;
    window.addEventListener('pointermove', stable.move, { passive: false });
    window.addEventListener('pointerup', stable.up);
    window.addEventListener('pointercancel', stable.cancel);
  };
  useEffect(
    () => () => {
      endGesture();
      window.cancelAnimationFrame(fling.current);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const tapGuard = (fn: () => void) => () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    fn();
  };

  // The hand's slider, arrows and wheel.
  const measureRail = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth > 4;
    const next = {
      overflow,
      atStart: el.scrollLeft <= 2,
      atEnd: el.scrollLeft >= el.scrollWidth - el.clientWidth - 2,
      value: scrollToSlider(el.scrollLeft, el.scrollWidth, el.clientWidth),
    };
    setRail((r) => (r.overflow === next.overflow && r.atStart === next.atStart && r.atEnd === next.atEnd && r.value === next.value ? r : next));
  }, []);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    measureRail();
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth - el.clientWidth <= 4) return;
      const d = wheelToScroll(e.deltaX, e.deltaY, e.deltaMode);
      const max = el.scrollWidth - el.clientWidth;
      if ((d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max)) return;
      e.preventDefault();
      el.scrollLeft += d;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', measureRail, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureRail) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', measureRail);
      ro?.disconnect();
    };
  }, [measureRail]);
  useEffect(() => {
    measureRail();
  }, [m.hand, m.leaderAt, measureRail]);
  const nudgeHand = (dir: 1 | -1) => {
    const el = rowRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  // ---- render helpers
  const selUnit = sel?.k === 'unit' ? m.units[sel.uid] : undefined;
  const handCard = sel?.k === 'hand' ? card(m.hand[ME][sel.i]) : undefined;
  const offBoardOpts = lit.options.filter((o) => o.gid || o.did);
  const unitActs = selUnit ? usableActs.filter((x) => x.a.uid === selUnit.uid) : [];
  const trayActs = usableActs.filter((x) => x.a.did);
  const gearActsElsewhere = usableActs.filter((x) => x.a.gid && x.a.uid !== selUnit?.uid);

  let banner: React.ReactNode = null;
  if (pendingMine) {
    const off = pendingMine.options.filter((o) => o.r == null && !o.uid);
    const onBoard = pendingMine.options.filter((o) => o.r != null || o.uid);
    banner = (
      <div className="aim-banner dh-choice" data-testid="choice-banner">
        <strong>{pendingMine.prompt}</strong>
        {onBoard.length > 0 && <span className="dh-hint"> Tap a lit tile.</span>}
        <span className="dh-choice-row">
          {(onBoard.length <= 4 ? onBoard : []).concat(off).map((o) => (
            <button key={o.key} type="button" className="brass-btn" data-testid={`choose-${o.key}`} onClick={() => act({ t: 'choose', key: o.key })}>
              {o.label}
            </button>
          ))}
          {pendingMine.optional && (
            <button type="button" className="brass-btn brass-btn-ghost" data-testid="choose-skip" onClick={() => act({ t: 'skip' })}>
              Pass
            </button>
          )}
        </span>
      </div>
    );
  } else if (myTurn && sel) {
    const cancel = (
      <button type="button" className="dev-link" onClick={() => setSel(null)}>
        Cancel
      </button>
    );
    if (sel.k === 'unit' && selUnit) {
      const c = card(selUnit.cardId);
      banner = (
        <div className="move-banner" data-testid="move-banner">
          <strong>{c.name}</strong>
          <span className="move-banner-sep">·</span>
          {lit.moves.size ? 'move to a blue tile' : 'no move'}
          <span className="move-banner-sep">·</span>
          {lit.strikes.size ? `strike a red tile${selUnit.kw.includes('ranged') ? ' (ranged 2)' : ''}` : 'no strike'}
          {unitActs.map((x) => (
            <button key={`${x.a.uid}-${x.a.gid ?? ''}`} type="button" className="brass-btn dh-act" data-testid="unit-act" onClick={() => startAct(x)}>
              {x.a.gid ? `${x.name}: ${x.label}` : x.label}
            </button>
          ))}
          <button type="button" className="dev-link" onClick={() => setPeek({ c, power: selUnit.power })}>
            Read
          </button>
          {cancel}
        </div>
      );
    } else if (sel.k === 'hand' && handCard) {
      const needs = handCard.kind !== 'unit' && handCard.target && handCard.target.kind !== 'none';
      banner = (
        <div className="aim-banner" data-testid="aim-banner">
          <strong>{handCard.name}</strong> ·{' '}
          {handCard.kind === 'unit'
            ? handCard.hide
              ? 'hide it on a lit tile.'
              : 'drag it to a lit tile, or tap one.'
            : needs
              ? lit.options.length
                ? 'name a lit target.'
                : 'nothing to name.'
              : handCard.text}
          {offBoardOpts.map((o, k) => (
            <button key={k} type="button" className="brass-btn" onClick={() => fireTarget(o)}>
              {targetLabel(m, o)}
            </button>
          ))}
          {handCard.kind !== 'unit' && (!needs || (handCard.target?.optional && !lit.options.length) || handCard.target?.optional) && (
            <button type="button" className="brass-btn brass-btn-solid" data-testid="play-card" onClick={() => fireTarget(undefined)}>
              {needs ? 'Play without a target' : `Play · ${playCost(m, ME, handCard)}`}
            </button>
          )}
          <button type="button" className="dev-link" onClick={() => setPeek({ c: handCard })}>
            Read
          </button>
          {cancel}
        </div>
      );
    } else if (sel.k === 'leader') {
      banner = (
        <div className="aim-banner" data-testid="aim-banner">
          <strong>{leaderCard.name}</strong> · drag it to a lit tile, or tap one. {cancel}
        </div>
      );
    } else if (sel.k === 'act' || sel.k === 'lead') {
      const label = sel.k === 'act' ? sel.label : `Lead · ${leaderCard.lead?.label}: ${leaderCard.lead?.text}`;
      banner = (
        <div className="aim-banner" data-testid="aim-banner">
          <strong>{label}</strong> {sel.spec && sel.spec.kind !== 'none' ? (lit.options.length ? '· name a lit target.' : '· nothing to name.') : ''}
          {offBoardOpts.map((o, k) => (
            <button key={k} type="button" className="brass-btn" onClick={() => fireTarget(o)}>
              {targetLabel(m, o)}
            </button>
          ))}
          {(!sel.spec || sel.spec.kind === 'none' || sel.spec.optional) && (
            <button type="button" className="brass-btn brass-btn-solid" data-testid="confirm-act" onClick={() => fireTarget(undefined)}>
              {sel.k === 'lead' ? 'Lead' : 'Use'}
            </button>
          )}
          {cancel}
        </div>
      );
    }
  } else if (m.pending.length && m.pending[0].side === 'red') {
    banner = <p className="aim-banner dh-wait">The rival is choosing…</p>;
  } else if (m.side === 'red' && !m.winner) {
    banner = <p className="aim-banner dh-wait">The rival rides…</p>;
  } else if (toast == null && myTurn && trayActs.length + gearActsElsewhere.length === 0) {
    banner = null;
  }

  const map = mapById(mapId);
  const scoreChip = (side: Side) => {
    const f = faction(side === 'blue' ? opts.blue : opts.red);
    return (
      <dl className={`score-chip dh-chip ${side === ME ? 'is-ally' : 'is-enemy'}`} id={side === 'blue' ? 'score-azure' : 'score-crimson'}>
        <dt>
          <span className="dh-chip-who">{side === ME ? 'You' : 'Rival'}</span>
          <span className="dh-chip-faction">{f.short}</span>
          {side !== ME && (
            <span className="bf-mind" id="ai-mind">
              {MINDS.find((x) => x.id === opts.mind)?.label}
            </span>
          )}
        </dt>
        <dd className="dh-chip-stats">
          <span className="dh-stat" title="Money in the bank">
            <span className="score-resource-jewel" role="img" aria-label="Money" />
            <strong className="score-loyalty" data-testid={`money-${side}`}>
              {m.money[side]}
            </strong>
          </span>
          <span className="dh-stat dh-stat-claims" title="Claims score: first to the mark wins">
            <span className="dh-stat-label">Claims</span>
            <em data-testid={`dom-${side}`}>
              {m.dom[side]}
              <span className="score-cap">/ {m.goal}</span>
            </em>
          </span>
        </dd>
        <p className="bf-hold">
          Holding <b>{holdings(m, side)}</b> · bank +<b>{bankFor(m, side)}</b>
        </p>
      </dl>
    );
  };

  const coin = (u: Unit) => {
    const c = card(u.cardId);
    const foe = u.side !== ME;
    const picked = sel?.k === 'unit' && sel.uid === u.uid;
    const canStep = myTurn && !foe && (moveTargets(m, u.uid).length > 0 || strikeTargets(m, u.uid).length > 0);
    const myHits = hits.filter((h) => h.uid === u.uid);
    const fast = u.kw.includes('fast');
    return (
      <div
        role="button"
        tabIndex={0}
        data-unit={u.cardId}
        data-uid={u.uid}
        data-side={u.side}
        className={`stone-coin is-${u.side} ${foe ? 'coin-foe' : 'coin-mine'} ${picked ? 'stone-picked' : ''} ${u.sick || isSpent(u) ? 'is-sick' : ''} ${canStep && !picked ? 'can-step' : ''} ${u.leader ? 'is-leader' : ''}`}
        title={`${c.name} · Power ${u.power} · Cost ${c.cost}${fast ? ' · Fast' : ''}${u.kw.includes('ranged') ? ' · Ranged' : ''}${u.gear.length ? ` · Carrying ${u.gear.map((g) => card(g.cardId).name).join(', ')}` : ''}`}
        aria-label={`${c.name}, Power ${u.power}${u.gear.length ? `, carrying ${u.gear.map((g) => card(g.cardId).name).join(', ')}` : ''}`}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPeek({ c, power: u.power });
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPeek({ c, power: u.power });
        }}
      >
        <CoinFace c={c} />
        <span className="coin-stat coin-loyalty" title="Cost">
          <abbr>$</abbr>
          {c.cost}
        </span>
        <span className="coin-power-slot">
          <span className={`coin-stat coin-power ${u.power < u.maxPower ? 'coin-hurt' : ''}`} title="Power · vitality and damage">
            <abbr>P</abbr>
            {u.power}
          </span>
        </span>
        {u.gear.length > 0 && (
          <span className="coin-gear-row" data-testid="coin-gear">
            {u.gear.map((g) => (
              <span key={g.gid} className={`coin-gear ${g.owner !== u.side ? 'is-foreign' : ''}`} title={card(g.cardId).name}>
                <CardArt c={card(g.cardId)} />
              </span>
            ))}
          </span>
        )}
        {u.leader && <span className="coin-leader-mark" aria-hidden>★</span>}
        {myHits.map((h) => (
          <span key={h.id} className="coin-dmg-float" aria-hidden>
            {h.text.replace(/^-/, '−')}
          </span>
        ))}
        {fast && (
          <span className="coin-fast-dagger" title="Fast · strikes first in melee">
            <img src="/assets/icons/fast-dagger.svg" alt="" aria-hidden />
          </span>
        )}
      </div>
    );
  };

  const hand = m.hand[ME];
  const dragCard = drag ? (drag.src === 'leader' ? leaderCard : maybeCard(hand[drag.src] ?? '')) : undefined;
  const dragCoin = dragCard && (dragCard.kind === 'unit' || dragCard.kind === 'leader') ? dragCard : undefined;
  return (
    <div className="app app-shell">
      <nav className="shell-bar" aria-label="Game shell">
        <button type="button" className="brass-btn brass-btn-ghost shell-back" data-testid="back" onClick={onLeave}>
          Back
        </button>
        <p className="shell-brand">
          <span>Dust Hex</span>
          <em>{map.name}</em>
        </p>
      </nav>
    <section className="battlefield" id="battlefield" onClick={onBackdrop} data-testid="battlefield" data-turn={m.turn} data-side={m.side}>
      <header className="bf-hud">
        <div className="bf-scores" aria-label="Money and Claims">
          {scoreChip('blue')}
          <div className="bf-turn">
            <span className="bf-turn-label">Turn</span>
            <strong data-testid="turn-number">{m.turn}</strong>
            <span className={`bf-side is-${m.side}`}>{m.side === ME ? 'Yours' : 'Rival'}</span>
          </div>
          {scoreChip('red')}
        </div>
        <div className="bf-actions">
          <div className="leader-tray">
            <button type="button" className="leader-plate is-mine" id="my-leader" onClick={() => setPeek({ c: leaderCard })}>
              <CardArt c={leaderCard} className="leader-plate-art" />
              <span className="leader-plate-copy">
                <strong>
                  {leaderCard.name}
                  {m.leaderAt[ME] !== 'board' && <span className="dh-leader-state"> · {m.leaderAt[ME] === 'tray' ? 'in the tray' : m.leaderAt[ME] === 'fallen' ? 'fallen' : 'set aside'}</span>}
                </strong>
                <em>{leaderCard.text}</em>
              </span>
            </button>
            <button type="button" className="leader-plate is-foe" id="foe-leader" onClick={() => setPeek({ c: foeLeader })}>
              <CardArt c={foeLeader} className="leader-plate-art" />
              <span className="leader-plate-copy">
                <strong>
                  {foeLeader.name}
                  {m.leaderAt.red !== 'board' && <span className="dh-leader-state"> · {m.leaderAt.red === 'tray' ? 'in the tray' : m.leaderAt.red === 'fallen' ? 'fallen' : 'set aside'}</span>}
                </strong>
                <em>{foeLeader.text}</em>
              </span>
            </button>
          </div>
          {canLead && (
            <button type="button" className="brass-btn" id="leader-power" title={`${leaderCard.lead?.label}: ${leaderCard.lead?.text} Once a match.`} onClick={startLead}>
              Lead
            </button>
          )}
          <button type="button" className="brass-btn brass-btn-solid" id="end-turn" data-testid="end-turn" disabled={!myTurn} onClick={() => !inFlight() && act({ t: 'end' })}>
            End turn
          </button>
          <button
            type="button"
            className="brass-btn brass-btn-ghost"
            data-testid="yield"
            disabled={!!m.winner}
            onClick={() => {
              if (!yieldAsk) {
                setYieldAsk(true);
                window.setTimeout(() => setYieldAsk(false), 3500);
                return;
              }
              setYieldAsk(false);
              const r = applyAction(mRef.current, { t: 'yield', side: ME });
              if (!r.error) {
                setM(r.state);
                after(r.state);
              }
            }}
          >
            {yieldAsk ? 'Yield?' : 'Yield'}
          </button>
          <select
            id="bf-field-select"
            aria-label="Field"
            value={mapId}
            onChange={(e) => {
              setMapId(e.target.value);
              restart(e.target.value);
            }}
          >
            <optgroup label="Short rides">
              {MAPS.filter((x) => x.era === 'first').map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Far country">
              {MAPS.filter((x) => x.era !== 'first').map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </header>
      <div className="bf-banner-slot" aria-live="polite" ref={slotRef} style={drag ? { height: slotH.current, overflow: 'hidden' } : undefined}>
        {!drag && banner}
        {turnBanner && !reveal && (
          <div key={turnBanner.id} className={`dh-turn-banner is-${turnBanner.side}`} data-testid="turn-banner" onAnimationEnd={() => setTurnBanner(null)} aria-live="polite">
            <span>{turnBanner.side === ME ? 'Your Turn' : 'Rival Rides'}</span>
          </div>
        )}
        {reveal && (() => {
          const rc = reveal.cardId ? maybeCard(reveal.cardId) : undefined;
          return (
            <div key={reveal.key} className={`dh-trap-reveal dh-trap-${reveal.outcome}`} data-testid="trap-reveal" role="alert" onPointerDown={(e) => { e.stopPropagation(); setReveals((q) => q.slice(1)); }}>
              <div className="dh-trap-card">
                <div className="dh-trap-banner">Trap Sprung!</div>
                {rc ? <CardArt c={rc} className="dh-trap-art" alt={reveal.title} /> : <div className="dh-trap-art card-art-fallback" aria-hidden />}
                <h3 className="dh-trap-name">{reveal.title}</h3>
                <p className="dh-trap-text">{reveal.text}</p>
              </div>
              <p className="dh-trap-line">{reveal.line}</p>
              <p className="dh-trap-hint">{reveals.length > 1 ? `Tap for next (${reveals.length - 1} more)` : 'Tap to continue'}</p>
            </div>
          );
        })()}
        {!drag && toast && (
          <p className="dh-toast" data-testid="toast">
            {toast}
          </p>
        )}
      </div>
      <div className="bf-stage" style={{ position: 'relative' }}>
        <div className="bf-board-socket">
          <img className="bf-board-socket-frame" src="/assets/images/bf_board_frame.png" alt="" aria-hidden draggable={false} />
          <div className={`board-wrap${map.mood === 'bright' ? ' mood-bright' : ''}`} style={{ backgroundImage: `url(/assets/maps/${map.id}.jpg), url(/assets/maps/${map.id === 'big-empty' ? 'outer-fence' : 'gallows-mesa'}.jpg)` }}>
            <div ref={gridRef} onClick={onGridGap} className={`board-grid${m.w > 5 ? ' is-big' : ''}${drag ? ' is-dragging' : ''}`} role="grid" data-testid="board" style={{ gridTemplateColumns: `repeat(${m.w}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${m.h}, minmax(0, 1fr))` }}>
              {m.tiles.map((row, r) =>
                row.map((t, c) => {
                  if (t.k === 'void') return <div key={`${r}-${c}`} className="tile-void" aria-hidden />;
                  const k = `${r},${c}`;
                  const uid = m.board[r][c];
                  const u = uid ? m.units[uid] : undefined;
                  const owner = m.control[r][c];
                  const h = t.h ?? 0;
                  const trap = m.traps.find((x) => x.r === r && x.c === c && x.known[ME]);
                  const dev = m.tileDevices.find((x) => x.r === r && x.c === c);
                  const ring = m.rings.some((x) => x.r === r && x.c === c && x.until >= m.turn);
                  const scouted = m.scouted[ME].includes(k) && !trap;
                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      className={[
                        'stone',
                        `tile-${t.k}`,
                        t.k === 'resource' && t.sym === 2 ? 'tile-resource-2' : '',
                        owner ? `owned-${owner} held-${owner}` : '',
                        h ? `elev-${Math.min(2, h)}` : '',
                        trap ? `trap-${trap.kind === 'pit' ? 'deadfall' : trap.kind} trap-open` : '',
                        lit.tiles.has(k) ? 'legal-tile' : '',
                        lit.moves.has(k) ? 'legal-move' : '',
                        lit.strikes.has(k) ? 'legal-strike' : '',
                        selUnit && posOf(m, selUnit.uid)?.r === r && posOf(m, selUnit.uid)?.c === c ? 'stone-origin' : '',
                        u ? 'has-unit' : '',
                        drag?.over === k ? 'dh-drop-ok' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-tile-r={r}
                      data-tile-c={c}
                      data-testid={`tile-${r}-${c}`}
                      onClick={(e) => {
                        onTile(r, c);
                        e.currentTarget.blur();
                      }}
                    >
                      {t.k === 'gate' && <span className={`tile-mark gate-mark gate-${t.home ?? 'neutral'}${u ? ' mark-under' : ''}`} aria-hidden />}
                      {t.k === 'stronghold' && <span className={`tile-mark stronghold-mark stronghold-${t.home ?? 'neutral'}${u ? ' mark-under' : ''}`} aria-hidden />}
                      {t.k === 'resource' && <span className={`tile-mark resource-mark resource-${t.sym === 2 ? 'double' : 'single'}${u ? ' mark-under' : ''}`} aria-hidden />}
                      {h > 0 && <span className={`elev-mark elev-mark-${Math.min(2, h)}`}>{terrainLabel(h)}</span>}
                      {trap && <span className="trap-mark">{TRAP_LABEL[trap.kind] ?? trap.kind}</span>}
                      {!trap && scouted && <span className="trap-mark dh-safe">Clear</span>}
                      {dev && (
                        <span className={`dh-tile-device is-${dev.owner}`} title={card(dev.cardId).name}>
                          {card(dev.cardId).name}
                        </span>
                      )}
                      {ring && <span className="dh-ring" aria-hidden />}
                      {u && coin(u)}
                      {drag?.over === k && !u && dragCoin && (
                        // Where the coin will land: a faint coin already sitting in the snapped tile.
                        <span className={`stone-coin is-${ME} coin-mine dh-drop-preview${dragCoin.kind === 'leader' ? ' is-leader' : ''}`} aria-hidden data-testid="drop-preview">
                          <CoinFace c={dragCoin} />
                        </span>
                      )}
                    </button>
                  );
                }),
              )}
            </div>
            <WeatherLayer kind={weather} />
          </div>
        </div>
      </div>
      {(m.tray.blue.length > 0 || m.tray.red.length > 0 || trayActs.length > 0 || gearActsElsewhere.length > 0) && (
        <div className="dh-tray" data-testid="device-tray">
          {(['blue', 'red'] as Side[]).map((s) =>
            m.tray[s].map((d) => {
              const c = card(d.cardId);
              const usable = s === ME ? trayActs.find((x) => x.a.did === d.did) : undefined;
              return (
                <span key={d.did} className={`dh-device is-${s}${d.exhaustedTurn === m.turn ? ' is-spent' : ''}`}>
                  <button type="button" className="dh-device-face" onClick={() => setPeek({ c })} title={c.text}>
                    <CardArt c={c} />
                    <span>{c.name}</span>
                  </button>
                  {usable && (
                    <button type="button" className="brass-btn dh-act" data-testid={`device-act-${c.id}`} onClick={() => startAct(usable)}>
                      {usable.label}
                    </button>
                  )}
                </span>
              );
            }),
          )}
          {trayActs
            .filter((x) => !m.tray[ME].some((d) => d.did === x.a.did))
            .map((x) => (
              <button key={x.a.did} type="button" className="brass-btn dh-act" data-testid="tile-device-act" onClick={() => startAct(x)}>
                {x.name}: {x.label}
              </button>
            ))}
          {gearActsElsewhere.map((x) => (
            <button key={`${x.a.uid}-${x.a.gid}`} type="button" className="brass-btn dh-act" data-testid="gear-act" onClick={() => startAct(x)}>
              {x.name} ({card(m.units[x.a.uid!].cardId).name}): {x.label}
            </button>
          ))}
        </div>
      )}
      <ul className="board-key">
        <li>
          <i className="legend-mark legend-gate" />
          Step on a circle to claim it · each claim adds to your Claims every round
        </li>
        <li>
          <i className="legend-mark legend-stronghold" />
          Stronghold · banks 2 · always deploys
        </li>
        <li>
          <i className="legend-mark legend-resource" />
          Money claim
        </li>
        <li>
          <i className="legend-jewels" />
          Money +2
        </li>
        <li>
          <span className="key-coin key-loyalty">$</span>Cost
        </li>
        <li>
          <span className="key-coin key-power">P</span>Power (combat)
        </li>
      </ul>
      <div className="hand-rail">
        <p className="hand-kicker">
          <span className="deck-pile" id="deck-pile" title="Cards left in your deck">
            <span className="dh-card-back deck-pile-back" />
            <span className="deck-pile-count" data-testid="deck-count">
              {m.deck[ME].length}
            </span>
          </span>
          <span className="dh-kicker-text">
            <strong>Your hand</strong>
            <span className="dh-kicker-help">Drag a card toward a lit tile and it snaps on, or tap the card then the tile. Hold still or double-click to read.</span>
          </span>
        </p>
        <div className={`hand-scroller dh-scroller${rail.overflow ? ' is-overflowing' : ''}${rail.atStart ? ' at-start' : ''}${rail.atEnd ? ' at-end' : ''}`} data-testid="hand-scroller">
          {rail.overflow && (
            <button type="button" className="dh-hand-arrow is-prev" data-testid="hand-prev" aria-label="Scroll hand left" disabled={rail.atStart} onClick={() => nudgeHand(-1)}>
              ‹
            </button>
          )}
          <div className="hand-scroller-view">
            <div className="hand-row hand-row-slide" ref={rowRef} data-testid="hand-row">
              {m.leaderAt[ME] === 'tray' && (
                <button
                  type="button"
                  className={`hand-card kind-hero hand-leader ${sel?.k === 'leader' ? 'is-selected' : ''} ${myTurn && canAfford(m, ME, leaderCard.id) ? 'is-draggable' : 'is-disabled'}`}
                  id="hand-leader"
                  data-testid="hand-leader"
                  onPointerDown={startGesture('leader', leaderCard)}
                  onClick={tapGuard(() => {
                    if (!myTurn) return setPeek({ c: leaderCard });
                    if (!canAfford(m, ME, leaderCard.id)) return setToast(`${leaderCard.name} costs ${leaderCard.cost}. You have ${m.money[ME]}.`);
                    setSel(sel?.k === 'leader' ? null : { k: 'leader' });
                  })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setPeek({ c: leaderCard });
                  }}
                  onDoubleClick={() => setPeek({ c: leaderCard })}
                >
                  <span className="hand-card-pip hand-card-loyalty">{leaderCard.cost}</span>
                  <CardArt c={leaderCard} />
                  <span className="hand-leader-tag">Leader</span>
                  <span className="hand-card-name">{leaderCard.name}</span>
                  <span className="hand-card-pip hand-card-power">{leaderCard.power}</span>
                </button>
              )}
              {hand.map((id, i) => {
                const c = card(id);
                const afford = canAfford(m, ME, id);
                const kindCls = c.kind === 'unit' ? 'kind-unit' : c.kind === 'rite' ? 'kind-rite' : 'kind-device';
                return (
                  <button
                    key={`${id}-${i}`}
                    type="button"
                    className={`hand-card ${kindCls} ${sel?.k === 'hand' && sel.i === i ? 'is-selected' : ''} ${myTurn && afford ? 'is-draggable' : 'is-disabled'}`}
                    data-testid={`hand-${i}`}
                    data-card={id}
                    onPointerDown={startGesture(i, c)}
                    onClick={tapGuard(() => onHand(i))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setPeek({ c });
                    }}
                    onDoubleClick={() => setPeek({ c })}
                    title={`${c.name} · ${c.text}`}
                  >
                    <span className="hand-card-pip hand-card-loyalty">{playCost(m, ME, c)}</span>
                    <CardArt c={c} />
                    {c.kind === 'unit' && (
                      <span className="art-motion art-fog">
                        <i className="fog f1" />
                        <i className="fog f2" />
                      </span>
                    )}
                    <span className="hand-card-name">{c.name}</span>
                    <span className="hand-card-kind">{KIND_LABEL[c.kind] ?? c.kind}</span>
                    {c.power != null && c.kind === 'unit' && <span className="hand-card-pip hand-card-power">{c.power}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          {rail.overflow && (
            <button type="button" className="dh-hand-arrow is-next" data-testid="hand-next" aria-label="Scroll hand right" disabled={rail.atEnd} onClick={() => nudgeHand(1)}>
              ›
            </button>
          )}
        </div>
        {rail.overflow && (
          <input
            type="range"
            className="dh-hand-slider"
            data-testid="hand-slider"
            aria-label="Scroll your hand"
            min={0}
            max={1000}
            value={rail.value}
            onChange={(e) => {
              const el = rowRef.current;
              if (el) el.scrollLeft = sliderToScroll(Number(e.target.value), el.scrollWidth, el.clientWidth);
            }}
          />
        )}
      </div>
      {drag && (
        <div className={`dh-ghost${drag.over ? ' is-on-target' : ''}`} style={{ left: drag.x, top: drag.y }} aria-hidden data-testid="drag-ghost" data-over={drag.over ?? ''}>
          {(() => {
            const c = drag.src === 'leader' ? leaderCard : card(hand[drag.src] ?? 'jesse');
            return (
              c.kind === 'unit' || c.kind === 'leader' ? (
                // The coin this card becomes, hovering over the tile it would land on.
                <span className="dh-ghost-coinwrap">
                  <span className={`stone-coin is-${ME} coin-mine dh-ghost-coin${c.kind === 'leader' ? ' is-leader' : ''}`}>
                    <CoinFace c={c} />
                    <span className="coin-power-slot">
                      <span className="coin-stat coin-power">{c.power}</span>
                    </span>
                    {c.kind === 'leader' && <span className="coin-leader-mark" aria-hidden>★</span>}
                  </span>
                  <span className="dh-ghost-name">{c.name}</span>
                </span>
              ) : (
                <span className="dh-ghost-card">
                  <CardArt c={c} />
                  <span>{c.name}</span>
                </span>
              )
            );
          })()}
        </div>
      )}
      <aside className="bf-log">
        <h3>Chronicle</h3>
        <ol data-testid="chronicle">
          {[...m.log].reverse().slice(0, 60).map((l, i) => (
            <li key={`${m.log.length - i}`}>{l}</li>
          ))}
        </ol>
      </aside>
      {peek && <CardPeek c={peek.c} power={peek.power} onClose={() => setPeek(null)} />}
      {m.winner && (
        <div className={`match-veil ${m.winner === ME ? 'is-victory' : 'is-defeat'}`} role="dialog" data-testid="match-over" data-winner={m.winner}>
          <div className="match-plate">
            <p className="match-kicker">{m.winKind === 'claims' ? 'Claims' : m.winKind === 'stronghold' ? 'Stronghold' : 'Yield'}</p>
            <h2>{m.winner === ME ? 'Victory' : 'Defeat'}</h2>
            <p className="match-reason">
              {m.winKind === 'claims'
                ? m.winner === ME
                  ? 'You win on Claims. Your hold on the range carried it.'
                  : 'The rival wins on Claims. Their hold on the range carried it.'
                : m.winKind === 'stronghold'
                  ? m.winner === ME
                    ? 'You took the rival’s stronghold.'
                    : 'The rival took your stronghold.'
                  : m.winner === ME
                    ? 'The rival yielded the ground.'
                    : 'You yielded the ground.'}
            </p>
            <p className="match-score">
              Claims · You {m.dom.blue} / {m.goal} · Rival {m.dom.red} / {m.goal} · Turn {m.turn}
            </p>
            <div className="match-actions">
              <button type="button" className="brass-btn brass-btn-solid" data-testid="new-match" onClick={() => restart()}>
                New match
              </button>
              <button type="button" className="brass-btn brass-btn-ghost" onClick={onLeave}>
                Back to the porch
              </button>
            </div>
          </div>
        </div>
      )}
      {primer && (
        <div className="primer-veil" role="dialog" aria-modal="true" aria-labelledby="primer-title" data-testid="rules-primer">
          <div className="primer-plate">
            <h2 id="primer-title">How a turn is fought</h2>
            <ul>
              {PRIMER.map((l) => (
                <li key={l.slice(0, 24)}>{l}</li>
              ))}
            </ul>
            <button
              type="button"
              className="brass-btn brass-btn-solid"
              data-testid="primer-dismiss"
              onClick={() => {
                try {
                  localStorage.setItem(SEEN, '1');
                } catch {
                  /* ignore */
                }
                setPrimer(false);
              }}
            >
              Ride
            </button>
          </div>
        </div>
      )}
    </section>
    </div>
  );
}

export function leaderName(f: FactionId) {
  return leaderOf(f).name;
}
