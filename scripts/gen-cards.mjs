// Builds src/data/cards.json from the mirrored raw cards plus ability specs.
// Run: node scripts/gen-cards.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { BASE, LEADERS } from './spec-base.mjs';
import { NEW } from './spec-new.mjs';

/** Strip the last Occult Wars terms from printed text. */
function westWords(t) {
  return t
    .replace(/\b(\d+) Resources?\b/g, '$1 money')
    .replace(/\bResources?\b/g, 'money')
    .replace(/an opponent's hand/g, 'the rival’s hand')
    .replace(/his plate is destroyed, set it aside/g, 'he is destroyed, set him aside')
    .replace(/your leader plate/g, 'your leader')
    .replace(/this plate/g, 'this card')
    .replace(/the plate knows/g, 'the card knows');
}

const raw = JSON.parse(readFileSync(new URL('../reference/grok-mirror/raw-cards.json', import.meta.url), 'utf8'));

const GEAR = {
  'grave-round': { op: 'graveRound', n: 2 },
  derringer: { op: 'derringer', n: 1 },
  'five-wheel': { op: 'cheatDeath' },
  parfleche: { op: 'shield', n: 1 },
  'painted-shield': { op: 'shield', n: 1 },
  'winter-count': { op: 'drawTurn' },
  'buffalo-skull': { op: 'skull', n: 2 },
  'surgeon-kit': { op: 'surgeon', n: 2 },
  'silver-star': { op: 'scout' },
  manacles: { op: 'manacle' },
  'trade-blanket': { op: 'buff', n: 1 },
  carmilla: { op: 'carmilla' },
};

const KIND = { Leader: 'leader', Unit: 'unit', Item: 'item', Device: 'device', Supernatural: 'rite' };
const out = [];
for (const r of raw) {
  const s = BASE[r.id];
  if (!s) throw new Error(`No spec for ${r.id}`);
  let kind = s.kind ?? KIND[r.kind];
  if (s.trapKind) kind = 'trap';
  const c = {
    id: r.id,
    name: r.name,
    faction: s.faction,
    kind,
    rarity: r.rarity,
    cost: r.cost,
    ...(r.power != null ? { power: r.power } : kind === 'leader' || kind === 'unit' ? { power: 1 } : {}),
    kw: s.kw ?? [],
    tags: r.keywords ?? [],
    mark: r.mark,
    text: westWords(s.text ?? r.text),
    quote: r.quote,
    quoted: r.quoted,
    art: r.art,
    ...(r.artPos ? { artPos: r.artPos } : {}),
  };
  for (const k of ['target', 'play', 'attach', 'ab', 'act', 'lead', 'trapKind', 'hide']) if (s[k] !== undefined) c[k] = s[k];
  if (GEAR[r.id]) c.gear = GEAR[r.id];
  out.push(c);
}
for (const n of NEW) {
  if (out.some((c) => c.id === n.id)) throw new Error(`dup ${n.id}`);
  if (!n.quote || !n.quoted) throw new Error(`No quote for ${n.id}`);
  out.push({ rarity: 'uncommon', kw: [], tags: [], isNew: true, ...n });
}
for (const [f, id] of Object.entries(LEADERS)) {
  const c = out.find((x) => x.id === id);
  if (!c || c.kind !== 'leader' || c.faction !== f) throw new Error(`leader ${f}`);
}
writeFileSync(new URL('../src/data/cards.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
const count = {};
for (const c of out) {
  count[c.faction] ??= { chars: 0, other: 0, leader: 0 };
  if (c.kind === 'leader') count[c.faction].leader++;
  else if (c.kind === 'unit') count[c.faction].chars++;
  else count[c.faction].other++;
}
console.log(out.length, 'cards', JSON.stringify(count));
