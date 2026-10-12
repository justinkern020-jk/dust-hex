/** Dust Hex core types. Everything in a Match is plain JSON so it can be cloned. */

export type Side = 'blue' | 'red';
export type FactionId = 'gang' | 'choir' | 'star' | 'army' | 'grass' | 'lodge';
export type CardKind = 'leader' | 'unit' | 'item' | 'device' | 'rite' | 'trap';

export type TileKind = 'void' | 'street' | 'stronghold' | 'gate' | 'resource';
export interface Tile {
  k: TileKind;
  home?: Side;
  sym?: 1 | 2;
  h?: number;
  /** Map-printed hidden death (snake, shaft, deadfall). Moved into Match.traps at start. */
  trap?: string;
}

export interface MapDef {
  id: string;
  name: string;
  epithet: string;
  era: string;
  mood?: string;
  goal: number;
  tiles: Tile[][];
}

/** Who a card or ability may name. */
export type TargetKind =
  | 'none'
  | 'ally'
  | 'enemy'
  | 'unit'
  | 'emptyTile'
  | 'anyTile'
  | 'heightAlly'
  | 'enemyGear'
  | 'leader';

export interface TargetSpec {
  kind: TargetKind;
  /** Unit power must be at most this. */
  maxPower?: number;
  /** Unit must belong to one of these factions. */
  faction?: FactionId[];
  /** A unit that has already moved or struck (for "ready" effects). */
  spent?: boolean;
  /** Target may be skipped (the effect has a fallback). */
  optional?: boolean;
}

/** One printed ability. `on` says when it fires; `op` names the engine handler. */
export interface Ability {
  on:
    | 'enter'
    | 'kill'
    | 'death'
    | 'turnStart'
    | 'enemyMovesAdj'
    | 'enemyEntersHalf'
    | 'allyDies'
    | 'anyDies'
    | 'enemyDies'
    | 'cardPlayed'
    | 'enemyRite'
    | 'enemyDeploys'
    | 'afterStrike'
    | 'conquer'
    | 'static';
  op: string;
  n?: number;
  m?: number;
  /** Optional filters for cardPlayed / allyDies triggers. */
  kinds?: CardKind[];
  factions?: FactionId[];
  once?: 'turn' | 'match';
}

export interface ActDef {
  op: string;
  n?: number;
  /** Money the act costs. */
  pay?: number;
  target?: TargetSpec;
  /** Exhausting the unit or device (it cannot move or strike afterwards). */
  exhaust?: boolean;
  once?: 'turn';
  label: string;
  /** Carry effects normally stop the unit striking; Bone Whistle does not. */
  keepStrike?: boolean;
  /** Act sits on a unit the enemy controls (manacles): the bearer's controller uses it. */
  bearer?: boolean;
}

export interface PlayOp {
  op: string;
  n?: number;
  m?: number;
}

export interface Card {
  id: string;
  name: string;
  faction: FactionId;
  kind: CardKind;
  rarity: 'common' | 'uncommon' | 'rare' | 'patron';
  cost: number;
  power?: number;
  /** Engine keywords: fast slow tough ranged delay cryptid harbor hold untargetable noRangedTarget noAnswer evenGround winged trapproof climber. */
  kw: string[];
  /** Printed keyword tags shown on the card (Raid, Returns ...). */
  tags: string[];
  /** Place / title line under the name. */
  mark: string;
  text: string;
  quote: string;
  quoted: string;
  art: string;
  artPos?: string;
  /** Rites, items, devices and traps: who you name when you play it. */
  target?: TargetSpec;
  /** Rites / one-shot devices: what happens. */
  play?: PlayOp[];
  /** Items: attaches to the target (or a tile device / tray device). */
  attach?: 'unit' | 'tile' | 'tray' | 'leader';
  ab?: Ability[];
  act?: ActDef;
  /** Leader once-per-match LEAD power. */
  lead?: { op: string; label: string; text: string; n?: number; target?: TargetSpec };
  isNew?: boolean;
  /** Items: what the attachment does while it is on its bearer. */
  gear?: { op: string; n?: number };
  /** Trap cards: which hidden death they lay. */
  trapKind?: string;
  /** Units that are hidden as a trap instead of deployed (Hidebehind). */
  hide?: boolean;
}

export interface Gear {
  gid: string;
  cardId: string;
  owner: Side;
  /** Spent one-shot item effects still attached (used flags live here). */
  used?: boolean;
  /** Turn number the per-turn effect last fired. */
  turnUsed?: number;
}

export interface Unit {
  uid: string;
  cardId: string;
  side: Side;
  power: number;
  maxPower: number;
  kw: string[];
  moved: boolean;
  attacked: boolean;
  /** Arrived this turn with Delay, or exhausted by an effect. */
  sick: boolean;
  /** Extra tiles this unit may still step this turn after moving. */
  steps: number;
  gear: Gear[];
  leader?: boolean;
  /** Cannot move while match.turn <= pinUntil. */
  pinUntil?: number;
  /** Cannot strike (or strike back) while match.turn <= noStrikeUntil. */
  noStrikeUntil?: number;
  /** Enemy rites cannot name it while match.turn <= wardUntil. */
  wardUntil?: number;
  /** Cannot climb while match.turn <= groundUntil. */
  groundUntil?: number;
  /** Turn on which it took its first strike (shields). */
  struckTurn?: number;
  /** Turn it arrived. */
  enteredTurn: number;
  /** One-time saves already spent. */
  spent: string[];
  /** Once-per-turn triggers: key -> turn used. */
  turnUse: Record<string, number>;
}

export interface Trap {
  tid: string;
  r: number;
  c: number;
  /** shaft snake deadfall sink cavein hidebehind cinders hellrail */
  kind: string;
  owner: Side | null;
  cardId?: string;
  known: { blue: boolean; red: boolean };
}

export interface TileDevice {
  did: string;
  r: number;
  c: number;
  cardId: string;
  owner: Side;
  exhaustedTurn?: number;
  spent?: boolean;
}

export interface TrayDevice {
  did: string;
  cardId: string;
  owner: Side;
  exhaustedTurn?: number;
}

export interface PendingOption {
  key: string;
  label: string;
  uid?: string;
  r?: number;
  c?: number;
  cardId?: string;
}

/** A choice the engine is waiting on before play continues. */
export interface Pending {
  side: Side;
  prompt: string;
  /** Engine handler that resolves the pick. */
  resolve: string;
  options: PendingOption[];
  optional: boolean;
  /** Free data for the resolver. */
  data: Record<string, unknown>;
  source?: string;
}

export type LeaderPlace = 'tray' | 'board' | 'aside' | 'fallen';

/** Optional rules that answer the first-player edge (see dusthex_rebuild.md). */
export interface Rules {
  /** A: the first player opens with one card fewer. */
  firstShortHand?: boolean;
  /** B: dominance is scored for both sides at the end of each full round. */
  roundScore?: boolean;
  /** C: the first player cannot strike on turn 1. */
  firstNoStrike?: boolean;
  /** D: the first player may muster only one unit on turn 1. */
  firstOneDeploy?: boolean;
  /** E: a dominance win is only settled at the end of a full round; the leader then wins, a tie plays on. */
  mirrorClock?: boolean;
}

export interface Match {
  mapId: string;
  /** Rules in force (missing = none of the optional rules). */
  rules?: Rules;
  /** Units mustered this turn (for firstOneDeploy). */
  musters?: number;
  w: number;
  h: number;
  tiles: Tile[][];
  goal: number;
  side: Side;
  turn: number;
  seed: number;
  seq: number;
  units: Record<string, Unit>;
  board: (string | null)[][];
  control: (Side | null)[][];
  money: Record<Side, number>;
  dom: Record<Side, number>;
  hand: Record<Side, string[]>;
  deck: Record<Side, string[]>;
  discard: Record<Side, string[]>;
  exile: Record<Side, string[]>;
  leader: Record<Side, string>;
  leaderAt: Record<Side, LeaderPlace>;
  /** Turn on which an aside leader / Returns unit musters again. */
  returning: { side: Side; cardId: string; turn: number; leader?: boolean; gear?: Gear[] }[];
  leadUsed: Record<Side, boolean>;
  traps: Trap[];
  tileDevices: TileDevice[];
  tray: Record<Side, TrayDevice[]>;
  /** Cold Ring tiles. */
  rings: { r: number; c: number; until: number }[];
  /** Salt Line and similar side-wide wards: side -> until turn. */
  saltOath: Record<Side, number>;
  /** Ledger lives on the leader plate. */
  ledger: Record<Side, boolean>;
  /** False Coffin returns at end of turn. */
  coffins: { side: Side; cardId: string }[];
  /** Night Watch: next allied move into a trap is turned aside. */
  aside: Record<Side, boolean>;
  /** Per-turn counters for the side whose turn it is. */
  played: { cards: number; items: number; devices: number };
  /** First allied move each turn may take Sitting Bull's extra step. */
  visionStep: Record<Side, boolean>;
  pending: Pending[];
  /** Tiles each side has looked at ("r,c"). */
  scouted: Record<Side, string[]>;
  log: string[];
  /** Events since the last action (UI sound / animation). */
  events: GameEvent[];
  winner: Side | null;
  winKind: 'claims' | 'stronghold' | 'yield' | null;
}

export type GameEvent =
  | { e: 'deploy'; uid: string; side: Side }
  | { e: 'move'; uid: string; from: [number, number]; to: [number, number] }
  | { e: 'strike'; uid: string; target: string; ranged: boolean }
  | { e: 'damage'; uid: string; n: number }
  | { e: 'death'; uid: string; cardId: string; side: Side }
  | { e: 'trap'; r: number; c: number; kind: string; uid?: string; victimId?: string; victimName?: string; victimSide?: Side; owner?: Side | null; cardId?: string }
  | { e: 'play'; side: Side; cardId: string }
  | { e: 'lead'; side: Side }
  | { e: 'turn'; side: Side }
  | { e: 'win'; side: Side };

export type Target = { uid?: string; r?: number; c?: number; gid?: string; did?: string };

export type Action =
  | { t: 'deploy'; i: number | 'leader'; r: number; c: number }
  | { t: 'move'; uid: string; r: number; c: number }
  | { t: 'strike'; uid: string; r: number; c: number }
  | { t: 'play'; i: number; target?: Target }
  | { t: 'act'; uid?: string; gid?: string; did?: string; target?: Target }
  | { t: 'lead'; target?: Target }
  | { t: 'choose'; key: string }
  | { t: 'skip' }
  | { t: 'end' }
  | { t: 'yield'; side?: Side };

export interface StepResult {
  state: Match;
  error: string | null;
}
