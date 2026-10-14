import { expect, test } from '@playwright/test';

test('local storage failure stays compact and does not leave setup', async ({ page }) => {
  await page.route('**/api/rpc/load_settings', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), api_key: '', has_protected_key: false } });
  });
  await page.route('**/api/rpc/save_settings', async route => {
    await route.fulfill({ json: { ok: false, error: 'Impossibile salvare la chiave.' } });
  });
  await page.goto('/');
  await page.getByLabel('Chiave API Gemini', { exact: true }).fill('AQ.abcdefghijklmnopqrstuvwxyz012345');
  await page.getByRole('button', { name: 'Salva e inizia' }).click();
  await expect(page.getByRole('alert')).toContainText('Impossibile salvare');
  await expect(page.getByText(/Formato valido/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Configura la tua API Key' })).toBeVisible();
  const notice = await page.locator('.setup-error-notice').boundingBox();
  expect(notice!.height).toBeLessThan(60);
});

test('saving the key opens the queue directly without model verification', async ({ page }) => {
  const remoteChecks: string[] = [];
  page.on('request', request => {
    if (/\/api\/rpc\/(verify_model_access|validate_environment)$/.test(request.url())) {
      remoteChecks.push(request.url());
    }
  });
  await page.route('**/api/rpc/load_settings', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), api_key: '', has_protected_key: false } });
  });
  await page.route('**/api/rpc/save_settings', async route => {
    await route.fulfill({ json: { ok: true, credential_storage: { primary: 'secure', fallback: 'absent' } } });
  });
  await page.goto('/');
  await page.getByLabel('Chiave API Gemini', { exact: true }).fill('AQ.abcdefghijklmnopqrstuvwxyz012345');
  await page.getByRole('button', { name: 'Salva e inizia' }).click();
  await expect(page.getByRole('heading', { name: 'Configura la tua API Key' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Accesso ai modelli' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continua', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Impostazioni/i }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verifica modelli', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Accesso ai modelli' })).toHaveCount(0);
  expect(remoteChecks).toEqual([]);
});
