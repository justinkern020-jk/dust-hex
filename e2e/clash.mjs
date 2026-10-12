// Clash / death / landing feel on a phone. Dev server only (deal/money params).
//   SHOTS=/workspace/art-fixes/preview node e2e/clash.mjs http://localhost:5173
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:5173';
const SHOTS = process.env.SHOTS || '/workspace/art-fixes/preview';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = [];
p.setDefaultTimeout(5000);
p.on('pageerror', (e) => errs.push(String(e)));
await p.addInitScript(() => {
  localStorage.setItem('dusthex.seenPrimer', '1');
  window.__fx = { clash: 0, death: 0, land: 0, trail: 0, banner: 0 };
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      for (const k of ['clash', 'death', 'land', 'trail']) if (n.classList.contains(`fx-${k}`)) window.__fx[k]++;
      if (n.matches?.('[data-testid="turn-banner"]')) window.__fx.banner++;
    }
  }).observe(document, { childList: true, subtree: true });
});
await p.goto(`${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy&deal=billy,belle,sam-bass,black-bart,cousin-jack,dynamite-dick,jackalope&money=60`, { waitUntil: 'load' });
await p.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 30000 });
const shotOn = async (sel, name, extra = 0) => {
  try { await p.waitForSelector(sel, { timeout: 4000, state: 'attached' }); await p.waitForTimeout(extra); await p.screenshot({ path: `${SHOTS}/dusthex_clash_${name}.png` }); return true; } catch { return false; }
};
const place = async () => {
  const card = p.locator('[data-testid^="hand-"].kind-unit.is-draggable, [data-testid="hand-leader"].is-draggable').first();
  if (!(await card.count())) return false;
  await card.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await card.click(); await p.waitForTimeout(150);
  const t = p.locator('.stone.legal-tile:not(.has-unit)').first();
  if (!(await t.count())) return false;
  await t.click();
  return true;
};
let landShot = false, clashShot = false, deathShot = false;
for (let turn = 0; turn < (Number(process.env.TURNS) || 3) && !(clashShot && deathShot); turn++) {
  for (let i = 0; i < 3; i++) { if (!(await place())) break; if (!landShot) landShot = await shotOn('.fx-land', 'landing', 380); await p.waitForTimeout(700); }
  // Strike anything in reach.
  const mine = Math.min(4, await p.locator('.stone-coin.coin-mine.can-step').count());
  for (let i = 0; i < mine; i++) {
    const c = p.locator('.stone-coin.coin-mine.can-step').nth(i);
    if (!(await c.count())) break;
    await c.click({ force: true }).catch(() => {}); await p.waitForTimeout(150);
    const s = p.locator('.stone.legal-strike').first();
    if (await s.count()) {
      await s.click({ force: true });
      if (!clashShot) clashShot = await shotOn('.fx-clash', 'impact', 150);
      if (!deathShot && (await p.locator('.fx-death').count())) deathShot = await shotOn('.fx-death', 'death', 420);
      await p.waitForTimeout(1300);
    } else {
      // March forward toward the rival.
      const mv = p.locator('.stone.legal-move').last();
      if (await mv.count()) { await mv.click({ force: true }); await p.waitForTimeout(500); }
    }
  }
  console.log('turn', turn, JSON.stringify(await p.evaluate(() => window.__fx)));
  await p.locator('[data-testid="end-turn"]').click().catch(() => {});
  if (!clashShot) clashShot = await shotOn('.fx-clash', 'impact', 150);
  if (!deathShot) deathShot = await shotOn('.fx-death', 'death', 420);
  if (turn === 0) await shotOn('[data-testid="turn-banner"]', 'banner', 300);
  await p.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 40000 }).catch(() => {});
  if (await p.locator('.match-veil').count()) break;
}
// Staged frames: a clash and a kill between two real coins, captured mid-flight.
await p.locator('[data-testid="board"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
await p.waitForTimeout(400);
const staged = await p.evaluate(() => {
  window.__fxKeep = true;
  const grid = document.querySelector('[data-testid="board"]');
  const g = grid.getBoundingClientRect();
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - g.left, y: r.top - g.top, w: r.width, h: r.height }; };
  const coins = [...grid.querySelectorAll('[data-uid]')];
  const a = coins.find((c) => c.dataset.side === 'blue'); const t = coins.find((c) => c.dataset.side === 'red');
  if (!a || !t) return false;
  const prev = new Map([[a.dataset.uid, box(a)], [t.dataset.uid, box(t)]]);
  const fx = window.__dhFx.planFx([{ e: 'strike', uid: a.dataset.uid, target: t.dataset.uid, ranged: false }, { e: 'death', uid: t.dataset.uid, cardId: t.dataset.unit, side: 'red' }], prev, prev);
  window.__dhFx.runFx(grid, fx, (id) => t.querySelector('img')?.getAttribute('src') ?? '', false);
  t.style.visibility = 'hidden';
  return true;
});
if (staged) {
  // Freeze every animation and scrub to exact moments (screenshots are slower than the effects).
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => { for (const an of document.getAnimations()) an.pause(); r(); })));
  const box = await p.locator('[data-testid="board"]').boundingBox();
  for (const [ms, name] of [[110, 'f1_lunge'], [175, 'f2_impact'], [260, 'f3_sparks'], [520, 'f4_crack'], [900, 'f5_crumble']]) {
    await p.evaluate((t) => { for (const an of document.getAnimations()) an.currentTime = t; }, ms);
    await p.screenshot({ path: `${SHOTS}/dusthex_clash_${name}.png`, clip: box });
  }
}
const fx = await p.evaluate(() => window.__fx);
console.log(JSON.stringify({ fx, landShot, clashShot, deathShot, errs }));
await b.close();
process.exit(errs.length || !fx.clash ? 1 : 0);
