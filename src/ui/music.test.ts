/** Menu music: gapless Web Audio loop, autoplay unlock, mute, fade out, match sting. */
import { statSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const played: string[] = [];
class FakeAudio {
  src: string;
  volume = 1;
  loop = false;
  paused = true;
  preload = '';
  constructor(src = '') {
    this.src = src;
  }
  canPlayType(t: string) {
    return t.includes('opus') ? 'probably' : '';
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
const ramps: [string, number, number][] = [];
const sources: FakeSource[] = [];
class FakeParam {
  value = 1;
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    ramps.push(['ramp', v, t]);
  }
  cancelScheduledValues() {}
}
class FakeSource {
  buffer: { duration: number } | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started = false;
  stoppedAt: number | null = null;
  connect(n: unknown) {
    return n;
  }
  start() {
    this.started = true;
  }
  stop(t: number) {
    this.stoppedAt = t;
  }
}
let decodes = 0;
class FakeCtx {
  state = 'suspended';
  currentTime = 10;
  destination = {};
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createBufferSource() {
    const s = new FakeSource();
    sources.push(s);
    return s;
  }
  createGain() {
    return { gain: new FakeParam(), connect: (n: unknown) => n };
  }
  decodeAudioData(_b: ArrayBuffer, ok: (b: { duration: number }) => void) {
    decodes++;
    ok({ duration: 56.0065 });
  }
}
const fetched: string[] = [];
vi.stubGlobal('Audio', FakeAudio);
vi.stubGlobal('AudioContext', FakeCtx);
vi.stubGlobal('fetch', (u: string) => {
  fetched.push(u);
  return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
});
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: () => null,
  length: 0,
});
const sound = await import('./sound');
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('menu music files and choices', () => {
  it('ships a gapless Opus loop with an AAC fallback, and a small sting', () => {
    const size = (f: string) => statSync(new URL(`../../public/assets/audio/music/${f}`, import.meta.url)).size;
    expect(size('menu-dust-devil.ogg')).toBeLessThan(1_000_000);
    expect(size('menu-dust-devil.m4a')).toBeLessThan(1_100_000);
    expect(size('match-sting.ogg')).toBeLessThan(120_000);
    expect(size('match-sting.m4a')).toBeLessThan(150_000);
  });
  it('picks Opus where the browser plays it, AAC otherwise', () => {
    expect(sound.pickFormat((t) => (t.includes('opus') ? 'maybe' : ''))).toBe('ogg');
    expect(sound.pickFormat(() => '')).toBe('m4a');
    expect(sound.menuSrc()).toBe('/assets/audio/music/menu-dust-devil.ogg');
  });
  it('loops exactly 56 s, ignoring encoder padding', () => {
    expect(sound.loopPoints(56.0065)).toEqual({ start: 0, end: 56 });
    expect(sound.loopPoints(56)).toEqual({ start: 0, end: 56 });
    expect(sound.loopPoints(30)).toEqual({ start: 0, end: 30 });
  });
});

describe('menu music playback', () => {
  beforeEach(() => {
    played.length = 0;
    ramps.length = 0;
  });
  it('waits for a user gesture', async () => {
    sound.playMenuMusic();
    await flush();
    expect(sources.length).toBe(0);
    expect(sound.menuMusicPlaying()).toBe(false);
  });
  it('after the first gesture it loops through a Web Audio buffer and fades in', async () => {
    sound.unlockAudio();
    sound.playMenuMusic();
    await flush();
    await flush();
    const s = sources.at(-1)!;
    expect(s.started).toBe(true);
    expect(s.loop).toBe(true);
    expect(s.loopEnd).toBe(56);
    expect(ramps.some(([, v]) => v > 0)).toBe(true);
    expect(fetched).toContain('/assets/audio/music/menu-dust-devil.ogg');
    sound.playMenuMusic(); // repeated calls never stack a second loop
    await flush();
    expect(sources.filter((x) => x.started).length).toBe(1);
  });
  it('fades out and stops when a match starts', () => {
    const s = sources.at(-1)!;
    sound.stopMenuMusic(900);
    expect(ramps.at(-1)).toEqual(['ramp', 0, 10.9]);
    expect(s.stoppedAt).toBeCloseTo(10.95);
    expect(sound.menuMusicPlaying()).toBe(false);
  });
  it('plays the match sting once, not twice in a row', async () => {
    const before = sources.length;
    expect(sound.playMatchSting()).toBe(true);
    expect(sound.playMatchSting()).toBe(false);
    await flush();
    await flush();
    expect(sources.length).toBe(before + 1);
    expect(fetched).toContain('/assets/audio/music/match-sting.ogg');
  });
  it('respects the music setting', async () => {
    sound.saveSettings({ sound: true, music: false, voice: true, weather: true });
    const before = sources.length;
    sound.playMenuMusic();
    await flush();
    expect(sources.length).toBe(before);
    vi.useFakeTimers();
    vi.advanceTimersByTime(10_000);
    expect(sound.playMatchSting()).toBe(false);
    vi.useRealTimers();
    sound.saveSettings({ sound: true, music: true, voice: true, weather: true });
  });
  it('muting music mid-loop stops the menu loop', async () => {
    sound.playMenuMusic();
    await flush();
    await flush();
    const s = sources.at(-1)!;
    sound.saveSettings({ sound: true, music: false, voice: true, weather: true });
    expect(s.stoppedAt).not.toBeNull();
    expect(sound.menuMusicPlaying()).toBe(false);
  });
});
