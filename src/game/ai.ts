/**
 * Rival mind. Greedy one-step search over legal actions using the pure engine:
 * try each action on a copy, answer any choices it raises, score the result.
 * It always musters when it can afford a unit and has a free door.
 */
import { card } from './cards';
import { dist, hasKw, posOf, strongholdOf, unitsOf, other } from './core';
import { actError, applyAction, bankFor, deployTiles, holdings, moveTargets, playCost, strikeTargets, targetOptions } from './engine';
import type { Action, Match, Side, Target } from './types';

export type Mind = 'easy' | 'experienced' | 'expert';

function unitValue(m: Match, uid: string) {
  const u = m.units[uid];
  const c = card(u.cardId);
  let v = u.power * 2.2 + u.maxPower * 0.6 + c.cost * 0.4;
  for (const k of ['fast', 'ranged', 'tough', 'hold', 'harbor', 'crown', 'steady', 'evenGround', 'untargetable']) if (hasKw(u, k)) v += 1.2;
  if (c.ab?.length) v += 0.8;
  if (u.leader) v += 3;
  v += u.gear.length * 1.2;
  return v;
}

export function evaluate(m: Match, side: Side): number {
  const foe = other(side);
  if (m.winner) return m.winner === side ? 1e6 : -1e6;
  let s = 0;
  const left = (x: Side) => Math.max(1, m.goal - m.dom[x]);
  s += (m.dom[side] - m.dom[foe]) * 1.4;
  s += 30 / left(foe) > 4 ? -20 : 0;
  s += holdings(m, side) * 4 - holdings(m, foe) * 4;
  s += bankFor(m, side) * 1.6 - bankFor(m, foe) * 1.6;
  s += m.money[side] * 0.5 - m.money[foe] * 0.3;
  s += m.hand[side].length * 0.7 - m.hand[foe].length * 0.4;
  s += m.tray[side].length * 2 - m.tray[foe].length * 2;
  const myHome = strongholdOf(m, side);
  const theirHome = strongholdOf(m, foe);
  for (const u of Object.values(m.units)) {
    const p = posOf(m, u.uid);
    if (!p) continue;
    const v = unitValue(m, u.uid);
    if (u.side === side) {
      s += v;
      if (theirHome) {
        const d = dist(p, theirHome);
        s += Math.max(0, 7 - d) * 0.9;
        if (d === 1) s += 6;
      }
    } else {
      s -= v;
      if (myHome) {
        const d = dist(p, myHome);
        s -= Math.max(0, 7 - d) * 1.1;
        if (d === 1) s -= 14;
      }
    }
  }
  for (const t of m.traps) if (t.owner === side) s += 1;
  return s;
}

/** Answer pending choices for whichever side owns them, greedily. */
export function settleAI(m: Match, depth = 0): Match {
  let s = m;
  for (let i = 0; i < 12 && s.pending.length; i++) {
    const a = choosePending(s, depth + 1);
    const r = applyAction(s, a);
    if (r.error) {
      const sk = applyAction(s, { t: 'skip' });
      if (sk.error) {
        const first = s.pending[0].options[0];
        const f = first ? applyAction(s, { t: 'choose', key: first.key }) : sk;
        s = f.state;
      } else s = sk.state;
    } else s = r.state;
  }
  return s;
}

export function choosePending(m: Match, depth = 0): Action {
  const p = m.pending[0];
  const side = p.side;
  const opts: Action[] = p.options.slice(0, 24).map((o) => ({ t: 'choose', key: o.key }));
  if (p.optional || !p.options.length) opts.push({ t: 'skip' });
  if (depth > 2 || opts.length === 1) return opts[0];
  let best = opts[0];
  let bestScore = -Infinity;
  for (const a of opts) {
    const r = applyAction(m, a);
    if (r.error) continue;
    const after = r.state.pending.length && depth < 2 ? settleAI(r.state, depth + 1) : r.state;
    const sc = evaluate(after, side);
    if (sc > bestScore) {
      bestScore = sc;
      best = a;
    }
  }
  return best;
}

/** Every action worth trying for `side` right now. */
export function candidates(m: Match, side: Side): Action[] {
  const out: Action[] = [];
  const known = (r: number, c: number) => m.traps.some((t) => t.r === r && t.c === c && t.owner !== side && t.known[side]);
  // Musters.
  const deployable: { i: number | 'leader'; id: string }[] = m.hand[side].map((id, i) => ({ i, id })).filter((x) => card(x.id).kind === 'unit');
  if (m.leaderAt[side] === 'tray') deployable.push({ i: 'leader', id: m.leader[side] });
  const seen = new Set<string>();
  for (const d of deployable) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    if (m.money[side] < playCost(m, side, card(d.id))) continue;
    let tiles = deployTiles(m, side, d.id);
    if (tiles.length > 6) {
      const home = strongholdOf(m, other(side));
      tiles = [...tiles].sort((a, b) => (home ? dist({ r: a[0], c: a[1] }, home) - dist({ r: b[0], c: b[1] }, home) : 0)).slice(0, 6);
    }
    for (const [r, c] of tiles) out.push({ t: 'deploy', i: d.i, r, c });
  }
  // Rites, items, devices, traps.
  m.hand[side].forEach((id, i) => {
    const c = card(id);
    if (c.kind === 'unit' || c.kind === 'leader') return;
    if (m.money[side] < playCost(m, side, c)) return;
    if (m.hand[side].indexOf(id) !== i) return;
    if (!c.target || c.target.kind === 'none') {
      out.push({ t: 'play', i });
      return;
    }
    let ts = targetOptions(m, side, c.target, c.kind === 'rite');
    if (c.trapKind || c.attach === 'tile') {
      const home = strongholdOf(m, side);
      ts = ts.filter((t) => t.r != null && home && dist({ r: t.r, c: t.c! }, home) >= 2 && dist({ r: t.r, c: t.c! }, home) <= 4).slice(0, 6);
    }
    if (!ts.length && c.target.optional) out.push({ t: 'play', i });
    for (const t of ts.slice(0, 10)) out.push({ t: 'play', i, target: t });
  });
  // Acts.
  for (const u of unitsOf(m, side)) {
    const acts: { gid?: string; spec: ReturnType<typeof card>['act'] }[] = [];
    if (card(u.cardId).act) acts.push({ spec: card(u.cardId).act });
    for (const g of u.gear) if (card(g.cardId).act) acts.push({ gid: g.gid, spec: card(g.cardId).act });
    for (const a of acts) {
      const ts: (Target | undefined)[] = a.spec?.target ? targetOptions(m, side, a.spec.target, false).slice(0, 8) : [undefined];
      for (const t of ts) if (!actError(m, side, { uid: u.uid, gid: a.gid }, t)) out.push({ t: 'act', uid: u.uid, gid: a.gid, target: t });
    }
  }
  for (const d of [...m.tray[side], ...m.tileDevices.filter((x) => x.owner === side)]) {
    const spec = card(d.cardId).act;
    if (!spec) continue;
    const ts: (Target | undefined)[] = spec.target ? targetOptions(m, side, spec.target, false).slice(0, 8) : [undefined];
    for (const t of ts) if (!actError(m, side, { did: d.did }, t)) out.push({ t: 'act', did: d.did, target: t });
  }
  // Lead.
  if (!m.leadUsed[side]) {
    const lead = card(m.leader[side]).lead;
    if (lead) {
      if (lead.target) for (const t of targetOptions(m, side, lead.target, false).slice(0, 6)) out.push({ t: 'lead', target: t });
      if (!lead.target || lead.target.optional) out.push({ t: 'lead' });
    }
  }
  // Moves and strikes.
  for (const u of unitsOf(m, side)) {
    for (const [r, c] of strikeTargets(m, u.uid)) out.push({ t: 'strike', uid: u.uid, r, c });
    for (const [r, c] of moveTargets(m, u.uid)) if (!known(r, c) || hasKw(u, 'trapproof')) out.push({ t: 'move', uid: u.uid, r, c });
  }
  return out;
}

export interface Plan {
  action: Action;
  score: number;
}

/** The next action for the side to move, or `end`. */
export function chooseAction(m: Match, mind: Mind = 'expert', rnd: () => number = Math.random): Action {
  const side = m.side;
  if (m.pending.length) return choosePending(m);
  const base = evaluate(m, side);
  const cands = candidates(m, side);
  const noise = mind === 'easy' ? 5 : mind === 'experienced' ? 1.2 : 0;
  let best: Plan | null = null;
  let bestDeploy: Plan | null = null;
  for (const a of cands) {
    const r = applyAction(m, a);
    if (r.error) continue;
    const after = r.state.pending.length ? settleAI(r.state) : r.state;
    let sc = evaluate(after, side) + (noise ? (rnd() - 0.5) * noise * 2 : 0);
    // Rites and LEAD are spent resources: make them earn their place.
    if (a.t === 'lead') sc -= 2.5;
    if (a.t === 'play') sc -= 0.8;
    if (!best || sc > best.score) best = { action: a, score: sc };
    if (a.t === 'deploy' && (!bestDeploy || sc > bestDeploy.score)) bestDeploy = { action: a, score: sc };
  }
  if (mind === 'easy' && rnd() < 0.15 && bestDeploy) return bestDeploy.action;
  if (best && best.score > base + 0.4) return best.action;
  // Never sit on money with an open door: muster something.
  if (bestDeploy) return bestDeploy.action;
  return { t: 'end' };
}

/** Run the AI side until it ends its turn (for tests and headless matches). */
export function playTurn(m: Match, mind: Mind = 'expert', rnd: () => number = Math.random, maxSteps = 40): Match {
  let s = m;
  const side = s.side;
  for (let i = 0; i < maxSteps && !s.winner && s.side === side; i++) {
    const a = s.pending.length ? choosePending(s) : chooseAction(s, mind, rnd);
    const r = applyAction(s, a);
    if (r.error) {
      const e = applyAction(s, s.pending.length ? { t: 'skip' } : { t: 'end' });
      s = e.error ? s : e.state;
      if (e.error) break;
      continue;
    }
    s = r.state;
  }
  if (!s.winner && s.side === side && !s.pending.length) s = applyAction(s, { t: 'end' }).state;
  return s;
}
