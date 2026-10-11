/**
 * /api/ranked — the ranked ladder. Dust Hex on grok.me shipped this door shut
 * ("until the ledger store is connected"); the port answers the same way so
 * the client shows its normal "ladder is shut" state instead of an error.
 */
import { json } from '../_lib/http.js';

export async function handleRanked(_req: Request): Promise<Response> {
  return json({ ok: false, shut: true, error: 'The ladder is shut until the ledger store is connected.' });
}
