// The real player flow, end to end: fresh launch -> title -> porch -> ride -> primer ->
// drag a unit card (and the leader) from the hand onto a lit tile. Phones use real
// touch input (CDP Input.dispatchTouchEvent with an Android Chrome UA), desktop a mouse.
// Drags go from a card on the right of the hand to the far gate, on a slant, which is
// what a thumb does (and what the browser used to swallow as a sideways swipe).
// No dev-only params, so it runs against the live site too:
//   node e2e/flow.mjs https://dust-hex.vercel.app      (SHOTS=dir for screenshots)
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:5173';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const box = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};

function input(page, cdp, touch) {
  const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
  return {
    tap: async (x, y) => {
      if (!touch) return page.mouse.click(x, y);
      await t('touchStart', x, y);
      await page.waitForTimeout(50);
      await t('touchEnd');
    },
    drag: async (a, b, steps = 22, mid) => {
      if (touch) await t('touchStart', a.x, a.y);
      else {
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
      }
      // A thumb arc: it sets off mostly sideways, then sweeps up onto the tile
      // (a quadratic curve whose first stretch runs at under 20 degrees).
      const cx = a.x + (b.x - a.x) * 0.75;
      const cy = a.y + (b.y - a.y) * 0.12;
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x;
        const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y;
        if (touch) await t('touchMove', x, y);
        else await page.mouse.move(x, y);
        await page.waitForTimeout(16);
        if (i === steps - 2 && mid) await mid();
      }
      await page.waitForTimeout(40);
      if (touch) await t('touchEnd');
      else await page.mouse.up();
    },
  };
}

async function run(browser, label, ctxOpts) {
  const touch = !!ctxOpts.hasTouch;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  const io = input(page, cdp, touch);
  const tapSel = async (sel) => {
    await page.locator(sel).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    await page.waitForTimeout(120);
    const c = await box(page, sel);
    await io.tap(c.x, c.y);
  };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await tapSel('[data-testid="title-start"]');
  await page.waitForSelector('[data-testid="frontier-porch"]');
  await page.waitForTimeout(700);
  ok((await page.locator('[data-testid="title-screen"]').count()) === 0, `${label}: title gone after the tap`);
  // A thumb scrolls the porch and picks a side lower down.
  await tapSel('[data-testid^="ride-"] >> nth=-1');
  await page.waitForSelector('[data-testid="battlefield"]');
  await page.waitForTimeout(800);
  if (await page.locator('[data-testid="rules-primer"]').count()) {
    const d = await box(page, '[data-testid="primer-dismiss"]');
    const reach = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="primer-dismiss"]'), [d.x, d.y]);
    ok(reach && d.b.y + d.b.height <= ctxOpts.viewport.height, `${label}: primer's Ride button is in reach without scrolling`);
    await tapSel('[data-testid="primer-dismiss"]');
    await page.waitForTimeout(400);
    if (process.env.DEBUG && (await page.locator('[data-testid="rules-primer"]').count())) {
      const c = await box(page, '[data-testid="primer-dismiss"]');
      console.log('primer still open; at button:', await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.tagName + '.' + e?.className + ' ' + e?.textContent?.slice(0, 20); }, [c.x, c.y]), c, await page.evaluate(() => [scrollY, innerHeight, visualViewport.height, visualViewport.offsetTop]));
    }
  }
  ok((await page.locator('[data-testid="rules-primer"]').count()) === 0, `${label}: primer closed`);
  await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 20000 });
  await page.waitForTimeout(1200);

  const mine = () => page.locator('.stone-coin.coin-mine').count();
  // Which tiles a hand card lights (tap to select, read, tap again to put it back).
  const litFor = async (sel) => {
    await tapSel(sel);
    await page.waitForTimeout(250);
    if (process.env.DEBUG) console.log('selected?', await page.locator(`${sel}.is-selected`).count(), await page.locator('.stone.legal-tile').count(), await page.locator('[data-testid="aim-banner"]').count());
    const lit = await page.$$eval('.stone.legal-tile', (els) => els.filter((e) => !e.querySelector('.stone-coin')).map((e) => ({ id: e.dataset.testid, x: e.getBoundingClientRect().x })));
    await tapSel(sel);
    await page.waitForTimeout(250);
    return lit.sort((p, q) => p.x - q.x);
  };
  const dragTo = async (sel, lit, shot) => {
    // Show the hand at the bottom, as it sits when you play.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.locator(sel).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.right > innerWidth) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    await page.waitForTimeout(200);
    let from = await box(page, sel);
    // The gate farthest across from the card, so the pull is slanted.
    const far = from.x > ctxOpts.viewport.width / 2 ? lit[0] : lit[lit.length - 1];
    // Keep the target clear of the top edge, where a drag scrolls the page up.
    const top = await page.locator(`[data-testid="${far.id}"]`).evaluate((el) => el.getBoundingClientRect().top);
    if (top < 110) {
      await page.evaluate((d) => window.scrollBy(0, d), top - 110);
      await page.waitForTimeout(150);
      from = await box(page, sel);
    }
    const to = await box(page, `[data-testid="${far.id}"]`);
    const n0 = await mine();
    let ghost = false;
    let ghostCoin = false;
    await io.drag(from, to, 22, async () => {
      ghost = (await page.locator('[data-testid="drag-ghost"]').count()) === 1;
      ghostCoin = (await page.locator('[data-testid="drag-ghost"] .stone-coin img').count()) === 1;
      if (shot && SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}` });
    });
    await page.waitForTimeout(900);
    return { ghost, ghostCoin, placed: (await mine()) === n0 + 1, far: far.id, dx: Math.round(to.x - from.x), dy: Math.round(to.y - from.y) };
  };

  // A deploy that asks for a choice (look at a tile, pick a target): pass on it.
  const settle = async () => {
    for (let i = 0; i < 4 && (await page.locator('[data-testid="choice-banner"]').count()); i++) {
      const skip = (await page.locator('[data-testid="choose-skip"]').count()) > 0;
      await tapSel(skip ? '[data-testid="choose-skip"]' : '[data-testid="choice-banner"] [data-testid^="choose-"]');
      await page.waitForTimeout(500);
    }
  };
  const endTurn = async () => {
    await settle();
    await tapSel('[data-testid="end-turn"]');
    await page.waitForTimeout(400);
    try {
      await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 30000 });
    } catch (e) {
      await page.screenshot({ path: `/tmp/flow_stuck_${label}.png` });
      console.log('stuck:', await page.locator('[data-testid="battlefield"]').evaluate((el) => el.innerText.slice(0, 600)));
      throw e;
    }
    await page.waitForTimeout(1200);
  };
  // A unit card from the right side of the hand (end turns until one is playable).
  const units = page.locator('[data-testid^="hand-"].kind-unit.is-draggable');
  let unitDone = false;
  for (let turn = 0; turn < 4 && !unitDone; turn++) {
    const n = await units.count();
    if (!n) {
      await endTurn();
      continue;
    }
    const id = await units.nth(n - 1).getAttribute('data-testid');
    const sel = `[data-testid="${id}"]`;
    const lit = await litFor(sel);
    if (!lit.length) {
      await endTurn();
      continue;
    }
    const r = await dragTo(sel, lit, touch ? `dusthex_drag_fix_${label}.png` : undefined);
    await settle();
    ok(r.ghost, `${label}: dragging shows the ghost`);
    ok(r.ghostCoin, `${label}: the ghost is the portrait coin the card becomes`);
    ok(r.placed, `${label}: thumb-arc drag of ${id} deployed on ${r.far} (dx ${r.dx}, dy ${r.dy})`);
    unitDone = true;
  }
  ok(unitDone, `${label}: found a unit to drag within four turns`);
  // The leader from the tray, once the bank can pay for it.
  const leaderSel = '[data-testid="hand-leader"].is-draggable';
  let leaderDone = false;
  for (let turn = 0; turn < 6 && !leaderDone; turn++) {
    if (!(await page.locator(leaderSel).count())) {
      await endTurn();
      continue;
    }
    const lit = await litFor(leaderSel);
    if (!lit.length) {
      await endTurn();
      continue;
    }
    const r = await dragTo(leaderSel, lit);
    await settle();
    ok(r.ghost && r.ghostCoin && r.placed, `${label}: leader dragged from the tray onto ${r.far} (dx ${r.dx}, dy ${r.dy}; ghost ${r.ghost}, coin ${r.ghostCoin}, placed ${r.placed})`);
    leaderDone = true;
  }
  if (!leaderDone) console.log(`info ${label}: leader never affordable/placeable in six turns`);
  // Coins carry portraits.
  const coins = await page.$$eval('.stone-coin', (els) => els.map((e) => !!e.querySelector('img.coin-portrait')?.getAttribute('src')));
  ok(coins.length > 0 && coins.every(Boolean), `${label}: every coin on the board shows a portrait (${coins.length})`);
  if (SHOTS) {
    await page.evaluate(() => document.querySelector('[data-testid="board"]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/dusthex_flow_${label}.png` });
  }
  ok(errs.length === 0, `${label}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  const phone = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: UA });
  for (let i = 0; i < Number(process.env.ROUNDS || 1); i++) {
    await run(browser, 'phone', phone(390, 844));
    await run(browser, 'phone412', phone(412, 915));
    await run(browser, 'desktop', { viewport: { width: 1440, height: 900 } });
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
