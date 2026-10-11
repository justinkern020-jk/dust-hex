import { describe, expect, it } from 'vitest';
import { launchScreen } from './launch';

describe('launch screen', () => {
  it('a fresh launch opens on the title card', () => {
    expect(launchScreen('')).toEqual({ s: 'title' });
    expect(launchScreen('?utm_source=x')).toEqual({ s: 'title' });
  });
  it('deep links skip the title', () => {
    expect(launchScreen('?codex').s).toBe('codex');
    const b = launchScreen('?side=gang&rival=lodge&map=gallows-mesa&mind=easy');
    expect(b.s).toBe('battle');
    if (b.s === 'battle') expect(b.opts).toMatchObject({ blue: 'gang', red: 'lodge', mind: 'easy' });
  });
  it('an unknown side falls back to the title', () => {
    expect(launchScreen('?side=nobody')).toEqual({ s: 'title' });
  });
  it('dev-only aids stay off unless dev', () => {
    const b = launchScreen('?side=gang&money=9&deal=a,b');
    if (b.s === 'battle') expect(b.opts.money).toBeUndefined();
    const d = launchScreen('?side=gang&money=9&deal=a,b', true);
    if (d.s === 'battle') expect(d.opts).toMatchObject({ money: 9, deal: ['a', 'b'] });
  });
});
