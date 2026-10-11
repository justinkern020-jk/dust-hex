// Economy sim: starter make-up per side and gold to complete each side (packs, then singles).
// npx vitest run -c vitest.sim.config.ts src/game/econ.sim.ts
import { it } from 'vitest';
import { FACTIONS, card } from './cards';
import { buyPack, buySingle, emptyCollection, grantStarters, sideProgress, starterDeck, shopPool } from './collection';
import { maxCopies } from './cards';
import { nextRand } from './rng';

it('economy', () => {
  for (const f of FACTIONS) {
    const d = starterDeck(f.id);
    const r: Record<string, number> = {};
    for (const id of d) r[card(id).rarity] = (r[card(id).rarity] ?? 0) + 1;
    const col = grantStarters(emptyCollection(), [f.id]);
    const p = sideProgress(col, f.id);
    const units = d.filter((id) => card(id).kind === 'unit').length;
    // packs-then-singles: average gold to complete
    let tot = 0, packsT = 0; const N = 300;
    for (let k = 0; k < N; k++) {
      let s = k * 977 + 13; const rng = () => { const [v, n] = nextRand(s); s = n; return v; };
      let c = { ...col, gold: 1e7 };
      const start = c.gold; let packs = 0;
      // Buy packs until little is left, then finish with singles.
      while (sideProgress(c, f.id).missingGold > 250) { const x = buyPack(c, f.id, rng); if ('error' in x) break; c = x.col; packs++; }
      for (const card0 of shopPool(f.id)) while ((c.owned[card0.id] ?? 0) < maxCopies(card0)) { const x = buySingle(c, card0.id); if ('error' in x) break; c = x.col; }
      tot += start - c.gold; packsT += packs;
    }
    console.log(f.id, 'starter', JSON.stringify(r), 'units', units, 'owned', p.have, '/', p.full, 'singlesOnly', p.missingGold, 'packs+singles', Math.round(tot / N), 'avgPacks', (packsT / N).toFixed(1));
  }
});
