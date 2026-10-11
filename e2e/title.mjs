// Browser check for the title card: shows on a fresh launch, the first tap/key
// starts the menu loop and wipes into the porch, deep links skip it, and leaving
// a match lands on the porch (not the title).
//   npx vite --port 5173 &  node e2e/title.mjs http://localhost:5173
// SHOTS=dir saves phone, desktop and mid-transition screenshots.
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:5173';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS;

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const TITLE = '[data-testid="title-screen"]';
const PORCH = '[data-testid="frontier-porch"]';
const music = (page) => page.evaluate(() => document.documentElement.dataset.menuMusic ?? '');
const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight);
const inView = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return !!r && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5;
  }, sel);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=user-gesture-required'] });
try {
  // ---- phone portrait: tap to ride
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    ok(await page.locator(TITLE).isVisible(), 'phone: title shows on launch');
    ok((await page.locator(PORCH).count()) === 0, 'phone: porch waits behind the title');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2600); // let the logotype settle in
    ok(await noOverflow(page), 'phone: no overflow');
    ok(await inView(page, '.dh-logo'), 'phone: logotype fits the screen');
    ok(await inView(page, '[data-testid="title-start"]'), 'phone: prompt on screen');
    ok((await page.locator('.dh-title-prompt .for-touch').isVisible()) && (await page.locator('.dh-title-prompt .for-touch').innerText()) === 'Tap to Ride', 'phone: says Tap to Ride');
    ok((await music(page)) !== 'on', 'phone: no music before a gesture');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dusthex_title_phone.png` });
    await page.touchscreen.tap(195, 520);
    await page.waitForTimeout(300);
    ok((await page.locator(`${TITLE}[data-leaving="true"]`).count()) === 1, 'phone: tap starts the dust wipe');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dusthex_title_transition.png` });
    await page.waitForSelector(PORCH, { timeout: 2000 });
    ok((await page.locator(TITLE).count()) === 0, 'phone: tap lands on the porch');
    await page.waitForFunction(() => document.documentElement.dataset.menuMusic === 'on', null, { timeout: 8000 }).catch(() => {});
    ok((await music(page)) === 'on', 'phone: menu loop playing after the tap');
    if (SHOTS) {
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/dusthex_porch_phone.png` });
    }
    // Ride, then leave the match: back to the porch, not the title.
    await page.locator('[data-testid^="ride-"]').first().click();
    await page.waitForSelector('[data-testid="battlefield"]');
    await page.click('[data-testid="primer-dismiss"]', { timeout: 3000 }).catch(() => {});
    await page.click('[data-testid="back"]');
    await page.waitForSelector(PORCH, { timeout: 3000 }).catch(() => {});
    ok((await page.locator(PORCH).count()) === 1 && (await page.locator(TITLE).count()) === 0, 'leaving a match returns to the porch');
    await ctx.close();
  }
  // ---- desktop: any key
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    ok(await page.locator(TITLE).isVisible(), 'desktop: title shows on launch');
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(720, 450);
    await page.waitForTimeout(2600);
    ok(await noOverflow(page), 'desktop: no overflow');
    ok(await inView(page, '.dh-logo'), 'desktop: logotype fits');
    ok((await page.locator('.dh-title-prompt .for-keys').innerText()) === 'Press any key to ride', 'desktop: says press any key');
    const font = await page.$eval('.dh-logo', (el) => getComputedStyle(el).fontFamily);
    ok(/Rye/.test(font) && (await page.evaluate(() => document.fonts.check('40px Rye'))), 'desktop: Rye loaded (self-hosted)');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dusthex_title_desktop.png` });
    await page.keyboard.press('Enter');
    await page.waitForSelector(PORCH, { timeout: 2000 });
    ok(true, 'desktop: a key goes to the porch');
    await page.waitForFunction(() => document.documentElement.dataset.menuMusic === 'on', null, { timeout: 8000 }).catch(() => {});
    ok((await music(page)) === 'on', 'desktop: menu loop playing after the key');
    if (SHOTS) {
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/dusthex_porch_desktop.png` });
    }
    // Deep links skip the title.
    await page.goto(`${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy`, { waitUntil: 'networkidle' });
    ok((await page.locator(TITLE).count()) === 0 && (await page.locator('[data-testid="battlefield"]').count()) === 1, 'deep link ?side= skips the title');
    await page.goto(`${BASE}/?codex`, { waitUntil: 'networkidle' });
    ok((await page.locator(TITLE).count()) === 0 && (await page.locator(PORCH).count()) === 0, 'deep link ?codex skips the title');
    await ctx.close();
  }
  // ---- reduced motion: still works, quick fade
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    ok(!(await page.locator('.dh-title-motes').isVisible()), 'reduced motion: no motes');
    await page.mouse.click(640, 400);
    await page.waitForSelector(PORCH, { timeout: 1000 });
    ok(true, 'reduced motion: click goes to the porch');
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall title checks passed');
process.exit(failed ? 1 : 0);
