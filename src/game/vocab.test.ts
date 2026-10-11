/**
 * Player-facing vocabulary. Everything a player can read is gathered here:
 * cards, maps, factions, every sentence-like string in the UI and the
 * engine, the page meta and manifest, and the logs of real matches. None of
 * it may say Dominance, or carry the borrowed occult vocabulary.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARDS, FACTIONS } from './cards';
import { MAPS, newMatch, resolveMapId, LEGACY_MAP_IDS } from './engine';
import { playTurn } from './ai';
import { migrateLegacySaves, LEGACY_SETTINGS_KEY, SETTINGS_KEY } from '../ui/storage';

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

/** String literals and JSX text from a source file, comments removed. */
function sourceStrings(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/\s.*$/gm, '');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const s = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    if (/\s/.test(s.trim()) || /^[A-Z]/.test(s)) out.push(s);
  }
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) out.push(m[1]);
  return out;
}

const UI_FILES = readdirSync(new URL('src/ui/', root))
  .filter((f) => /\.tsx?$/.test(f) && f !== 'storage.ts')
  .map((f) => `src/ui/${f}`);
const GAME_FILES = readdirSync(new URL('src/game/', root))
  .filter((f) => /\.ts$/.test(f) && !/\.(test|sim)\.ts$/.test(f) && f !== 'testkit.ts')
  .map((f) => `src/game/${f}`);

function corpus(): [string, string][] {
  const out: [string, string][] = [];
  for (const c of CARDS) {
    for (const k of ['name', 'text', 'mark', 'quote', 'quoted'] as const) if (c[k]) out.push([`${c.id}.${k}`, String(c[k])]);
    for (const t of c.tags ?? []) out.push([`${c.id}.tag`, t]);
    if (c.lead) out.push([`${c.id}.lead`, `${c.lead.label ?? ''} ${c.lead.text}`]);
    if (c.act) out.push([`${c.id}.act`, c.act.label]);
  }
  for (const m of MAPS) out.push([`map ${m.id}`, `${m.name} ${m.epithet}`]);
  for (const f of FACTIONS) out.push([`faction ${f.id}`, `${f.name} ${f.short} ${f.banner} ${f.line}`]);
  for (const f of [...UI_FILES, 'src/App.tsx', ...GAME_FILES]) for (const s of sourceStrings(read(f))) out.push([f, s]);
  out.push(['index.html', read('index.html').replace(/<script[\s\S]*?<\/script>/g, '')]);
  out.push(['manifest', read('public/manifest.webmanifest')]);
  // Real match logs and prompts.
  let seed = 7;
  for (const b of FACTIONS) {
    const red = FACTIONS[(FACTIONS.indexOf(b) + 1) % FACTIONS.length];
    let m = newMatch({ blue: b.id, red: red.id, seed: seed++, mapId: 'gallows-mesa' });
    let rnd = seed * 7919;
    const r = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
    for (let t = 0; t < 120 && !m.winner; t++) {
      for (const p of m.pending) out.push(['prompt', `${p.prompt} ${p.options.map((o) => o.label).join(' ')}`]);
      m = playTurn(m, 'experienced', r);
    }
    for (const l of m.log) out.push([`log ${b.id}`, typeof l === 'string' ? l : JSON.stringify(l)]);
  }
  return out;
}
const ALL = corpus();
const word = (w: string) => new RegExp(`(?<![-\\w])${w}(?![-\\w])`, 'i');

describe('player-facing vocabulary', () => {
  it('reads every surface', () => {
    expect(ALL.length).toBeGreaterThan(1500);
    expect(ALL.some(([, s]) => /Claims \d+ \/ \d+/.test(s))).toBe(true);
  });
  it('never says Dominance or Domination', () => {
    for (const [where, s] of ALL) expect(s, where).not.toMatch(/Dominan|Dominat/i);
  });
  it('never says occult', () => {
    for (const [where, s] of ALL) expect(s, where).not.toMatch(/occult/i);
  });
  it('carries none of the borrowed occult vocabulary', () => {
    const banned = ['rites?', 'muster(s|ed|ing)?', 'working', 'oaths?', 'plates?', 'grimoires?', 'leaden', 'sigils?', 'covens?', 'rituals?', 'cabal\\w*', 'alchem\\w*', 'athanor', 'azoth', 'cloister'];
    for (const [where, s] of ALL) {
      for (const b of banned) expect(s, `${where}: ${b}`).not.toMatch(word(b));
      // Sitting Bull keeps his name; nothing else is a "sitting".
      expect(s.replace(/Sitting Bull/g, ''), where).not.toMatch(word('sitting'));
    }
  });
  it('the card kind reads as Trick', () => {
    expect(CARDS.filter((c) => c.kind === 'rite').every((c) => !(c.tags ?? []).includes('Rite'))).toBe(true);
    expect(read('src/ui/cardview.tsx')).toMatch(/rite: 'Trick'/);
  });
});

describe('old saves and links', () => {
  it('old map ids still open the renamed ground', () => {
    for (const [old, now] of Object.entries(LEGACY_MAP_IDS)) {
      expect(resolveMapId(old)).toBe(now);
      expect(MAPS.some((m) => m.id === now)).toBe(true);
    }
    expect(resolveMapId('nowhere')).toBeNull();
  });
  it('carries old sound settings over and clears the old keys', () => {
    const data = new Map<string, string>([
      [LEGACY_SETTINGS_KEY, '{"sound":false,"music":true}'],
      ['occult-wars.story-seen', '1'],
      ['ow:settings', 'x'],
      ['dusthex.mind', 'easy'],
    ]);
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    };
    expect(migrateLegacySaves(store)).toBe(true);
    expect(data.get(SETTINGS_KEY)).toBe('{"sound":false,"music":true}');
    expect([...data.keys()].sort()).toEqual(['dusthex.mind', SETTINGS_KEY].sort());
    // A second run changes nothing and never overwrites newer settings.
    data.set(LEGACY_SETTINGS_KEY, '{"sound":true}');
    expect(migrateLegacySaves(store)).toBe(false);
    expect(data.get(SETTINGS_KEY)).toBe('{"sound":false,"music":true}');
  });
});
