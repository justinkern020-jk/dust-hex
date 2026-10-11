/**
 * One function for every /api door (/api/table, /api/account, /api/watch,
 * /api/meeting, /api/ranked, /api/relay). Keeping them in a single function means one warm instance
 * serves them all — so the best-effort memory store (used until Upstash is
 * connected) is shared between them, and there are fewer cold starts.
 */
import { json } from './_lib/http.js';
import { handleAccount } from './_routes/account.js';
import { handleMeeting } from './_routes/meeting.js';
import { handleTable } from './_routes/table.js';
import { handleWatch } from './_routes/watch.js';
import { handleRanked } from './_routes/ranked.js';
import { handleRelay } from './_routes/relay.js';

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  table: handleTable,
  account: handleAccount,
  watch: handleWatch,
  meeting: handleMeeting,
  ranked: handleRanked,
  relay: handleRelay,
};

export function routeName(req: Request): string {
  const url = new URL(req.url);
  const seg = url.pathname.replace(/\/+$/, '').split('/');
  const i = seg.indexOf('api');
  const fromPath = i >= 0 ? seg[i + 1] : undefined;
  return (fromPath && fromPath !== '[fn]' ? fromPath : url.searchParams.get('fn')) ?? '';
}

export function route(req: Request): Promise<Response> | Response {
  const handler = ROUTES[routeName(req)];
  return handler ? handler(req) : json({ ok: false }, 404);
}

export function GET(req: Request) {
  return route(req);
}

export function POST(req: Request) {
  return route(req);
}
