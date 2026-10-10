import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const baseUrl = process.env.QA_FRONTEND_URL ?? 'http://127.0.0.1:3005';
const password = process.env.QA_ADMIN_PASSWORD;
if (!password) throw new Error('QA_ADMIN_PASSWORD is required');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const result = { url: baseUrl, screenshot: null, visible: false, error: null, stage: 'init' };

try {
  result.stage = 'login-page';
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.locator('#username').fill('operator');
  await page.locator('#password').fill(password);
  result.stage = 'submit-login';
  await page.getByRole('button', { name: /ingresar|sign in|login/i }).click();
  await page.waitForURL(/\/app/);
  result.stage = 'dashboard';
  await page.getByRole('heading', { name: /cola de trabajo de leads|lead work queue/i }).waitFor();
  await page.waitForTimeout(1000);
  await writeFile(new URL('dashboard-debug.txt', import.meta.url), await page.locator('body').innerText());
  await writeFile(new URL('dashboard-buttons.json', import.meta.url), JSON.stringify(await page.getByRole('button').allTextContents(), null, 2));

  result.stage = 'select-arlington';
  const arlington = page.getByRole('button', { name: /Arlington Motors of Woodbridge/i }).first();
  if (await arlington.count()) {
    await arlington.click();
    await page.waitForTimeout(500);
  }

  result.stage = 'find-gabriel';
  await page.getByRole('table').getByText('Gabriel Gonzalez', { exact: true }).waitFor({ timeout: 10000 });
  const bodyText = await page.locator('body').innerText();
  result.visible = /Gabriel Gonzalez/.test(bodyText) && /Chevrolet Camaro 2LT/i.test(bodyText) && /esta semana/i.test(bodyText);
  result.screenshot = 'frontend-arlington.png';
  await page.screenshot({ path: fileURLToPath(new URL(result.screenshot, import.meta.url)), fullPage: true });
} catch (error) {
  result.error = String(error?.stack ?? error);
  throw error;
} finally {
  if (result.stage !== 'done' && !result.visible) result.error = result.error ?? 'capture did not reach the expected final state';
  await writeFile(new URL('frontend-result.json', import.meta.url), JSON.stringify(result, null, 2));
  await browser.close();
}

result.stage = 'done';
if (!result.visible) throw new Error(`Expected repaired Gabriel qualification was not visible: ${JSON.stringify(result)}`);
console.log(JSON.stringify({ result: 'PASS', ...result }));
