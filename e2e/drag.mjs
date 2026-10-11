// Browser check for the hand: drag to deploy (mouse and touch), swipe, wheel,
// slider, arrows, tap-then-tile and inspect.
// Run against a dev server (the deal/money test params are dev-only):
//   npx vite --port 5173 &  node e2e/drag.mjs http://localhost:5173
// Against a production build pass LIVE=1 to run only the checks that need no test hand.
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:5173';
const LIVE = !!process.env.LIVE;
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const HAND = 'billy,belle,sam-bass,black-bart,jackalope,cousin-jack,dynamite-dick';
const url = LIVE ? `${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy` : `${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy&deal=${HAND}&money=12`;

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const center = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const unitOn = (page, r, c) => page.locator(`[data-tile-r="${r}"][data-tile-c="${c}"] .stone-coin`).count();
const scrollLeft = (page) => page.$eval('[data-testid="hand-row"]', (el) => el.scrollLeft);
const handCount = (page) => page.locator('[data-testid^="hand-"][data-card]').count();

async function open(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.click('[data-testid="primer-dismiss"]').catch(() => {});
  await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 15000 });
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const errs = [];
try {
  // ---------------- desktop, mouse ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(String(e)));
    await open(page);
    ok((await page.locator('.hand-card').first().evaluate((el) => getComputedStyle(el).touchAction)) === 'pan-x', 'hand cards let the browser swipe sideways (touch-action: pan-x)');
    const overflow = await page.$eval('[data-testid="hand-row"]', (el) => el.scrollWidth > el.clientWidth + 4);
    ok(overflow, 'hand overflows at this width');
    if (overflow) {
      ok(await page.locator('[data-testid="hand-slider"]').isVisible(), 'slider is shown under the hand');
      ok(await page.locator('[data-testid="hand-next"]').isVisible(), 'edge arrows are shown');
      // wheel
      await page.locator('[data-testid="hand-row"]').scrollIntoViewIfNeeded();
      const row = await center(page, '[data-testid="hand-row"]');
      await page.mouse.move(row.x, row.y);
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(250);
      const afterWheel = await scrollLeft(page);
      ok(afterWheel > 0, `mouse wheel scrolls the hand (${afterWheel}px)`);
      // slider
      await page.$eval('[data-testid="hand-slider"]', (el) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(el, '0');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(150);
      ok((await scrollLeft(page)) === 0, 'slider back to the start scrolls the hand home');
      // arrows
      await page.click('[data-testid="hand-next"]');
      await page.waitForTimeout(700);
      const afterArrow = await scrollLeft(page);
      ok(afterArrow > 0, `next arrow scrolls the hand (${afterArrow}px)`);
      await page.click('[data-testid="hand-prev"]');
      await page.waitForTimeout(700);
      ok((await scrollLeft(page)) < afterArrow, 'prev arrow scrolls back');
      // mouse sideways drag scrolls, does not select
      await page.$eval('[data-testid="hand-row"]', (el) => (el.scrollLeft = 0));
      const c2 = await center(page, '[data-testid="hand-2"]');
      await page.mouse.move(c2.x, c2.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(c2.x - i * 20, c2.y + 2);
      await page.mouse.up();
      await page.waitForTimeout(150);
      ok((await scrollLeft(page)) > 60, 'a sideways mouse drag on a card scrolls the hand');
      ok((await page.locator('[data-testid="aim-banner"]').count()) === 0, 'a sideways drag does not pick the card');
      await page.$eval('[data-testid="hand-row"]', (el) => (el.scrollLeft = 0));
    }
    if (!LIVE) {
      // vertical mouse drag deploys
      const n0 = await handCount(page);
      const from = await center(page, '[data-testid="hand-0"]');
      const to = await center(page, '[data-testid="tile-4-1"]');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
      ok(await page.locator('[data-testid="drag-ghost"]').isVisible(), 'a ghost card follows the pointer');
      ok((await page.locator('[data-testid="tile-4-1"].dh-drop-ok').count()) === 1, 'the lit tile under the pointer is highlighted');
      await page.mouse.up();
      await page.waitForTimeout(300);
      ok((await unitOn(page, 4, 1)) === 1, 'mouse drag up to a lit gate deploys the unit');
      ok((await handCount(page)) === n0 - 1, 'the card left the hand');
      // drop on an unlit tile: nothing happens, a hint shows
      const f2 = await center(page, '[data-testid="hand-0"]');
      const bad = await center(page, '[data-testid="tile-2-2"]');
      await page.mouse.move(f2.x, f2.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(f2.x + ((bad.x - f2.x) * i) / 10, f2.y + ((bad.y - f2.y) * i) / 10);
      await page.mouse.up();
      await page.waitForTimeout(200);
      ok((await unitOn(page, 2, 2)) === 0 && (await handCount(page)) === n0 - 1, 'a drop on an unlit tile does nothing');
      ok(await page.locator('[data-testid="aim-banner"]').isVisible(), 'after a missed drop the card stays picked, ready for a tap');
      await page.click('.aim-banner .dev-link >> text=Cancel');
      // tap card, then tap tile still works
      await page.click('[data-testid="hand-0"]');
      await page.waitForSelector('[data-testid="aim-banner"]');
      await page.click('[data-testid="tile-4-3"]');
      await page.waitForTimeout(300);
      ok((await unitOn(page, 4, 3)) === 1, 'tap a card, then a lit tile, still deploys');
    }
    // inspect
    await page.dblclick('[data-testid="hand-0"]');
    ok(await page.locator('[data-testid="card-inspect"]').isVisible(), 'double-click reads the card');
    await page.keyboard.press('Escape');
    await ctx.close();
  }
  // ---------------- phone, touch ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(String(e)));
    await open(page);
    const cdp = await ctx.newCDPSession(page);
    await page.waitForTimeout(300);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await page.locator('[data-testid="hand-row"]').scrollIntoViewIfNeeded();
    // sideways swipe scrolls natively
    const c1 = await center(page, '[data-testid="hand-1"]');
    await touch('touchStart', c1.x, c1.y);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', c1.x - i * 18, c1.y + 1);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd');
    await page.waitForTimeout(500);
    const sl = await scrollLeft(page);
    ok(sl > 40, `a sideways swipe scrolls the hand (${sl}px)`);
    ok((await page.locator('[data-testid="aim-banner"]').count()) === 0, 'the swipe did not pick a card');
    await page.$eval('[data-testid="hand-row"]', (el) => (el.scrollLeft = 0));
    await page.waitForTimeout(100);
    if (!LIVE) {
      const n0 = await handCount(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(100);
      const from = await center(page, '[data-testid="hand-0"]');
      const to = await center(page, '[data-testid="tile-4-1"]');
      await touch('touchStart', from.x, from.y);
      for (let i = 1; i <= 14; i++) {
        await touch('touchMove', from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14);
        await page.waitForTimeout(16);
      }
      await touch('touchEnd');
      await page.waitForTimeout(400);
      ok((await unitOn(page, 4, 1)) === 1, 'touch drag up to a lit gate deploys the unit');
      ok((await handCount(page)) === n0 - 1, 'the card left the hand');
    }
    // press and hold reads the card
    const h = await center(page, '[data-testid="hand-0"]');
    await touch('touchStart', h.x, h.y);
    await page.waitForTimeout(750);
    await touch('touchEnd');
    await page.waitForTimeout(200);
    ok(await page.locator('[data-testid="card-inspect"]').isVisible(), 'press and hold reads the card');
    await ctx.close();
  }
} finally {
  await browser.close();
}
ok(errs.length === 0, `no page errors ${errs.join(' | ')}`);
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
