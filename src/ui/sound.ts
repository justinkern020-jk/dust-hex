import type { FactionId, GameEvent, Match, Side } from '../game/types';
import { card, maybeCard } from '../game/cards';

import { SETTINGS_KEY as KEY, migrateLegacySaves } from './storage';

export interface Settings {
  sound: boolean;
  music: boolean;
  voice: boolean;
  weather: boolean;
}
const DEFAULTS: Settings = { sound: true, music: true, voice: true, weather: true };

export function loadSettings(): Settings {
  migrateLegacySaves();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (typeof raw[k] === 'boolean') out[k] = raw[k];
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
  current = s;
  if (!s.music) {
    stopMusic();
    stopMenuMusic(0);
  }
}
let current = loadSettings();

const cache = new Map<string, HTMLAudioElement>();
function play(src: string, vol = 0.55) {
  if (typeof Audio === 'undefined') return;
  try {
    let base = cache.get(src);
    if (!base) {
      base = new Audio(src);
      base.preload = 'auto';
      cache.set(src, base);
    }
    const a = base.cloneNode(true) as HTMLAudioElement;
    a.volume = vol;
    void a.play().catch(() => undefined);
  } catch {
    /* no audio */
  }
}
const pickN = (n: number) => 1 + Math.floor(Math.random() * n);

export function sfx(name: string, vol = 0.5) {
  if (!current.sound) return;
  play(`/assets/audio/sfx/west/${name}.mp3`, vol);
}
export function voice(kind: 'power' | 'foe' | 'victory' | 'defeat') {
  if (!current.voice) return;
  const n = { power: 6, foe: 4, victory: 3, defeat: 3 }[kind];
  play(`/assets/audio/voice/${kind}_${pickN(n)}.mp3`, 0.8);
}

let music: HTMLAudioElement | null = null;
let musicSrc = '';
const MUSIC_VOL = 0.22;
export function playMusic(track: 'frontier-horn' | 'ghost-town') {
  if (!current.music || typeof Audio === 'undefined') return;
  const src = `/assets/audio/music/${track}.mp3`;
  if (music && musicSrc === src) {
    if (music.paused) void music.play().catch(() => undefined);
    return;
  }
  stopMusic();
  music = new Audio(src);
  musicSrc = src;
  music.loop = true;
  music.volume = duckUntil > Date.now() ? MUSIC_VOL * 0.3 : MUSIC_VOL;
  void music.play().catch(() => undefined);
}
export function stopMusic() {
  if (music) {
    music.pause();
    music = null;
    musicSrc = '';
  }
}

// ------------------------------------------------------------------ menu music
/**
 * The porch/menu loop ("Dust Devil, Darker", 56 s) loops through a Web Audio
 * buffer, which is sample-exact (an MP3 or <audio loop> leaves a gap at the
 * seam). Opus/OGG where the browser plays it, AAC/M4A otherwise (older Safari).
 * Audio can only start after a user gesture, so the App calls unlockAudio()
 * from its first pointer/key event.
 */
export const MENU_LOOP_S = 56;
const MENU_VOL = 0.32;
const STING_VOL = 0.55;
export const STING_MS = 5600;

export type AudioFormat = 'ogg' | 'm4a';
/** Pick the encoding to fetch from what the browser says it can play. */
export function pickFormat(canPlay: (type: string) => string): AudioFormat {
  return canPlay('audio/ogg; codecs="opus"') ? 'ogg' : 'm4a';
}
/** Loop points for a decoded buffer: exactly MENU_LOOP_S, ignoring encoder padding at the end. */
export function loopPoints(duration: number, loopS = MENU_LOOP_S): { start: number; end: number } {
  return { start: 0, end: duration >= loopS - 0.005 ? Math.min(loopS, duration) : duration };
}

let format: AudioFormat | null = null;
function fmt(): AudioFormat {
  if (format) return format;
  try {
    const a = typeof Audio === 'undefined' ? null : new Audio();
    format = a ? pickFormat((t) => a.canPlayType(t)) : 'm4a';
  } catch {
    format = 'm4a';
  }
  return format;
}
export const menuSrc = () => `/assets/audio/music/menu-dust-devil.${fmt()}`;
export const stingSrc = () => `/assets/audio/music/match-sting.${fmt()}`;

type Ctx = AudioContext;
let ctx: Ctx | null = null;
function audioCtx(): Ctx | null {
  if (ctx) return ctx;
  const C = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    ctx = null;
  }
  return ctx;
}
let unlocked = false;
/** Call from a user gesture: browsers only let audio start after one. */
export function unlockAudio() {
  unlocked = true;
  const c = audioCtx();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}
export const audioUnlocked = () => unlocked;

const bytes = new Map<string, Promise<ArrayBuffer>>();
const buffers = new Map<string, Promise<AudioBuffer>>();
function fetchBytes(src: string) {
  let p = bytes.get(src);
  if (!p) {
    p = fetch(src).then((r) => {
      if (!r.ok) throw new Error(`${src} ${r.status}`);
      return r.arrayBuffer();
    });
    p.catch(() => bytes.delete(src));
    bytes.set(src, p);
  }
  return p;
}
function decoded(c: Ctx, src: string) {
  let p = buffers.get(src);
  if (!p) {
    p = fetchBytes(src).then(
      (b) =>
        new Promise<AudioBuffer>((res, rej) => {
          // The callback form also works on older Safari.
          const r = c.decodeAudioData(b.slice(0), res, rej);
          if (r && typeof (r as Promise<AudioBuffer>).then === 'function') (r as Promise<AudioBuffer>).then(res, rej);
        }),
    );
    p.catch(() => buffers.delete(src));
    buffers.set(src, p);
  }
  return p;
}
/** Start downloading the menu loop and sting early (no audio plays). */
export function preloadMenuAudio() {
  if (typeof fetch === 'undefined') return;
  void fetchBytes(menuSrc()).catch(() => undefined);
  void fetchBytes(stingSrc()).catch(() => undefined);
}

type MenuSlot = { src: AudioBufferSourceNode | null; gain: GainNode | null; el: HTMLAudioElement | null };
let menu = null as MenuSlot | null;
const menuNow = () => menu;
let menuWanted = false;
/** Play the menu loop (fades in). Safe to call repeatedly; does nothing while muted or before a gesture. */
export function playMenuMusic() {
  menuWanted = true;
  if (!current.music || !unlocked || menu) return;
  stopMusic(); // the battle track, if we came back from a match
  const c = audioCtx();
  if (!c) {
    // No Web Audio: an <audio loop> (may leave a tiny gap at the seam).
    if (typeof Audio === 'undefined') return;
    const el = new Audio(menuSrc());
    el.loop = true;
    el.volume = MENU_VOL;
    menu = { src: null, gain: null, el };
    void el.play().catch(() => undefined);
    return;
  }
  const slot: MenuSlot = { src: null, gain: null, el: null };
  menu = slot;
  void decoded(c, menuSrc())
    .then((buf) => {
      if (menuNow() !== slot || !menuWanted || !current.music) return;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = loopPoints(buf.duration);
      src.loopStart = lp.start;
      src.loopEnd = lp.end;
      const g = c.createGain();
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(MENU_VOL, c.currentTime + 1.2);
      src.connect(g).connect(c.destination);
      src.start();
      slot.src = src;
      slot.gain = g;
    })
    .catch(() => {
      if (menuNow() === slot) menu = null;
    });
}
/** Fade the menu loop out (ms) and stop it. */
export function stopMenuMusic(ms = 900) {
  menuWanted = false;
  const m = menu;
  menu = null;
  if (!m) return;
  if (m.el) {
    m.el.pause();
    return;
  }
  const c = ctx;
  if (!c || !m.src || !m.gain) return;
  const t = c.currentTime;
  const s = ms / 1000;
  try {
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0, t + s);
    m.src.stop(t + s + 0.05);
  } catch {
    /* already stopped */
  }
}
export const menuMusicPlaying = () => !!menu;

let lastSting = 0;
/** The match-start sting (music setting). Ducks the battle track under it. Never twice in a row. */
export function playMatchSting(): boolean {
  if (!current.music) return false;
  const now = Date.now();
  if (now - lastSting < 3000) return false;
  lastSting = now;
  duckUntil = now + STING_MS;
  if (music) music.volume = MUSIC_VOL * 0.3;
  if (duckTimer) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    duckTimer = null;
    if (music && Date.now() >= duckUntil) music.volume = MUSIC_VOL;
  }, STING_MS);
  const c = unlocked ? audioCtx() : null;
  if (c) {
    void decoded(c, stingSrc())
      .then((buf) => {
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = STING_VOL;
        src.connect(g).connect(c.destination);
        src.start();
      })
      .catch(() => play(stingSrc(), STING_VOL));
  } else play(stingSrc(), STING_VOL);
  return true;
}

// ------------------------------------------------------------------ faction cues
/** Short musical cues that replace the generic LEAD / deploy sound for certain factions. */
export type Cue = 'outlaw-lead' | 'nations-lead' | 'lawmen-lead' | 'army-leader-deploy';
export const CUES: Record<Cue, { file: string; ms: number }> = {
  'outlaw-lead': { file: 'rose-of-alabama', ms: 6500 },
  'nations-lead': { file: 'war-drums', ms: 6000 },
  'lawmen-lead': { file: 'lawmen-whistle', ms: 6200 },
  'army-leader-deploy': { file: 'army-snare-roll', ms: 3300 },
};

/** Which cue (if any) a side's LEAD power plays. */
export function leadCue(f: FactionId | undefined): Cue | null {
  if (f === 'gang' || f === 'choir') return 'outlaw-lead';
  if (f === 'grass' || f === 'lodge') return 'nations-lead';
  if (f === 'star') return 'lawmen-lead';
  return null;
}

let duckUntil = 0;
let duckTimer: ReturnType<typeof setTimeout> | null = null;
let cueBusyUntil = 0;
/** Plays a faction cue (respects the sound setting) and ducks the music under it. Returns false when muted or busy. */
export function playCue(c: Cue, vol = 0.6): boolean {
  if (!current.sound) return false;
  const now = Date.now();
  if (now < cueBusyUntil) return false; // never stack two cues
  const { file, ms } = CUES[c];
  cueBusyUntil = now + ms * 0.8;
  play(`/assets/audio/sfx/west/cues/${file}.mp3`, vol);
  duckUntil = now + ms;
  if (music) music.volume = MUSIC_VOL * 0.3;
  if (duckTimer) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    duckTimer = null;
    if (music && Date.now() >= duckUntil) music.volume = MUSIC_VOL;
  }, ms);
  return true;
}

function sideFaction(m: Match | undefined, side: Side): FactionId | undefined {
  const id = m?.leader?.[side];
  return id ? maybeCard(id)?.faction : undefined;
}

/** Sounds for what just happened on the field. Pass the match so faction cues can be chosen. */
export function soundEvents(events: GameEvent[], me: Side = 'blue', m?: Match) {
  let shots = 0;
  for (const e of events) {
    switch (e.e) {
      case 'deploy': {
        const u = m?.units[e.uid];
        const c = u ? maybeCard(u.cardId) : undefined;
        if (c?.kind === 'leader' && c.faction === 'army' && playCue('army-leader-deploy', 0.6)) break;
        sfx('enter', 0.45);
        break;
      }
      case 'move':
        sfx(`step-${pickN(4)}`, 0.35);
        break;
      case 'strike':
        if (shots++ < 2) sfx(e.ranged ? `shot-${pickN(3)}` : 'whip', 0.5);
        break;
      case 'death':
        sfx('death', 0.45);
        break;
      case 'trap':
        sfx(e.kind === 'deadfall' || e.kind === 'pit' || e.kind === 'cavein' ? 'dynamite' : 'ricochet', 0.5);
        break;
      case 'play': {
        const k = card(e.cardId).kind;
        sfx(k === 'device' ? 'cylinder' : k === 'item' ? 'cock' : 'bell', 0.45);
        break;
      }
      case 'lead': {
        const cue = leadCue(sideFaction(m, e.side));
        // A faction cue replaces the generic LEAD sting; the spoken line still plays (voice setting).
        if (!(cue && playCue(cue, 0.6))) sfx('leader', 0.55);
        voice(e.side === me ? 'power' : 'foe');
        break;
      }
      case 'turn':
        if (e.side === me) sfx('spur', 0.35);
        break;
      case 'win':
        sfx(e.side === me ? 'victory' : 'defeat', 0.6);
        voice(e.side === me ? 'victory' : 'defeat');
        break;
    }
  }
}
