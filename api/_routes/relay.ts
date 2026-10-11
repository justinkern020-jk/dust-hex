/**
 * /api/relay — best-effort mailbox relay for Friend rooms and Quick match.
 *
 * The client tries WebRTC (PeerJS cloud) first and only leans on this relay
 * when a direct link fails, or to pair Quick-match players. State lives in
 * the warm function instance's memory (all /api doors share one function), so
 * it works while one instance is warm but is not durable or cross-region.
 */
import { HttpError, fail, json, readJson } from '../_lib/http.js';

type Item = Record<string, unknown> & { k: string };
interface Box { items: { n: number; item: Item }[]; next: number }
interface Room { hid: string | null; at: number; boxes: Map<string, Box> }

const ROOM_TTL = 30 * 60_000;
const QUICK_TTL = 25_000;
const MAX_ITEMS = 400;
const ROOM_RE = /^[A-Z]{4}$/;
const ID_RE = /^[a-z0-9-]{1,40}$/i;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const rooms = new Map<string, Room>();
/** Quick-match rooms waiting for a partner: room -> { hid, beat }. */
const waiting = new Map<string, { hid: string; beat: number }>();

function sweep(now: number) {
  for (const [k, r] of rooms) if (now - r.at > ROOM_TTL) rooms.delete(k);
  for (const [k, w] of waiting) if (now - w.beat > QUICK_TTL) waiting.delete(k);
}

function roomOf(v: unknown): string {
  const r = typeof v === 'string' ? v.toUpperCase() : '';
  if (!ROOM_RE.test(r)) throw new HttpError(400, 'Bad room.');
  return r;
}

function boxOf(v: unknown): string {
  const b = typeof v === 'string' ? v : '';
  if (!ID_RE.test(b)) throw new HttpError(400, 'Bad box.');
  return b;
}

function getRoom(code: string, now: number): Room {
  let r = rooms.get(code);
  if (!r) {
    r = { hid: null, at: now, boxes: new Map() };
    rooms.set(code, r);
  }
  r.at = now;
  return r;
}

function getBox(r: Room, name: string): Box {
  let b = r.boxes.get(name);
  if (!b) {
    b = { items: [], next: 0 };
    r.boxes.set(name, b);
  }
  return b;
}

function freshCode(): string {
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (!rooms.has(c) && !waiting.has(c)) return c;
  }
  throw new HttpError(503, 'No free room.');
}

export async function handleRelay(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);
  try {
    const body = await readJson(req);
    const op = body.op;
    const now = Date.now();
    sweep(now);
    const hid = typeof body.hid === 'string' && ID_RE.test(body.hid) ? body.hid : null;

    if (op === 'host') {
      const code = roomOf(body.room);
      const existed = rooms.get(code);
      const fresh = !existed || existed.hid !== hid;
      const r = getRoom(code, now);
      if (fresh) r.boxes.clear();
      r.hid = hid;
      return json({ ok: true, fresh });
    }
    if (op === 'leave') {
      const code = roomOf(body.room);
      const r = rooms.get(code);
      if (r && (!hid || r.hid === hid)) rooms.delete(code);
      waiting.delete(code);
      return json({ ok: true });
    }
    if (op === 'push') {
      const code = roomOf(body.room);
      const r = rooms.get(code);
      if (!r || !r.hid) return json({ ok: false, nohost: true, error: 'No host in that room.' });
      r.at = now;
      const b = getBox(r, boxOf(body.box));
      const items = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
      for (const it of items) {
        if (!it || typeof it !== 'object' || typeof (it as Item).k !== 'string') continue;
        b.items.push({ n: b.next++, item: it as Item });
      }
      if (b.items.length > MAX_ITEMS) b.items.splice(0, b.items.length - MAX_ITEMS);
      return json({ ok: true, next: b.next });
    }
    if (op === 'pull') {
      const code = roomOf(body.room);
      const r = rooms.get(code);
      if (!r) return json({ ok: true, items: [], next: Number(body.from) || 0, lost: hid !== null });
      r.at = now;
      const b = getBox(r, boxOf(body.box));
      const from = Math.max(0, Math.floor(Number(body.from) || 0));
      const out = b.items.filter((x) => x.n >= from).slice(0, 40);
      const next = out.length ? out[out.length - 1].n + 1 : Math.max(from, b.next);
      const lost = hid !== null && r.hid !== null && r.hid !== hid;
      return json({ ok: true, items: out.map((x) => x.item), next, ...(lost ? { lost: true } : {}) });
    }
    if (op === 'quick') {
      const gid = typeof body.gid === 'string' && ID_RE.test(body.gid) ? body.gid : null;
      if (!gid) throw new HttpError(400, 'Bad gid.');
      for (const [code, w] of waiting) {
        if (w.hid === gid) continue;
        waiting.delete(code);
        return json({ ok: true, room: code, role: 'guest' });
      }
      const code = freshCode();
      waiting.set(code, { hid: gid, beat: now });
      return json({ ok: true, room: code, role: 'host' });
    }
    if (op === 'quickbeat' || op === 'quickagain') {
      const code = roomOf(body.room);
      const w = waiting.get(code);
      if (w) {
        w.beat = now;
        return json({ ok: true, waiting: true });
      }
      if (op === 'quickagain' && hid) {
        waiting.set(code, { hid, beat: now });
        return json({ ok: true, waiting: true });
      }
      return json({ ok: true, waiting: false });
    }
    if (op === 'quickcancel') {
      waiting.delete(roomOf(body.room));
      return json({ ok: true });
    }
    return json({ ok: false, error: 'Unknown op.' }, 400);
  } catch (err) {
    return fail(err);
  }
}
