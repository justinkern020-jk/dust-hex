/**
 * The Occultist Meeting — one shared bulletin board for everyone at the table.
 *
 * Messages are plain text (never HTML; the client renders them as text) kept
 * in a sorted index of sequential ids, the newest ~200 retained. Posting is
 * rate-limited per hand and per address and capped in length; words, links
 * and images are not filtered (by the owner's choice). The owner
 * (server-verified: OWNER_KEY / OWNER_EMAILS / OWNER_IDS) posts with a Grand
 * Master badge and may strike any message.
 */
import { del as blobDel, put as blobPut } from '@vercel/blob';
import type { Store } from './store.js';
import { userForToken } from './accounts.js';

export const KEEP = 200;
export const TEXT_MAX = 500;
export const NAME_MAX = 24;
export const POST_EVERY_MS = 5_000;
export const IP_PER_10S = 8;
/** Images: compressed in the browser; the server takes at most this many bytes. */
export const IMG_MAX = 320_000;
export const IMG_EVERY_MS = 30_000;
export const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type ImgType = (typeof IMG_TYPES)[number];
const MSG_SEC = 30 * 24 * 60 * 60;

export const MK = {
  n: 'ow:meet:n',
  rev: 'ow:meet:rev',
  idx: 'ow:meet:idx',
  msg: (id: number) => `ow:meet:m:${id}`,
  img: (id: number) => `ow:meet:i:${id}`,
  rate: (who: string) => `ow:meet:rl:${who}`,
};

export type Badge = 'owner' | 'seat' | 'guest';
export type MeetingImage = { src: string; w: number; h: number; type: ImgType };
export type MeetingMessage = {
  id: number;
  at: number;
  name: string;
  text: string;
  badge: Badge;
  img?: MeetingImage;
};

export class MeetingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]{0,23}$/u;
const RESERVED_RE = /grand\s*master|owner|admin|moderator|justin\s*kern|occult\s*wars/i;

/** Plain text, no control characters, whitespace tamed, length capped. */
export function cleanText(raw: unknown): string {
  const s = String(raw ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.slice(0, TEXT_MAX);
}

/** Refusal reason, or null when the message may be posted. The meeting is not censored. */
export function spamReason(text: string): string | null {
  return text ? null : 'Say something first.';
}

export function cleanName(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (!NAME_RE.test(s)) return null;
  return s;
}

function parse(raw: unknown): MeetingMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const m = JSON.parse(raw) as MeetingMessage;
    return m && Number.isFinite(m.id) && typeof m.text === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** Recent messages (oldest first). With `since`, only newer ones. */
export async function listMeeting(
  store: Store,
  since = 0,
): Promise<{ msgs: MeetingMessage[]; head: number; rev: number }> {
  const [ids, head, rev] = await store.pipe([
    ['ZRANGEBYSCORE', MK.idx, since > 0 ? `(${since}` : '-inf', '+inf'],
    ['GET', MK.n],
    ['GET', MK.rev],
  ]);
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite).slice(-KEEP);
  let msgs: MeetingMessage[] = [];
  if (list.length) {
    const [raws] = await store.pipe([['MGET', ...list.map(MK.msg)]]);
    msgs = (Array.isArray(raws) ? raws : []).map(parse).filter((m): m is MeetingMessage => !!m);
  }
  return { msgs, head: Number(head) || 0, rev: Number(rev) || 0 };
}

/** What the bytes really are (never trust the declared type). */
export function sniffImage(b: Uint8Array): ImgType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export type ImageInput = { bytes: Buffer; type: ImgType; w: number; h: number };

/** Validate an attached image: base64 (or a data URL), a real png/jpeg/webp/gif, small. */
export function parseImage(raw: unknown): ImageInput | null {
  if (raw == null) return null;
  const o = (typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const data = String(o.data ?? '').replace(/^data:image\/[a-z+]+;base64,/, '');
  if (!data || data.length > Math.ceil((IMG_MAX * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new MeetingError(413, 'That image is too large — keep it under 300 KB.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > IMG_MAX) throw new MeetingError(413, 'That image is too large — keep it under 300 KB.');
  const type = sniffImage(bytes);
  if (!type) throw new MeetingError(415, 'Only PNG, JPEG, WebP or GIF images.');
  const dim = (v: unknown) => Math.max(1, Math.min(4096, Math.round(Number(v) || 0)));
  return { bytes, type, w: dim(o.w), h: dim(o.h) };
}

const EXT: Record<ImgType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

type Env = Record<string, string | undefined>;

/** Keep the image: Vercel Blob when a store is connected, else beside the messages. */
async function saveImage(store: Store, id: number, img: ImageInput, env: Env): Promise<MeetingImage> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    try {
      const r = await blobPut(`meeting/${id}.${EXT[img.type]}`, img.bytes, {
        access: 'public',
        contentType: img.type,
        addRandomSuffix: true,
        token,
      });
      return { src: r.url, w: img.w, h: img.h, type: img.type };
    } catch (err) {
      console.error('meeting: blob put failed, keeping the image beside the messages', err);
    }
  }
  await store.pipe([
    ['SET', MK.img(id), JSON.stringify({ type: img.type, b64: img.bytes.toString('base64') }), 'EX', MSG_SEC],
  ]);
  return { src: `/api/meeting?img=${id}`, w: img.w, h: img.h, type: img.type };
}

async function dropImage(store: Store, id: number, msg: MeetingMessage | null, env: Env): Promise<void> {
  const cmds: (string | number)[][] = [['DEL', MK.img(id)]];
  await store.pipe(cmds);
  const src = msg?.img?.src;
  if (src && /^https:\/\//.test(src) && env.BLOB_READ_WRITE_TOKEN) {
    try {
      await blobDel(src, { token: env.BLOB_READ_WRITE_TOKEN });
    } catch (err) {
      console.error('meeting: blob delete failed', err);
    }
  }
}

/** An image kept beside the messages. */
export async function readImage(store: Store, id: unknown): Promise<{ type: ImgType; bytes: Buffer } | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const [raw] = await store.pipe([['GET', MK.img(n)]]);
  if (typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as { type: ImgType; b64: string };
    if (!IMG_TYPES.includes(o.type)) return null;
    return { type: o.type, bytes: Buffer.from(o.b64, 'base64') };
  } catch {
    return null;
  }
}

export type Poster = {
  owner: boolean;
  seatId: string | null;
  seatName: string | null;
  mark: string;
  ip: string;
};

export async function posterFor(
  store: Store,
  token: string | null,
  owner: boolean,
  mark: string,
  ip: string,
): Promise<Poster> {
  const user = await userForToken(store, token);
  return {
    owner,
    seatId: user?.id ?? null,
    seatName: user ? user.username || user.displayName || null : null,
    mark,
    ip,
  };
}

export async function postMeeting(
  store: Store,
  who: Poster,
  input: { text: unknown; name: unknown; image?: unknown },
  now: number,
  env: Env = process.env,
): Promise<MeetingMessage> {
  const text = cleanText(input.text);
  const image = parseImage(input.image);
  const why = image && !text ? null : spamReason(text);
  if (why) throw new MeetingError(400, why);
  let name: string;
  let badge: Badge;
  if (who.owner) {
    name = cleanName(input.name) ?? 'Grand Master';
    badge = 'owner';
  } else if (who.seatName) {
    name = cleanName(who.seatName) ?? 'Occultist';
    badge = 'seat';
  } else {
    const chosen = cleanName(input.name);
    if (!chosen) throw new MeetingError(400, 'Choose a name to speak under (letters and numbers).');
    if (RESERVED_RE.test(chosen)) throw new MeetingError(400, 'That name belongs to the lodge.');
    name = chosen;
    badge = 'guest';
  }
  if (!who.owner) {
    // One message per hand every 5 s; a shared address (an office, a station)
    // gets a looser ceiling so a crowd behind one router can still talk.
    const slow = new MeetingError(429, 'Wait a few breaths before you speak again.');
    const hand = who.seatId ? `s:${who.seatId}` : `m:${who.mark}`;
    const imgKey = MK.rate(`img:${hand}`);
    if (image) {
      const [ok] = await store.pipe([['SET', imgKey, '1', 'PX', IMG_EVERY_MS, 'NX']]);
      if (ok !== 'OK') throw new MeetingError(429, 'One image every thirty seconds, please.');
    }
    const [mine] = await store.pipe([['SET', MK.rate(hand), '1', 'PX', POST_EVERY_MS, 'NX']]);
    const bucket = MK.rate(`ip:${who.ip}:${Math.floor(now / 10_000)}`);
    const [count] = mine === 'OK' ? await store.pipe([['INCR', bucket], ['EXPIRE', bucket, 20]]) : [0];
    if (mine !== 'OK' || Number(count) > IP_PER_10S) {
      // A refused message does not spend the image allowance.
      if (image) await store.pipe([['DEL', imgKey]]);
      throw slow;
    }
  }
  const [n] = await store.pipe([['INCR', MK.n]]);
  const id = Number(n);
  const msg: MeetingMessage = { id, at: now, name, text, badge };
  if (image) msg.img = await saveImage(store, id, image, env);
  // The board keeps the newest KEEP: the one that falls off goes with its image.
  const gone = id - KEEP;
  const [goneRaw] = gone > 0 ? await store.pipe([['GET', MK.msg(gone)]]) : [null];
  await store.pipe([
    ['SET', MK.msg(id), JSON.stringify(msg), 'EX', MSG_SEC],
    ['ZADD', MK.idx, id, String(id)],
    ['ZREMRANGEBYSCORE', MK.idx, '-inf', gone],
    ...(gone > 0 ? [['DEL', MK.msg(gone)]] : []),
  ]);
  const goneMsg = parse(goneRaw);
  if (gone > 0 && goneMsg?.img) await dropImage(store, gone, goneMsg, env);
  return msg;
}

/** Owner only (the caller checks): strike a message from the board. */
export async function deleteMeeting(store: Store, id: unknown, env: Env = process.env): Promise<void> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new MeetingError(400, 'Bad message.');
  const [raw] = await store.pipe([['GET', MK.msg(n)]]);
  await store.pipe([['ZREM', MK.idx, String(n)], ['DEL', MK.msg(n)], ['INCR', MK.rev]]);
  await dropImage(store, n, parse(raw), env);
}
