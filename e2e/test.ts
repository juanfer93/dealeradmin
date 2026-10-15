import { test as base, expect, type Page } from '@playwright/test';

export const test = base;

test.beforeEach(async ({ page, request }) => {
  page.on('pageerror', (error) => console.error(`[browser pageerror] ${error.stack || error.message}`));
  const response = await request.post('http://127.0.0.1:3010/api/test/reset');
  if (!response.ok()) {
    throw new Error(`Unable to reset E2E fixtures: ${response.status()} ${await response.text()}`);
  }
});

export { expect };

export async function getDealerId(page: Page, name: string): Promise<string> {
  const dealerId = await page.evaluate(async (dealerName) => {
    const response = await fetch('/api/dealers', { credentials: 'include' });
    if (!response.ok) throw new Error(`Unable to load dealers: ${response.status}`);
    const dealers = await response.json() as Array<{ id: string; name: string }>;
    return dealers.find((dealer) => dealer.name === dealerName)?.id ?? null;
  }, name);
  if (!dealerId) throw new Error(`Dealer not found in E2E fixture: ${name}`);
  return dealerId;
}
