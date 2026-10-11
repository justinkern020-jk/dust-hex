/**
 * Accounts and the Ledger — grok.me's "Take a seat" (email + password), the
 * name other occultists see, table / practice records, and a cloud copy of
 * the profile. Sessions are random tokens kept server-side (hashed), carried
 * in an HttpOnly cookie, so no signing secret is needed.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { Store } from './store.js';

const scrypt = (pw: string, salt: Buffer, len: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, len, { N: 16384, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

export const SESSION_COOKIE = 'ow_session';
export const SESSION_SEC = 60 * 60 * 24 * 60;
export const NAME_MAX = 18;
export const PROFILE_MAX = 200_000;
const BOOK_SIZE = 50;

const K = {
  user: (id: string) => `ow:u:${id}`,
  email: (e: string) => `ow:u:email:${e}`,
  name: (n: string) => `ow:u:name:${n}`,
  session: (h: string) => `ow:s:${h}`,
  profile: (id: string) => `ow:p:${id}`,
  book: 'ow:book',
  rate: (ip: string) => `ow:rl:${ip}`,
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  salt: string;
  hash: string;
  createdAt: number;
  username: string | null;
  tableWins: number;
  tableLosses: number;
  practiceWins: number;
  practiceLosses: number;
};

export type PublicSeat = {
  id: string;
  email: string;
  displayName: string;
  username: string | null;
  tableWins: number;
  tableLosses: number;
  practiceWins: number;
  practiceLosses: number;
};

export type BookRow = { username: string; tableWins: number; tableLosses: number };

export class SeatError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function publicSeat(u: User): PublicSeat {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    username: u.username,
    tableWins: u.tableWins,
    tableLosses: u.tableLosses,
    practiceWins: u.practiceWins,
    practiceLosses: u.practiceLosses,
  };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function normalizeEmail(raw: unknown): string {
  const e = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (e.length < 3 || e.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw new SeatError(400, 'That email will not take ink.');
  }
  return e;
}

/** A ledger name: 2–18 letters, digits, spaces, . _ ' - */
export function cleanLedgerName(raw: unknown): string {
  const n = (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > NAME_MAX || !/^[\p{L}\p{N} ._'-]+$/u.test(n)) {
    throw new SeatError(400, `A name is 2–${NAME_MAX} letters or numbers.`);
  }
  return n;
}

function bookScore(u: User): number {
  // Table wins rank first; fewer table losses break ties.
  return u.tableWins * 100_000 - Math.min(u.tableLosses, 99_999);
}

async function readUser(store: Store, id: string): Promise<User | null> {
  const [raw] = await store.pipe([['GET', K.user(id)]]);
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

async function writeUser(store: Store, u: User): Promise<void> {
  const cmds: (string | number)[][] = [['SET', K.user(u.id), JSON.stringify(u)]];
  if (u.username) cmds.push(['ZADD', K.book, bookScore(u), u.id]);
  await store.pipe(cmds);
}

/** 20 sign-in / sign-up tries per minute per address. */
export async function rateLimit(store: Store, ip: string): Promise<void> {
  const [n] = await store.pipe([
    ['INCR', K.rate(ip)],
    ['EXPIRE', K.rate(ip), 60],
  ]);
  if (Number(n) > 20) throw new SeatError(429, 'Too many tries. Wait a minute.');
}

async function newSession(store: Store, userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await store.pipe([['SET', K.session(sha(token)), userId, 'EX', SESSION_SEC]]);
  return token;
}

export async function signUp(
  store: Store,
  input: { email: unknown; password: unknown; name?: unknown },
  now: number,
): Promise<{ user: User; token: string }> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < 8 || password.length > 200) {
    throw new SeatError(400, 'A password needs at least 8 characters.');
  }
  const displayName =
    (typeof input.name === 'string' ? input.name.trim().slice(0, 40) : '') || 'Adept';
  const id = randomBytes(12).toString('hex');
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  const [claimed] = await store.pipe([['SET', K.email(email), id, 'NX']]);
  if (claimed !== 'OK') throw new SeatError(409, 'That email already has a seat.');
  const user: User = {
    id,
    email,
    displayName,
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    createdAt: now,
    username: null,
    tableWins: 0,
    tableLosses: 0,
    practiceWins: 0,
    practiceLosses: 0,
  };
  await writeUser(store, user);
  return { user, token: await newSession(store, id) };
}

export async function signIn(
  store: Store,
  input: { email: unknown; password: unknown },
): Promise<{ user: User; token: string }> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';
  const [id] = await store.pipe([['GET', K.email(email)]]);
  const user = typeof id === 'string' ? await readUser(store, id) : null;
  const refuse = new SeatError(401, 'The book does not know that email and password.');
  if (!user) {
    // Burn comparable time so a missing email is not obvious.
    await scrypt(password || 'x', randomBytes(16), 64);
    throw refuse;
  }
  const got = await scrypt(password, Buffer.from(user.salt, 'hex'), 64);
  const want = Buffer.from(user.hash, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw refuse;
  return { user, token: await newSession(store, user.id) };
}

/** Close an account for good (the password again, to be sure). */
export async function deleteAccount(
  store: Store,
  user: User,
  password: unknown,
  token: string | null,
): Promise<void> {
  const pw = typeof password === 'string' ? password : '';
  const got = await scrypt(pw, Buffer.from(user.salt, 'hex'), 64);
  const want = Buffer.from(user.hash, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    throw new SeatError(401, 'That is not the password for this seat.');
  }
  await store.pipe([
    ['DEL', K.user(user.id)],
    ['DEL', K.email(user.email)],
    ...(user.username ? [['DEL', K.name(user.username.toLowerCase())]] : []),
    ['DEL', K.profile(user.id)],
    ['ZREM', K.book, user.id],
    ...(token ? [['DEL', K.session(sha(token))]] : []),
  ]);
}

export async function signOut(store: Store, token: string | null): Promise<void> {
  if (token) await store.pipe([['DEL', K.session(sha(token))]]);
}

export async function userForToken(store: Store, token: string | null): Promise<User | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [id] = await store.pipe([['GET', K.session(sha(token))]]);
  return typeof id === 'string' ? readUser(store, id) : null;
}

export async function takeName(store: Store, user: User, raw: unknown): Promise<User> {
  const name = cleanLedgerName(raw);
  const key = name.toLowerCase();
  if (user.username && user.username.toLowerCase() === key) {
    const next = { ...user, username: name };
    await writeUser(store, next);
    return next;
  }
  const [claimed] = await store.pipe([['SET', K.name(key), user.id, 'NX']]);
  if (claimed !== 'OK') throw new SeatError(409, 'Another occultist already took that name.');
  if (user.username) await store.pipe([['DEL', K.name(user.username.toLowerCase())]]);
  const next = { ...user, username: name };
  await writeUser(store, next);
  return next;
}

/** A finished sitting. Live-table results are the standing; the rest is practice. */
export async function recordResult(
  store: Store,
  user: User,
  won: boolean,
  table: boolean,
): Promise<User> {
  const fresh = (await readUser(store, user.id)) ?? user;
  const next: User = { ...fresh };
  if (table) {
    if (won) next.tableWins += 1;
    else next.tableLosses += 1;
  } else if (won) next.practiceWins += 1;
  else next.practiceLosses += 1;
  await writeUser(store, next);
  return next;
}

export async function readBook(store: Store): Promise<BookRow[]> {
  const [ids] = await store.pipe([['ZREVRANGE', K.book, 0, BOOK_SIZE - 1]]);
  const list = (ids as string[]) ?? [];
  if (list.length === 0) return [];
  const [raws] = await store.pipe([['MGET', ...list.map(K.user)]]);
  const rows: BookRow[] = [];
  for (const raw of (raws as (string | null)[]) ?? []) {
    if (typeof raw !== 'string') continue;
    try {
      const u = JSON.parse(raw) as User;
      if (u.username) {
        rows.push({ username: u.username, tableWins: u.tableWins, tableLosses: u.tableLosses });
      }
    } catch {
      /* skip */
    }
  }
  return rows;
}

export async function readCloudProfile(store: Store, user: User): Promise<unknown | null> {
  const [raw] = await store.pipe([['GET', K.profile(user.id)]]);
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeCloudProfile(store: Store, user: User, profile: unknown): Promise<void> {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new SeatError(400, 'That is not a profile.');
  }
  const text = JSON.stringify(profile);
  if (text.length > PROFILE_MAX) throw new SeatError(413, 'That profile is too large.');
  await store.pipe([['SET', K.profile(user.id), text]]);
}

/** The seat token: the HttpOnly cookie, or a Bearer header (kept in localStorage). */
export function tokenFrom(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+([a-f0-9]{64})$/i.exec(auth.trim());
  if (bearer) return bearer[1].toLowerCase();
  const cookie = req.headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}
