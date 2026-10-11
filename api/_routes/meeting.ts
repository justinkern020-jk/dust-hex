/**
 * POST /api/meeting — the Occultist Meeting (shared bulletin board).
 *   { op: 'list', since?, rev? }      → { msgs, head, rev, full, owner, store }
 *   { op: 'post', mark, text, name?, image? } → { ok, msg }   image: { data (base64), w, h }
 *   GET ?img=<id>                     → the image bytes (when kept beside the messages)
 *   { op: 'delete', id }              → owner only (else 404)
 */
import { getStore } from '../_lib/store.js';
import { HttpError, clientIp, fail, json, readJson } from '../_lib/http.js';
import { tokenFrom } from '../_lib/accounts.js';
import { isOwner } from '../_lib/watch.js';
import {
  IMG_MAX,
  MeetingError,
  deleteMeeting,
  listMeeting,
  postMeeting,
  posterFor,
  readImage,
} from '../_lib/meeting.js';

const MARK_RE = /^[a-z0-9]{16}$/;

export async function handleMeeting(req: Request, now = Date.now()): Promise<Response> {
  try {
    const store = getStore();
    if (req.method === 'GET') {
      // An image kept beside the messages; the CDN keeps it for an hour.
      const img = await readImage(store, new URL(req.url).searchParams.get('img'));
      if (!img) return json({ ok: false }, 404);
      return new Response(new Uint8Array(img.bytes), {
        status: 200,
        headers: {
          'Content-Type': img.type,
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    }
    if (req.method !== 'POST') throw new HttpError(405, 'POST only.');
    const body = await readJson(req, Math.ceil((IMG_MAX * 4) / 3) + 6_000);
    const op = String(body.op ?? 'list');
    const owner = await isOwner(req, store);
    if (op === 'list') {
      const since = Math.max(0, Math.floor(Number(body.since) || 0));
      const rev = Number(body.rev);
      // A strike since the last read (rev moved) sends the whole board again.
      const first = await listMeeting(store, since);
      if (since > 0 && Number.isFinite(rev) && rev !== first.rev) {
        const all = await listMeeting(store, 0);
        return json({ ok: true, ...all, full: true, owner, store: store.kind });
      }
      return json({ ok: true, ...first, full: since === 0, owner, store: store.kind });
    }
    if (op === 'post') {
      const mark = String(body.mark ?? '');
      if (!MARK_RE.test(mark)) throw new HttpError(400, 'Bad mark.');
      const who = await posterFor(store, tokenFrom(req), owner, mark, clientIp(req));
      const msg = await postMeeting(store, who, { text: body.text, name: body.name, image: body.image }, now);
      return json({ ok: true, msg });
    }
    if (op === 'delete') {
      if (!owner) return json({ ok: false }, 404);
      await deleteMeeting(store, body.id);
      return json({ ok: true });
    }
    throw new HttpError(400, 'Unknown op.');
  } catch (err) {
    if (err instanceof MeetingError) return json({ ok: false, error: err.message }, err.status);
    return fail(err);
  }
}

export function POST(req: Request): Promise<Response> {
  return handleMeeting(req);
}
