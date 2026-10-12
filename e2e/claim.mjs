// Claiming a money tile shows Claimed! +N, a rim and a pennant. Dev server only.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = process.env.SHOTS || '/workspace/art-fixes/preview';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const p = await b.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
p.setDefaultTimeout(8000);
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.addInitScript(() => localStorage.setItem('dusthex.seenPrimer', '1'));
await p.goto(`${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy&deal=billy,belle,sam-bass,black-bart&money=30`, { waitUntil: 'load' });
await p.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 30000 });
for (let i = 0; i < 2; i++) {
  await p.locator('[data-testid^="hand-"].kind-unit.is-draggable').first().click(); await p.waitForTimeout(150);
  await p.locator('.stone.legal-tile:not(.has-unit)').nth(i === 0 ? 0 : 0).click();
   await p.waitForTimeout(900);
}
await p.locator('[data-testid="end-turn"]').click();
await p.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 40000 });
await p.waitForTimeout(1500);
let popped = false;
for (let turn = 0; turn < 4 && !popped; turn++) {
  const uids = await p.$$eval('.stone-coin.coin-mine.can-step', (els) => els.map((e) => e.dataset.uid));
  let fallback = null;
  for (const uid of uids) {
    await p.locator(`[data-uid="${uid}"]`).click({ force: true }); await p.waitForTimeout(200);
    const t = p.locator('.stone.legal-move:has(.resource-mark)').first();
    if (await t.count()) {
      await p.locator('[data-testid="board"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await t.click({ force: true });
      await p.waitForSelector('[data-testid="claim-pop"]', { timeout: 3000 });
      await p.waitForTimeout(350);
      await p.locator('.bf-board-socket').screenshot({ path: `${OUT}/dusthex_capture_moment.png` });
      popped = true;
      break;
    }
    if (!fallback && (await p.locator('.stone.legal-move').count())) fallback = uid;
    await p.locator('.shell-brand').click(); await p.waitForTimeout(150);
  }
  if (popped) break;
  if (fallback) {
    await p.locator(`[data-uid="${fallback}"]`).click({ force: true }); await p.waitForTimeout(200);
    await p.locator('.stone.legal-move').first().click({ force: true }); await p.waitForTimeout(800);
  }
  await p.locator('[data-testid="end-turn"]').click();
  await p.waitForSelector('[data-testid="end-turn"]:not([disabled])', { timeout: 40000 });
  await p.waitForTimeout(1500);
}
await p.waitForTimeout(2000);
await p.locator('.bf-board-socket').screenshot({ path: `${OUT}/dusthex_capture_held.png` });
const flags = await p.locator('.claim-flag.is-blue').count();
console.log(JSON.stringify({ popped, flags, errs }));
await b.close(); process.exit(popped && flags && !errs.length ? 0 : 1);
