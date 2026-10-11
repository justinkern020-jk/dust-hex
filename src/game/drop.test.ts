/** Drag from the hand: which way a gesture reads, and what a drop does. */
import { describe, expect, it } from 'vitest';
import { classifyGesture, dropAction, scrollToSlider, sliderToScroll, wheelToScroll } from './drop';
import { applyAction } from './engine';
import { field, put } from './testkit';

describe('gesture reading', () => {
  it('small wobbles are still a tap', () => {
    expect(classifyGesture(0, 0)).toBe('pending');
    expect(classifyGesture(5, -6)).toBe('pending');
  });
  it('up toward the board is a drag; sideways scrolls the hand', () => {
    expect(classifyGesture(2, -40)).toBe('drag');
    expect(classifyGesture(-12, -14)).toBe('drag'); // a thumb leaning off true
    expect(classifyGesture(40, -6)).toBe('scroll');
    expect(classifyGesture(-30, 10)).toBe('scroll');
  });
});

describe('dropping a card on the board', () => {
  it('a unit dropped on a lit gate deploys; on an unlit tile it does nothing', () => {
    const m = field();
    m.hand.blue = ['baca'];
    expect(dropAction(m, 'blue', 0, 4, 1)).toEqual({ t: 'deploy', i: 0, r: 4, c: 1 });
    expect(applyAction(m, dropAction(m, 'blue', 0, 4, 1)!).error).toBeFalsy();
    expect(dropAction(m, 'blue', 0, 2, 2)).toBeNull();
    expect(dropAction(m, 'blue', 0, 0, 2)).toBeNull();
  });
  it('the leader drops from the tray like a unit', () => {
    const m = field();
    m.leaderAt.blue = 'tray';
    expect(dropAction(m, 'blue', 'leader', 4, 2)).toEqual({ t: 'deploy', i: 'leader', r: 4, c: 2 });
    m.leaderAt.blue = 'board';
    expect(dropAction(m, 'blue', 'leader', 4, 2)).toBeNull();
  });
  it('a targeted card names the unit it is dropped on, and only a legal one', () => {
    const m = field();
    m.hand.blue = ['silver-jury'];
    const foe = put(m, 'billy', 'red', 1, 2);
    put(m, 'baca', 'blue', 3, 2);
    expect(dropAction(m, 'blue', 0, 1, 2)).toEqual({ t: 'play', i: 0, target: { uid: foe.uid } });
    expect(dropAction(m, 'blue', 0, 3, 2)).toBeNull();
    expect(dropAction(m, 'blue', 0, 2, 2)).toBeNull();
  });
  it('an untargeted card plays wherever it lands on the ground', () => {
    const m = field();
    m.hand.blue = ['dead-volley'];
    expect(dropAction(m, 'blue', 0, 2, 2)).toEqual({ t: 'play', i: 0 });
  });
  it('nothing drops when it is not your turn, you cannot pay, or the hand slot is empty', () => {
    const m = field();
    m.hand.blue = ['baca'];
    m.money.blue = 0;
    expect(dropAction(m, 'blue', 0, 4, 1)).toBeNull();
    m.money.blue = 14;
    expect(dropAction(m, 'blue', 3, 4, 1)).toBeNull();
    m.side = 'red';
    expect(dropAction(m, 'blue', 0, 4, 1)).toBeNull();
  });
});

describe('hand rail scrolling', () => {
  it('slider and scroll position map onto each other', () => {
    expect(sliderToScroll(0, 2000, 500)).toBe(0);
    expect(sliderToScroll(1000, 2000, 500)).toBe(1500);
    expect(sliderToScroll(500, 2000, 500)).toBe(750);
    expect(sliderToScroll(500, 400, 500)).toBe(0);
    expect(scrollToSlider(750, 2000, 500)).toBe(500);
    expect(scrollToSlider(0, 400, 500)).toBe(0);
  });
  it('a vertical wheel scrolls the hand sideways, line and page modes scale', () => {
    expect(wheelToScroll(0, 100)).toBe(100);
    expect(wheelToScroll(-60, 10)).toBe(-60);
    expect(wheelToScroll(0, 3, 1)).toBe(120);
    expect(wheelToScroll(0, 1, 2)).toBe(400);
  });
});
