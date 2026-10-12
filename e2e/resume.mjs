// Safety net: a reload mid-match and a render crash both land back in the same match. Dev server only.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:5173';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const p = await b.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
p.setDefaultTimeout(30000);
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
await p.addInitScript(() => localStorage.setItem('dusthex.seenPrimer', '1'));
await p.goto(`${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy&fast`, { waitUntil: 'load' });
await p.waitForSelector('[data-testid="end-turn"]:not([disabled])');
await p.locator('[data-testid="end-turn"]').click();
await p.waitForFunction(() => document.querySelector('[data-testid="turn-number"]')?.textContent === '3' && !document.querySelector('[data-testid="end-turn"][disabled]'));
const log1 = await p.locator('.chronicle, [data-testid="chronicle"]').first().textContent().catch(() => '');
// 1. Reload (what Android does after killing the tab, or a pull-to-refresh).
await p.goto(`${BASE}/`, { waitUntil: 'load' });
await p.waitForSelector('[data-testid="board"]', { timeout: 15000 }).catch(() => {});
ok(await p.locator('[data-testid="board"]').count(), 'reload mid-match reopens the match, not the title');
ok((await p.textContent('[data-testid="turn-number"]').catch(() => '')) === '3', 'same turn after reload');
// 2. A render crash recovers in place.
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.evaluate(() => { window.__dhCrashOnce = true; });
await p.locator('[data-testid="end-turn"]').click();
await p.waitForTimeout(2500);
ok(await p.locator('[data-testid="board"]').count(), 'render crash recovers to the board');
ok(!(await p.locator('.title-screen').count()), 'no title screen after a crash');
// 3. Leaving the match clears the save: a reload then shows the title.
await p.locator('[data-testid="back"]').click();
await p.waitForTimeout(500);
await p.goto(`${BASE}/`, { waitUntil: 'load' });
await p.waitForTimeout(1500);
ok(!(await p.locator('[data-testid="board"]').count()), 'after leaving, a reload does not resume');
await b.close();
process.exit(fail ? 1 : 0);
