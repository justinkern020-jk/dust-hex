import COIN_FACES from '../data/coinfaces.json';

/** Face centre (fraction of the art) and zoom for each unit; made by scripts/coin-faces.py. */
const FACES = COIN_FACES as unknown as Record<string, [number, number, number]>;
export const COIN_FALLBACK: [number, number, number] = [0.5, 0.36, 1.25];

/**
 * Where a unit's 2:3 card art sits inside its round coin, as CSS for an absolutely
 * placed <img>: zoomed so the face and upper body fill the circle, never leaving a gap.
 */
export function coinCrop(id: string): { width: string; left: string; top: string } {
  const [cx, cy, z] = FACES[id] ?? COIN_FALLBACK;
  const w = Math.max(1, z);
  const h = 1.5 * w;
  const left = Math.min(0, Math.max(1 - w, 0.5 - cx * w));
  const top = Math.min(0, Math.max(1 - h, 0.5 - cy * h));
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  return { width: pct(w), left: pct(left), top: pct(top) };
}
export const hasCoinFace = (id: string) => id in FACES;
