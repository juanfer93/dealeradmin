import { test as base, expect } from '@playwright/test';

export const test = base;

test.beforeEach(async ({ request }) => {
  const response = await request.post('http://127.0.0.1:3010/api/test/reset');
  if (!response.ok()) {
    throw new Error(`Unable to reset E2E fixtures: ${response.status()} ${await response.text()}`);
  }
});

export { expect };
