import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 820 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:3018/qa-marie-flanagan.html', { waitUntil: 'load', timeout: 15000 });
await page.screenshot({ path: 'C:/dev/dealeradmin/tmp/qa-marie-flanagan-20260913/evidence-correction.png', fullPage: true });
await browser.close();
console.log('local-screenshot-created');
