import type { GameEvent, Side } from '../game/types';
import { card } from '../game/cards';

const KEY = 'dusthex.settings.v1';
export interface Settings {
  sound: boolean;
  music: boolean;
  voice: boolean;
  weather: boolean;
}
const DEFAULTS: Settings = { sound: true, music: true, voice: true, weather: true };

export function loadSettings(): Settings {
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
  music.volume = 0.22;
  void music.play().catch(() => undefined);
}
export function stopMusic() {
  if (music) {
    music.pause();
    music = null;
    musicSrc = '';
  }
}

/** Sounds for what just happened on the field. */
export function soundEvents(events: GameEvent[], me: Side = 'blue') {
  let shots = 0;
  for (const e of events) {
    switch (e.e) {
      case 'deploy':
        sfx('enter', 0.45);
        break;
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
      case 'lead':
        sfx('leader', 0.55);
        voice(e.side === me ? 'power' : 'foe');
        break;
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
