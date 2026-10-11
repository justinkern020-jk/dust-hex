import { describe, expect, it } from 'vitest';
import { newMatch } from './engine';
import { playTurn, chooseAction } from './ai';
import { FACTIONS } from './cards';
import { field, put } from './testkit';

describe('rival mind', () => {
  it('musters on its first turn', () => {
    for (const f of FACTIONS) {
      let m = newMatch({ blue: 'gang', red: f.id, seed: 11, mapId: 'gallows-mesa' });
      m = playTurn(m, 'expert');
      m = playTurn(m, 'expert');
      expect(Object.values(m.units).some((u) => u.side === 'red')).toBe(true);
    }
  });
  it('takes a free kill', () => {
    const m = field();
    const a = put(m, 'wyatt', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2, { power: 1 });
    const act = chooseAction(m, 'expert');
    expect(act).toMatchObject({ t: 'strike', uid: a.uid });
  });
  it('plays whole matches to a finish for every faction pairing', () => {
    let seed = 1;
    for (const b of FACTIONS) {
      const red = FACTIONS[(FACTIONS.indexOf(b) + 2) % FACTIONS.length];
      let m = newMatch({ blue: b.id, red: red.id, seed: seed++, mapId: 'gallows-mesa' });
      let rnd = seed * 9301;
      const r = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
      for (let t = 0; t < 120 && !m.winner; t++) m = playTurn(m, 'experienced', r);
      expect(m.winner).toBeTruthy();
    }
  }, 120000);
});
