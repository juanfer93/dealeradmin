import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const baseURL = process.env.QA_FRONTEND_URL || 'http://127.0.0.1:3000';
const username = process.env.QA_ADMIN_USERNAME || 'qa-admin';
const password = process.env.QA_ADMIN_PASSWORD;
if (!password) throw new Error('QA_ADMIN_PASSWORD must be injected by the test process.');

await mkdir('tmp/qa-e2e-local-20260912', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /ingresar|sign in/i }).click();
  await page.waitForURL(/\/app(?:\?|$)/, { timeout: 10_000 });
  console.log(JSON.stringify({ after_login_url: page.url(), body_preview: (await page.locator('body').innerText()).slice(0, 500) }));
  await page.getByRole('heading', { name: /lead work queue|cola de trabajo de leads/i }).waitFor();
  const fredericksburg = page.getByRole('button', { name: /Offlease Fredericksburg/i }).first();
  await fredericksburg.waitFor();
  await fredericksburg.click();
  await page.locator('table').getByText('Ana Fred', { exact: true }).waitFor();
  const bodyText = await page.locator('body').innerText();
  const hasQueuedLead = /Stale Exactly|Ana Fred|Duplicate Buyer|Lead work queue|Cola de trabajo de leads/i.test(bodyText);
  if (!hasQueuedLead) throw new Error('Authenticated queue did not render a local QA lead.');
  await page.screenshot({ path: 'tmp/qa-e2e-local-20260912/frontend-dashboard.png', fullPage: true });
  const result = { login_status: 'PASS', dashboard_status: 'PASS', url: page.url(), has_local_qa_lead: hasQueuedLead, screenshot: 'tmp/qa-e2e-local-20260912/frontend-dashboard.png' };
  await writeFile('tmp/qa-e2e-local-20260912/frontend-result.json', JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
