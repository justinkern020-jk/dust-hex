import { it } from 'vitest';
import { newMatch } from './engine';
import { playTurn } from './ai';
import { FACTIONS } from './cards';
import { nextRand } from './rng';
import type { Rules } from './types';

// RULES=A,B,C,D,E (letters, any combination; empty = none). SEEDS = rounds over all pairings and maps.
const FLAG: Record<string, keyof Rules> = { A: 'firstShortHand', B: 'roundScore', C: 'firstNoStrike', D: 'firstOneDeploy', E: 'mirrorClock' };

it('balance', () => {
  const rules: Rules = {};
  for (const k of (process.env.RULES ?? '').split(/[,+]/).filter(Boolean)) rules[FLAG[k]] = true;
  const wins: Record<string, number> = {};
  const games: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  const seed0 = Number(process.env.SEED ?? 11);
  let seed = seed0;
  const rounds = Number(process.env.SEEDS ?? 1);
  const maps = (process.env.MAPS ?? 'leaden-court,ashen-cross,twin-vaults').split(',');
  let turns = 0, n = 0, blueW = 0, redW = 0, none = 0;
  for (let k = 0; k < rounds; k++)
    for (const map of maps) for (const b of FACTIONS) for (const r of FACTIONS) {
      if (b.id === r.id) continue;
      let rs = seed * 7919;
      const rnd = () => { const [v, s] = nextRand(rs); rs = s; return v; };
      let m = newMatch({ blue: b.id, red: r.id, seed: seed++, mapId: map, rules });
      for (let t = 0; t < 160 && !m.winner; t++) m = playTurn(m, 'expert', rnd);
      const w = m.winner === 'blue' ? b.id : m.winner === 'red' ? r.id : 'none';
      if (m.winner === 'blue') blueW++; else if (m.winner === 'red') redW++; else none++;
      wins[w] = (wins[w] ?? 0) + 1;
      games[b.id] = (games[b.id] ?? 0) + 1; games[r.id] = (games[r.id] ?? 0) + 1;
      kinds[`${m.winner}:${m.winKind}`] = (kinds[`${m.winner}:${m.winKind}`] ?? 0) + 1;
      turns += m.turn; n++;
    }
  const pct = Object.fromEntries(FACTIONS.map((f) => [f.id, Math.round((1000 * (wins[f.id] ?? 0)) / games[f.id]) / 10]));
  console.log('RESULT ' + JSON.stringify({ rules: process.env.RULES ?? '', seed0, n, blueWin: Math.round((1000 * blueW) / n) / 10, redW, none, avgTurn: Math.round((10 * turns) / n) / 10, pct, kinds }));
}, 7_000_000);
