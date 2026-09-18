import { expect, test } from '@playwright/test';

test('landing page shows the verified DealerADMIN stack', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '¿Qué hace dealerADMIN por tu operación?' })).toBeVisible();
  await expect(page.getByText('Stack de la automatización')).toBeVisible();
  await expect(page.getByText('Python media-worker')).toBeVisible();
  await expect(page.getByText('Docker', { exact: true })).toBeVisible();
  await expect(page.getByText('GitHub Actions', { exact: true })).toBeVisible();
  await expect(page.getByText('faster-whisper')).toBeVisible();
  await expect(page.getByText('PaddleOCR + Tesseract')).toBeVisible();
  await expect(page.getByText('PyTorch CPU')).toBeVisible();
  await expect(page.getByText('Transformers')).toBeVisible();
  await expect(page.getByText('SmolVLM local')).toBeVisible();
});

test.describe('landing responsive layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

  test('keeps the explanatory content readable on mobile without horizontal overflow', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '¿Qué hace dealerADMIN por tu operación?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir la consola operativa' }).first()).toBeVisible();

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  });
});
