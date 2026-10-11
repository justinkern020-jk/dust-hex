/** Faction cues: Outlaws/Nations/Lawmen LEAD and the Army leader's deploy get their own cue. */
import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Match } from '../game/types';
import { leaderOf } from '../game/cards';

const played: string[] = [];
class FakeAudio {
  src: string;
  volume = 1;
  preload = '';
  loop = false;
  paused = true;
  constructor(src = '') {
    this.src = src;
  }
  cloneNode() {
    return new FakeAudio(this.src);
  }
  play() {
    played.push(this.src);
    return Promise.resolve();
  }
  pause() {}
}
vi.stubGlobal('Audio', FakeAudio);

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const sound = await import('./sound');

function match(blue: string, red: string, units: Match['units'] = {}): Match {
  return { leader: { blue, red }, units } as unknown as Match;
}

describe('faction cues', () => {
  beforeEach(() => {
    played.length = 0;
    vi.useFakeTimers();
    vi.advanceTimersByTime(60_000);
    vi.setSystemTime(Date.now() + 60_000);
    sound.saveSettings({ sound: true, music: true, voice: false, weather: true });
  });

  it('maps each banner to its LEAD cue', () => {
    expect(sound.leadCue('gang')).toBe('outlaw-lead');
    expect(sound.leadCue('choir')).toBe('outlaw-lead');
    expect(sound.leadCue('grass')).toBe('nations-lead');
    expect(sound.leadCue('lodge')).toBe('nations-lead');
    expect(sound.leadCue('star')).toBe('lawmen-lead');
    expect(sound.leadCue('army')).toBeNull();
  });

  it('every cue file ships', () => {
    for (const { file } of Object.values(sound.CUES)) {
      expect(existsSync(new URL(`../../public/assets/audio/sfx/west/cues/${file}.mp3`, import.meta.url))).toBe(true);
    }
  });

  it('an Outlaw LEAD plays the Rose of Alabama instead of the generic sting', () => {
    sound.soundEvents([{ e: 'lead', side: 'red' }], 'blue', match(leaderOf('star').id, leaderOf('gang').id));
    expect(played).toEqual(['/assets/audio/sfx/west/cues/rose-of-alabama.mp3']);
  });

  it('Nations and Lawmen LEADs play their own cues; Army LEAD keeps the generic sting', () => {
    sound.soundEvents([{ e: 'lead', side: 'blue' }], 'blue', match(leaderOf('lodge').id, leaderOf('army').id));
    vi.setSystemTime(Date.now() + 10_000);
    sound.soundEvents([{ e: 'lead', side: 'blue' }], 'blue', match(leaderOf('star').id, leaderOf('army').id));
    vi.setSystemTime(Date.now() + 10_000);
    sound.soundEvents([{ e: 'lead', side: 'red' }], 'blue', match(leaderOf('star').id, leaderOf('army').id));
    expect(played).toEqual([
      '/assets/audio/sfx/west/cues/war-drums.mp3',
      '/assets/audio/sfx/west/cues/lawmen-whistle.mp3',
      '/assets/audio/sfx/west/leader.mp3',
    ]);
  });

  it('only the Army leader deploying plays the snare roll', () => {
    const army = leaderOf('army').id;
    const units = {
      u1: { uid: 'u1', cardId: army, side: 'blue' },
      u2: { uid: 'u2', cardId: leaderOf('gang').id, side: 'red' },
    } as unknown as Match['units'];
    sound.soundEvents([{ e: 'deploy', uid: 'u2', side: 'red' }], 'blue', match(army, leaderOf('gang').id, units));
    sound.soundEvents([{ e: 'deploy', uid: 'u1', side: 'blue' }], 'blue', match(army, leaderOf('gang').id, units));
    expect(played).toEqual(['/assets/audio/sfx/west/enter.mp3', '/assets/audio/sfx/west/cues/army-snare-roll.mp3']);
  });

  it('respects the sound setting (mute)', () => {
    sound.saveSettings({ sound: false, music: true, voice: false, weather: true });
    sound.soundEvents([{ e: 'lead', side: 'red' }], 'blue', match(leaderOf('star').id, leaderOf('gang').id));
    expect(played).toEqual([]);
  });

  it('two cues never stack', () => {
    const m = match(leaderOf('gang').id, leaderOf('choir').id);
    sound.soundEvents([{ e: 'lead', side: 'blue' }, { e: 'lead', side: 'red' }], 'blue', m);
    expect(played.filter((s) => s.includes('/cues/'))).toHaveLength(1);
  });
});
