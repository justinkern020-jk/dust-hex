// Backing out never leaves a black screen: from the Codex (and a match), the in-app
// Back and the Android/browser back gesture (history back) both land on the porch,
// with the menu music still on. Also from a ?codex deep link. Phone (touch) and desktop.
//   node e2e/back.mjs http://localhost:5173   (also safe against the live site)
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:5173';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const PORCH = '[data-testid="frontier-porch"]';
const CODEX = '[data-testid="codex"]';

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
try {
  for (const vp of [
    { label: 'phone', opts: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: UA } },
    { label: 'desktop', opts: { viewport: { width: 1280, height: 900 } } },
  ]) {
    const ctx = await browser.newContext(vp.opts);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    const press = async (sel) => {
      await page.locator(sel).first().scrollIntoViewIfNeeded();
      if (vp.opts.hasTouch) await page.locator(sel).first().tap();
      else await page.locator(sel).first().click();
    };
    // The porch is up, drawn (not a black page), with the menu music on.
    const onPorch = async (how) => {
      await page.waitForSelector(PORCH, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      const st = await page.evaluate(() => ({
        porch: !!document.querySelector('[data-testid="frontier-porch"]'),
        title: !!document.querySelector('[data-testid="title-screen"]'),
        codex: !!document.querySelector('[data-testid="codex"]'),
        root: (document.getElementById('root')?.innerHTML.length ?? 0) > 200,
        rides: document.querySelectorAll('[data-testid^="ride-"]').length,
        url: location.href,
        music: document.documentElement.dataset.menuMusic ?? '',
      }));
      ok(st.porch && !st.title && !st.codex && st.root && st.rides >= 4 && st.music === 'on' && !/codex/.test(st.url), `${vp.label}: ${how} lands on the porch (${JSON.stringify(st)})`);
    };
    const toCodex = async () => {
      await press('[data-testid="open-codex"]');
      await page.waitForSelector(CODEX);
      await page.evaluate(() => window.scrollTo(0, 2000));
      // Read a card page and close it, as a player would.
      await press('[data-testid="codex-open"] >> nth=3');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    };

    // Fresh launch: title -> tap -> porch -> Codex -> in-app Back.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await press('[data-testid="title-start"]');
    await page.waitForSelector(PORCH);
    await page.waitForTimeout(800);
    await toCodex();
    await press(`${CODEX} .codex-head button`);
    await onPorch('Codex -> in-app Back');
    // Codex -> back gesture (history back).
    await toCodex();
    await page.goBack();
    await onPorch('Codex -> back gesture');
    // Again, to be sure history stays sound: in-app Back then gesture back again.
    await toCodex();
    await press(`${CODEX} .codex-head button`);
    await page.waitForTimeout(300);
    await toCodex();
    await page.goBack();
    await onPorch('Codex twice (Back, then gesture)');
    // A match -> back gesture, and a match -> in-app Back.
    await press('[data-testid^="ride-"] >> nth=0');
    await page.waitForSelector('[data-testid="battlefield"]');
    await page.waitForTimeout(500);
    await page.goBack();
    await onPorch('a match -> back gesture');
    await press('[data-testid^="ride-"] >> nth=1');
    await page.waitForSelector('[data-testid="battlefield"]');
    if (await page.locator('[data-testid="primer-dismiss"]').count()) await press('[data-testid="primer-dismiss"]');
    await press('[data-testid="back"]');
    await onPorch('a match -> in-app Back');

    // Deep link ?codex: in-app Back, then (fresh) the back gesture.
    await page.goto(`${BASE}/?codex`, { waitUntil: 'networkidle' });
    await page.waitForSelector(CODEX);
    await page.mouse.click(5, 5); // a first gesture unlocks audio, as a real visit would
    await press(`${CODEX} .codex-head button`);
    await onPorch('?codex deep link -> in-app Back');
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => errs.push(String(e)));
    await p2.goto(`${BASE}/?codex`, { waitUntil: 'networkidle' });
    await p2.waitForSelector(CODEX);
    await p2.mouse.click(5, 5);
    await p2.goBack();
    await p2.waitForTimeout(600);
    const st = await p2.evaluate(() => ({ porch: !!document.querySelector('[data-testid="frontier-porch"]'), url: location.href, music: document.documentElement.dataset.menuMusic ?? '' }));
    ok(st.porch && !/codex/.test(st.url) && st.music === 'on', `${vp.label}: ?codex deep link -> back gesture lands on the porch (${JSON.stringify(st)})`);
    ok(errs.length === 0, `${vp.label}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
