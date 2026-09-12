import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const baseURL = process.env.QA_FRONTEND_URL || 'http://127.0.0.1:3000';
const username = process.env.QA_ADMIN_USERNAME || 'qa-admin';
const password = process.env.QA_ADMIN_PASSWORD;
if (!password) throw new Error('QA_ADMIN_PASSWORD must be injected by the test process.');

await mkdir('tmp/qa-whatsapp-stafford-20260912', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /ingresar|sign in/i }).click();
  await page.waitForURL(/\/app(?:\?|$)/, { timeout: 10_000 });
  await page.getByRole('heading', { name: /lead work queue|cola de trabajo de leads/i }).waitFor();
  const stafford = page.getByRole('button', { name: /Offlease Motors Stafford/i }).first();
  await stafford.waitFor();
  await stafford.click();
  const table = page.getByRole('table');
  await table.getByText('+12405552001', { exact: true }).waitFor();
  const mustangRows = table.getByText('Mustang', { exact: true });
  await mustangRows.first().waitFor();
  await page.screenshot({ path: 'tmp/qa-whatsapp-stafford-20260912/frontend-stafford-dashboard.png', fullPage: true });
  const result = {
    login_status: 'PASS',
    dashboard_status: 'PASS',
    url: page.url(),
    selected_dealer: 'Offlease Motors Stafford',
    qa_phone_visible: true,
    qa_vehicle_visible: true,
    screenshot: 'tmp/qa-whatsapp-stafford-20260912/frontend-stafford-dashboard.png',
  };
  await writeFile('tmp/qa-whatsapp-stafford-20260912/frontend-result.json', JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
