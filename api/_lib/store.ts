/**
 * Tiny Redis-shaped store for the Occult Wars table / ledger functions.
 *
 * - With Upstash Redis (Vercel Marketplace → "Upstash for Redis", free tier)
 *   connected to the project, `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or
 *   `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) are injected and
 *   every command goes to Redis over its REST API — durable and shared by
 *   every function instance.
 * - Without them the store falls back to memory inside the warm function
 *   instance. Presence and challenges still work (they are short-lived), but
 *   nothing survives a cold start, so accounts refuse to open on it.
 *
 * Commands are written once as Redis pipelines; the memory executor speaks the
 * small subset used here.
 */

export type Cmd = (string | number)[];
export type StoreKind = 'redis' | 'memory';

export interface Store {
  kind: StoreKind;
  durable: boolean;
  /** Run commands in order; returns one result per command. */
  pipe(cmds: Cmd[]): Promise<unknown[]>;
}

type Env = Record<string, string | undefined>;

export function redisEnv(env: Env): { url: string; token: string } | null {
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // The Marketplace integration may add a custom prefix (e.g. STORAGE_KV_REST_API_URL).
    for (const [k, v] of Object.entries(env)) {
      const m = /^(.+_)?(KV_REST_API|UPSTASH_REDIS_REST)_URL$/.exec(k);
      if (!m || !v) continue;
      const t = env[`${m[1] ?? ''}${m[2]}_TOKEN`];
      if (t) {
        url = v;
        token = t;
        break;
      }
    }
  }
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

export function redisStore(url: string, token: string, fetcher: typeof fetch = fetch): Store {
  return {
    kind: 'redis',
    durable: true,
    async pipe(cmds) {
      if (cmds.length === 0) return [];
      const res = await fetcher(`${url}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cmds.map((c) => c.map(String))),
      });
      if (!res.ok) throw new Error(`store ${res.status}`);
      const out = (await res.json()) as { result?: unknown; error?: string }[];
      return out.map((r) => {
        if (r.error) throw new Error(`store: ${r.error}`);
        return r.result ?? null;
      });
    },
  };
}

type Entry =
  | { t: 'str'; v: string; exp?: number }
  | { t: 'hash'; v: Map<string, string>; exp?: number }
  | { t: 'zset'; v: Map<string, number>; exp?: number };

/** In-memory executor for the subset of Redis this app uses. */
export function memoryStore(now: () => number = Date.now): Store {
  const db = new Map<string, Entry>();

  const live = (key: string): Entry | undefined => {
    const e = db.get(key);
    if (!e) return undefined;
    if (e.exp != null && e.exp <= now()) {
      db.delete(key);
      return undefined;
    }
    return e;
  };
  const hash = (key: string, create: boolean): Map<string, string> | null => {
    const e = live(key);
    if (e?.t === 'hash') return e.v;
    if (!create) return null;
    const v = new Map<string, string>();
    db.set(key, { t: 'hash', v });
    return v;
  };
  const zset = (key: string, create: boolean): Map<string, number> | null => {
    const e = live(key);
    if (e?.t === 'zset') return e.v;
    if (!create) return null;
    const v = new Map<string, number>();
    db.set(key, { t: 'zset', v });
    return v;
  };
  const bound = (raw: string | number, lo: boolean): number => {
    const s = String(raw);
    if (s === '-inf') return -Infinity;
    if (s === '+inf' || s === 'inf') return Infinity;
    if (s.startsWith('(')) return Number(s.slice(1)) + (lo ? 1e-9 : -1e-9);
    return Number(s);
  };
  const sortedZ = (z: Map<string, number>) =>
    [...z.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));

  function run(cmd: Cmd): unknown {
    const [rawOp, ...a] = cmd;
    const op = String(rawOp).toUpperCase();
    const k = String(a[0] ?? '');
    switch (op) {
      case 'GET': {
        const e = live(k);
        return e?.t === 'str' ? e.v : null;
      }
      case 'MGET':
        return a.map((key) => {
          const e = live(String(key));
          return e?.t === 'str' ? e.v : null;
        });
      case 'SET': {
        const v = String(a[1]);
        let exp: number | undefined;
        let nx = false;
        for (let i = 2; i < a.length; i++) {
          const f = String(a[i]).toUpperCase();
          if (f === 'NX') nx = true;
          else if (f === 'EX') exp = now() + Number(a[++i]) * 1000;
          else if (f === 'PX') exp = now() + Number(a[++i]);
        }
        if (nx && live(k)) return null;
        db.set(k, { t: 'str', v, exp });
        return 'OK';
      }
      case 'DEL': {
        let n = 0;
        for (const key of a) if (db.delete(String(key))) n++;
        return n;
      }
      case 'INCR': {
        const e = live(k);
        const n = (e?.t === 'str' ? Number(e.v) : 0) + 1;
        db.set(k, { t: 'str', v: String(n), exp: e?.exp });
        return n;
      }
      case 'EXPIRE': {
        const e = live(k);
        if (!e) return 0;
        e.exp = now() + Number(a[1]) * 1000;
        return 1;
      }
      case 'HSET': {
        const h = hash(k, true)!;
        let n = 0;
        for (let i = 1; i + 1 < a.length; i += 2) {
          if (!h.has(String(a[i]))) n++;
          h.set(String(a[i]), String(a[i + 1]));
        }
        return n;
      }
      case 'HSETNX': {
        const h = hash(k, true)!;
        if (h.has(String(a[1]))) return 0;
        h.set(String(a[1]), String(a[2]));
        return 1;
      }
      case 'HGET':
        return hash(k, false)?.get(String(a[1])) ?? null;
      case 'HMGET': {
        const h = hash(k, false);
        return a.slice(1).map((f) => h?.get(String(f)) ?? null);
      }
      case 'HDEL': {
        const h = hash(k, false);
        let n = 0;
        for (const f of a.slice(1)) if (h?.delete(String(f))) n++;
        return n;
      }
      case 'HINCRBY': {
        const h = hash(k, true)!;
        const n = Number(h.get(String(a[1])) ?? 0) + Number(a[2]);
        h.set(String(a[1]), String(n));
        return n;
      }
      case 'HGETALL': {
        const h = hash(k, false);
        if (!h) return [];
        return [...h.entries()].flat();
      }
      case 'ZADD': {
        const z = zset(k, true)!;
        let n = 0;
        for (let i = 1; i + 1 < a.length; i += 2) {
          const m = String(a[i + 1]);
          if (!z.has(m)) n++;
          z.set(m, Number(a[i]));
        }
        return n;
      }
      case 'ZREM': {
        const z = zset(k, false);
        let n = 0;
        for (const m of a.slice(1)) if (z?.delete(String(m))) n++;
        return n;
      }
      case 'ZSCORE': {
        const v = zset(k, false)?.get(String(a[1]));
        return v == null ? null : String(v);
      }
      case 'ZRANGEBYSCORE': {
        const z = zset(k, false);
        if (!z) return [];
        const lo = bound(a[1]!, true);
        const hi = bound(a[2]!, false);
        return sortedZ(z)
          .filter(([, s]) => s >= lo && s <= hi)
          .map(([m]) => m);
      }
      case 'ZREMRANGEBYSCORE': {
        const z = zset(k, false);
        if (!z) return 0;
        const lo = bound(a[1]!, true);
        const hi = bound(a[2]!, false);
        let n = 0;
        for (const [m, s] of [...z.entries()]) {
          if (s >= lo && s <= hi) {
            z.delete(m);
            n++;
          }
        }
        return n;
      }
      case 'ZREVRANGE': {
        const z = zset(k, false);
        if (!z) return [];
        const all = sortedZ(z).reverse();
        const start = Number(a[1]);
        const stop = Number(a[2]);
        const end = stop < 0 ? all.length + stop : stop;
        return all.slice(start, end + 1).map(([m]) => m);
      }
      case 'ZCARD':
        return zset(k, false)?.size ?? 0;
      default:
        throw new Error(`memory store: unsupported ${op}`);
    }
  }

  return {
    kind: 'memory',
    durable: false,
    async pipe(cmds) {
      return cmds.map(run);
    },
  };
}

let shared: Store | null = null;

/** Process-wide store: Redis when configured, else this instance's memory. */
export function getStore(env: Env = process.env): Store {
  if (shared) return shared;
  const r = redisEnv(env);
  shared = r ? redisStore(r.url, r.token) : memoryStore();
  return shared;
}

/** Tests only. */
export function setStoreForTests(s: Store | null): void {
  shared = s;
}

/** HGETALL result (array or object, depending on REST client) → record. */
export function toRecord(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = String(raw[i + 1]);
    return out;
  }
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  }
  return {};
}
