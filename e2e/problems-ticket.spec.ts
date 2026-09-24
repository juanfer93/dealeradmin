import { test, expect } from './test';

test('el operador genera y descarga un ticket Markdown como historia de usuario', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="username"]', 'operator');
  await page.fill('input[name="password"]', 'test-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole('link', { name: 'Problemas' }).click();
  await expect(page).toHaveURL(/\/app\/problems$/);
  await expect(page.getByRole('heading', { name: 'Reporta un problema' })).toBeVisible();

  await page.getByLabel(/Problema que está ocurriendo/).fill('El ticket debe conservar el contexto del problema.');
  await page.getByLabel(/^Evidencia/).fill('Conversación de prueba y pasos para reproducir.');
  await page.getByLabel(/^Alcance/).fill('Solo el módulo Problemas.');
  await page.getByLabel(/^Fuera de alcance/).fill('No tocar la cola de leads.');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar ticket Markdown' }).click();
  const download = await downloadPromise;

  await expect(page.getByRole('status')).toContainText('Ticket generado: ticket-0001.md');
  await expect(page.getByLabel('Tickets recientes').getByText('ticket-0001.md')).toBeVisible();
  expect(download.suggestedFilename()).toBe('ticket-0001.md');
});

test('el formulario exige el problema y no genera un ticket vacío', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="username"]', 'operator');
  await page.fill('input[name="password"]', 'test-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.getByRole('link', { name: 'Problemas' }).click();

  await page.getByRole('button', { name: 'Generar ticket Markdown' }).click();
  await expect(page.getByLabel(/Problema que está ocurriendo/)).toBeFocused();
  await expect(page.getByText(/Ticket generado:/)).toHaveCount(0);
});
