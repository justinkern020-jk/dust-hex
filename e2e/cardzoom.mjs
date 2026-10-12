// Premium card view: Codex (several rarities, phone + desktop) and the battlefield coin peek. Dev server.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = process.env.SHOTS || '/workspace/art-fixes/preview';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
for (const [label, vp] of [['phone', { width: 393, height: 851, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }], ['desktop', { width: 1280, height: 900 }]]) {
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(`${BASE}/?codex`, { waitUntil: 'load' });
  await p.waitForSelector('[data-testid="codex-open"]');
  for (const name of ['Billy the Kid', 'Crazy Horse', 'Switchman', 'Cousin Jack']) {
    const tabs = await p.locator('.codex-tab').count();
    let found = false;
    for (let i = 0; i < tabs && !found; i++) {
      await p.locator('.codex-tab').nth(i).click();
      const e = p.locator(`[data-testid="codex-open"][aria-label="${name}"]`);
      if (await e.count()) { await e.first().click(); found = true; }
    }
    if (!found) continue;
    await p.waitForSelector('[data-testid="premium-card"]');
    await p.waitForTimeout(500);
    // Lean the light to one side, like a tilted phone.
    const box = await p.locator('[data-testid="premium-card"]').boundingBox();
    if (label === 'desktop') await p.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25);
    else await p.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: 45, gamma: 0 })))
      .then(() => p.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: 52, gamma: 14 }))));
    await p.waitForTimeout(300);
    const r = await p.locator('[data-testid="premium-card"]').getAttribute('data-rarity');
    const fit = box.width <= vp.width && box.x >= 0;
    ok(fit, `${label}: ${name} (${r}) card fits the screen (${Math.round(box.width)}x${Math.round(box.height)})`);
    await p.screenshot({ path: `${OUT}/dusthex_cardzoom_${label}_${r}.png` });
    await p.locator('.pc-close').click();
  }
  ok(!errs.length, `${label}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}
await b.close();
process.exit(fail ? 1 : 0);
