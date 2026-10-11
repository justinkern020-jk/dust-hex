/**
 * /api/account — accounts, the Ledger and the cloud profile.
 *   GET  ?op=me       → { seat | null }
 *   GET  ?op=book     → { book: [{ username, tableWins, tableLosses }] }
 *   GET  ?op=profile  → { profile | null }        (signed in)
 *   POST { op: 'signup', email, password, name }
 *   POST { op: 'signin', email, password }
 *   POST { op: 'signout' }
 *   POST { op: 'name', username }                 (signed in)
 *   POST { op: 'record', won, table }             (signed in)
 *   POST { op: 'profile', profile }               (signed in)
 *
 * Needs a durable store (Upstash Redis). On instance memory the book stays
 * shut (503) rather than inventing accounts that vanish on a cold start.
 */
import { getStore, type Store } from '../_lib/store.js';
import { HttpError, clientIp, fail, json, readJson } from '../_lib/http.js';
import {
  SESSION_COOKIE,
  SESSION_SEC,
  SeatError,
  publicSeat,
  rateLimit,
  readBook,
  readCloudProfile,
  recordResult,
  signIn,
  deleteAccount,
  signOut,
  signUp,
  takeName,
  tokenFrom,
  userForToken,
  writeCloudProfile,
} from '../_lib/accounts.js';

function sessionCookie(token: string | null): string {
  const base = `${SESSION_COOKIE}=${token ?? ''}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return token ? `${base}; Max-Age=${SESSION_SEC}` : `${base}; Max-Age=0`;
}

function shut(store: Store): boolean {
  return !store.durable && process.env.OW_ALLOW_MEMORY_ACCOUNTS !== '1';
}

function seatFail(err: unknown): Response {
  if (err instanceof SeatError) return json({ ok: false, error: err.message }, err.status);
  return fail(err);
}

export async function handleAccount(req: Request, now = Date.now()): Promise<Response> {
  try {
    const store = getStore();
    if (shut(store)) {
      return json(
        { ok: false, shut: true, error: 'The book is shut — accounts open once the ledger store is connected.' },
        // Reads (every page load asks "who is here?") answer quietly so a shut
        // book is not a console error; writes still refuse with 503.
        req.method === 'GET' ? 200 : 503,
      );
    }
    const token = tokenFrom(req);
    if (req.method === 'GET') {
      const op = new URL(req.url).searchParams.get('op') ?? 'me';
      if (op === 'book') return json({ ok: true, book: await readBook(store) });
      const user = await userForToken(store, token);
      if (op === 'me') return json({ ok: true, seat: user ? publicSeat(user) : null });
      if (op === 'profile') {
        if (!user) throw new SeatError(401, 'Sign in first.');
        return json({ ok: true, profile: await readCloudProfile(store, user) });
      }
      throw new HttpError(400, 'Unknown op.');
    }
    if (req.method !== 'POST') throw new HttpError(405, 'GET or POST.');
    const body = await readJson(req);
    const op = String(body.op ?? '');
    if (op === 'signup' || op === 'signin') {
      await rateLimit(store, clientIp(req));
      const { user, token: fresh } =
        op === 'signup'
          ? await signUp(store, { email: body.email, password: body.password, name: body.name }, now)
          : await signIn(store, { email: body.email, password: body.password });
      // The token also rides in the body so the client can keep it past a
      // blocked or cleared cookie (validated server-side on every call).
      return json({ ok: true, seat: publicSeat(user), token: fresh }, 200, {
        'Set-Cookie': sessionCookie(fresh),
      });
    }
    if (op === 'signout') {
      await signOut(store, token);
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(null) });
    }
    const user = await userForToken(store, token);
    if (!user) throw new SeatError(401, 'Sign in first.');
    if (op === 'delete') {
      await deleteAccount(store, user, body.password, token);
      return json({ ok: true, seat: null }, 200, { 'Set-Cookie': sessionCookie(null) });
    }
    if (op === 'name') return json({ ok: true, seat: publicSeat(await takeName(store, user, body.username)) });
    if (op === 'record') {
      const next = await recordResult(store, user, body.won === true, body.table === true);
      return json({ ok: true, seat: publicSeat(next) });
    }
    if (op === 'profile') {
      await writeCloudProfile(store, user, body.profile);
      return json({ ok: true });
    }
    throw new HttpError(400, 'Unknown op.');
  } catch (err) {
    return seatFail(err);
  }
}

export function GET(req: Request): Promise<Response> {
  return handleAccount(req);
}

export function POST(req: Request): Promise<Response> {
  return handleAccount(req);
}
