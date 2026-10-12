// Portrait coins: deal a hand, put several units and the leader on the board, let the
// rival answer, then check every coin carries its card portrait and take screenshots.
// Dev server only (uses the deal/money test params):
//   npx vite --port 5173 &  SHOTS=dir node e2e/coins.mjs http://localhost:5173
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:5173';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS;
const HAND = 'billy,belle,sam-bass,black-bart,cousin-jack,dynamite-dick,jackalope';
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

async function run(browser, label, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('dusthex.seenPrimer', '1'));
  await page.goto(`${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy&deal=${HAND}&money=40`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 20000 });
  const place = async (sel) => {
    await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await page.locator(sel).first().click();
    await page.waitForTimeout(200);
    const t = page.locator('.stone.legal-tile:not(.has-unit)').first();
    if (!(await t.count())) return false;
    await t.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await t.click();
    await page.waitForTimeout(900);
    return true;
  };
  await place('[data-testid="hand-leader"].is-draggable');
  for (let i = 0; i < 3; i++) await place('[data-testid^="hand-"].kind-unit.is-draggable');
  await page.locator('[data-testid="end-turn"]').click();
  await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const coins = await page.$$eval('.stone-coin', (els) =>
    els.map((e) => ({ side: e.dataset.side, img: e.querySelector('img.coin-portrait')?.getAttribute('src') ?? '', w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, round: getComputedStyle(e).borderRadius })),
  );
  ok(coins.length >= 4, `${label}: ${coins.length} coins on the board`);
  ok(coins.every((c) => c.img.startsWith('/cards/') || c.img.includes('/cards/')), `${label}: every coin shows its card portrait`);
  ok(coins.every((c) => Math.abs(c.w - c.h) < 1.5 && c.round === '50%'), `${label}: coins are round`);
  ok(coins.some((c) => c.side === 'red'), `${label}: the rival has coins too`);
  ok((await page.locator('.stone-coin.is-leader').count()) >= 1, `${label}: a leader coin is marked`);
  const power = await page.locator('.stone-coin .coin-power').first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, fs: parseFloat(getComputedStyle(el).fontSize) };
  });
  ok(power.fs >= 11, `${label}: power badge legible (${power.fs}px)`);
  if (SHOTS) {
    await page.evaluate(() => document.querySelector('[data-testid="board"]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/dusthex_coins_${label}.png` });
    const b = await page.locator('[data-testid="board"]').boundingBox();
    if (b) await page.screenshot({ path: `${SHOTS}/dusthex_coins_${label}_board.png`, clip: { x: b.x, y: Math.max(0, b.y), width: b.width, height: Math.min(b.height, ctxOpts.viewport.height) } });
  }
  // A coin still opens the card view: tap a rival coin; tap your coin twice
  // (the first tap picks it to move); double-click on desktop.
  const closePeek = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  };
  const tapCoin = async (sel) => {
    await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(150);
    const b = await page.locator(sel).first().boundingBox();
    if (ctxOpts.hasTouch) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(350);
  };
  await tapCoin('.stone-coin.coin-foe');
  ok(await page.locator('[data-testid="card-inspect"]').isVisible(), `${label}: tapping a rival coin opens its card`);
  await closePeek();
  await tapCoin('.stone-coin.coin-mine');
  await tapCoin('.stone-coin.coin-mine');
  ok(await page.locator('[data-testid="card-inspect"]').isVisible(), `${label}: tapping your coin twice opens its card`);
  await closePeek();
  if (!ctxOpts.hasTouch) {
    await page.locator('.stone-coin.coin-mine').first().dblclick();
    await page.waitForTimeout(300);
    ok(await page.locator('[data-testid="card-inspect"]').isVisible(), `${label}: double-click reads a coin`);
  }
  ok(errs.length === 0, `${label}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  await run(browser, 'phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await run(browser, 'desktop', { viewport: { width: 1440, height: 900 } });
} finally {
  await browser.close();
}
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
