import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const baseUrl = process.env.QA_FRONTEND_URL ?? 'http://127.0.0.1:3006';
const password = process.env.QA_ADMIN_PASSWORD;
if (!password) throw new Error('QA_ADMIN_PASSWORD is required');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
try {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.locator('#username').fill('operator');
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /ingresar|sign in|login/i }).click();
  await page.waitForURL(/\/app/);
  await page.getByRole('heading', { name: /cola de trabajo de leads|lead work queue/i }).waitFor();
  await page.getByRole('button', { name: /Offlease Motors Stafford/i }).first().click();
  await page.getByText('Rafael Soto', { exact: true }).last().waitFor({ timeout: 10000 });
  const bodyText = await page.locator('body').innerText();
  if (!/Toyota Tacoma/i.test(bodyText) || !/esta semana/i.test(bodyText)) throw new Error('Stafford qualification not visible');
  const screenshotPath = fileURLToPath(new URL('frontend-stafford.png', import.meta.url));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(new URL('frontend-stafford-result.json', import.meta.url), JSON.stringify({ result: 'PASS', url: baseUrl, screenshot: 'frontend-stafford.png' }, null, 2));
  console.log(JSON.stringify({ result: 'PASS', screenshot: 'frontend-stafford.png' }));
} finally {
  await browser.close();
}
