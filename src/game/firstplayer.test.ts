import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, newMatch } from './engine';
import { field, put, endTurn, tryRun, deployCard } from './testkit';
import type { Match, Rules } from './types';

function withRules(m: Match, rules: Rules): Match {
  m.rules = rules;
  return m;
}

describe('first-player rule (shipped: dominance scores at the end of each round)', () => {
  it('is the default for new matches', () => {
    expect(DEFAULT_RULES.roundScore).toBe(true);
    expect(newMatch({ blue: 'gang', red: 'lodge', seed: 1 }).rules?.roundScore).toBe(true);
    expect(field().rules?.roundScore).toBe(true);
  });
  it('the first player does not score at the end of their own turn', () => {
    let m = field();
    m = endTurn(m);
    expect(m.dom.blue).toBe(0);
    expect(m.dom.red).toBe(0);
  });
  it('both sides score together at the end of the round, each for what they hold then', () => {
    let m = field();
    m = endTurn(m);
    m = endTurn(m);
    expect(m.dom.blue).toBe(3);
    expect(m.dom.red).toBe(3);
    expect(m.side).toBe('blue');
  });
  it('a claim the first player loses during the rival turn does not score', () => {
    let m = field();
    m.control[2][0] = 'blue';
    m = endTurn(m);
    m.control[2][0] = 'red'; // taken back during red's turn
    m = endTurn(m);
    expect(m.dom.blue).toBe(3);
    expect(m.dom.red).toBe(4);
  });
  it('reaching the goal only wins at the end of the round', () => {
    let m = field();
    m.dom.blue = 58;
    m = endTurn(m);
    expect(m.winner).toBeNull();
    m = endTurn(m);
    expect(m.winner).toBe('blue');
    expect(m.winKind).toBe('claims');
  });
  it('the second player can win at the end of the round', () => {
    let m = field();
    m.dom.red = 58;
    m = endTurn(m);
    m = endTurn(m);
    expect(m.winner).toBe('red');
  });
  it('taking the stronghold still ends the match at once', () => {
    let m = field();
    const u = put(m, 'baca', 'blue', 1, 2);
    m.board[0][2] = null;
    const r = tryRun(m, { t: 'move', uid: u.uid, r: 0, c: 2 });
    expect(r.error).toBeNull();
    expect(r.state.winner).toBe('blue');
    expect(r.state.winKind).toBe('stronghold');
  });
});

describe('other first-player options (flags, kept for the balance sim)', () => {
  it('A: the first player opens a card short', () => {
    const m = newMatch({ blue: 'gang', red: 'lodge', seed: 1, rules: { firstShortHand: true } });
    expect(m.hand.blue).toHaveLength(4);
    expect(m.hand.red).toHaveLength(5);
  });
  it('per-turn scoring (no flags) wins as soon as the goal is reached', () => {
    let m = withRules(field(), {});
    m.dom.blue = 58;
    m = endTurn(m);
    expect(m.winner).toBe('blue');
  });
  it('C: the first player cannot strike on turn 1', () => {
    const m = withRules(field(), { firstNoStrike: true });
    const a = put(m, 'baca', 'blue', 2, 2);
    put(m, 'billy', 'red', 1, 2);
    expect(tryRun(m, { t: 'strike', uid: a.uid, r: 1, c: 2 }).error).toMatch(/opening turn/);
  });
  it('D: the first player musters only one unit on turn 1', () => {
    let m = withRules(field(), { firstOneDeploy: true });
    m = deployCard(m, 'blue', 'baca', 4, 2);
    m.hand.blue.push('baca');
    expect(tryRun(m, { t: 'deploy', i: m.hand.blue.length - 1, r: 4, c: 1 }).error).toMatch(/only one unit/);
  });
  it('E: if both pass the mark in the same round, the leader wins', () => {
    let m = withRules(field(), { mirrorClock: true });
    m.dom.blue = 59;
    m = endTurn(m); // blue 62: reaches the mark, but red answers
    expect(m.winner).toBeNull();
    m.dom.red = 60;
    m.control[2][0] = 'red';
    m.control[2][4] = 'red';
    m = endTurn(m); // red 60 + 5 = 65 > 62
    expect(m.winner).toBe('red');
  });
  it('E: a dead level plays on to the next round', () => {
    let m = withRules(field(), { mirrorClock: true });
    m.dom.blue = 59;
    m = endTurn(m);
    m.dom.red = 59;
    m = endTurn(m);
    expect(m.dom.blue).toBe(62);
    expect(m.dom.red).toBe(62);
    expect(m.winner).toBeNull();
  });
});
