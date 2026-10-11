/**
 * POST /api/table — presence heartbeat, challenge issue / accept / cancel.
 * Body: { op: 'beat' | 'issue' | 'accept' | 'cancel', mark, room?, country? }
 *       { op: 'live', mark, id, key, summary, frame? }  (a match reporting to the Portal)
 */
import { getStore } from '../_lib/store.js';
import { HttpError, fail, headerCountry, json, readJson } from '../_lib/http.js';
import { MARK_RE, ROOM_RE, accept, beat, cancel, cleanActivity, cleanCountry, issue, serverBuild } from '../_lib/table.js';
import { FRAME_MAX, WatchError, reportLive } from '../_lib/watch.js';

export async function handleTable(req: Request, now = Date.now()): Promise<Response> {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only.');
    const body = await readJson(req, FRAME_MAX + 8_000);
    const mark = String(body.mark ?? '');
    if (!MARK_RE.test(mark)) throw new HttpError(400, 'Bad mark.');
    const store = getStore();
    const op = String(body.op ?? 'beat');
    if (op === 'beat') {
      const country = cleanCountry(headerCountry(req)) ?? cleanCountry(body.country);
      return json(await beat(store, mark, country, now, cleanActivity(body.who), serverBuild()));
    }
    if (op === 'live') {
      // A match reporting itself to the Portal (frames only while watched).
      return json(
        await reportLive(store, { id: body.id, key: body.key, summary: body.summary, frame: body.frame }, now),
      );
    }
    const room = String(body.room ?? '');
    if (op === 'cancel') return json(await cancel(store, mark));
    if (!ROOM_RE.test(room)) throw new HttpError(400, 'Bad room.');
    if (op === 'issue') return json(await issue(store, mark, room, now));
    if (op === 'accept') return json(await accept(store, mark, room, now));
    throw new HttpError(400, 'Unknown op.');
  } catch (err) {
    if (err instanceof WatchError) return json({ ok: false, error: err.message }, err.status);
    return fail(err);
  }
}

export function POST(req: Request): Promise<Response> {
  return handleTable(req);
}

export function GET(): Response {
  return json({ ok: false, error: 'POST only.' }, 405);
}
