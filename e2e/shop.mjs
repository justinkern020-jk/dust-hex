// Browser check for the collection: earn gold from a match, buy a pack, edit and
// save a deck, then start a match with that deck. Phone (touch) and desktop.
// Run against a dev server (the opening-deck hook is dev-only):
//   npx vite --port 5181 &  node e2e/shop.mjs http://localhost:5181
// SHOTS=dir saves screenshots there.
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:5173';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS || '';
const KEY = 'dusthex.collection.v1.local';
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/dusthex_shop_${name}.png`, fullPage: false });
const gold = (page) => page.locator('[data-testid="gold"]').first().getAttribute('data-gold').then(Number);
const readCol = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);

async function run(browser, label, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('dusthex.settings.v1', JSON.stringify({ sound: false, music: false })));
  // A fresh launch opens on the title card: ride past it to the porch.
  const home = async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="title-start"]').click();
    await page.waitForSelector('[data-testid="frontier-porch"]');
  };
  const tap = (sel) => (ctxOpts.hasTouch ? page.locator(sel).first().tap() : page.locator(sel).first().click());

  // 1. First launch: starters for all six sides, no gold.
  await home();
  ok((await gold(page)) === 0, `${label}: first launch shows 0 gold on the porch`);
  ok((await page.locator('[data-testid="ride-deck-gang"]').textContent()).includes('Starter deck'), `${label}: each side rides with its starter deck`);
  const col0 = await readCol(page);
  ok(col0.starters.length === 6 && Object.keys(col0.owned).length > 60, `${label}: starter cards granted for all six sides`);
  await shot(page, `menu_${label}`);

  // 2. Earn gold: play three turns, then yield (a loss after turn 6 still pays).
  await page.goto(`${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy&fast`, { waitUntil: 'networkidle' });
  await page.click('[data-testid="primer-dismiss"]').catch(() => {});
  for (let i = 0; i < 3; i++) {
    await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 20000 });
    await tap('[data-testid="end-turn"]');
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 20000 });
  await tap('[data-testid="yield"]');
  await tap('[data-testid="yield"]');
  await page.waitForSelector('[data-testid="match-gold"]', { timeout: 10000 });
  const earned = Number(await page.locator('[data-testid="match-gold"]').getAttribute('data-gold'));
  ok(earned === 10, `${label}: end screen shows +${earned} gold for a full-length loss`);
  ok((await page.locator('[data-testid="match-gold"]').textContent()).includes('+10 gold'), `${label}: "+10 gold" is written on the end screen`);
  await shot(page, `match_end_${label}`);
  await page.locator('.match-actions button', { hasText: 'Back to the porch' }).click();
  ok((await gold(page)) === 10, `${label}: the porch purse shows the 10 gold`);

  // 3. Buy a pack (top the purse up as if from several matches).
  await page.evaluate((k) => {
    const c = JSON.parse(localStorage.getItem(k));
    c.gold = 400;
    localStorage.setItem(k, JSON.stringify(c));
  }, KEY);
  await home();
  await tap('[data-testid="open-shop"]');
  await page.waitForSelector('[data-testid="trading-post"]');
  await shot(page, `shop_${label}`);
  const before = await readCol(page);
  await tap('[data-testid="buy-pack"]');
  await page.waitForSelector('[data-testid="pack-open"]');
  ok((await page.locator('[data-testid="pack-card"]').count()) === 5, `${label}: a pack opens five cards`);
  await page.waitForTimeout(1100);
  await shot(page, `pack_${label}`);
  const after = await readCol(page);
  const got = Object.values(after.owned).reduce((s, n) => s + n, 0) - Object.values(before.owned).reduce((s, n) => s + n, 0);
  ok(after.gold === 250 && got === 5, `${label}: pack cost 150 gold (now ${after.gold}) and added ${got} cards`);
  await tap('[data-testid="pack-done"]');
  // a single card
  const buyable = page.locator('[data-testid="shop-card"]:has([data-testid="buy-single"]:not([disabled]))').first();
  const single = await buyable.getAttribute('data-card');
  const g1 = await gold(page);
  await (ctxOpts.hasTouch ? buyable.locator('[data-testid="buy-single"]').tap() : buyable.locator('[data-testid="buy-single"]').click());
  ok((await gold(page)) < g1 && (await readCol(page)).owned[single] >= 1, `${label}: bought a single (${single})`);

  // 4. Deck editor: swap a card for a newly owned one, save.
  await tap('[data-testid="post-to-decks"]');
  await page.waitForSelector('[data-testid="deck-editor"]');
  await shot(page, `deck_editor_${label}`);
    if (await page.locator('[data-testid="view-deck"]').isVisible()) await tap('[data-testid="view-deck"]');
  const removeId = await page.locator('[data-testid="deck-row"]').first().getAttribute('data-card');
  await tap('[data-testid="deck-row"] [data-testid="deck-remove"]');
  ok((await page.locator('[data-testid="deck-count"]').textContent()).includes('29'), `${label}: removing a card leaves 29`);
  ok(await page.locator('[data-testid="deck-save"]').isDisabled(), `${label}: a 29-card deck cannot be saved`);
  if (await page.locator('[data-testid="view-pool"]').isVisible()) await tap('[data-testid="view-pool"]');
  // add any owned gang card with a free copy, other than the one just removed
  const cand = page.locator(`[data-testid="pool-card"]:not(.is-locked):not(.is-maxed):not([data-card="${removeId}"])`).first();
  const addId = await cand.getAttribute('data-card');
  await (ctxOpts.hasTouch ? cand.locator('.dh-pool-add').tap() : cand.locator('.dh-pool-add').click());
  ok((await page.locator('[data-testid="deck-count"]').textContent()).includes('30'), `${label}: tapping ${addId} adds it (30/30)`);
  // a locked card explains where to get it
  const locked = page.locator('[data-testid="pool-card"].is-locked').first();
  if (await locked.count()) {
    await (ctxOpts.hasTouch ? locked.locator('.dh-pool-add').tap() : locked.locator('.dh-pool-add').click());
    ok((await page.locator('[data-testid="deck-toast"]').textContent()).includes('Trading Post'), `${label}: a locked card points to the Trading Post`);
  }
  await page.fill('[data-testid="deck-name"]', 'Test posse');
  await tap('[data-testid="deck-save"]');
  await page.waitForTimeout(200);
  const saved = await readCol(page);
  const mine = saved.decks.gang.find((d) => d.id === saved.active.gang);
  ok(mine && mine.name === 'Test posse' && mine.cards.length === 30 && mine.cards.includes(addId), `${label}: deck saved and set as the riding deck`);
  await shot(page, `deck_saved_${label}`);
  // auto-build
  await tap('[data-testid="deck-auto"]');
  ok((await page.locator('[data-testid="deck-count"]').textContent()).includes('30'), `${label}: auto-build makes 30 cards`);
  await tap('[data-testid="back-porch"]');
  if (await page.locator('[data-testid="deck-leave"]').count()) await tap('[data-testid="deck-leave-discard"]');

  // 5. Start a match: the saved deck is what you draw from.
  ok((await page.locator('[data-testid="ride-deck-gang"]').textContent()).includes('Test posse'), `${label}: porch shows the saved deck`);
  await tap('[data-testid="ride-The Red Creek Gang"]');
  await page.waitForSelector('[data-testid="end-turn"]', { timeout: 15000 });
  const opening = await page.evaluate(() => window.__dhOpening);
  ok(JSON.stringify([...opening].sort()) === JSON.stringify([...mine.cards].sort()), `${label}: the match deals from the saved deck`);
  ok(errs.length === 0, `${label}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  await run(browser, 'phone', { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  await run(browser, 'desktop', { viewport: { width: 1366, height: 900 } });
} finally {
  await browser.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
