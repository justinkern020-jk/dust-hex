/**
 * POST /api/watch — the owner's Portal (gated server-side, see _lib/watch.ts).
 *   { op: 'gate' }                         → { ok } (200 for anyone; ok only for the owner)
 *   { op: 'list' }                         → { matches }
 *   { op: 'who' }                          → { hands, matches, build } (everyone at the table now)
 *   { op: 'view', id }                     → { summary, frame }
 *   { op: 'code', id, side, code }         → { ok, cmd }
 * Anyone else gets a bare 404 so the door is not advertised.
 */
import { getStore } from '../_lib/store.js';
import { HttpError, fail, json, readJson } from '../_lib/http.js';
import { listHands, serverBuild } from '../_lib/table.js';
import { WatchError, isOwner, listLive, sendCode, viewMatch } from '../_lib/watch.js';

export async function handleWatch(req: Request, now = Date.now()): Promise<Response> {
  try {
    const store = getStore();
    if (req.method !== 'POST') return json({ ok: false }, 404);
    const body = await readJson(req, 4_000);
    const op = String(body.op ?? '');
    const owner = await isOwner(req, store);
    // The gate answers quietly (no console noise for signed-in players);
    // every other door is a bare 404 unless you are the owner.
    if (op === 'gate') return json(owner ? { ok: true, store: store.kind } : { ok: false });
    if (!owner) return json({ ok: false }, 404);
    if (op === 'list') return json({ ok: true, matches: await listLive(store, now) });
    if (op === 'who') {
      const [hands, matches] = await Promise.all([listHands(store, now), listLive(store, now)]);
      return json({ ok: true, hands, matches, build: serverBuild() });
    }
    if (op === 'view') return json({ ok: true, ...(await viewMatch(store, String(body.id ?? ''))) });
    if (op === 'code') return json({ ok: true, cmd: await sendCode(store, { id: body.id, side: body.side, code: body.code }, now) });
    throw new HttpError(400, 'Unknown op.');
  } catch (err) {
    if (err instanceof WatchError) return json({ ok: false, error: err.message }, err.status);
    return fail(err);
  }
}

export function POST(req: Request): Promise<Response> {
  return handleWatch(req);
}

export function GET(): Response {
  return json({ ok: false }, 404);
}
