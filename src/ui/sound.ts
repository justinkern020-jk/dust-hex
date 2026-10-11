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
  if (!s.music) stopMusic();
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
