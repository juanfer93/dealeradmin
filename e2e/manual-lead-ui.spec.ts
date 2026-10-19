import { test, expect } from './test';

test('el operador puede crear un lead manual y verlo en la cola del dealer activo', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login');
  await page.fill('input[name="username"]', 'operator');
  await page.fill('input[name="password"]', 'test-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole('button', { name: /^Offlease Motors Stafford\s+\d+$/ }).click();
  await page.getByRole('button', { name: /Agregar lead manual/i }).click();

  const modal = page.getByRole('dialog', { name: 'Agregar lead manual' });
  await expect(modal).toBeVisible();
  await modal.getByLabel(/Nombre completo/).fill('Pedro E2E');
  await modal.getByLabel(/Teléfono móvil/).fill('3019876545');
  await modal.getByLabel(/Tipo de vehículo/).fill('Troca');
  await modal.getByLabel(/Identificación/).fill('LIC-9900');
  await modal.getByRole('button', { name: 'Agregar lead' }).click();

  await expect(modal).not.toBeVisible();
  const leadRow = page.locator('tr').filter({ hasText: 'Pedro E2E' });
  await expect(leadRow).toBeVisible();
  await expect(leadRow).toContainText('+13019876545');
  await expect(leadRow).toContainText('down no indicado');
  await expect(leadRow).toContainText('documentos no indicados');
  await expect(leadRow).toContainText('ID: LIC-9900');

  await leadRow.getByRole('button', { name: 'Copiar' }).click();
  await expect(page.getByRole('button', { name: '¡Copiado!' })).toBeVisible();
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe('Pedro E2E +13019876545, Troca, ID: LIC-9900.');
});

test('la copia E2E omite el no down payment y limpia el prefijo de compra al explorar opciones', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login');
  await page.fill('input[name="username"]', 'operator');
  await page.fill('input[name="password"]', 'test-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole('button', { name: /^Offlease Motors Stafford\s+\d+$/ }).click();
  await page.getByRole('button', { name: /Agregar lead manual/i }).click();
  const modal = page.getByRole('dialog', { name: 'Agregar lead manual' });
  await modal.getByLabel(/Nombre completo/).fill('Elena Opciones');
  await modal.getByLabel(/Teléfono móvil/).fill('3019876544');
  await modal.getByLabel(/Tipo de vehículo/).fill('SUV');
  await modal.getByLabel(/Down payment/).fill('No tengo down payment');
  await modal.getByLabel(/Línea de tiempo de compra/).fill('quiere comprar explorando opciones');
  await modal.getByRole('button', { name: 'Agregar lead' }).click();

  const leadRow = page.locator('tr').filter({ hasText: 'Elena Opciones' });
  await expect(leadRow).toBeVisible();
  await expect(leadRow).toContainText('down no indicado');
  await expect(leadRow).toContainText('Quiere ver opciones');
  await expect(leadRow).not.toContainText('quiere comprar');
  await leadRow.getByRole('button', { name: 'Copiar' }).click();
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe('Elena Opciones +13019876544, SUV, Quiere ver opciones.');
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.not.toContain('down');
});

test('la copia reemplaza un nombre técnico antiguo por el nombre actual del lead', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login');
  await page.fill('input[name="username"]', 'operator');
  await page.fill('input[name="password"]', 'test-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole('button', { name: /^Offlease Motors Stafford\s+\d+$/ }).click();
  await page.getByRole('button', { name: /Agregar lead manual/i }).click();
  const modal = page.getByRole('dialog', { name: 'Agregar lead manual' });
  await modal.getByLabel(/Nombre completo/).fill('Reyna Lizeth E2E');
  await modal.getByLabel(/Teléfono móvil/).fill('5716913408');
  await modal.getByLabel(/Tipo de vehículo/).fill('Nissan Altima');
  await modal.getByLabel(/Down payment/).fill('3500');
  await modal.getByRole('button', { name: 'Agregar lead' }).click();
  await expect(page.locator('tr').filter({ hasText: 'Reyna Lizeth E2E' })).toBeVisible();

  await page.route('**/api/leads**', async (route) => {
    if (!route.request().url().includes('status=pending')) return route.continue();
    const response = await route.fetch();
    const body = await response.json() as { leads: Array<{ name: string; phone: string; messageText: string }> };
    const leads = body.leads.map((lead) => lead.name === 'Reyna Lizeth E2E'
      ? { ...lead, messageText: `Me Puede Enviar Fotos ${lead.phone} Nissan Altima, 3500 de down.` }
      : lead);
    await route.fulfill({ response, json: { ...body, leads } });
  });
  await page.reload();
  await page.getByRole('button', { name: /^Offlease Motors Stafford\s+\d+$/ }).click();
  const leadRow = page.locator('tr').filter({ hasText: 'Reyna Lizeth E2E' });
  await expect(leadRow).toBeVisible();
  await leadRow.getByRole('button', { name: 'Copiar' }).click();
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe('Reyna Lizeth E2E +15716913408 Nissan Altima, 3500 de down.');
});
