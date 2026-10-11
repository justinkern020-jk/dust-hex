/**
 * Dust Hex engine: a pure step function over a Match.
 * applyAction never mutates its input; the UI keeps one Match and swaps it.
 */
import mapsRaw from '../data/maps.json';
import { buildDeck, card, isOutlaw, leaderOf } from './cards';
import {
  allTiles,
  bank,
  canDeployOn,
  countOnBoard,
  dist,
  draw,
  heightAt,
  isEmptyTile,
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
import {
  addGear,
  bankFor,
  cardPlayed,
  damage,
  destroy,
  doMove,
  doStrike,
  effectMove,
  exhaustUnit,
  fire,
  gearOp,
  heal,
  holdings,
  isSpent,
  lookAt,
  lookAuto,
  makeUnit,
  moveError,
  muster,
  reachTiles,
  readyUnit,
  removeGear,
  revealAll,
  riteBlock,
  stepTiles,
  strikeError,
  tileOption,
  trapName,
  unitOption,
  win,
} from './rules';
import type { Action, Card, FactionId, MapDef, Match, Pending, PendingOption, Side, StepResult, Target, TargetSpec, Unit } from './types';
import { abilitiesOf } from './core';

export const MAPS = mapsRaw as MapDef[];
export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[1];
}

export interface NewMatchOpts {
  mapId?: string;
  blue: FactionId;
  red: FactionId;
  seed?: number;
  blueDeck?: string[];
  redDeck?: string[];
}

function shuffle(m: Match, xs: string[]) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(m) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newMatch(o: NewMatchOpts): Match {
  const map = mapById(o.mapId ?? 'ashen-cross');
  const tiles = map.tiles.map((row) => row.map((t) => ({ ...t, trap: undefined })));
  const h = tiles.length;
  const w = tiles[0].length;
  const m: Match = {
    mapId: map.id,
    w,
    h,
    tiles,
    goal: map.goal,
    side: 'blue',
    turn: 1,
    seed: (o.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    seq: 1,
    units: {},
    board: tiles.map((row) => row.map(() => null)),
    control: tiles.map((row) => row.map((t) => t.home ?? null)),
    money: { blue: 0, red: 0 },
    dom: { blue: 0, red: 0 },
    hand: { blue: [], red: [] },
    deck: { blue: [], red: [] },
    discard: { blue: [], red: [] },
    exile: { blue: [], red: [] },
    leader: { blue: leaderOf(o.blue).id, red: leaderOf(o.red).id },
    leaderAt: { blue: 'tray', red: 'tray' },
    returning: [],
    leadUsed: { blue: false, red: false },
    traps: [],
    tileDevices: [],
    tray: { blue: [], red: [] },
    rings: [],
    saltOath: { blue: 0, red: 0 },
    ledger: { blue: false, red: false },
    coffins: [],
    aside: { blue: false, red: false },
    played: { cards: 0, items: 0, devices: 0 },
    visionStep: { blue: false, red: false },
    pending: [],
    scouted: { blue: [], red: [] },
    log: [],
    events: [],
    winner: null,
    winKind: null,
  };
  map.tiles.forEach((row, r) =>
    row.forEach((t, c) => {
      if (t.trap) m.traps.push({ tid: `t${m.seq++}`, r, c, kind: t.trap === 'deadfall' ? 'pit' : t.trap, owner: null, known: { blue: false, red: false } });
    }),
  );
  m.deck.blue = shuffle(m, o.blueDeck ?? buildDeck(o.blue));
  m.deck.red = shuffle(m, o.redDeck ?? buildDeck(o.red));
  draw(m, 'blue', 5);
  draw(m, 'red', 5);
  bank(m, 'blue', bankFor(m, 'blue'));
  log(m, `${map.name}. ${map.epithet}`);
  return m;
}

// ------------------------------------------------------------------ costs & targets

export function playCost(m: Match, side: Side, c: Card) {
  let cost = c.cost;
  if (c.kind === 'device') {
    cost -= countOnBoard(m, side, 'deviceDiscount');
    cost += countOnBoard(m, other(side), 'deviceTax');
  }
  if (c.kind === 'rite') cost += m.tileDevices.filter((d) => d.owner !== side && card(d.cardId).id === 'cut-wire').length;
  return Math.max(0, cost);
}

function unitTargetOk(m: Match, side: Side, spec: TargetSpec, u: Unit, rite: boolean): string | null {
  if (spec.kind === 'ally' && u.side !== side) return 'Name a unit you control.';
  if (spec.kind === 'enemy' && u.side === side) return 'Name an enemy unit.';
  if (spec.kind === 'heightAlly' && (u.side !== side || heightAt(m, posOf(m, u.uid)!.r, posOf(m, u.uid)!.c) < 1)) return 'Name an allied unit on higher ground.';
  if (spec.kind === 'leader' && !u.leader) return 'Name your leader.';
  if (spec.maxPower != null && u.power > spec.maxPower) return `Name a unit with Power ${spec.maxPower} or less.`;
  if (spec.faction && !spec.faction.includes(card(u.cardId).faction)) return 'That unit does not answer to this.';
  if (spec.spent && !isSpent(u)) return `${nameOf(u)} is already ready.`;
  if (rite) {
    const b = riteBlock(m, side, u);
    if (b) return b;
  }
  return null;
}

function emptyPlaceable(m: Match, r: number, c: number) {
  const t = tileAt(m, r, c);
  return !!t && (t.k === 'street' || t.k === 'resource') && isEmptyTile(m, r, c);
}

/** Every legal target for a spec (used by the UI to light tiles and by the AI). */
export function targetOptions(m: Match, side: Side, spec: TargetSpec | undefined, rite: boolean): Target[] {
  if (!spec || spec.kind === 'none') return [];
  const out: Target[] = [];
  switch (spec.kind) {
    case 'ally':
    case 'enemy':
    case 'unit':
    case 'heightAlly':
    case 'leader':
      for (const u of Object.values(m.units)) if (!unitTargetOk(m, side, spec, u, rite)) out.push({ uid: u.uid });
      break;
    case 'emptyTile':
      for (const [r, c] of allTiles(m)) if (emptyPlaceable(m, r, c)) out.push({ r, c });
      break;
    case 'anyTile':
      for (const [r, c] of allTiles(m)) out.push({ r, c });
      break;
    case 'enemyGear':
      for (const u of unitsOf(m, other(side))) for (const g of u.gear) if (g.owner !== side) out.push({ uid: u.uid, gid: g.gid });
      for (const u of unitsOf(m, side)) for (const g of u.gear) if (g.owner !== side) out.push({ uid: u.uid, gid: g.gid });
      for (const d of m.tileDevices) if (d.owner !== side) out.push({ did: d.did });
      for (const d of m.tray[other(side)]) out.push({ did: d.did });
      break;
  }
  return out;
}

export function targetError(m: Match, side: Side, spec: TargetSpec | undefined, t: Target | undefined, rite: boolean): string | null {
  if (!spec || spec.kind === 'none') return null;
  if (!t || (t.uid == null && t.r == null && t.did == null)) {
    if (spec.optional && targetOptions(m, side, spec, rite).length === 0) return null;
    return 'Choose a target.';
  }
  const opts = targetOptions(m, side, spec, rite);
  const ok = opts.some((o) => (o.uid ?? null) === (t.uid ?? null) && (o.r ?? null) === (t.r ?? null) && (o.c ?? null) === (t.c ?? null) && (o.gid ?? null) === (t.gid ?? null) && (o.did ?? null) === (t.did ?? null));
  if (ok) return null;
  if (t.uid && m.units[t.uid]) return unitTargetOk(m, side, spec, m.units[t.uid], rite) ?? 'That cannot be named.';
  return 'That cannot be named.';
}

/** Tiles where a unit (or the leader) from hand may enter. */
export function deployTiles(m: Match, side: Side, cardId: string): [number, number][] {
  const c = card(cardId);
  const out: [number, number][] = [];
  for (const [r, cc] of allTiles(m)) {
    if (c.hide) {
      if (emptyPlaceable(m, r, cc)) out.push([r, cc]);
      continue;
    }
    if (m.board[r][cc]) continue;
    if (c.kw.includes('winged')) {
      const t = tileAt(m, r, cc)!;
      if (t.k !== 'stronghold' && !trapAt(m, r, cc) && !tileDeviceAt(m, r, cc) && !onHalf(m, other(side), r, cc)) out.push([r, cc]);
      continue;
    }
    if (canDeployOn(m, side, r, cc)) out.push([r, cc]);
  }
  return out;
}

function unitActOf(_m: Match, side: Side, u: Unit, gid?: string) {
  if (gid) {
    const g = u.gear.find((x) => x.gid === gid);
    if (!g) return null;
    const a = card(g.cardId).act;
    if (!a) return null;
    if (a.bearer ? u.side !== side : g.owner !== side || u.side !== side) return null;
    return a;
  }
  if (u.side !== side) return null;
  return card(u.cardId).act ?? null;
}

/** Why an act cannot be used right now, or null. */
export function actError(m: Match, side: Side, a: { uid?: string; gid?: string; did?: string }, target?: Target): string | null {
  if (a.did) {
    const d = [...m.tray[side], ...m.tileDevices.filter((x) => x.owner === side)].find((x) => x.did === a.did);
    if (!d) return 'Not your device.';
    const act = card(d.cardId).act;
    if (!act) return 'That device has nothing to do.';
    if (d.exhaustedTurn === m.turn) return `${card(d.cardId).name} is exhausted.`;
    if (act.pay && m.money[side] < act.pay) return `Not enough money (need ${act.pay}).`;
    return targetError(m, side, act.target, target, false);
  }
  const u = a.uid ? m.units[a.uid] : undefined;
  if (!u) return 'Nothing there.';
  const act = unitActOf(m, side, u, a.gid);
  if (!act) return 'That unit has nothing to do.';
  if (act.once === 'turn' && u.turnUse[`act:${a.gid ?? ''}`] === m.turn) return 'Already used this turn.';
  if (act.exhaust && isSpent(u)) return `${nameOf(u)} is already spent.`;
  if (act.pay && m.money[side] < act.pay) return `Not enough money (need ${act.pay}).`;
  if (act.op === 'readyAlly' && act.target && targetOptions(m, side, act.target, false).filter((t) => t.uid !== u.uid).length === 0) return 'No spent ally to ready.';
  if (target?.uid === u.uid && act.op === 'readyAlly') return `${nameOf(u)} cannot ready itself.`;
  return targetError(m, side, act.target, target, false);
}

// ------------------------------------------------------------------ turn flow

function endTurn(m: Match) {
  const s = m.side;
  const gain = holdings(m, s);
  m.dom[s] += gain;
  log(m, `${sideName(s)} hold${s === 'blue' ? '' : 's'} ${gain}. Dominance ${m.dom[s]} / ${m.goal}.`);
  if (m.dom[s] >= m.goal) {
    win(m, s, 'dominance');
    return;
  }
  for (const cf of m.coffins.filter((x) => x.side === s)) {
    const i = m.discard[s].indexOf(cf.cardId);
    if (i >= 0 && m.hand[s].length < HAND_CAP) {
      m.discard[s].splice(i, 1);
      m.hand[s].push(cf.cardId);
      log(m, `The false coffin is empty. ${card(cf.cardId).name} returns to hand.`);
    }
    m.exile[s].push('false-coffin');
  }
  m.coffins = m.coffins.filter((x) => x.side !== s);
  const n = other(s);
  m.side = n;
  m.turn += 1;
  m.played = { cards: 0, items: 0, devices: 0 };
  openTurn(m);
}

function openTurn(m: Match) {
  const s = m.side;
  m.events.push({ e: 'turn', side: s });
  m.rings = m.rings.filter((x) => x.until >= m.turn);
  for (const u of unitsOf(m, s)) {
    u.moved = false;
    u.attacked = false;
    u.sick = false;
    u.steps = 0;
  }
  // Returns.
  for (const ret of m.returning.filter((x) => x.side === s && x.turn <= m.turn)) {
    const u = muster(m, s, ret.cardId, !!ret.leader, true);
    if (u) {
      m.returning = m.returning.filter((x) => x !== ret);
      log(m, `${card(ret.cardId).name} rides back in, exhausted.`);
    } else {
      ret.turn = m.turn + 2;
    }
  }
  // Start-of-turn abilities and gear.
  for (const u of unitsOf(m, s)) for (const ab of abilitiesOf(u.cardId)) if (ab.on === 'turnStart') fire(m, u, ab);
  for (const u of unitsOf(m, s))
    for (const g of u.gear)
      if (gearOp(g) === 'drawTurn') {
        draw(m, s, 1);
        log(m, `The winter count adds a mark. Draw 1.`);
      }
  for (const u of Object.values(m.units))
    for (const g of u.gear)
      if (gearOp(g) === 'carmilla' && g.owner === s && m.units[u.uid]) {
        log(m, `Carmilla drinks. ${nameOf(u)} loses 1.`);
        damage(m, u.uid, 1, { raw: true });
      }
  draw(m, s, 1);
  let gain = bankFor(m, s);
  if (s === 'red' && m.turn === 2) gain += 1;
  bank(m, s, gain);
}

// ------------------------------------------------------------------ play ops

function runPlay(m: Match, side: Side, c: Card, target: Target | undefined) {
  const foe = other(side);
  const tu = target?.uid ? m.units[target.uid] : undefined;
  for (const op of c.play ?? []) {
    const n = op.n ?? 1;
    switch (op.op) {
      case 'bounce': {
        if (!tu) break;
        bounce(m, tu);
        break;
      }
      case 'bind':
        if (tu && m.units[tu.uid]) {
          tu.pinUntil = Math.max(tu.pinUntil ?? 0, m.turn + 1);
          tu.noStrikeUntil = Math.max(tu.noStrikeUntil ?? 0, m.turn + 1);
          log(m, `${nameOf(tu)} walks the wrong path and cannot move or strike until your next turn.`);
        }
        break;
      case 'draw':
        draw(m, side, n);
        break;
      case 'bank':
        bank(m, side, n);
        break;
      case 'rideBack': {
        const opts: PendingOption[] = [...new Set(m.discard[side].filter((id) => card(id).kind === 'unit' && isOutlaw(card(id))))].map((id) => ({ key: id, cardId: id, label: card(id).name }));
        if (m.leaderAt[side] === 'fallen' && isOutlaw(card(m.leader[side]))) opts.push({ key: 'leader', cardId: m.leader[side], label: `${card(m.leader[side]).name} (leader)` });
        if (!opts.length) log(m, 'The road is empty. Nothing rides back.');
        pushPending(m, { side, prompt: 'Ride Back: choose who returns.', resolve: 'rideBack', options: opts, source: c.id });
        break;
      }
      case 'falseCoffin': {
        const opts = [...new Set(m.discard[side].filter((id) => card(id).kind === 'unit' && isOutlaw(card(id))))].map((id) => ({ key: id, cardId: id, label: card(id).name }));
        if (!opts.length) {
          log(m, 'No one to put in the false coffin.');
          m.discard[side].push(c.id);
        }
        pushPending(m, { side, prompt: 'False Coffin: choose a destroyed Outlaw to bring home at the end of the turn.', resolve: 'falseCoffin', options: opts, source: c.id });
        break;
      }
      case 'lamp': {
        if (target?.r == null) break;
        const r = target.r;
        const cc = target.c!;
        lookAt(m, side, r, cc, 'The widow lamp');
        const t = trapAt(m, r, cc);
        const d = tileDeviceAt(m, r, cc);
        if (t || d) {
          const spots = allTiles(m).filter(([rr, c2]) => emptyPlaceable(m, rr, c2));
          pushPending(m, {
            side,
            prompt: `Move that ${t ? trapName(t.kind) : card(d!.cardId).name} onto a different empty tile?`,
            resolve: 'relocate',
            options: spots.map(([rr, c2]) => tileOption(rr, c2)),
            optional: true,
            data: { tid: t?.tid, did: t ? undefined : d?.did },
            source: c.id,
          });
        }
        break;
      }
      case 'pin':
        if (tu) {
          tu.pinUntil = Math.max(tu.pinUntil ?? 0, nextTurnOf(m, tu.side));
          log(m, `A warrant is served. ${nameOf(tu)} cannot move on its next turn.`);
        }
        break;
      case 'saltOath':
        m.saltOath[side] = m.turn + 1;
        log(m, `Salt is poured round your leader. Striking it costs 2 until your next turn.`);
        break;
      case 'silence':
        if (tu) {
          tu.noStrikeUntil = Math.max(tu.noStrikeUntil ?? 0, m.turn);
          log(m, `The jury is out. ${nameOf(tu)} cannot strike this turn.`);
        }
        break;
      case 'exileGear':
        exileGear(m, side, target, 'exile');
        break;
      case 'rope':
        if (tu) {
          log(m, `The rope takes ${nameOf(tu)}.`);
          destroy(m, tu.uid, {});
        } else {
          loseMoney(m, side, 2);
          draw(m, side, 1);
          log(m, `No one fit the rope. Lose 2 money, draw 1.`);
        }
        break;
      case 'yellowSign': {
        const hand = m.hand[foe];
        bank(m, side, 1);
        if (!hand.length) {
          log(m, `The yellow sign finds an empty hand. Gain 1.`);
          break;
        }
        pushPending(m, {
          side,
          prompt: 'The Yellow Sign: choose a card from their hand. They discard it.',
          resolve: 'yellowSign',
          options: hand.map((id, i) => ({ key: `${i}`, cardId: id, label: card(id).name })),
          source: c.id,
        });
        break;
      }
      case 'window': {
        revealAll(m, side);
        log(m, `You look at every hidden tile.`);
        const opts: PendingOption[] = [
          ...m.traps.filter((t) => t.owner !== side).map((t) => ({ key: `trap:${t.tid}`, label: `Destroy the ${trapName(t.kind)} at row ${t.r + 1}, file ${t.c + 1}`, r: t.r, c: t.c })),
          ...unitsOf(m, foe).map((u) => ({ ...unitOption(m, u), key: `unit:${u.uid}`, label: `Deal 2 to ${nameOf(u)}` })),
        ];
        pushPending(m, { side, prompt: 'At the Window: destroy one trap, or deal 2 to an enemy unit.', resolve: 'window', options: opts, source: c.id });
        break;
      }
      case 'chamber':
        if (tu) {
          exhaustUnit(m, tu);
          tu.noStrikeUntil = Math.max(tu.noStrikeUntil ?? 0, m.turn + 1);
          tu.wardUntil = Math.max(tu.wardUntil ?? 0, m.turn + 1);
          log(m, `${nameOf(tu)} is shut in the haunted chamber until your next turn.`);
        }
        break;
      case 'signal': {
        if (target?.r == null) break;
        const hh = heightAt(m, target.r, target.c!);
        lookAuto(m, side, 'The signal glass');
        const low = unitsOf(m, foe).filter((u) => {
          const p = posOf(m, u.uid)!;
          return heightAt(m, p.r, p.c) < hh;
        });
        if (!low.length) log(m, 'The flash finds no one below that height.');
        pushPending(m, { side, prompt: 'Signal Glass: deal 1 to an enemy standing lower.', resolve: 'dmgUnit', options: low.map((u) => unitOption(m, u)), data: { n: 1 }, source: c.id });
        break;
      }
      case 'dmgEnemies':
        log(m, `${c.name}: ${n} to every enemy unit.`);
        for (const u of unitsOf(m, foe)) damage(m, u.uid, n, {});
        break;
      case 'owlCreek':
        if (tu) {
          const owner = tu.side;
          destroy(m, tu.uid, {});
          draw(m, owner, 1);
          log(m, `${sideName(owner)} draw${owner === 'blue' ? '' : 's'} 1 from the creek.`);
        }
        break;
      case 'thunderRidge': {
        if (!tu) break;
        const p = posOf(m, tu.uid)!;
        const hh = heightAt(m, p.r, p.c);
        const low = unitsOf(m, foe).filter((u) => {
          const q = posOf(m, u.uid)!;
          return heightAt(m, q.r, q.c) < hh && dist(p, q) <= 2;
        });
        if (!low.length) log(m, 'Thunder rolls, but no one stands below within reach.');
        pushPending(m, { side, prompt: `Thunder on the Ridge: ${nameOf(tu)} deals ${n} to an enemy below.`, resolve: 'dmgUnit', options: low.map((u) => unitOption(m, u)), data: { n, ground: true }, source: c.id });
        break;
      }
      case 'carry': {
        if (!tu) break;
        const spots = reachTiles(m, tu, n);
        pushPending(m, { side, prompt: `Move ${nameOf(tu)} up to ${n} tiles.`, resolve: 'moveTo', options: spots.map(([r, cc]) => tileOption(r, cc)), optional: true, data: { uid: tu.uid, noStrike: true }, source: c.id });
        break;
      }
      case 'coldRing':
        if (target?.r != null) {
          m.rings.push({ r: target.r, c: target.c!, until: m.turn + 1 });
          log(m, `A cold ring closes on row ${target.r + 1}, file ${target.c! + 1}.`);
        }
        break;
      default:
        log(m, `${c.name} (${op.op}) has no handler.`);
    }
  }
}

export function bounce(m: Match, u: Unit) {
  const owner = u.side;
  const p = posOf(m, u.uid);
  for (const g of [...u.gear]) removeGear(m, u, g.gid, 'discard');
  if (p) m.board[p.r][p.c] = null;
  delete m.units[u.uid];
  if (u.leader) {
    m.leaderAt[owner] = 'tray';
    const h = m.hand[owner];
    if (h.length) {
      const i = Math.floor(rand(m) * h.length);
      const [cid] = h.splice(i, 1);
      m.discard[owner].push(cid);
      log(m, `${card(u.cardId).name} is sent back to the tray, and ${sideName(owner)} discard${owner === 'blue' ? '' : 's'} ${card(cid).name}.`);
    } else log(m, `${card(u.cardId).name} is sent back to the tray.`);
    return;
  }
  if (m.hand[owner].length < HAND_CAP) m.hand[owner].push(u.cardId);
  else m.discard[owner].push(u.cardId);
  log(m, `${card(u.cardId).name} returns to its owner's hand.`);
}

function exileGear(m: Match, side: Side, t: Target | undefined, to: 'exile' | 'hand') {
  if (!t) return;
  if (t.gid && t.uid && m.units[t.uid]) {
    const u = m.units[t.uid];
    const g = u.gear.find((x) => x.gid === t.gid);
    if (!g) return;
    removeGear(m, u, g.gid, to);
    log(m, `${card(g.cardId).name} comes off ${nameOf(u)}${to === 'hand' ? ' and goes back to its owner' : ''}.`);
    if (to === 'exile' && m.units[u.uid]) damage(m, u.uid, 1, { raw: true });
    return;
  }
  if (t.did) {
    for (const s of ['blue', 'red'] as Side[]) {
      const d = m.tray[s].find((x) => x.did === t.did);
      if (d) {
        m.tray[s] = m.tray[s].filter((x) => x.did !== t.did);
        if (to === 'hand' && m.hand[s].length < HAND_CAP) m.hand[s].push(d.cardId);
        else m.exile[s].push(d.cardId);
        log(m, `${card(d.cardId).name} is ${to === 'hand' ? 'sent back to its owner' : 'exiled'}.`);
        return;
      }
    }
    const d = m.tileDevices.find((x) => x.did === t.did);
    if (d) {
      m.tileDevices = m.tileDevices.filter((x) => x.did !== t.did);
      if (to === 'hand' && m.hand[d.owner].length < HAND_CAP) m.hand[d.owner].push(d.cardId);
      else m.exile[d.owner].push(d.cardId);
      log(m, `${card(d.cardId).name} is ${to === 'hand' ? 'sent back to its owner' : 'exiled'}.`);
    }
  }
  void side;
}

// ------------------------------------------------------------------ acts

function runAct(m: Match, side: Side, op: string, n: number, target: Target | undefined, srcName: string, self?: Unit, gid?: string, keepStrike?: boolean) {
  const foe = other(side);
  const tu = target?.uid ? m.units[target.uid] : undefined;
  switch (op) {
    case 'fuse': {
      if (!tu) return;
      const p = posOf(m, tu.uid)!;
      log(m, `${srcName} goes off under ${nameOf(tu)}.`);
      damage(m, tu.uid, n, {});
      if (!m.units[tu.uid]) {
        const near = neighbors(m, p.r, p.c)
          .map(([r, c]) => unitAt(m, r, c))
          .filter((x): x is Unit => !!x && x.side === foe);
        pushPending(m, { side, prompt: 'The fuse carries. Deal 1 to an enemy beside it.', resolve: 'dmgUnit', options: near.map((u) => unitOption(m, u)), data: { n: 1 }, source: 'powder-fuse' });
      }
      return;
    }
    case 'knock': {
      if (target?.r == null) return;
      lookAt(m, side, target.r, target.c!, srcName);
      const t = trapAt(m, target.r, target.c!);
      if (t) {
        const spots = allTiles(m).filter(([r, c]) => emptyPlaceable(m, r, c));
        pushPending(m, { side, prompt: `Move the ${trapName(t.kind)} onto a different empty tile?`, resolve: 'relocate', options: spots.map(([r, c]) => tileOption(r, c)), optional: true, data: { tid: t.tid }, source: 'tommyknockers' });
      }
      return;
    }
    case 'breakManacles':
      if (self && gid) {
        removeGear(m, self, gid, 'exile');
        log(m, `${nameOf(self)} breaks the manacles.`);
      }
      return;
    case 'readyAlly':
      if (tu) {
        readyUnit(tu);
        log(m, `${srcName} readies ${nameOf(tu)}.`);
      }
      return;
    case 'dmgEnemies':
      log(m, `${srcName}: ${n} to every enemy unit.`);
      for (const u of unitsOf(m, foe)) damage(m, u.uid, n, {});
      return;
    case 'wagon': {
      const sh = allTiles(m).find(([r, c]) => m.tiles[r][c].k === 'stronghold' && m.tiles[r][c].home === side);
      const threat = sh && neighbors(m, sh[0], sh[1]).some(([r, c]) => unitAt(m, r, c)?.side === foe);
      bank(m, side, threat ? 1 : 2);
      log(m, `The supply wagon unloads: gain ${threat ? 1 : 2}.`);
      return;
    }
    case 'dmg':
      if (tu) {
        log(m, `${srcName} hits ${nameOf(tu)} for ${n}.`);
        damage(m, tu.uid, n, {});
      }
      return;
    case 'carry': {
      if (!tu) return;
      const spots = reachTiles(m, tu, n);
      pushPending(m, { side, prompt: `Move ${nameOf(tu)} up to ${n} tile${n > 1 ? 's' : ''}.`, resolve: 'moveTo', options: spots.map(([r, c]) => tileOption(r, c)), optional: true, data: { uid: tu.uid, noStrike: !keepStrike }, source: srcName });
      return;
    }
    case 'returnGear':
      exileGear(m, side, target, 'hand');
      return;
    case 'moveBlanket': {
      if (!self || !gid || !tu || tu.uid === self.uid) return;
      const g = self.gear.find((x) => x.gid === gid);
      if (!g) return;
      removeGear(m, self, gid, 'exile');
      m.exile[g.owner].pop();
      addGear(m, tu, g.cardId, g.owner);
      log(m, `The trade blanket passes to ${nameOf(tu)}.`);
      return;
    }
    case 'posse': {
      const lawmen = unitsOf(m, side).filter((u) => card(u.cardId).faction === 'star' && stepTiles(m, u).length);
      pushPending(m, { side, prompt: 'Posse Bell: choose a lawman to move one tile.', resolve: 'possePick', options: lawmen.map((u) => unitOption(m, u)), optional: true, data: { left: n, moved: [] }, source: 'posse-bell' });
      return;
    }
    case 'wire': {
      const d = m.tileDevices.find((x) => x.owner === side && card(x.cardId).id === 'night-wire');
      if (!d) return;
      const near = neighbors(m, d.r, d.c)
        .map(([r, c]) => unitAt(m, r, c))
        .filter((x): x is Unit => !!x && x.side === foe);
      if (!near.length) log(m, 'Nobody is close to the wire.');
      pushPending(m, { side, prompt: 'Night Wire: deal 1 to an enemy beside it.', resolve: 'dmgUnit', options: near.map((u) => unitOption(m, u)), data: { n: 1 }, source: 'night-wire' });
      return;
    }
    default:
      log(m, `${srcName}: nothing happens (${op}).`);
  }
}

// ------------------------------------------------------------------ lead

function runLead(m: Match, side: Side, c: Card, target: Target | undefined) {
  const lead = c.lead!;
  const tu = target?.uid ? m.units[target.uid] : undefined;
  m.events.push({ e: 'lead', side });
  switch (lead.op) {
    case 'drawBank':
      draw(m, side, lead.n ?? 1);
      bank(m, side, 2);
      log(m, `${c.name} rides through the wreck. Draw 1. Gain 2.`);
      return;
    case 'draw':
      draw(m, side, lead.n ?? 1);
      log(m, `${c.name} takes the house cut and draws.`);
      return;
    case 'standFast':
      if (tu) {
        if (!tu.kw.includes('tough')) tu.kw.push('tough');
        if (!tu.kw.includes('lastStand')) tu.kw.push('lastStand');
        tu.spent = tu.spent.filter((s) => s !== 'lastStand');
        draw(m, side, 1);
        log(m, `${c.name} stands ${nameOf(tu)} to the first blow. You draw.`);
      }
      return;
    case 'trainUp': {
      let k = 0;
      for (const u of unitsOf(m, side)) {
        readyUnit(u);
        k++;
      }
      draw(m, side, 1);
      log(m, `${c.name} brings the train up. ${k} of yours may act again. Draw 1.`);
      return;
    }
    case 'bullVision':
      revealAll(m, side, true);
      log(m, `${c.name} sees every hidden death on your half.`);
      if (tu) {
        readyUnit(tu);
        log(m, `${nameOf(tu)} may act again.`);
      }
      return;
    case 'cloudWord': {
      const lost = loseMoney(m, other(side), 1);
      log(m, `${c.name} makes the other side pay${lost ? ' 1 money' : ''}.`);
      if (tu) {
        readyUnit(tu);
        log(m, `${nameOf(tu)} may act again.`);
      }
      return;
    }
  }
}

// ------------------------------------------------------------------ pending

function resolvePending(m: Match, p: Pending, o: PendingOption | null) {
  const d = p.data as Record<string, any>;
  if (!o) {
    if (p.resolve === 'deny') return resolvePending(m, p, { key: 'allow', label: '' });
    if (p.resolve === 'possePick' || (p.resolve === 'moveTo' && d.then === 'posse')) return;
    return;
  }
  const u = o.uid ? m.units[o.uid] : undefined;
  switch (p.resolve) {
    case 'dmgUnit':
      if (u) {
        if (d.ground) u.groundUntil = Math.max(u.groundUntil ?? 0, nextTurnOf(m, u.side));
        damage(m, u.uid, d.n ?? 1, { strike: !!d.strike });
      }
      return;
    case 'exhaustUnit':
      if (u) {
        exhaustUnit(m, u);
        log(m, `${nameOf(u)} is exhausted.`);
      }
      return;
    case 'pinUnit':
      if (u) {
        u.pinUntil = Math.max(u.pinUntil ?? 0, nextTurnOf(m, u.side));
        log(m, `${nameOf(u)} cannot move on its next turn.`);
      }
      return;
    case 'destroyUnit':
      if (u) destroy(m, u.uid, {});
      return;
    case 'healUnit':
      if (u) log(m, `${nameOf(u)} is mended for ${heal(m, u, d.n ?? 1)}.`);
      return;
    case 'nudgePick':
      if (u) {
        const spots = stepTiles(m, u);
        pushPending(m, { side: p.side, prompt: `Move ${nameOf(u)} where?`, resolve: 'moveTo', options: spots.map(([r, c]) => tileOption(r, c)), optional: true, data: { uid: u.uid }, source: p.source });
        // Keep this follow-up first in line.
        const last = m.pending.pop();
        if (last) m.pending.unshift(last);
      }
      return;
    case 'moveTo': {
      const mu = m.units[d.uid];
      if (mu && o.r != null && !m.board[o.r][o.c!]) {
        effectMove(m, mu.uid, o.r, o.c!);
        if (d.noStrike && m.units[mu.uid]) m.units[mu.uid].noStrikeUntil = Math.max(m.units[mu.uid].noStrikeUntil ?? 0, m.turn);
      }
      if (d.then === 'posse' && d.left > 0) {
        const moved: string[] = d.moved ?? [];
        const lawmen = unitsOf(m, p.side).filter((x) => card(x.cardId).faction === 'star' && !moved.includes(x.uid) && stepTiles(m, x).length);
        pushPending(m, { side: p.side, prompt: 'Posse Bell: another lawman may move one tile.', resolve: 'possePick', options: lawmen.map((x) => unitOption(m, x)), optional: true, data: { left: d.left, moved }, source: 'posse-bell' });
        const last = m.pending.pop();
        if (last) m.pending.unshift(last);
      }
      return;
    }
    case 'possePick':
      if (u) {
        const spots = stepTiles(m, u);
        pushPending(m, { side: p.side, prompt: `Move ${nameOf(u)} where?`, resolve: 'moveTo', options: spots.map(([r, c]) => tileOption(r, c)), optional: true, data: { uid: u.uid, then: 'posse', left: (d.left ?? 1) - 1, moved: [...(d.moved ?? []), u.uid] }, source: p.source });
        const last = m.pending.pop();
        if (last) m.pending.unshift(last);
      }
      return;
    case 'switchTo': {
      const mu = m.units[d.uid];
      if (mu && o.r != null && !m.board[o.r][o.c!]) {
        log(m, `The switch throws ${nameOf(mu)} aside. It loses 1.`);
        effectMove(m, mu.uid, o.r, o.c!);
        if (m.units[mu.uid]) damage(m, mu.uid, 1, { raw: true });
      }
      return;
    }
    case 'placeUnit': {
      const mu = m.units[d.uid];
      if (mu && o.r != null && !m.board[o.r][o.c!]) {
        log(m, `${nameOf(mu)} runs to it.`);
        effectMove(m, mu.uid, o.r, o.c!);
      }
      return;
    }
    case 'saddle': {
      const su = m.units[d.uid];
      if (!su) return;
      exhaustUnit(m, su);
      const i = m.discard[p.side].lastIndexOf(d.cardId);
      if (i >= 0 && m.hand[p.side].length < HAND_CAP) {
        m.discard[p.side].splice(i, 1);
        m.hand[p.side].push(d.cardId);
        log(m, `The empty saddle brings ${card(d.cardId).name} home to your hand.`);
      }
      return;
    }
    case 'discardToHand': {
      const i = m.discard[p.side].indexOf(o.key);
      if (i >= 0 && m.hand[p.side].length < HAND_CAP) {
        m.discard[p.side].splice(i, 1);
        m.hand[p.side].push(o.key);
        log(m, `${card(o.key).name} comes back to hand.`);
      }
      return;
    }
    case 'lookTile':
      if (o.r != null) lookAt(m, p.side, o.r, o.c!, p.source ? card(p.source).name : 'You');
      return;
    case 'drawOrLook':
      if (o.key === 'draw') draw(m, p.side, 1);
      else lookAuto(m, p.side, 'The marshal');
      return;
    case 'deny': {
      const c = card(d.cardId);
      const cole = m.units[d.cole];
      if (o.key === 'cancel' && cole) {
        cole.turnUse['deny'] = m.turn;
        exhaustUnit(m, cole);
        m.discard[d.side as Side].push(c.id);
        log(m, `${nameOf(cole)} calls it a lie. ${c.name} is cancelled.`);
        return;
      }
      resolveCard(m, d.side, c, d.target);
      return;
    }
    case 'rideBack': {
      if (o.key === 'leader') {
        const lu = muster(m, p.side, m.leader[p.side], true, true);
        if (lu) log(m, `${nameOf(lu)} rides back, exhausted.`);
        return;
      }
      const i = m.discard[p.side].indexOf(o.key);
      if (i >= 0 && m.hand[p.side].length < HAND_CAP) {
        m.discard[p.side].splice(i, 1);
        m.hand[p.side].push(o.key);
        log(m, `${card(o.key).name} rides back to your hand.`);
      }
      return;
    }
    case 'falseCoffin':
      m.coffins.push({ side: p.side, cardId: o.key });
      log(m, `${card(o.key).name} is laid in a false coffin.`);
      return;
    case 'relocate': {
      if (o.r == null) return;
      if (d.tid) {
        const t = m.traps.find((x) => x.tid === d.tid);
        if (t && emptyPlaceable(m, o.r, o.c!)) {
          t.r = o.r;
          t.c = o.c!;
          t.owner = t.owner ?? p.side;
          t.known = { blue: p.side === 'blue', red: p.side === 'red' };
          m.scouted[other(p.side)] = m.scouted[other(p.side)].filter((k) => k !== key(o.r!, o.c!));
          log(m, `The hidden death is moved. The rival is not shown where.`);
        }
      } else if (d.did) {
        const dv = m.tileDevices.find((x) => x.did === d.did);
        if (dv && emptyPlaceable(m, o.r, o.c!)) {
          dv.r = o.r;
          dv.c = o.c!;
          log(m, `${card(dv.cardId).name} is moved.`);
        }
      }
      return;
    }
    case 'yellowSign': {
      const foe = other(p.side);
      const i = Number(o.key);
      const cid = m.hand[foe][i];
      if (cid) {
        m.hand[foe].splice(i, 1);
        m.discard[foe].push(cid);
        log(m, `The Yellow Sign: ${sideName(foe)} discard${foe === 'blue' ? '' : 's'} ${card(cid).name}.`);
      }
      return;
    }
    case 'window':
      if (o.key.startsWith('trap:')) {
        const tid = o.key.slice(5);
        m.traps = m.traps.filter((t) => t.tid !== tid);
        log(m, `The trap is pulled up.`);
      } else if (o.key.startsWith('unit:')) {
        const wu = m.units[o.key.slice(5)];
        if (wu) damage(m, wu.uid, 2, {});
      }
      return;
  }
}

// ------------------------------------------------------------------ card resolution

function resolveCard(m: Match, side: Side, c: Card, target: Target | undefined) {
  const tu = target?.uid ? m.units[target.uid] : undefined;
  let kept = false;
  if (c.trapKind && target?.r != null) {
    m.traps.push({ tid: `t${m.seq++}`, r: target.r, c: target.c!, kind: c.trapKind, owner: side, cardId: c.id, known: { blue: side === 'blue', red: side === 'red' } });
    m.scouted[other(side)] = m.scouted[other(side)].filter((k) => k !== key(target.r!, target.c!));
    log(m, side === 'blue' ? `You hide a ${trapName(c.trapKind)} at row ${target.r + 1}, file ${target.c! + 1}.` : `The rival hides something on the field.`);
    kept = true;
  } else if (c.attach === 'unit') {
    if (tu) {
      addGear(m, tu, c.id, side);
      log(m, `${c.name} is attached to ${nameOf(tu)}.`);
      kept = true;
    }
  } else if (c.attach === 'leader') {
    m.ledger[side] = true;
    log(m, `${c.name} is pinned to your leader.`);
    kept = true;
  } else if (c.attach === 'tile' && target?.r != null) {
    m.tileDevices.push({ did: `d${m.seq++}`, r: target.r, c: target.c!, cardId: c.id, owner: side });
    log(m, `${c.name} is placed.`);
    kept = true;
  } else if (c.attach === 'tray') {
    m.tray[side].push({ did: `d${m.seq++}`, cardId: c.id, owner: side });
    log(m, `${c.name} is set up.`);
    kept = true;
  } else {
    log(m, `${side === 'blue' ? 'You play' : 'The rival plays'} ${c.name}.`);
  }
  runPlay(m, side, c, target);
  if (c.play?.some((p) => p.op === 'falseCoffin')) kept = true;
  if (!kept) m.discard[side].push(c.id);
  cardPlayed(m, side, c);
}

// ------------------------------------------------------------------ step

export function applyAction(state: Match, a: Action): StepResult {
  if (state.winner) return { state, error: 'The hour is over.' };
  const m: Match = structuredClone(state);
  m.events = [];
  const err = step(m, a);
  if (err) return { state, error: err };
  return { state: m, error: null };
}

function step(m: Match, a: Action): string | null {
  if (m.pending.length && a.t !== 'choose' && a.t !== 'skip' && a.t !== 'yield') return 'Answer the choice first.';
  const side = m.side;
  switch (a.t) {
    case 'choose':
    case 'skip': {
      const p = m.pending[0];
      if (!p) return 'Nothing to choose.';
      if (a.t === 'skip' && !p.optional && p.options.length) return 'You must choose.';
      const o = a.t === 'choose' ? p.options.find((x) => x.key === a.key) : null;
      if (a.t === 'choose' && !o) return 'Not one of the choices.';
      m.pending.shift();
      resolvePending(m, p, o ?? null);
      return null;
    }
    case 'yield': {
      const ys = a.side ?? side;
      win(m, other(ys), 'yield');
      log(m, `${sideName(ys)} yield${ys === 'blue' ? '' : 's'}.`);
      return null;
    }
    case 'end':
      endTurn(m);
      return null;
    case 'deploy': {
      const isLeader = a.i === 'leader';
      if (isLeader && m.leaderAt[side] !== 'tray') return 'Your leader is not in the tray.';
      const cardId = isLeader ? m.leader[side] : m.hand[side][a.i as number];
      if (!cardId) return 'No such card.';
      const c = card(cardId);
      if (c.kind !== 'unit' && c.kind !== 'leader') return 'Not a unit.';
      const cost = playCost(m, side, c);
      if (m.money[side] < cost) return `Not enough money (need ${cost}).`;
      if (!deployTiles(m, side, cardId).some(([r, cc]) => r === a.r && cc === a.c)) return c.hide ? 'Hide it on an empty tile.' : c.kw.includes('winged') ? 'It needs an empty tile.' : 'Deploy on your stronghold or a door you hold.';
      m.money[side] -= cost;
      if (isLeader) m.leaderAt[side] = 'board';
      else m.hand[side].splice(a.i as number, 1);
      if (c.hide) {
        m.traps.push({ tid: `t${m.seq++}`, r: a.r, c: a.c, kind: 'hidebehind', owner: side, cardId, known: { blue: side === 'blue', red: side === 'red' } });
        m.scouted[other(side)] = m.scouted[other(side)].filter((k) => k !== key(a.r, a.c));
        log(m, side === 'blue' ? `The Hidebehind slips out of sight at row ${a.r + 1}, file ${a.c + 1}.` : `Something slips out of sight on the field.`);
        cardPlayed(m, side, c);
        return null;
      }
      const u = makeUnit(m, cardId, side, { leader: isLeader });
      m.units[u.uid] = u;
      m.board[a.r][a.c] = u.uid;
      m.events.push({ e: 'deploy', uid: u.uid, side });
      log(m, `${side === 'blue' ? 'You muster' : 'The rival musters'} ${c.name}.`);
      if (trapAt(m, a.r, a.c) || tileAt(m, a.r, a.c)!.k !== 'gate') {
        // Winged arrivals can land on open ground: claim it like a step.
        const t = tileAt(m, a.r, a.c)!;
        if ((t.k === 'street' || t.k === 'resource') && m.control[a.r][a.c] !== side) m.control[a.r][a.c] = side;
      }
      for (const ab of abilitiesOf(cardId)) if (ab.on === 'enter') fire(m, u, ab);
      for (const w of unitsOf(m, other(side))) for (const ab of abilitiesOf(w.cardId)) if (ab.on === 'enemyDeploys' && m.units[u.uid]) fire(m, w, ab, { victim: u });
      cardPlayed(m, side, c);
      return null;
    }
    case 'move': {
      const e = moveError(m, a.uid, a.r, a.c);
      if (e) return e;
      doMove(m, a.uid, a.r, a.c);
      return null;
    }
    case 'strike': {
      const e = strikeError(m, a.uid, a.r, a.c);
      if (e) return e;
      doStrike(m, a.uid, a.r, a.c);
      return null;
    }
    case 'play': {
      const id = m.hand[side][a.i];
      if (!id) return 'No such card.';
      const c = card(id);
      if (c.kind === 'unit' || c.kind === 'leader') return 'Muster units onto the field.';
      const cost = playCost(m, side, c);
      if (m.money[side] < cost) return `Not enough money (need ${cost}).`;
      const rite = c.kind === 'rite';
      const te = targetError(m, side, c.target, a.target, rite);
      if (te) return te;
      m.money[side] -= cost;
      m.hand[side].splice(a.i, 1);
      if (rite) {
        const cole = unitsOf(m, other(side)).find((u) => abilitiesOf(u.cardId).some((ab) => ab.on === 'enemyRite' && ab.op === 'deny') && !isSpent(u) && !((u.turnUse['deny'] ?? -1) >= m.turn) && (u.pinUntil ?? 0) < nextTurnOf(m, u.side));
        if (cole) {
          log(m, `${side === 'blue' ? 'You play' : 'The rival plays'} ${c.name}. ${nameOf(cole)} is watching.`);
          m.pending.push({
            side: other(side),
            prompt: `${c.name} is played. Exhaust ${nameOf(cole)} to cancel it? (He sits out your next turn.)`,
            resolve: 'deny',
            options: [
              { key: 'cancel', label: `Cancel ${c.name}` },
              { key: 'allow', label: 'Let it stand' },
            ],
            optional: true,
            data: { cardId: c.id, target: a.target ?? null, side, cole: cole.uid },
            source: cole.cardId,
          });
          return null;
        }
      }
      resolveCard(m, side, c, a.target);
      return null;
    }
    case 'act': {
      const e = actError(m, side, a, a.target);
      if (e) return e;
      if (a.did) {
        const d = [...m.tray[side], ...m.tileDevices.filter((x) => x.owner === side)].find((x) => x.did === a.did)!;
        const act = card(d.cardId).act!;
        d.exhaustedTurn = m.turn;
        if (act.pay) m.money[side] -= act.pay;
        runAct(m, side, act.op, act.n ?? 1, a.target, card(d.cardId).name, undefined, undefined, act.keepStrike);
        return null;
      }
      const u = m.units[a.uid!];
      const act = unitActOf(m, side, u, a.gid)!;
      if (act.pay) m.money[side] -= act.pay;
      if (act.once === 'turn') u.turnUse[`act:${a.gid ?? ''}`] = m.turn;
      if (act.exhaust) {
        u.moved = true;
        u.attacked = true;
      }
      runAct(m, side, act.op, act.n ?? 1, a.target, nameOf(u), u, a.gid, act.keepStrike);
      return null;
    }
    case 'lead': {
      if (m.leadUsed[side]) return 'Your leader has already led this match.';
      const c = card(m.leader[side]);
      if (!c.lead) return 'This leader has no working.';
      const te = targetError(m, side, c.lead.target, a.target, false);
      if (te) return te;
      m.leadUsed[side] = true;
      runLead(m, side, c, a.target);
      return null;
    }
  }
  return 'Unknown action.';
}

// ------------------------------------------------------------------ queries for UI / AI

export function canAfford(m: Match, side: Side, cardId: string) {
  return m.money[side] >= playCost(m, side, card(cardId));
}

export function strikeTargets(m: Match, uid: string): [number, number][] {
  const out: [number, number][] = [];
  for (const u of Object.values(m.units)) {
    const p = posOf(m, u.uid);
    if (p && !strikeError(m, uid, p.r, p.c)) out.push([p.r, p.c]);
  }
  return out;
}

export function moveTargets(m: Match, uid: string): [number, number][] {
  const p = posOf(m, uid);
  if (!p) return [];
  return neighbors(m, p.r, p.c).filter(([r, c]) => !moveError(m, uid, r, c));
}

export { holdings, bankFor, leaderUnit, onHalf, isVoid };
