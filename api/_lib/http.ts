/** Small helpers shared by the /api functions. */

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export async function readJson(req: Request, max = 256_000): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'Too large.');
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'Bad JSON.');
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function fail(err: unknown): Response {
  if (err instanceof HttpError) return json({ ok: false, error: err.message }, err.status);
  console.error(err);
  return json({ ok: false, error: 'The table is shut.' }, 503);
}

/** Visitor country from Vercel's edge header (free; no third-party lookup). */
export function headerCountry(req: Request): string | null {
  return req.headers.get('x-vercel-ip-country');
}

export function clientIp(req: Request): string {
  const f = req.headers.get('x-forwarded-for') ?? '';
  return f.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}
