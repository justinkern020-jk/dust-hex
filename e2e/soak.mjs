// Soak: the rival mind plays both sides for whole matches in the real UI. Dev server only (?autoplay&fast).
//   GAMES=6 node e2e/soak.mjs http://localhost:5173
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:5173';
const GAMES = Number(process.env.GAMES || 4);
const FAST = process.env.SLOW ? '' : '&fast';
const FACTIONS = ['gang', 'lodge', 'army', 'star', 'grass', 'choir'];
const MAPS = (process.env.MAPS || 'gallows-mesa').split(',');
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
let bad = 0;
for (let g = 0; g < GAMES; g++) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('crash', () => errs.push('PAGE CRASH'));
  let loads = 0; p.on('load', () => loads++);
  await p.addInitScript(() => localStorage.setItem('dusthex.seenPrimer', '1'));
  const side = FACTIONS[g % 6], rival = FACTIONS[(g + 1 + Math.floor(g / 6)) % 6], map = MAPS[g % MAPS.length];
  await p.goto(`${BASE}/?side=${side}&rival=${rival}&map=${map}&mind=expert&autoplay${FAST}`, { waitUntil: 'load' });
  const t0 = Date.now(); let over = false, lost = false, stats, peak = { heap: 0, nodes: 0, anims: 0, audio: 0 };
  while (Date.now() - t0 < 600000) {
    await p.waitForTimeout(3000);
    stats = await p.evaluate(() => ({ over: !!document.querySelector('[data-testid="match-over"]'), board: !!document.querySelector('[data-testid="board"]'), turn: document.querySelector('[data-testid="turn-number"]')?.textContent, nodes: document.getElementsByTagName('*').length, fx: document.querySelectorAll('.fx').length, heap: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6), anims: document.getAnimations().length })).catch((e) => ({ dead: String(e) }));
    if (stats.dead) { lost = true; break; }
    for (const k of ['heap', 'nodes', 'anims']) peak[k] = Math.max(peak[k], stats[k]);
    if (stats.over) { over = true; break; }
    if (!stats.board) { lost = true; break; }
  }
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => ({ board: !!document.querySelector('[data-testid="board"]'), over: !!document.querySelector('[data-testid="match-over"]') })).catch(() => ({}));
  const ok = over && !lost && after.board && loads <= 1 && !errs.length;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} game ${g} ${side} v ${rival} @${map}: over=${over} lost=${lost} loads=${loads} after=${JSON.stringify(after)} last=${JSON.stringify(stats)} peak=${JSON.stringify(peak)} ${((Date.now() - t0) / 1000) | 0}s`);
  for (const e of errs.slice(0, 5)) console.log('   ', e.slice(0, 700));
  await ctx.close();
}
await b.close();
process.exit(bad ? 1 : 0);
