import { describe, expect, it } from 'vitest';
import { newMatch } from '../game/engine';
import { LIVE_KEY, clearLive, loadLive, saveLive } from './resume';
import { launchScreen } from './launch';

const mem = () => {
  const d = new Map<string, string>();
  return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k), d };
};
const opts = { blue: 'gang', red: 'lodge', mind: 'expert', mapId: 'gallows-mesa' } as const;

describe('match safety net (reload / crash resumes the match)', () => {
  it('saves a live match and loads it back intact, without stale animation events', () => {
    const s = mem();
    const m = newMatch({ blue: 'gang', red: 'lodge', seed: 5, mapId: 'gallows-mesa' });
    m.events = [{ e: 'turn', side: 'blue' }];
    m.dom = { blue: 55, red: 58 };
    saveLive({ ...opts }, m, s, 1000);
    const v = loadLive(s, 2000)!;
    expect(v.m.dom).toEqual({ blue: 55, red: 58 });
    expect(v.m.events).toEqual([]);
    expect(v.opts.mapId).toBe('gallows-mesa');
  });
  it('a finished match, an old save, or junk is dropped', () => {
    const s = mem();
    const m = newMatch({ blue: 'gang', red: 'lodge', seed: 5, mapId: 'gallows-mesa' });
    saveLive({ ...opts }, { ...m, winner: 'blue' }, s);
    expect(s.d.has(LIVE_KEY)).toBe(false);
    saveLive({ ...opts }, m, s, 0);
    expect(loadLive(s, 13 * 3600 * 1000)).toBeNull();
    s.setItem(LIVE_KEY, '{oops');
    expect(loadLive(s)).toBeNull();
    saveLive({ ...opts }, m, s);
    clearLive(s);
    expect(loadLive(s)).toBeNull();
  });
  it('a plain launch still opens the title when nothing is saved', () => {
    expect(launchScreen('', false).s).toBe('title');
  });
});
