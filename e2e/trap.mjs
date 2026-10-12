// Trap reveal: dev server only (?trapdemo). Phone portrait screenshot + tap-to-dismiss queue.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = process.env.OUT || '/workspace/art-fixes/preview/dusthex_trap_reveal_phone.png';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.addInitScript(() => localStorage.setItem('dusthex.seenPrimer', '1'));
await p.goto(`${BASE}/?side=gang&rival=lodge&map=gallows-mesa&mind=easy&trapdemo=1`, { waitUntil: 'load' });
await p.waitForSelector('[data-testid="trap-reveal"]');
await p.waitForTimeout(1200);
const t1 = await p.textContent('[data-testid="trap-reveal"]');
await p.screenshot({ path: OUT });
await p.tap('[data-testid="trap-reveal"]');
await p.waitForTimeout(300);
const t2 = await p.textContent('[data-testid="trap-reveal"]').catch(() => '');
let fail = 0;
if (!t1.includes('Frank James is down')) { console.log('FAIL first', t1); fail++; }
if (!t2.includes('Alkali Sink')) { console.log('FAIL queue', t2); fail++; }
await p.waitForTimeout(6500);
if (await p.locator('[data-testid="trap-reveal"]').count()) { console.log('FAIL auto-dismiss'); fail++; }
console.log(fail ? 'FAILED' : 'ok trap reveal');
await b.close(); process.exit(fail ? 1 : 0);
