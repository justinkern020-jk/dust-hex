// Sloppy drops: the coin snaps to the nearest lit tile, so a thumb that lets go
// off-centre, between two tiles, on a slant or in a hurry still deploys.
// Phones use real touch (CDP Input.dispatchTouchEvent), desktop a mouse.
//   npx vite --port 5173 &  node e2e/snap.mjs http://localhost:5173
// LIVE=1 runs without the dev-only test hand (whatever you are dealt).
// TRIALS=n per viewport (default 24). SHOT=path saves a mid-drag phone screenshot.
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:5173';
const LIVE = !!process.env.LIVE;
const TRIALS = Number(process.env.TRIALS || 24);
const SHOT = process.env.SHOT;
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const HAND = 'billy,belle,sam-bass,black-bart,cousin-jack,billy,belle';
const url = LIVE ? `${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy` : `${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy&deal=${HAND}&money=14`;
const LIFT = 66;

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
// Deterministic randomness, so a failure can be replayed.
let seed = Number(process.env.SEED || 20261011);
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const summary = [];
try {
  for (const vp of [
    { label: 'phone 390x844', touch: true, opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA } },
    { label: 'phone 412x915', touch: true, opts: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: UA } },
    { label: 'desktop 1280x900', touch: false, opts: { viewport: { width: 1280, height: 900 } } },
  ]) {
    const ctx = await browser.newContext(vp.opts);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    const cdp = await ctx.newCDPSession(page);
    const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    const down = (p) => (vp.touch ? T('touchStart', p.x, p.y) : page.mouse.move(p.x, p.y).then(() => page.mouse.down()));
    const move = (p) => (vp.touch ? T('touchMove', p.x, p.y) : page.mouse.move(p.x, p.y));
    const up = () => (vp.touch ? T('touchEnd') : page.mouse.up());
    const tap = async (p) => {
      if (!vp.touch) return page.mouse.click(p.x, p.y);
      await T('touchStart', p.x, p.y);
      await page.waitForTimeout(40);
      await T('touchEnd');
    };
    const lift = vp.touch ? LIFT : 0;
    const open = async () => {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => localStorage.setItem('dusthex.seenPrimer', '1'));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 20000 });
      await page.waitForTimeout(400);
    };
    const settle = async () => {
      for (let i = 0; i < 4 && (await page.locator('[data-testid="choice-banner"]').count()); i++) {
        const skip = (await page.locator('[data-testid="choose-skip"]').count()) > 0;
        await page.locator(skip ? '[data-testid="choose-skip"]' : '[data-testid="choice-banner"] [data-testid^="choose-"]').first().click();
        await page.waitForTimeout(400);
      }
    };
    // A playable unit card in the hand, brought into view with the hand at the bottom of the screen.
    const pickCard = async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const sels = await page.$$eval('.hand-card.is-draggable.kind-unit, .hand-card.is-draggable.hand-leader', (els) => els.map((e) => e.dataset.testid));
      if (!sels.length) return null;
      const sel = `[data-testid="${sels[Math.floor(rnd() * sels.length)]}"]`;
      await page.locator(sel).evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      await page.waitForTimeout(120);
      const b = await page.locator(sel).boundingBox();
      return { sel, from: { x: b.x + b.width * (0.25 + rnd() * 0.5), y: b.y + b.height * (0.3 + rnd() * 0.4) } };
    };
    const spots = () =>
      page.$$eval('[data-tile-r]', (els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { id: e.dataset.testid, key: `${e.dataset.tileR},${e.dataset.tileC}`, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, lit: e.classList.contains('legal-tile') && !e.querySelector('.stone-coin:not(.dh-drop-preview)') };
        }),
      );
    const nearest = (sp, x, y) => {
      let best = null;
      let d0 = Infinity;
      for (const s of sp) {
        if (!s.lit) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d <= s.w * 1.2 && d < d0) [best, d0] = [s, d];
      }
      return best;
    };
    const count = () => page.$$eval('.stone-coin.coin-mine:not(.dh-drop-preview)', (e) => e.length);

    await open();
    let pass = 0;
    let runs = 0;
    const styles = ['off-centre', 'between', 'slanted', 'fast'];
    let shotDone = false;
    for (let trial = 0; runs < TRIALS && trial < TRIALS * 3; trial++) {
      const pick = await pickCard();
      if (!pick || (await page.locator('[data-testid="end-turn"]:not([disabled])').count()) === 0) {
        await open();
        continue;
      }
      const style = styles[runs % styles.length];
      const n0 = await count();
      await down(pick.from);
      // Lift off: a hold for some trials (any direction), a pull up for the rest.
      if (rnd() < 0.3) await page.waitForTimeout(300);
      await move({ x: pick.from.x + (rnd() - 0.5) * 10, y: pick.from.y - 14 });
      await page.waitForTimeout(30);
      const sp = await spots();
      const lit = sp.filter((s) => s.lit);
      if (!lit.length) {
        await up();
        await open();
        continue;
      }
      // Where the coin is let go.
      const t = lit[Math.floor(rnd() * lit.length)];
      let aim;
      if (style === 'between' && lit.length > 1) {
        const o = lit.filter((s) => s !== t).sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
        const f = 0.35 + rnd() * 0.3;
        aim = { x: t.x + (o.x - t.x) * f, y: t.y + (o.y - t.y) * f };
      } else {
        const a = rnd() * Math.PI * 2;
        const r = t.w * (0.2 + rnd() * 0.5);
        aim = { x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r };
      }
      // On touch the coin rides LIFT px above the finger: the player aims the coin. Some trials aim the finger instead.
      const fingerAim = vp.touch && rnd() < 0.25;
      const end = { x: aim.x, y: aim.y + (fingerAim ? 0 : lift) };
      const coinAt = { x: end.x, y: end.y - lift };
      const steps = style === 'fast' ? 3 : 10 + Math.floor(rnd() * 10);
      const start = { x: pick.from.x, y: pick.from.y - 14 };
      // Slanted: a thumb arc that sets off mostly sideways.
      const cx = style === 'slanted' ? start.x + (end.x - start.x) * 0.8 : (start.x + end.x) / 2 + (rnd() - 0.5) * 40;
      const cy = style === 'slanted' ? start.y + (end.y - start.y) * 0.1 : (start.y + end.y) / 2;
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        await move({ x: (1 - u) ** 2 * start.x + 2 * (1 - u) * u * cx + u * u * end.x, y: (1 - u) ** 2 * start.y + 2 * (1 - u) * u * cy + u * u * end.y });
        if (style !== 'fast') await page.waitForTimeout(12);
      }
      const sp2 = await spots();
      const want = nearest(sp2, coinAt.x, coinAt.y);
      // A fast flick lets go before the next frame paints, so only its landing is checked.
      const fast = style === 'fast';
      const over = fast ? null : await page.locator('[data-testid="drag-ghost"]').getAttribute('data-over').catch(() => null);
      const lifted = vp.touch && !fast ? await page.locator('[data-testid="drag-ghost"] .dh-ghost-coin').boundingBox() : null;
      if (SHOT && vp.touch && !shotDone && want && style !== 'fast') {
        await page.screenshot({ path: SHOT });
        shotDone = true;
      }
      await up();
      await page.waitForTimeout(550);
      await settle();
      runs++;
      if (!want) {
        console.log(`info ${vp.label}: trial ${runs} (${style}) released ${Math.round(Math.hypot(coinAt.x - t.x, coinAt.y - t.y))}px from ${t.key}, outside reach; skipped`);
        runs--;
        continue;
      }
      const landed = await page.locator(`[data-testid="${want.id}"] .stone-coin.coin-mine`).count();
      const n1 = await count();
      const good = landed === 1 && n1 === n0 + 1 && (fast || over === want.key) && (!lifted || lifted.y + lifted.height < end.y - 20);
      if (good) pass++;
      else console.log(`FAIL ${vp.label}: trial ${runs} (${style}${fingerAim ? ', finger-aimed' : ''}) aimed ${t.key}, expected ${want.key}, ghost over ${over}, landed ${landed}, coins ${n0}->${n1}, lifted ${lifted ? Math.round(lifted.y + lifted.height) : '-'} vs finger ${Math.round(end.y)}`);
    }
    ok(pass === runs && runs >= Math.min(TRIALS, 20), `${vp.label}: ${pass}/${runs} sloppy drops deployed on the snapped tile`);
    summary.push(`${vp.label} ${pass}/${runs}`);

    // Release over the hand: the drag is called off.
    await open();
    {
      const pick = await pickCard();
      const n0 = await count();
      const hand = await page.locator('.hand-scroller').boundingBox();
      await down(pick.from);
      for (let i = 1; i <= 8; i++) await move({ x: pick.from.x + i * 3, y: pick.from.y - i * 30 });
      for (let i = 1; i <= 8; i++) await move({ x: pick.from.x + 24, y: pick.from.y - 240 + i * 30 });
      await move({ x: pick.from.x + 30, y: hand.y + hand.height / 2 });
      await up();
      await page.waitForTimeout(500);
      ok((await count()) === n0 && (await page.locator('[data-testid="aim-banner"]').count()) === 0, `${vp.label}: let go over the hand calls the drag off`);
    }
    // Tap a card, then tap a lit tile (off-centre), deploys; tap elsewhere puts it back.
    {
      const pick = await pickCard();
      await tap(pick.from);
      await page.waitForTimeout(250);
      ok((await page.locator(`${pick.sel}.is-selected`).count()) === 1 && (await page.locator('.stone.legal-tile').count()) > 0, `${vp.label}: a tapped card is raised and its tiles lit`);
      const bf = await page.locator('.bf-log h3').boundingBox();
      await tap({ x: bf.x + 4, y: bf.y + bf.height / 2 });
      await page.waitForTimeout(250);
      ok((await page.locator('.stone.legal-tile').count()) === 0, `${vp.label}: a tap elsewhere puts the card back`);
      const p2 = await pickCard();
      await tap(p2.from);
      await page.waitForTimeout(250);
      const lit = (await spots()).filter((s) => s.lit);
      const t = lit[0];
      const n0 = await count();
      await tap({ x: t.x + t.w * 0.3, y: t.y - t.w * 0.25 });
      await page.waitForTimeout(600);
      ok((await page.locator(`[data-testid="${t.id}"] .stone-coin.coin-mine`).count()) === 1 && (await count()) === n0 + 1, `${vp.label}: tap a card, then a lit tile, deploys`);
    }
    // The leader from the tray, dropped off-centre.
    if (!LIVE) {
      await open();
      const has = await page.locator('.hand-leader.is-draggable').count();
      if (has) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.locator('.hand-leader').evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        const b = await page.locator('.hand-leader').boundingBox();
        const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        await down(from);
        await move({ x: from.x - 6, y: from.y - 20 });
        await page.waitForTimeout(30);
        const t = (await spots()).filter((s) => s.lit).pop();
        const end = { x: t.x + t.w * 0.45, y: t.y + t.w * 0.3 + lift };
        for (let i = 1; i <= 8; i++) await move({ x: from.x + ((end.x - from.x) * i) / 8, y: from.y - 20 + ((end.y - from.y + 20) * i) / 8 });
        await up();
        await page.waitForTimeout(600);
        ok((await page.locator(`[data-testid="${t.id}"] .stone-coin.is-leader`).count()) === 1, `${vp.label}: the leader dropped off-centre lands on ${t.key}`);
      } else console.log(`info ${vp.label}: leader not affordable`);
    }
    ok(errs.length === 0, `${vp.label}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`summary: ${summary.join(' · ')}`);
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
