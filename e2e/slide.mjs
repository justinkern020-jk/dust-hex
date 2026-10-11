// Browser check for coin slides: deploy (tap and drag), move, AI moves, reduced motion,
// and a mid-slide screenshot. Needs a dev server (deal/money are dev-only):
//   npx vite --port 5173 &  node e2e/slide.mjs http://localhost:5173 [shot-dir]
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:5173';
const SHOTS = process.argv[3] || '';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const url = `${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy&deal=billy,belle,sam-bass,black-bart&money=12`;
let failed = 0;
const ok = (c, m) => {
  console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`);
  if (!c) failed++;
};
const center = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
// Transform of the coin on a tile, as a translate y offset (0 when settled).
const coinState = (page, r, c) =>
  page.evaluate(([r, c]) => {
    const el = document.querySelector(`[data-tile-r="${r}"][data-tile-c="${c}"] .stone-coin`);
    if (!el) return null;
    const m = new DOMMatrix(getComputedStyle(el).transform === 'none' ? undefined : getComputedStyle(el).transform);
    return { tx: Math.round(m.m41), ty: Math.round(m.m42), anims: el.getAnimations().length, flying: el.classList.contains('is-flying'), opacity: Number(getComputedStyle(el).opacity) };
  }, [r, c]);
// Click inside the page and sample the coin after `ms`, so tool latency cannot hide the glide.
const clickAndSample = (page, sel, r, c, ms) =>
  page.evaluate(
    async ([sel, r, c, ms]) => {
      document.querySelector(sel).click();
      await new Promise((res) => setTimeout(res, ms));
      const el = document.querySelector(`[data-tile-r="${r}"][data-tile-c="${c}"] .stone-coin`);
      if (!el) return null;
      if (window.__pauseMid) el.getAnimations().forEach((a) => a.pause());
      const t = getComputedStyle(el).transform;
      const m = new DOMMatrix(t === 'none' ? undefined : t);
      return { tx: Math.round(m.m41), ty: Math.round(m.m42), flying: el.classList.contains('is-flying'), opacity: Number(getComputedStyle(el).opacity) };
    },
    [sel, r, c, ms],
  );
async function open(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.click('[data-testid="primer-dismiss"]').catch(() => {});
  await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 0));
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const errs = [];
try {
  for (const [name, opts] of [
    ['desk', { viewport: { width: 1280, height: 1000 } }],
    ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(String(e)));
    await open(page);
    // Tap deploy: the coin slides in from the hand.
    if (name === 'desk') await page.click('[data-testid="hand-0"]');
    else await page.tap('[data-testid="hand-0"]');
    await page.waitForSelector('[data-testid="aim-banner"]');
    await page.evaluate(() => (window.__pauseMid = true));
    const mid = await clickAndSample(page, '[data-testid="tile-4-1"]', 4, 1, 140);
    ok(mid && mid.flying && mid.ty > 20, `${name}: deployed coin is mid-slide up from the hand (ty ${mid?.ty}px)`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dusthex_slide_${name}_deploy_mid.png` });
    await page.evaluate(() => {
      window.__pauseMid = false;
      document.querySelectorAll('.stone-coin').forEach((el) => el.getAnimations().forEach((a) => a.play()));
    });
    await page.waitForTimeout(450);
    const landed = await coinState(page, 4, 1);
    ok(landed && !landed.flying && landed.tx === 0 && landed.ty === 0, `${name}: deployed coin lands exactly on its tile`);
    await page.click('[data-testid="hand-0"]');
    await page.waitForSelector('[data-testid="aim-banner"]');
    // Input is blocked only while in flight.
    const blocked = await page.evaluate(async () => {
      document.querySelector('[data-testid="tile-4-3"]').click();
      await new Promise((r) => setTimeout(r, 40));
      document.querySelector('[data-testid="hand-1"]').click();
      await new Promise((r) => setTimeout(r, 30));
      return !document.querySelector('[data-testid="aim-banner"]');
    });
    ok(blocked, `${name}: a tap mid-flight is ignored`);
    await page.waitForTimeout(450);
    await page.click('[data-testid="hand-1"]');
    ok((await page.locator('[data-testid="aim-banner"]').count()) === 1, `${name}: input works again right after landing`);
    await page.click('.aim-banner .dev-link >> text=Cancel');
    // Drag deploy: the coin settles from the drop point.
    const from = await center(page, '[data-testid="hand-0"]');
    const to = await center(page, '[data-testid="tile-4-2"]');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10 - 18);
    await page.mouse.up();
    await page.waitForTimeout(60);
    const dm = await coinState(page, 4, 2);
    ok(dm && dm.flying, `${name}: drag-deployed coin settles with a slide`);
    await page.waitForTimeout(450);
    // End turn and watch the rival: its coins slide in, one action at a time.
    let aiAnim = 0;
    await page.exposeFunction('__aiSlide', () => aiAnim++).catch(() => {});
    await page.evaluate(() => {
      const seen = new WeakSet();
      const t = setInterval(() => {
        document.querySelectorAll('.stone-coin.is-flying[data-side="red"]').forEach((el) => {
          if (!seen.has(el)) {
            seen.add(el);
            window.__aiSlide();
          }
        });
      }, 16);
      window.__stopWatch = () => clearInterval(t);
    });
    await page.click('[data-testid="end-turn"]');
    await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 30000 });
    await page.evaluate(() => window.__stopWatch());
    ok(aiAnim >= 1, `${name}: the rival's coins slide (${aiAnim} seen)`);
    // Move: my unit glides to the chosen tile.
    await page.waitForTimeout(500);
    let target = null;
    const mine = await page.$$eval('.stone-coin[data-side="blue"]', (els) => els.map((e) => e.closest('.stone').dataset.testid));
    for (const t of mine) {
      await page.click(`[data-testid="${t}"] .stone-coin`);
      target = await page.evaluate(() => {
        const t = document.querySelector('.stone.legal-move');
        return t ? [Number(t.dataset.tileR), Number(t.dataset.tileC)] : null;
      });
      if (target) break;
      await page.click(`[data-testid="${t}"] .stone-coin`); // put it down again
    }
    {
      if (target) {
        // Freeze the glide halfway for the screenshot, then let it finish.
        const mv = await page.evaluate(
          async ([r, c]) => {
            document.querySelector(`[data-testid="tile-${r}-${c}"]`).click();
            await new Promise((res) => setTimeout(res, 180));
            const el = document.querySelector(`[data-tile-r="${r}"][data-tile-c="${c}"] .stone-coin`);
            el.getAnimations().forEach((a) => a.pause());
            const m = new DOMMatrix(getComputedStyle(el).transform);
            return { tx: Math.round(m.m41), ty: Math.round(m.m42), flying: el.classList.contains('is-flying') };
          },
          target,
        );
        ok(mv && mv.flying && Math.hypot(mv.tx, mv.ty) > 10, `${name}: a moved coin glides between tiles (offset ${mv?.tx},${mv?.ty})`);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/dusthex_slide_${name}_move_mid.png` });
        await page.evaluate(([r, c]) => document.querySelector(`[data-tile-r="${r}"][data-tile-c="${c}"] .stone-coin`).getAnimations().forEach((a) => a.play()), target);
        await page.waitForTimeout(400);
        const mvEnd = await coinState(page, target[0], target[1]);
        ok(mvEnd && mvEnd.tx === 0 && mvEnd.ty === 0 && !mvEnd.flying, `${name}: and lands cleanly`);
      } else console.log(`info ${name}: no unit could move this turn ${await page.evaluate(() => [document.querySelector('[data-testid="aim-banner"]')?.textContent, document.querySelector('.stone-picked') ? 'picked' : 'notpicked', document.querySelector('[data-testid="turn-number"]')?.textContent, [...document.querySelectorAll('.stone-coin')].map((e) => e.dataset.side + '@' + e.closest('.stone').dataset.testid).join(',')].join(' | '))}`);
    }
    await ctx.close();
  }
  // Reduced motion: a short fade in place, no travel.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await open(page);
    await page.click('[data-testid="hand-0"]');
    const s = await clickAndSample(page, '[data-testid="tile-4-1"]', 4, 1, 40);
    ok(s && s.flying && s.tx === 0 && s.ty === 0 && s.opacity < 1, `reduced motion: fades in place (opacity ${s?.opacity?.toFixed(2)})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
ok(errs.length === 0, `no page errors ${errs.join(' | ')}`);
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
