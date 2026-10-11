import { it } from 'vitest';
import { newMatch } from './engine';
import { playTurn } from './ai';
import { FACTIONS } from './cards';
import { nextRand } from './rng';

it('balance', () => {
  const wins: Record<string, number> = {};
  const games: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  let seed = Number(process.env.SEED ?? 11);
  const maps = (process.env.MAPS ?? 'leaden-court,ashen-cross,twin-vaults,outer-seal,culvert-court').split(',');
  let turns = 0, n = 0;
  for (const map of maps) for (const b of FACTIONS) for (const r of FACTIONS) {
    if (b.id === r.id) continue;
    let rs = seed * 7919;
    const rnd = () => { const [v, s] = nextRand(rs); rs = s; return v; };
    let m = newMatch({ blue: b.id, red: r.id, seed: seed++, mapId: map });
    for (let t = 0; t < 120 && !m.winner; t++) m = playTurn(m, 'expert', rnd);
    const w = m.winner === 'blue' ? b.id : m.winner === 'red' ? r.id : 'none';
    wins[w] = (wins[w] ?? 0) + 1;
    games[b.id] = (games[b.id] ?? 0) + 1; games[r.id] = (games[r.id] ?? 0) + 1;
    kinds[`${m.winner}:${m.winKind}`] = (kinds[`${m.winner}:${m.winKind}`] ?? 0) + 1;
    turns += m.turn; n++;
  }
  const pct = Object.fromEntries(FACTIONS.map((f) => [f.id, Math.round((100 * (wins[f.id] ?? 0)) / games[f.id])]));
  console.log(JSON.stringify({ pct, kinds, avgTurn: turns / n, n }));
}, 900000);
