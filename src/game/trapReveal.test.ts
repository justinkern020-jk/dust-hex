import { describe, expect, it } from 'vitest';
import { trapReveals } from './trapReveal';

describe('trap reveals', () => {
  it('names the trap card and says the victim is down', () => {
    const r = trapReveals([
      { e: 'trap', r: 1, c: 1, kind: 'snake', uid: 'u1', victimName: 'Frank James', victimSide: 'blue', owner: 'red', cardId: 'shaft-viper' },
      { e: 'death', uid: 'u1', cardId: 'frank-james', side: 'blue' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].cardId).toBe('shaft-viper');
    expect(r[0].outcome).toBe('killed');
    expect(r[0].line).toContain('Frank James is down');
  });
  it('map rattlesnakes show as Rattlesnake with borrowed art; damage is "hurt"; queues several', () => {
    const r = trapReveals([
      { e: 'trap', r: 0, c: 0, kind: 'snake', uid: 'a', victimName: 'A' },
      { e: 'death', uid: 'a', cardId: 'x', side: 'red' },
      { e: 'trap', r: 0, c: 1, kind: 'sink', uid: 'b', victimName: 'B' },
      { e: 'damage', uid: 'b', n: 3 },
    ]);
    expect(r.map((x) => x.title)).toEqual(['Rattlesnake', 'Alkali Sink']);
    expect(r[0].cardId).toBe('shaft-viper');
    expect(r[1].outcome).toBe('hurt');
    expect(r.every((x) => !/occult|ritual|demon|spell/i.test(x.text + x.line))).toBe(true);
  });
});
