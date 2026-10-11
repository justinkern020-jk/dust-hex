/**
 * The Portal — owner-only spectating of live matches, and secret codes sent
 * through it. Matches report themselves (the host / the only client) to the
 * table; frames are only streamed while the owner is actually watching.
 *
 * Gate (server-side): a signed-in seat whose email is in OWNER_EMAILS or id in
 * OWNER_IDS (durable store only), or the OWNER_KEY secret (≥16 chars) sent in
 * the x-ow-owner-key header from the owner's device.
 */
import { timingSafeEqual, createHash } from 'node:crypto';
import type { Store } from './store.js';
import { tokenFrom, userForToken } from './accounts.js';

/** Long enough to ride out a background tab's throttled timers (about once a minute). */
export const LIVE_MS = 90_000;
/** A finished (or left) match lingers briefly, marked over. */
const OVER_MS = 15_000;
export const WATCH_MS = 12_000;
const CMD_MS = 60_000;
const KEY_SEC = 6 * 60 * 60;
const LIST_MAX = 40;
export const FRAME_MAX = 48_000;

export const MATCH_ID_RE = /^[a-z0-9]{12,24}$/;
const MATCH_KEY_RE = /^[a-z0-9]{24,48}$/;
/** Codes the Portal may carry (the in-match ones). */
export const PORTAL_CODES = ['justin', 'adept', 'seth', 'southhaven', 'athens'] as const;
export type PortalCode = (typeof PORTAL_CODES)[number];
export type PortalCommand = { n: number; side: 'blue' | 'red'; code: PortalCode; at: number };

const K = {
  idx: 'ow:m:idx',
  sum: (id: string) => `ow:m:s:${id}`,
  frame: (id: string) => `ow:m:f:${id}`,
  watched: (id: string) => `ow:m:w:${id}`,
  cmds: (id: string) => `ow:m:c:${id}`,
  key: (id: string) => `ow:m:k:${id}`,
};

export class WatchError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Env = Record<string, string | undefined>;

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Is this request the owner? Never trusts anything the browser merely claims. */
export async function isOwner(req: Request, store: Store, env: Env = process.env): Promise<boolean> {
  const emails = list(env.OWNER_EMAILS);
  const ids = list(env.OWNER_IDS);
  if (store.durable && (emails.length || ids.length)) {
    const user = await userForToken(store, tokenFrom(req));
    if (user && (emails.includes(user.email.toLowerCase()) || ids.includes(user.id.toLowerCase()))) {
      return true;
    }
  }
  // A long secret owner key, kept on the owner's device, always opens it too.
  const key = env.OWNER_KEY ?? '';
  if (key.length >= 16) {
    const sent = req.headers.get('x-ow-owner-key') ?? '';
    if (sent && sameSecret(sent, key)) return true;
  }
  return false;
}

export type MatchSummary = {
  id: string;
  mode: string;
  era: string;
  map: string;
  turn: number;
  side: 'blue' | 'red';
  phase: string;
  blue: { name: string; faction: string; leader: string };
  red: { name: string; faction: string; leader: string };
  over: boolean;
  at: number;
};

function str(v: unknown, max = 60): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function seatOf(v: unknown) {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { name: str(o.name, 32), faction: str(o.faction), leader: str(o.leader) };
}

export function cleanSummary(id: string, raw: unknown, now: number): MatchSummary {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    id,
    mode: str(o.mode, 16) || 'training',
    era: str(o.era, 8) || 'first',
    map: str(o.map, 40),
    turn: Math.max(0, Math.min(9999, Math.floor(Number(o.turn) || 0))),
    side: o.side === 'red' ? 'red' : 'blue',
    phase: str(o.phase, 12),
    blue: seatOf(o.blue),
    red: seatOf(o.red),
    over: o.over === true,
    at: now,
  };
}

/** A reporting client: keep the match listed; stream the frame while watched. */
export async function reportLive(
  store: Store,
  input: { id: unknown; key: unknown; summary: unknown; frame?: unknown },
  now: number,
): Promise<{ ok: true; watched: boolean; cmds: PortalCommand[] }> {
  const id = String(input.id ?? '');
  const key = String(input.key ?? '');
  if (!MATCH_ID_RE.test(id) || !MATCH_KEY_RE.test(key)) throw new WatchError(400, 'Bad match.');
  // First report claims the match id; later reports must hold the same key.
  const [claimed, held] = await store.pipe([
    ['SET', K.key(id), key, 'NX', 'EX', KEY_SEC],
    ['GET', K.key(id)],
  ]);
  if (claimed !== 'OK' && held !== key) throw new WatchError(403, 'Not your match.');
  const summary = cleanSummary(id, input.summary, now);
  const cmds: (string | number)[][] = [
    ['SET', K.sum(id), JSON.stringify(summary), 'PX', summary.over ? OVER_MS : LIVE_MS],
    ['ZADD', K.idx, now, id],
    ['ZREMRANGEBYSCORE', K.idx, '-inf', now - LIVE_MS],
    ['EXPIRE', K.key(id), KEY_SEC],
  ];
  if (input.frame !== undefined) {
    const text = JSON.stringify(input.frame);
    if (text.length > FRAME_MAX) throw new WatchError(413, 'Frame too large.');
    cmds.push(['SET', K.frame(id), text, 'PX', LIVE_MS]);
  }
  cmds.push(['GET', K.watched(id)], ['GET', K.cmds(id)], ['DEL', K.cmds(id)]);
  const out = await store.pipe(cmds);
  const watched = out[out.length - 3] != null;
  let pending: PortalCommand[] = [];
  const rawCmds = out[out.length - 2];
  if (typeof rawCmds === 'string') {
    try {
      const parsed = JSON.parse(rawCmds) as PortalCommand[];
      pending = Array.isArray(parsed) ? parsed : [];
    } catch {
      pending = [];
    }
  }
  return { ok: true, watched, cmds: pending };
}

export async function listLive(store: Store, now: number): Promise<MatchSummary[]> {
  const [ids] = await store.pipe([['ZRANGEBYSCORE', K.idx, now - LIVE_MS, '+inf']]);
  const idList = (Array.isArray(ids) ? ids : []).map(String).slice(-LIST_MAX).reverse();
  if (!idList.length) return [];
  const [raws] = await store.pipe([['MGET', ...idList.map(K.sum)]]);
  const out: MatchSummary[] = [];
  for (const raw of Array.isArray(raws) ? raws : []) {
    if (typeof raw !== 'string') continue;
    try {
      out.push(JSON.parse(raw) as MatchSummary);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Owner opens (or keeps open) the portal on a match. */
export async function viewMatch(
  store: Store,
  id: string,
): Promise<{ summary: MatchSummary | null; frame: unknown | null }> {
  if (!MATCH_ID_RE.test(id)) throw new WatchError(400, 'Bad match.');
  const [, sum, frame] = await store.pipe([
    ['SET', K.watched(id), '1', 'PX', WATCH_MS],
    ['GET', K.sum(id)],
    ['GET', K.frame(id)],
  ]);
  const parse = (v: unknown) => {
    if (typeof v !== 'string') return null;
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  };
  return { summary: parse(sum) as MatchSummary | null, frame: parse(frame) };
}

/** Owner sends a code through the portal to one side of a live match. */
export async function sendCode(
  store: Store,
  input: { id: unknown; side: unknown; code: unknown },
  now: number,
): Promise<PortalCommand> {
  const id = String(input.id ?? '');
  if (!MATCH_ID_RE.test(id)) throw new WatchError(400, 'Bad match.');
  const side = input.side === 'red' ? 'red' : input.side === 'blue' ? 'blue' : null;
  const code = PORTAL_CODES.find((c) => c === input.code);
  if (!side || !code) throw new WatchError(400, 'That code does not cross the portal.');
  const [sum, prev] = await store.pipe([['GET', K.sum(id)], ['GET', K.cmds(id)]]);
  if (typeof sum !== 'string') throw new WatchError(404, 'That match has closed.');
  let queue: PortalCommand[] = [];
  if (typeof prev === 'string') {
    try {
      queue = (JSON.parse(prev) as PortalCommand[]).slice(-8);
    } catch {
      queue = [];
    }
  }
  const lastN = queue.length ? queue[queue.length - 1]!.n : 0;
  const cmd: PortalCommand = { n: Math.max(now, lastN + 1), side, code, at: now };
  queue.push(cmd);
  await store.pipe([
    ['SET', K.cmds(id), JSON.stringify(queue), 'PX', CMD_MS],
    ['SET', K.watched(id), '1', 'PX', WATCH_MS],
  ]);
  return cmd;
}
