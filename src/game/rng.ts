/** mulberry32: small seeded RNG kept in match state so replays are exact. */
export function nextRand(seed: number): [number, number] {
  let t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  const v = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return [v, t];
}
