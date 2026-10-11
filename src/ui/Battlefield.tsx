import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, Card, FactionId, Match, Side, Target, TargetSpec, Unit } from '../game/types';
import { card, faction, leaderOf, maybeCard } from '../game/cards';
import { MAPS, actError, applyAction, bankFor, canAfford, deployTiles, holdings, mapById, moveTargets, newMatch, playCost, strikeTargets, targetOptions } from '../game/engine';
import { chooseAction, choosePending, type Mind } from '../game/ai';
import { isSpent } from '../game/rules';
import { posOf, unitAt } from '../game/core';
import { CardArt, CardPeek } from './cardview';
import { MINDS } from './Porch';
import { WeatherLayer, pickWeather } from './Weather';
import { playMusic, sfx, soundEvents } from './sound';

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

const PRIMER = [
  'Each side owns one stronghold. It banks 2 money every turn, you can always muster a unit there, and it counts as a claim.',
  'Gates you hold, and your stronghold, are the only places a unit can enter. A claim you take stays yours and banks its money.',
  'Both sides score dominance together at the end of each round, 1 per claim held (your stronghold counts), so going first banks no lead. Reach the number beside the score to win.',
  'A card costs the one number printed on it. If the bank can pay that number, you may play it.',
  'Each unit either moves or strikes once a turn. Melee strikes are answered; fast lands first and a killing stroke is not answered. Power is vitality and damage as one number.',
  'Ranged units reach two tiles in a straight line, never on a diagonal, and are not answered. High ground adds 1. A unit striking up a ridge in melee misses one blow in three.',
  'Take the enemy stronghold to end the fight at once. You may yield the ground if the hour turns against you.',
  'The range is haunted. Hidden deaths — a rattler, a shaft, a deadfall — are not marked until someone finds them.',
  'Your leader waits in the tray. Muster them like a unit. Once a match, Lead calls on their power.',
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
  const [peek, setPeek] = useState<{ c: Card; power?: number } | null>(null);
  const [hits, setHits] = useState<{ id: number; uid: string; text: string }[]>([]);
  const [yieldAsk, setYieldAsk] = useState(false);
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

  useEffect(() => {
    playMusic('ghost-town');
  }, []);

  const after = useCallback((next: Match) => {
    soundEvents(next.events, ME);
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
    if (!aiToMove || primer) return;
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
    }, AI_DELAY);
    return () => window.clearTimeout(id);
  }, [m, aiToMove, opts.mind, after, primer]);

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

  const onTile = (r: number, c: number) => {
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
    if (sel?.k === 'hand' && card(m.hand[ME][sel.i]).kind === 'unit' && lit.tiles.has(key)) return void act({ t: 'deploy', i: sel.i, r, c });
    if (sel?.k === 'leader' && lit.tiles.has(key)) return void act({ t: 'deploy', i: 'leader', r, c });
    if (sel?.k === 'unit') {
      if (lit.strikes.has(key)) return void act({ t: 'strike', uid: sel.uid, r, c });
      if (lit.moves.has(key)) return void act({ t: 'move', uid: sel.uid, r, c });
    }
    if (u && u.side === ME) {
      if (sel?.k === 'unit' && sel.uid === u.uid) return setSel(null);
      return setSel({ k: 'unit', uid: u.uid });
    }
    if (u) return setPeek({ c: card(u.cardId), power: u.power });
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
    setM(startMatch({ ...opts, deal: undefined, money: undefined }, map));
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
              : 'muster on a lit tile.'
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
          <strong>{leaderCard.name}</strong> · muster on a lit tile. {cancel}
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
      <dl className={`score-chip ${side === ME ? 'is-ally' : 'is-enemy'}`} id={side === 'blue' ? 'score-azure' : 'score-crimson'}>
        <dt>
          {side === ME ? 'Your side' : 'The rival'} · {f.short}
          {side !== ME && (
            <span className="bf-mind" id="ai-mind">
              {MINDS.find((x) => x.id === opts.mind)?.label}
            </span>
          )}
        </dt>
        <dd>
          <span className="score-resource-jewel" role="img" aria-label="Money" />
          <strong className="score-loyalty" data-testid={`money-${side}`}>
            {m.money[side]}
          </strong>
          <span>money</span>
          <em data-testid={`dom-${side}`}>
            {m.dom[side]}
            <span className="score-cap">/ {m.goal}</span>
          </em>
          <span>dom</span>
        </dd>
        <p className="bf-hold">
          Holding <b>{holdings(m, side)}</b> · next bank +<b>{bankFor(m, side)}</b>
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
        <CardArt c={c} className="stone-face" />
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
    <section className="battlefield" id="battlefield" data-testid="battlefield" data-turn={m.turn} data-side={m.side}>
      <header className="bf-hud">
        <div className="bf-scores" aria-label="Money and dominance">
          {scoreChip('blue')}
          <div className="bf-turn">
            <span className="bf-turn-label">Turn</span>
            <strong data-testid="turn-number">{m.turn}</strong>
            <span className={`bf-side is-${m.side}`}>{m.side === ME ? 'Your side' : 'The rival'}</span>
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
          <button type="button" className="brass-btn brass-btn-solid" id="end-rite" data-testid="end-turn" disabled={!myTurn} onClick={() => act({ t: 'end' })}>
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
      <div className="bf-banner-slot" aria-live="polite">
        {banner}
        {toast && (
          <p className="dh-toast" data-testid="toast">
            {toast}
          </p>
        )}
      </div>
      <div className="bf-stage" style={{ position: 'relative' }}>
        <div className="bf-board-socket">
          <img className="bf-board-socket-frame" src="/assets/images/bf_board_frame.png" alt="" aria-hidden draggable={false} />
          <div className={`board-wrap${map.mood === 'bright' ? ' mood-bright' : ''}`} style={{ backgroundImage: `url(/assets/maps/${map.id}.jpg), url(/assets/maps/${map.id === 'big-empty' ? 'outer-seal' : 'ashen-cross'}.jpg)` }}>
            <div className={`board-grid${m.w > 5 ? ' is-big' : ''}`} role="grid" data-testid="board" style={{ gridTemplateColumns: `repeat(${m.w}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${m.h}, minmax(0, 1fr))` }}>
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
          Step on a circle to claim it · claims score dominance each round
        </li>
        <li>
          <i className="legend-mark legend-stronghold" />
          Stronghold · banks 2 · always musters
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
            <span className="ow-card-back deck-pile-back" />
            <span className="deck-pile-count" data-testid="deck-count">
              {m.deck[ME].length}
            </span>
          </span>
          Your hand · tap a card, then a lit tile · tap a coin to move or strike · double-tap to read
        </p>
        <div className="hand-scroller" data-testid="hand-scroller">
          <div className="hand-scroller-view">
            <div className="hand-row hand-row-slide">
              {m.leaderAt[ME] === 'tray' && (
                <button
                  type="button"
                  className={`hand-card kind-hero hand-leader ${sel?.k === 'leader' ? 'is-selected' : ''} ${myTurn && canAfford(m, ME, leaderCard.id) ? 'is-draggable' : 'is-disabled'}`}
                  id="hand-leader"
                  data-testid="hand-leader"
                  onClick={() => {
                    if (!myTurn) return setPeek({ c: leaderCard });
                    if (!canAfford(m, ME, leaderCard.id)) return setToast(`${leaderCard.name} costs ${leaderCard.cost}. You have ${m.money[ME]}.`);
                    setSel(sel?.k === 'leader' ? null : { k: 'leader' });
                  }}
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
                    onClick={() => onHand(i)}
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
                    <span className="hand-card-kind">{c.kind}</span>
                    {c.power != null && c.kind === 'unit' && <span className="hand-card-pip hand-card-power">{c.power}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
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
            <p className="match-kicker">{m.winKind === 'dominance' ? 'Dominance' : m.winKind === 'stronghold' ? 'Stronghold' : 'Yield'}</p>
            <h2>{m.winner === ME ? 'Victory' : 'Defeat'}</h2>
            <p className="match-reason">
              {m.winKind === 'dominance'
                ? m.winner === ME
                  ? 'Your claims carried the range.'
                  : 'The rival’s claims carried the range.'
                : m.winKind === 'stronghold'
                  ? m.winner === ME
                    ? 'You took the rival’s stronghold.'
                    : 'The rival took your stronghold.'
                  : m.winner === ME
                    ? 'The rival yielded the ground.'
                    : 'You yielded the ground.'}
            </p>
            <p className="match-score">
              Your side {m.dom.blue} / {m.goal} · The rival {m.dom.red} / {m.goal} · Turn {m.turn}
            </p>
            <div className="match-actions">
              <button type="button" className="brass-btn brass-btn-solid" data-testid="new-sitting" onClick={() => restart()}>
                New sitting
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
