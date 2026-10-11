/**
 * Dust Hex rules: damage, death, triggers, movement, strikes, and every
 * ability op named in cards.json. Mutates the Match it is given; engine.ts
 * clones before calling in.
 */
import { card } from './cards';
import {
  abilitiesOf,
  adjacentUnits,
  allTiles,
  bank,
  canDeployOn,
  dist,
  draw,
  hasKw,
  hasStatic,
  heightAt,
  isEmptyTile,
  isPaintable,
  isVoid,
  key,
  leaderUnit,
  log,
  loseMoney,
  nameOf,
  neighbors,
  nextTurnOf,
  onHalf,
  other,
  pick,
  posOf,
  pushPending,
  rand,
  sideName,
  tileAt,
  tileDeviceAt,
  trapAt,
  unitAt,
  unitsOf,
  HAND_CAP,
} from './core';
import type { Ability, Card, Gear, Match, PendingOption, Side, Target, Unit } from './types';

// ------------------------------------------------------------------ units

export function makeUnit(m: Match, cardId: string, side: Side, opts: { leader?: boolean; sick?: boolean } = {}): Unit {
  const c = card(cardId);
  const p = c.power ?? 1;
  const sick = opts.sick ?? c.kw.includes('delay');
  return {
    uid: `u${m.seq++}`,
    cardId,
    side,
    power: p,
    maxPower: p,
    kw: [...c.kw],
    moved: sick,
    attacked: sick,
    sick,
    steps: 0,
    gear: [],
    leader: opts.leader || c.kind === 'leader' || undefined,
    enteredTurn: m.turn,
    spent: [],
    turnUse: {},
  };
}

export function gearOp(g: Gear) {
  return card(g.cardId).gear?.op ?? '';
}

function gearN(g: Gear, d: number) {
  return card(g.cardId).gear?.n ?? d;
}

export function hasGear(u: Unit, op: string) {
  return u.gear.some((g) => gearOp(g) === op && !g.used);
}

/** Exhaust: on its own turn it is spent; on the other side's turn it sits out its next turn. */
export function exhaustUnit(m: Match, u: Unit) {
  if (u.side === m.side) {
    u.moved = true;
    u.attacked = true;
    u.steps = 0;
  } else {
    const t = nextTurnOf(m, u.side);
    u.pinUntil = Math.max(u.pinUntil ?? 0, t);
    u.noStrikeUntil = Math.max(u.noStrikeUntil ?? 0, t);
  }
}

export function readyUnit(u: Unit) {
  u.moved = false;
  u.attacked = false;
  u.sick = false;
}

export function isSpent(u: Unit) {
  return u.moved || u.attacked || u.sick;
}

/** Can an enemy rite name this unit? Returns a reason when it cannot. */
export function riteBlock(m: Match, caster: Side, u: Unit): string | null {
  if (u.side === caster) return null;
  if (hasKw(u, 'untargetable')) return `${nameOf(u)} cannot be named by rites.`;
  if ((u.wardUntil ?? 0) >= m.turn) return `${nameOf(u)} is warded from rites.`;
  if (hasKw(u, 'winged') && u.enteredTurn === m.turn) return `${nameOf(u)} cannot be named the turn it enters.`;
  const p = posOf(m, u.uid);
  if (p) {
    const dev = tileDeviceAt(m, p.r, p.c);
    if (dev && dev.owner === u.side && card(dev.cardId).id === 'sibley') return `${nameOf(u)} is under the Sibley tent.`;
  }
  const harbor = unitsOf(m, u.side).find((x) => x.uid !== u.uid && hasKw(x, 'harbor'));
  if (harbor) return `${nameOf(harbor)} harbors the others. Name ${nameOf(harbor)} or nothing.`;
  return null;
}

// ------------------------------------------------------------------ damage & death

export interface DmgOpts {
  strike?: boolean;
  killer?: string | null;
  /** "Loses N Power": no Tough, no shields. */
  raw?: boolean;
  source?: string;
}

function tenBearsFor(m: Match, side: Side) {
  return unitsOf(m, side).some((x) => hasStatic(x, 'tenBears'));
}

export function damage(m: Match, uid: string, n: number, o: DmgOpts = {}): number {
  const u = m.units[uid];
  if (!u || n <= 0) return 0;
  let amt = n;
  if (!o.raw && hasKw(u, 'tough')) amt = Math.max(0, amt - 1);
  if (o.strike && u.struckTurn !== m.turn) {
    u.struckTurn = m.turn;
    if (hasKw(u, 'duty')) {
      if (amt > 0) log(m, `${nameOf(u)} does not give ground to the first strike.`);
      amt = 0;
    } else if (tenBearsFor(m, u.side)) {
      if (amt > 0) log(m, `Ten Bears' word holds: ${nameOf(u)} loses nothing from the first strike.`);
      amt = 0;
    } else {
      for (const g of u.gear) if (gearOp(g) === 'shield') amt -= gearN(g, 1);
    }
    amt = Math.max(0, amt);
  }
  if (amt > 0 && hasStatic(u, 'firstWound') && !u.spent.includes('wound')) {
    u.spent.push('wound');
    log(m, `The first wound on ${nameOf(u)} does not count.`);
    amt = 0;
  }
  if (amt <= 0) return 0;
  u.power -= amt;
  m.events.push({ e: 'damage', uid, n: amt });
  if (u.power > 0) {
    const kit = u.gear.find((g) => gearOp(g) === 'surgeon');
    if (kit && u.power < u.maxPower) {
      const heal = Math.min(gearN(kit, 2), u.maxPower - u.power);
      u.power += heal;
      removeGear(m, u, kit.gid, 'exile');
      log(m, `The Surgeon's Roll gives ${nameOf(u)} back ${heal} Power.`);
    }
    return amt;
  }
  // Saves, in printed order of strength.
  const killer = o.killer ? m.units[o.killer] : undefined;
  if (o.strike && hasStatic(u, 'hangFire') && !u.spent.includes('hangFire')) {
    u.spent.push('hangFire');
    u.power = 1;
    log(m, `${nameOf(u)} does not fall. He fires back.`);
    if (killer) damage(m, killer.uid, u.maxPower, { strike: true, killer: u.uid });
    return amt;
  }
  if (o.strike) {
    const wheel = u.gear.find((g) => gearOp(g) === 'cheatDeath');
    if (wheel) {
      u.power = 1;
      removeGear(m, u, wheel.gid, 'exile');
      log(m, `The chamber was empty on purpose. ${nameOf(u)} stands at 1.`);
      return amt;
    }
  }
  if (hasKw(u, 'lastStand') && !u.spent.includes('lastStand')) {
    u.spent.push('lastStand');
    u.power = 1;
    log(m, `${nameOf(u)} stands at 1.`);
    return amt;
  }
  if (hasStatic(u, 'breakAway') && !u.spent.includes('breakAway')) {
    const spot = breakAwaySpot(m, u);
    if (spot) {
      u.spent.push('breakAway');
      u.power = 1;
      const from = posOf(m, u.uid)!;
      m.board[from.r][from.c] = null;
      m.board[spot.r][spot.c] = u.uid;
      m.events.push({ e: 'move', uid: u.uid, from: [from.r, from.c], to: [spot.r, spot.c] });
      log(m, `${nameOf(u)} breaks away.`);
      return amt;
    }
  }
  destroy(m, uid, { killer: o.killer ?? null, byStrike: !!o.strike });
  return amt;
}

function breakAwaySpot(m: Match, u: Unit): { r: number; c: number } | null {
  const p = posOf(m, u.uid);
  if (!p) return null;
  const enemies = unitsOf(m, other(u.side)).map((e) => posOf(m, e.uid)!).filter(Boolean);
  const score = (r: number, c: number) => Math.min(99, ...enemies.map((e) => dist(e, { r, c })));
  const near = neighbors(m, p.r, p.c).filter(([r, c]) => isEmptyTile(m, r, c));
  const pool = near.length ? near : allTiles(m).filter(([r, c]) => isEmptyTile(m, r, c) && onHalf(m, u.side, r, c));
  if (!pool.length) return null;
  pool.sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]));
  return { r: pool[0][0], c: pool[0][1] };
}

export function heal(_m: Match, u: Unit, n: number) {
  const h = Math.min(n, u.maxPower - u.power);
  if (h > 0) u.power += h;
  return h;
}

export function removeGear(m: Match, u: Unit, gid: string, to: 'discard' | 'exile' | 'hand') {
  const g = u.gear.find((x) => x.gid === gid);
  if (!g) return;
  u.gear = u.gear.filter((x) => x.gid !== gid);
  if (gearOp(g) === 'buff') {
    const n = gearN(g, 1);
    u.maxPower -= n;
    u.power -= n;
    if (u.power <= 0) u.power = 1;
  }
  if (to === 'hand' && m.hand[g.owner].length < HAND_CAP) m.hand[g.owner].push(g.cardId);
  else if (to === 'exile') m.exile[g.owner].push(g.cardId);
  else m.discard[g.owner].push(g.cardId);
}

export function addGear(m: Match, u: Unit, cardId: string, owner: Side) {
  const g: Gear = { gid: `g${m.seq++}`, cardId, owner };
  u.gear.push(g);
  if (gearOp(g) === 'buff') {
    const n = gearN(g, 1);
    u.maxPower += n;
    u.power += n;
  }
  return g;
}

export function destroy(m: Match, uid: string, o: { killer?: string | null; byStrike?: boolean; exile?: boolean } = {}) {
  const u = m.units[uid];
  if (!u) return;
  const p = posOf(m, uid);
  const c = card(u.cardId);
  if (p) m.board[p.r][p.c] = null;
  delete m.units[uid];
  m.events.push({ e: 'death', uid, cardId: u.cardId, side: u.side });
  log(m, `${c.name} is destroyed.`);
  const killer = o.killer ? m.units[o.killer] : undefined;
  const unmade = !!killer && hasKw(killer, 'unmaker');
  if (unmade) log(m, `${nameOf(killer)} leaves nothing to come back.`);

  // Attachments come off first.
  for (const g of [...u.gear]) {
    const op = gearOp(g);
    if (op === 'skull' && o.byStrike && killer && m.units[killer.uid]) {
      log(m, `The buffalo skull answers: ${nameOf(killer)} loses ${gearN(g, 2)}.`);
      damage(m, killer.uid, gearN(g, 2), { killer: null });
    }
    if (op === 'carmilla') {
      draw(m, g.owner, 1);
      bank(m, g.owner, 2);
      log(m, `Carmilla feeds. ${sideName(g.owner)} draws 1 and gains 2.`);
    }
    if (op === 'graveRound' || op === 'derringer') m.exile[g.owner].push(g.cardId);
    else m.discard[g.owner].push(g.cardId);
  }
  u.gear = [];

  let toPile: 'discard' | 'exile' | 'none' = o.exile || unmade ? 'exile' : 'discard';
  if (!unmade) {
    for (const ab of abilitiesOf(u.cardId)) {
      if (ab.on !== 'death') continue;
      const kept = runDeath(m, u, ab, p);
      if (kept) toPile = 'none';
    }
  }
  if (u.leader) {
    const returning = m.returning.some((x) => x.side === u.side && x.leader);
    m.leaderAt[u.side] = returning ? 'aside' : 'fallen';
    if (!returning) toPile = 'none';
  }
  if (toPile === 'discard') m.discard[u.side].push(u.cardId);
  else if (toPile === 'exile') m.exile[u.side].push(u.cardId);

  // Kill triggers.
  if (killer && m.units[killer.uid]) {
    for (const ab of abilitiesOf(killer.cardId)) if (ab.on === 'kill') fire(m, m.units[killer.uid], ab, { victim: u });
  }
  // Death watchers.
  for (const w of Object.values(m.units)) {
    for (const ab of abilitiesOf(w.cardId)) {
      if (ab.on === 'allyDies' && w.side === u.side) fire(m, w, ab, { victim: u });
      if (ab.on === 'enemyDies' && w.side !== u.side) fire(m, w, ab, { victim: u });
      if (ab.on === 'anyDies') fire(m, w, ab, { victim: u });
    }
  }
  for (const s of ['blue', 'red'] as Side[]) {
    for (const d of m.tray[s]) for (const ab of abilitiesOf(d.cardId)) if (ab.on === 'anyDies') fireDevice(m, s, d.cardId, ab, { victim: u });
  }
}

/** Returns true when the card does not go to the discard pile. */
function runDeath(m: Match, u: Unit, ab: Ability, p: { r: number; c: number } | null): boolean {
  const name = card(u.cardId).name;
  switch (ab.op) {
    case 'returns':
      if (u.spent.includes('returns') || m.returning.some((x) => x.cardId === u.cardId && x.side === u.side)) return false;
      m.returning.push({ side: u.side, cardId: u.cardId, turn: nextTurnOf(m, u.side), leader: u.leader, gear: [] });
      log(m, `${name} is set aside. He rides again at the start of your next turn.`);
      return true;
    case 'lloronaReturns':
      if (m.exile[u.side].includes(`spent:${u.cardId}`)) return false;
      m.exile[u.side].push(`spent:${u.cardId}`);
      if (m.hand[u.side].length < HAND_CAP) {
        m.hand[u.side].push(u.cardId);
        loseMoney(m, u.side, 2);
        log(m, `${name} goes back to the river, and to the hand. ${sideName(u.side)} pays 2.`);
        return true;
      }
      return false;
    case 'lastShot': {
      if (!p) return false;
      const n = ab.n ?? card(u.cardId).power ?? 1;
      const foes = adjacentUnits(m, p.r, p.c).filter((x) => x.side !== u.side);
      if (foes.length === 1) {
        log(m, `${name} fires as he falls.`);
        damage(m, foes[0].uid, n, { strike: true });
      } else if (foes.length > 1) {
        pushPending(m, {
          side: u.side,
          prompt: `${name} fires as he falls. Choose who he names.`,
          resolve: 'dmgUnit',
          options: foes.map((f) => unitOption(m, f)),
          data: { n, strike: true },
          source: u.cardId,
        });
      }
      return false;
    }
    case 'bank':
      bank(m, u.side, ab.n ?? 1);
      log(m, `${name} leaves ${ab.n ?? 1} money behind.`);
      return false;
    case 'draw':
      draw(m, u.side, ab.n ?? 1);
      log(m, `${name}: draw ${ab.n ?? 1}.`);
      return false;
    case 'deathBurst': {
      if (!p) return false;
      const foes = adjacentUnits(m, p.r, p.c).filter((x) => x.side !== u.side);
      log(m, `${name} goes up with a bang.`);
      for (const f of foes) damage(m, f.uid, ab.n ?? 1, {});
      return false;
    }
    default:
      return false;
  }
}

// ------------------------------------------------------------------ triggers

export interface FireCtx {
  victim?: Unit;
  mover?: Unit;
  card?: Card;
  playedBy?: Side;
  struck?: Unit;
}

function onceOk(m: Match, u: Unit, ab: Ability) {
  const k = `${ab.on}:${ab.op}`;
  if (ab.once === 'turn') {
    if (u.turnUse[k] === m.turn) return false;
    u.turnUse[k] = m.turn;
  }
  if (ab.once === 'match') {
    if (u.spent.includes(k)) return false;
    u.spent.push(k);
  }
  return true;
}

export function unitOption(m: Match, u: Unit): PendingOption {
  const p = posOf(m, u.uid);
  return { key: u.uid, uid: u.uid, label: `${nameOf(u)} (${u.power})`, r: p?.r, c: p?.c };
}

export function tileOption(r: number, c: number): PendingOption {
  return { key: key(r, c), label: `Row ${r + 1}, file ${c + 1}`, r, c };
}

export function fire(m: Match, u: Unit, ab: Ability, ctx: FireCtx = {}) {
  if (!m.units[u.uid]) return;
  if (!onceOk(m, u, ab)) return;
  const name = nameOf(u);
  const n = ab.n ?? 1;
  const foe = other(u.side);
  const here = posOf(m, u.uid);
  switch (ab.op) {
    case 'drawBank':
      draw(m, u.side, n);
      bank(m, u.side, ab.m ?? 2);
      log(m, `${name} rides through the wreck. Draw ${n}, gain ${ab.m ?? 2}.`);
      return;
    case 'draw':
      draw(m, u.side, n);
      log(m, `${name}: draw ${n}.`);
      return;
    case 'bank':
      bank(m, u.side, n);
      log(m, `${name}: gain ${n} money.`);
      return;
    case 'foeLoses': {
      const lost = loseMoney(m, foe, n);
      log(m, `${name}: ${foe === 'blue' ? 'you lose' : 'the rival loses'} ${lost} money.`);
      return;
    }
    case 'growOnKill':
      u.maxPower += n;
      u.power = u.maxPower;
      log(m, `${name} feeds and grows to ${u.power}.`);
      return;
    case 'drawOrLook':
      pushPending(m, {
        side: u.side,
        prompt: `${name} brings one in. Draw 1, or look at a hidden tile?`,
        resolve: 'drawOrLook',
        options: [
          { key: 'draw', label: 'Draw 1' },
          { key: 'look', label: 'Look at a hidden tile' },
        ],
        optional: true,
        source: u.cardId,
      });
      return;
    case 'exhaustEnemy':
    case 'pinEnemy':
    case 'snipe':
    case 'enterExecute': {
      const foes = unitsOf(m, foe).filter((x) => ab.op !== 'enterExecute' || x.power <= n);
      if (!foes.length) return;
      const resolve = ab.op === 'exhaustEnemy' ? 'exhaustUnit' : ab.op === 'pinEnemy' ? 'pinUnit' : ab.op === 'snipe' ? 'dmgUnit' : 'destroyUnit';
      const verb = ab.op === 'exhaustEnemy' ? 'exhaust' : ab.op === 'pinEnemy' ? 'hold in place' : ab.op === 'snipe' ? `deal ${n} to` : 'destroy';
      pushPending(m, {
        side: u.side,
        prompt: `${name}: choose an enemy unit to ${verb}.`,
        resolve,
        options: foes.map((f) => unitOption(m, f)),
        data: { n },
        source: u.cardId,
      });
      return;
    }
    case 'heal': {
      const hurt = unitsOf(m, u.side).filter((x) => x.power < x.maxPower);
      if (!hurt.length) return;
      pushPending(m, {
        side: u.side,
        prompt: `${name}: choose an allied unit to mend for ${n}.`,
        resolve: 'healUnit',
        options: hurt.map((f) => unitOption(m, f)),
        data: { n },
        source: u.cardId,
      });
      return;
    }
    case 'dmgEnemies':
      log(m, `${name} hits every enemy for ${n}.`);
      for (const e of unitsOf(m, foe)) damage(m, e.uid, n, {});
      return;
    case 'dmgIt':
      if (ctx.victim && m.units[ctx.victim.uid]) {
        log(m, `${name} looms. ${nameOf(ctx.victim)} loses ${n}.`);
        damage(m, ctx.victim.uid, n, { raw: true });
      }
      return;
    case 'discardRandom': {
      const h = m.hand[foe];
      if (!h.length) return;
      const i = Math.floor(rand(m) * h.length);
      const [cid] = h.splice(i, 1);
      m.discard[foe].push(cid);
      log(m, `${name}: ${sideName(foe)} discards ${card(cid).name}.`);
      return;
    }
    case 'look': {
      if (ab.on !== 'enter') {
        lookAuto(m, u.side, name);
        return;
      }
      const seen = new Set(m.scouted[u.side]);
      const cands = allTiles(m).filter(([r, c]) => !seen.has(key(r, c)) && !m.board[r][c]);
      pushPending(m, {
        side: u.side,
        prompt: `${name}: look at one hidden tile.`,
        resolve: 'lookTile',
        options: cands.map(([r, c]) => tileOption(r, c)),
        optional: true,
        source: u.cardId,
      });
      return;
    }
    case 'lookAll':
      revealAll(m, u.side);
      log(m, `${name} sees every hidden death on the field.`);
      return;
    case 'watch': {
      const t = lookAuto(m, u.side, name);
      if (t) {
        m.aside[u.side] = true;
        log(m, `${name} will turn the next allied move aside from it.`);
      }
      return;
    }
    case 'vision':
      lookAuto(m, u.side, name);
      m.visionStep[u.side] = true;
      return;
    case 'weep': {
      if (!here) return;
      const foes = adjacentUnits(m, here.r, here.c).filter((x) => x.side !== u.side);
      if (!foes.length) return;
      foes.sort((a, b) => b.power - a.power);
      const t = foes[0];
      t.pinUntil = Math.max(t.pinUntil ?? 0, nextTurnOf(m, t.side));
      log(m, `${name} weeps. ${nameOf(t)} cannot move on its next turn.`);
      return;
    }
    case 'nudgeAlly': {
      const allies = unitsOf(m, u.side).filter((x) => x.uid !== u.uid && stepTiles(m, x).length > 0);
      if (!allies.length) return;
      pushPending(m, {
        side: u.side,
        prompt: `${name}: move another allied unit one tile.`,
        resolve: 'nudgePick',
        options: allies.map((a) => unitOption(m, a)),
        optional: true,
        source: u.cardId,
      });
      return;
    }
    case 'switch': {
      const mv = ctx.mover;
      if (!mv || !m.units[mv.uid]) return;
      const mp = posOf(m, mv.uid)!;
      const spots = neighbors(m, mp.r, mp.c).filter(([r, c]) => passableFor(m, mv, r, c));
      if (!spots.length) return;
      pushPending(m, {
        side: u.side,
        prompt: `${name} throws the switch. Move ${nameOf(mv)} onto a different tile? It loses 1 Power.`,
        resolve: 'switchTo',
        options: spots.map(([r, c]) => tileOption(r, c)),
        optional: true,
        data: { uid: mv.uid },
        source: u.cardId,
      });
      return;
    }
    case 'sentry':
      if (ctx.mover && m.units[ctx.mover.uid]) {
        log(m, `${name} fires from the bluff. ${nameOf(ctx.mover)} loses ${n}.`);
        damage(m, ctx.mover.uid, n, { raw: true });
      }
      return;
    case 'picket':
      if (ctx.mover && m.units[ctx.mover.uid]) {
        const mv = m.units[ctx.mover.uid];
        mv.noStrikeUntil = Math.max(mv.noStrikeUntil ?? 0, m.turn);
        log(m, `${name} holds the picket. ${nameOf(mv)} loses ${n} and cannot strike this turn.`);
        damage(m, mv.uid, n, { raw: true });
      }
      return;
    case 'dogRuns': {
      const mv = ctx.mover;
      if (!mv || !m.units[mv.uid]) return;
      const mp = posOf(m, mv.uid)!;
      const spots = neighbors(m, mp.r, mp.c).filter(([r, c]) => isEmptyTile(m, r, c));
      if (!spots.length) {
        u.spent = u.spent.filter((s) => s !== `${ab.on}:${ab.op}`);
        return;
      }
      pushPending(m, {
        side: u.side,
        prompt: `${nameOf(mv)} crossed onto your half. Send the black dog beside it?`,
        resolve: 'placeUnit',
        options: spots.map(([r, c]) => tileOption(r, c)),
        optional: true,
        data: { uid: u.uid },
        source: u.cardId,
      });
      return;
    }
    case 'saddle': {
      const v = ctx.victim;
      if (!v || v.uid === u.uid || isSpent(u)) return;
      if (ab.factions && !ab.factions.includes(card(v.cardId).faction)) return;
      if (v.leader) return;
      pushPending(m, {
        side: u.side,
        prompt: `${nameOf(u)}: exhaust it to return ${card(v.cardId).name} to your hand?`,
        resolve: 'saddle',
        options: [{ key: 'yes', label: `Return ${card(v.cardId).name}` }],
        optional: true,
        data: { cardId: v.cardId, uid: u.uid },
        source: u.cardId,
      });
      return;
    }
    case 'rideOn': {
      if (!here) return;
      const spots = neighbors(m, here.r, here.c).filter(([r, c]) => passableFor(m, u, r, c));
      if (!spots.length) return;
      pushPending(m, {
        side: u.side,
        prompt: `${name} survived the stroke. Ride on one tile?`,
        resolve: 'moveTo',
        options: spots.map(([r, c]) => tileOption(r, c)),
        optional: true,
        data: { uid: u.uid },
        source: u.cardId,
      });
      return;
    }
    case 'exhume': {
      const opts = uniqueCards(m.discard[u.side].filter((id) => card(id).kind === 'unit' && id !== u.cardId));
      if (!opts.length) return;
      pushPending(m, {
        side: u.side,
        prompt: `${name}: return a unit from your discard to your hand.`,
        resolve: 'discardToHand',
        options: opts.map((id) => ({ key: id, cardId: id, label: card(id).name })),
        optional: true,
        source: u.cardId,
      });
      return;
    }
    case 'readyAll':
      for (const a of unitsOf(m, u.side)) if (a.uid !== u.uid) readyUnit(a);
      log(m, `${name} readies the line.`);
      return;
    case 'coroner':
      return;
    default:
      return;
  }
}

function fireDevice(m: Match, side: Side, cardId: string, ab: Ability, _ctx: FireCtx) {
  if (ab.op === 'coroner') {
    const top = m.deck[side][0];
    if (!top) return;
    if (card(top).faction === 'star' && m.hand[side].length < HAND_CAP) {
      m.deck[side].shift();
      m.hand[side].push(top);
      log(m, `The coroner turns the top card. ${side === 'blue' ? card(top).name + ' is' : 'A Silver Star card is'} drawn.`);
    } else {
      log(m, `The coroner turns the top card and leaves it.`);
    }
  }
  void cardId;
}

function uniqueCards(ids: string[]) {
  return [...new Set(ids)];
}

/** Fire every unit's printed ability for `on`, filtered. */
export function fireAll(m: Match, on: Ability['on'], filter: (u: Unit) => boolean, ctx: FireCtx = {}) {
  for (const u of Object.values(m.units)) {
    if (!filter(u)) continue;
    for (const ab of abilitiesOf(u.cardId)) if (ab.on === on) fire(m, u, ab, ctx);
  }
}

export function cardPlayed(m: Match, side: Side, c: Card) {
  m.played.cards += 1;
  if (c.kind === 'item') m.played.items += 1;
  if (c.kind === 'device') m.played.devices += 1;
  m.events.push({ e: 'play', side, cardId: c.id });
  if (m.ledger[side] && m.played.cards === 1) {
    bank(m, side, 1);
    log(m, `The ledger takes its line: gain 1.`);
  }
  for (const u of unitsOf(m, side)) {
    for (const ab of abilitiesOf(u.cardId)) {
      if (ab.on !== 'cardPlayed') continue;
      if (ab.kinds && !ab.kinds.includes(c.kind)) continue;
      if (ab.factions && !ab.factions.includes(c.faction)) continue;
      fire(m, u, ab, { card: c });
    }
  }
}

// ------------------------------------------------------------------ looking

/** Look at the unscouted tile nearest your units; returns the trap if one was there. */
export function lookAuto(m: Match, side: Side, who: string) {
  const seen = new Set(m.scouted[side]);
  const mine = unitsOf(m, side).map((u) => posOf(m, u.uid)!).filter(Boolean);
  const cands = allTiles(m).filter(([r, c]) => !seen.has(key(r, c)) && !m.board[r][c]);
  if (!cands.length) return undefined;
  const score = ([r, c]: [number, number]) => (mine.length ? Math.min(...mine.map((p) => dist(p, { r, c }))) : 0) + rand(m) * 0.5;
  cands.sort((a, b) => score(a) - score(b));
  // Prefer a tile that really hides something within the nearest few, so a look is worth having.
  const [r, c] = cands[0];
  return lookAt(m, side, r, c, who);
}

export function lookAt(m: Match, side: Side, r: number, c: number, who: string) {
  if (!m.scouted[side].includes(key(r, c))) m.scouted[side].push(key(r, c));
  const t = trapAt(m, r, c);
  if (t && t.owner !== side) {
    t.known[side] = true;
    log(m, side === 'blue' ? `${who} looks at row ${r + 1}, file ${c + 1}: a hidden ${trapName(t.kind)}.` : `${who} looks at a hidden tile.`);
    return t;
  }
  log(m, side === 'blue' ? `${who} looks at row ${r + 1}, file ${c + 1}: nothing hidden.` : `${who} looks at a hidden tile.`);
  return undefined;
}

export function revealAll(m: Match, side: Side, onlyHalf = false) {
  for (const t of m.traps) if (!onlyHalf || onHalf(m, side, t.r, t.c)) t.known[side] = true;
  for (const [r, c] of allTiles(m)) if (!onlyHalf || onHalf(m, side, r, c)) if (!m.scouted[side].includes(key(r, c))) m.scouted[side].push(key(r, c));
}

export function trapName(kind: string) {
  switch (kind) {
    case 'snake':
      return 'rattlesnake';
    case 'shaft':
      return 'mine shaft';
    case 'pit':
      return 'deadfall pit';
    case 'deadfall':
      return 'deadfall';
    case 'sink':
      return 'alkali sink';
    case 'cavein':
      return 'cave-in';
    case 'hidebehind':
      return 'Hidebehind';
    case 'cinders':
      return 'cinder bed';
    default:
      return kind;
  }
}

// ------------------------------------------------------------------ movement

/** Can `u` stand on (r,c) at all (ignoring readiness): field, empty of units, not wired, not too steep. */
export function passableFor(m: Match, u: Unit, r: number, c: number, from?: { r: number; c: number }) {
  if (isVoid(m, r, c) || m.board[r][c]) return false;
  const dev = tileDeviceAt(m, r, c);
  if (dev) {
    const id = card(dev.cardId).id;
    if (id === 'cut-wire') return false;
    if (id === 'night-wire' && dev.owner !== u.side) return false;
  }
  const f = from ?? posOf(m, u.uid);
  if (f) {
    const up = heightAt(m, r, c) - heightAt(m, f.r, f.c);
    if (up > 1) return false;
    if (up > 0 && (u.groundUntil ?? 0) >= m.turn) return false;
  }
  return true;
}

export function stepTiles(m: Match, u: Unit): [number, number][] {
  const p = posOf(m, u.uid);
  if (!p) return [];
  return neighbors(m, p.r, p.c).filter(([r, c]) => passableFor(m, u, r, c));
}

/** Tiles reachable in up to n steps through empty, passable tiles. */
export function reachTiles(m: Match, u: Unit, n: number): [number, number][] {
  const p = posOf(m, u.uid);
  if (!p) return [];
  const seen = new Set([key(p.r, p.c)]);
  let frontier: [number, number][] = [[p.r, p.c]];
  const out: [number, number][] = [];
  for (let s = 0; s < n; s++) {
    const next: [number, number][] = [];
    for (const [r, c] of frontier) {
      for (const [rr, cc] of neighbors(m, r, c)) {
        if (seen.has(key(rr, cc))) continue;
        if (!passableFor(m, u, rr, cc, { r, c })) continue;
        seen.add(key(rr, cc));
        out.push([rr, cc]);
        next.push([rr, cc]);
      }
    }
    frontier = next;
  }
  return out;
}

/** Why `u` cannot take a normal move this turn, or null. */
export function moveBlock(m: Match, u: Unit): string | null {
  const name = nameOf(u);
  if (hasKw(u, 'fixture')) return `${name} stays where it was placed.`;
  if (u.attacked || u.sick) return `${name} cannot act.`;
  if (u.moved && u.steps <= 0) return `${name} has moved.`;
  if ((u.pinUntil ?? 0) >= m.turn) return `${name} is held and cannot move this turn.`;
  if (hasGear(u, 'manacle')) return `${name} is manacled.`;
  const p = posOf(m, u.uid);
  if (!p) return `${name} is not on the field.`;
  if (m.rings.some((x) => x.r === p.r && x.c === p.c && x.until >= m.turn)) return `${name} is inside the cold ring.`;
  const holder = adjacentUnits(m, p.r, p.c).find((x) => x.side !== u.side && hasKw(x, 'hold'));
  if (holder) return `${nameOf(holder)} holds ${name} in place.`;
  return null;
}

export function moveError(m: Match, uid: string, r: number, c: number): string | null {
  const u = m.units[uid];
  if (!u || u.side !== m.side) return 'That unit will not heed you.';
  const b = moveBlock(m, u);
  if (b) return b;
  const p = posOf(m, uid)!;
  if (dist(p, { r, c }) !== 1) return 'Move only to an adjacent tile.';
  if (isVoid(m, r, c)) return 'Off the field.';
  if (m.board[r][c]) return 'That tile is occupied.';
  const dev = tileDeviceAt(m, r, c);
  if (dev && card(dev.cardId).id === 'cut-wire') return 'Cut wire blocks that tile.';
  if (dev && card(dev.cardId).id === 'night-wire' && dev.owner !== u.side) return 'Night wire blocks that tile.';
  const up = heightAt(m, r, c) - heightAt(m, p.r, p.c);
  if (up > 1) return 'Too steep. Climb one shelf at a time.';
  if (up > 0 && (u.groundUntil ?? 0) >= m.turn) return `${nameOf(u)} cannot climb this turn.`;
  return null;
}

/** A normal move. Assumes moveError returned null. */
export function doMove(m: Match, uid: string, r: number, c: number) {
  const u = m.units[uid];
  const from = posOf(m, uid)!;
  const t = trapAt(m, r, c);
  if (t && t.owner !== u.side && (hasGear(u, 'scout') || m.aside[u.side])) {
    t.known[u.side] = true;
    if (!hasGear(u, 'scout')) m.aside[u.side] = false;
    log(m, `${nameOf(u)} sees the ${trapName(t.kind)} and turns aside.`);
    return;
  }
  const first = !u.moved;
  const climbed = heightAt(m, r, c) > heightAt(m, from.r, from.c);
  m.board[from.r][from.c] = null;
  m.board[r][c] = uid;
  m.events.push({ e: 'move', uid, from: [from.r, from.c], to: [r, c] });
  if (first) {
    u.steps = 0;
    for (const ab of abilitiesOf(u.cardId)) if (ab.on === 'static' && ab.op === 'extraStep') u.steps += ab.n ?? 1;
    if (m.visionStep[u.side]) {
      m.visionStep[u.side] = false;
      u.steps += 1;
      log(m, `Vision: ${nameOf(u)} may move one more tile.`);
    }
  } else {
    u.steps -= 1;
  }
  u.moved = true;
  if (climbed && hasKw(u, 'climber') && first) {
    u.moved = false;
    log(m, `${nameOf(u)} climbs without spending his move.`);
  }
  // Cinders: the tile he leaves burns for the next enemy.
  if (hasKw(u, 'cinders') && isEmptyTile(m, from.r, from.c)) {
    m.traps.push({ tid: `t${m.seq++}`, r: from.r, c: from.c, kind: 'cinders', owner: u.side, known: { blue: true, red: true } });
  }
  enterTile(m, uid, from, { r, c }, true);
}

/** Moves made by effects (not the unit's own move). */
export function effectMove(m: Match, uid: string, r: number, c: number) {
  const u = m.units[uid];
  if (!u) return;
  const from = posOf(m, uid);
  if (!from || m.board[r][c]) return;
  m.board[from.r][from.c] = null;
  m.board[r][c] = uid;
  m.events.push({ e: 'move', uid, from: [from.r, from.c], to: [r, c] });
  enterTile(m, uid, from, { r, c }, false);
}

/** Everything that happens when a unit arrives on a tile. */
export function enterTile(m: Match, uid: string, from: { r: number; c: number } | null, to: { r: number; c: number }, ownMove: boolean) {
  const u = m.units[uid];
  if (!u) return;
  const t = trapAt(m, to.r, to.c);
  if (t && !(t.owner === u.side && (t.kind === 'hidebehind' || t.kind === 'cinders'))) {
    springTrap(m, u, t);
    if (!m.units[uid]) return;
  }
  const dev = tileDeviceAt(m, to.r, to.c);
  if (dev && card(dev.cardId).id === 'hell-rail') {
    if (dev.owner === u.side) {
      if (ownMove) {
        u.steps += 1;
        log(m, `${nameOf(u)} rides the hell rail and may move one more tile.`);
      }
    } else if (!dev.spent) {
      dev.spent = true;
      log(m, `The hell rail bites ${nameOf(u)} for 2.`);
      damage(m, uid, 2, { raw: true });
      if (!m.units[uid]) return;
    }
  }
  const tile = tileAt(m, to.r, to.c)!;
  if (tile.k === 'stronghold' && tile.home && tile.home !== u.side) {
    m.control[to.r][to.c] = u.side;
    win(m, u.side, 'stronghold');
    log(m, `${nameOf(u)} storms the rival fort.`);
    return;
  }
  if (isPaintable(tile) && m.control[to.r][to.c] !== u.side) {
    m.control[to.r][to.c] = u.side;
    for (const ab of abilitiesOf(u.cardId)) {
      if (ab.on === 'conquer' && ab.op === 'raid' && tile.k === 'resource') {
        bank(m, u.side, ab.n ?? 1);
        log(m, `${nameOf(u)} cleans out the claim: gain ${ab.n ?? 1}.`);
      }
    }
  }
  // Watchers on the other side.
  for (const w of unitsOf(m, other(u.side))) {
    const wp = posOf(m, w.uid);
    if (!wp || !m.units[uid]) continue;
    const nowAdj = dist(wp, to) === 1;
    const wasAdj = from ? dist(wp, from) === 1 : false;
    if (nowAdj && !wasAdj) for (const ab of abilitiesOf(w.cardId)) if (ab.on === 'enemyMovesAdj') fire(m, w, ab, { mover: u });
    if (onHalf(m, w.side, to.r, to.c) && !(from && onHalf(m, w.side, from.r, from.c)))
      for (const ab of abilitiesOf(w.cardId)) if (ab.on === 'enemyEntersHalf') fire(m, w, ab, { mover: u });
  }
}

export function springTrap(m: Match, u: Unit, t: { tid: string; r: number; c: number; kind: string; owner: Side | null; cardId?: string }) {
  m.traps = m.traps.filter((x) => x.tid !== t.tid);
  m.events.push({ e: 'trap', r: t.r, c: t.c, kind: t.kind });
  const name = nameOf(u);
  const deadly = ['snake', 'shaft', 'pit', 'cavein'];
  if (deadly.includes(t.kind)) {
    if (hasKw(u, 'trapproof')) {
      log(m, `${name} walks out of the ${trapName(t.kind)}. Traps cannot destroy it.`);
      return;
    }
    log(m, t.kind === 'snake' ? `${name} steps on a rattlesnake and is killed.` : t.kind === 'shaft' ? `${name} falls through a hidden mine shaft and is killed.` : t.kind === 'cavein' ? `The ground caves in under ${name}.` : `${name} drops through a deadfall and is killed.`);
    destroy(m, u.uid, {});
    if (t.kind === 'cavein' && t.owner) {
      // Exile one enemy item or device next to the collapse.
      for (const [r, c] of neighbors(m, t.r, t.c)) {
        const dev = tileDeviceAt(m, r, c);
        if (dev && dev.owner !== t.owner) {
          m.tileDevices = m.tileDevices.filter((d) => d.did !== dev.did);
          m.exile[dev.owner].push(dev.cardId);
          log(m, `The collapse buries ${card(dev.cardId).name}.`);
          return;
        }
        const nu = unitAt(m, r, c);
        const g = nu?.gear.find((x) => x.owner !== t.owner);
        if (nu && g) {
          removeGear(m, nu, g.gid, 'exile');
          log(m, `The collapse buries ${card(g.cardId).name}.`);
          return;
        }
      }
    }
    return;
  }
  if (t.kind === 'deadfall') {
    u.noStrikeUntil = Math.max(u.noStrikeUntil ?? 0, m.turn);
    log(m, `A deadfall drops on ${name}: 2 Power, and no strike this turn.`);
    damage(m, u.uid, 2, { raw: true });
    return;
  }
  if (t.kind === 'sink') {
    u.pinUntil = Math.max(u.pinUntil ?? 0, nextTurnOf(m, u.side));
    log(m, `${name} sinks in alkali: 3 Power, and cannot move on its next turn.`);
    damage(m, u.uid, 3, { raw: true });
    return;
  }
  if (t.kind === 'cinders') {
    log(m, `${name} rides into hot cinders and loses 2.`);
    damage(m, u.uid, 2, { raw: true });
    return;
  }
  if (t.kind === 'hidebehind' && t.owner) {
    log(m, `Something was hiding there. ${name} is dealt 3.`);
    damage(m, u.uid, 3, {});
    const owner = t.owner;
    const hb = makeUnit(m, t.cardId ?? 'hidebehind', owner, { sick: true });
    hb.enteredTurn = m.turn;
    let spot: [number, number] | undefined;
    if (!m.board[t.r][t.c]) spot = [t.r, t.c];
    else spot = neighbors(m, t.r, t.c).find(([r, c]) => isEmptyTile(m, r, c));
    if (spot) {
      m.units[hb.uid] = hb;
      m.board[spot[0]][spot[1]] = hb.uid;
      exhaustUnit(m, hb);
      m.events.push({ e: 'deploy', uid: hb.uid, side: owner });
      log(m, `The Hidebehind is revealed, exhausted.`);
    } else {
      m.discard[owner].push(t.cardId ?? 'hidebehind');
    }
  }
}

// ------------------------------------------------------------------ strikes

export function strikeBlock(m: Match, u: Unit): string | null {
  const name = nameOf(u);
  if (u.sick) return `${name} arrived this turn and cannot strike yet.`;
  if (u.moved || u.attacked) return `${name} cannot act.`;
  if ((u.noStrikeUntil ?? 0) >= m.turn) return `${name} cannot strike this turn.`;
  return null;
}

export function strikeError(m: Match, uid: string, r: number, c: number): string | null {
  const a = m.units[uid];
  if (!a || a.side !== m.side) return 'That unit will not heed you.';
  if (m.rules?.firstNoStrike && m.turn === 1) return 'The first player cannot strike on the opening turn.';
  const b = strikeBlock(m, a);
  if (b) return b;
  const d = unitAt(m, r, c);
  if (!d) return 'Nothing there to strike.';
  if (d.side === a.side) return 'That is one of yours.';
  const p = posOf(m, uid)!;
  const n = dist(p, { r, c });
  if (n === 1) return null;
  if (n === 2 && hasKw(a, 'ranged')) {
    if (p.r !== r && p.c !== c) return 'Ranged strikes do not shoot on a diagonal.';
    if (hasKw(d, 'noRangedTarget')) return `${nameOf(d)} cannot be named by ranged strikes.`;
    const joseph = unitsOf(m, d.side).find((x) => hasKw(x, 'evenGround'));
    if (joseph) return `${nameOf(joseph)} keeps even ground: his side cannot be struck by ranged attacks.`;
    return null;
  }
  return 'Out of reach.';
}

function crownBonus(m: Match, side: Side, r: number, c: number, self: string) {
  return adjacentUnits(m, r, c).filter((x) => x.side === side && x.uid !== self && hasKw(x, 'crown')).length;
}

function speed(u: Unit, derringer: boolean) {
  if (derringer || hasKw(u, 'fast')) return 2;
  if (hasKw(u, 'slow')) return 0;
  return 1;
}

/** Resolve a strike. Assumes strikeError returned null. */
export function doStrike(m: Match, uid: string, r: number, c: number) {
  const a = m.units[uid];
  const d = unitAt(m, r, c)!;
  const ap = posOf(m, uid)!;
  const n = dist(ap, { r, c });
  const ranged = n === 2;
  const aName = nameOf(a);
  const dName = nameOf(d);
  a.moved = true;
  a.attacked = true;
  a.steps = 0;
  m.events.push({ e: 'strike', uid, target: d.uid, ranged });

  // Gear read before the blow.
  const grave = a.gear.find((g) => gearOp(g) === 'graveRound');
  const derr = a.gear.find((g) => gearOp(g) === 'derringer');
  let bonus = 0;
  if (grave) bonus += gearN(grave, 2);
  if (derr) bonus += gearN(derr, 1);
  bonus += crownBonus(m, a.side, ap.r, ap.c, a.uid);
  for (const ab of abilitiesOf(a.cardId)) if (ab.on === 'static' && ab.op === 'leaderBond' && leaderUnit(m, a.side) && !a.leader) bonus += ab.n ?? 1;
  const hA = heightAt(m, ap.r, ap.c);
  const hD = heightAt(m, r, c);
  let ground = 0;
  if (hA > hD) ground = hasKw(a, 'highStriker') ? 2 : 1;
  if (ranged && hA >= 2) ground = Math.max(ground, 1);
  if (ground) log(m, ranged && hA >= 2 && hA <= hD ? `${aName} has the ridge top and shoots for 1 more.` : `${aName} has the high ground (+${ground}).`);
  bonus += ground;
  let noAnswer = ranged || hasKw(a, 'noAnswer');
  if (hasKw(a, 'steady') && m.played.cards === 0) {
    bonus += 1;
    noAnswer = true;
    log(m, `${aName} is steady: +1, and it is not answered.`);
  }
  if ((d.noStrikeUntil ?? 0) >= m.turn) noAnswer = true;
  if (derr) removeGear(m, a, derr.gid, 'exile');

  // Salt Oath: striking the warded leader costs 2.
  if (d.leader && (m.saltOath[d.side] ?? 0) >= m.turn) {
    log(m, `The salt circle burns ${aName} for 2.`);
    damage(m, a.uid, 2, { raw: true });
    if (!m.units[a.uid]) return;
  }

  // Ridge: a melee strike up onto a ridge can miss.
  if (!ranged && hD >= 1 && rand(m) < 1 / 3) {
    log(m, `The ridge spoils it. ${aName} misses ${dName}.`);
    if (!noAnswer) {
      const back = Math.max(0, d.power) + 0;
      log(m, `${dName} answers for ${back}.`);
      damage(m, a.uid, back, { strike: true, killer: d.uid });
    }
    return;
  }

  const aBlow = Math.max(0, a.power) + bonus;
  const dBlow = Math.max(0, d.power);
  const sa = speed(a, !!derr);
  const sd = speed(d, false);
  if (noAnswer) {
    log(m, ranged ? `Ranged: ${aName} strikes ${dName} for ${aBlow} from ${n} away.` : `${aName} strikes ${dName} for ${aBlow}. It is not answered.`);
    damage(m, d.uid, aBlow, { strike: true, killer: a.uid });
  } else if (sa > sd) {
    log(m, `${aName} strikes first for ${aBlow}.`);
    damage(m, d.uid, aBlow, { strike: true, killer: a.uid });
    if (m.units[d.uid] && m.units[a.uid]) {
      const back = Math.max(0, m.units[d.uid].power);
      log(m, `${dName} answers for ${back}.`);
      damage(m, a.uid, back, { strike: true, killer: d.uid });
    } else if (!m.units[d.uid]) log(m, `${dName} does not strike back.`);
  } else if (sa < sd) {
    log(m, `${dName} strikes first for ${dBlow}.`);
    damage(m, a.uid, dBlow, { strike: true, killer: d.uid });
    if (m.units[a.uid] && m.units[d.uid]) {
      const blow = Math.max(0, m.units[a.uid].power) + bonus;
      log(m, `${aName} answers for ${blow}.`);
      damage(m, d.uid, blow, { strike: true, killer: a.uid });
    }
  } else {
    log(m, `${aName} (${aBlow}) and ${dName} (${dBlow}) exchange blows.`);
    damage(m, d.uid, aBlow, { strike: true, killer: a.uid });
    damage(m, a.uid, dBlow, { strike: true, killer: d.uid });
  }

  const alive = m.units[a.uid];
  const killed = !m.units[d.uid];
  if (grave && alive) {
    if (killed) {
      removeGear(m, alive, grave.gid, 'exile');
      alive.wardUntil = nextTurnOf(m, alive.side) - 0;
      alive.wardUntil = m.turn + 1;
      log(m, `Grave Round is spent. Rites cannot name ${aName} until your next turn.`);
    } else {
      removeGear(m, alive, grave.gid, 'exile');
    }
  }
  if (killed && alive) {
    if (!ranged) {
      // Advance into the cleared tile.
      if (!m.board[r][c]) {
        const from = posOf(m, a.uid)!;
        m.board[from.r][from.c] = null;
        m.board[r][c] = a.uid;
        m.events.push({ e: 'move', uid: a.uid, from: [from.r, from.c], to: [r, c] });
        log(m, `${aName} advances.`);
        enterTile(m, a.uid, from, { r, c }, false);
      }
    } else {
      const t = tileAt(m, r, c);
      if (isPaintable(t) && m.control[r][c] !== a.side && !m.board[r][c]) {
        m.control[r][c] = a.side;
        log(m, `${aName} takes the ground from range.`);
      }
    }
  }
  const after = m.units[a.uid];
  if (after) for (const ab of abilitiesOf(after.cardId)) if (ab.on === 'afterStrike') fire(m, after, ab, { struck: d });
}

// ------------------------------------------------------------------ win

export function win(m: Match, side: Side, kind: 'dominance' | 'stronghold' | 'yield') {
  if (m.winner) return;
  m.winner = side;
  m.winKind = kind;
  m.events.push({ e: 'win', side });
}

export function holdings(m: Match, side: Side) {
  let n = 0;
  for (let r = 0; r < m.h; r++)
    for (let c = 0; c < m.w; c++) {
      const t = m.tiles[r][c];
      if (t.k === 'void') continue;
      if (t.k === 'stronghold') {
        if (t.home === side) n += 1;
        continue;
      }
      if (m.control[r][c] === side) n += 1;
    }
  return n;
}

export function bankFor(m: Match, side: Side) {
  let n = 0;
  for (let r = 0; r < m.h; r++)
    for (let c = 0; c < m.w; c++) {
      const t = m.tiles[r][c];
      if (t.k === 'stronghold' && t.home === side) n += 2;
      if (t.k === 'resource' && m.control[r][c] === side) n += t.sym ?? 1;
    }
  return n;
}

// ------------------------------------------------------------------ musters

/** Put a returning unit or leader back on its side's stronghold or a held gate. */
export function muster(m: Match, side: Side, cardId: string, leader: boolean, exhausted: boolean): Unit | null {
  const spots: [number, number][] = [];
  for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) if (canDeployOn(m, side, r, c) && !m.board[r][c]) spots.push([r, c]);
  const sh = spots.find(([r, c]) => m.tiles[r][c].k === 'stronghold');
  const spot = sh ?? pick(m, spots);
  if (!spot) return null;
  const u = makeUnit(m, cardId, side, { leader, sick: exhausted });
  u.spent.push('returns');
  if (exhausted) {
    u.moved = true;
    u.attacked = true;
  }
  m.units[u.uid] = u;
  m.board[spot[0]][spot[1]] = u.uid;
  if (leader) m.leaderAt[side] = 'board';
  m.events.push({ e: 'deploy', uid: u.uid, side });
  return u;
}

export type { Target };
