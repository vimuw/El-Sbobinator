import { expect, test, type Page } from '@playwright/test';

// The old addresses cannot be reached from here: requests for https://www.elsbobinator.com are
// answered by the local preview server, and the official address by a stub page. Chromium only.
const OLD_ADDRESS = 'https://www.elsbobinator.com';
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';

function trackCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', message => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

async function serveOldAddress(page: Page, baseURL: string) {
  await page.route(`${OLD_ADDRESS}/**`, async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` }) });
  });
  await page.route('https://elsbobinator.com/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="it"><title>Indirizzo ufficiale</title><p>Indirizzo ufficiale</p></html>',
  }));
}

test('an empty browser on the old address moves to the same page on elsbobinator.com', async ({ page, baseURL }) => {
  await serveOldAddress(page, baseURL!);
  await page.goto(`${OLD_ADDRESS}/?simulazione=1`);

  await expect(page.getByText('Indirizzo ufficiale')).toBeVisible();
  expect(page.url()).toBe('https://elsbobinator.com/?simulazione=1');
});

test('a browser with work on the old address stays and asks for a backup', async ({ page, baseURL }) => {
  await serveOldAddress(page, baseURL!);
  // A lecture left in the queue on the old address: a redirect would hide it.
  await page.goto(`${OLD_ADDRESS}/version.json`);
  await page.evaluate(([key]) => {
    localStorage.setItem('el-sbobinator.web.gemini-keys.v1', key);
    localStorage.setItem('el-sbobinator.queue.v1', JSON.stringify([{ id: 'vecchia', name: 'Lezione vecchia.mp3', status: 'error', errorText: 'Interrotta' }]));
  }, [DUMMY_KEY]);
  await page.goto(`${OLD_ADDRESS}/`);

  const banner = page.getByRole('region', { name: 'El Sbobinator ora è su elsbobinator.com' });
  await expect(banner).toBeVisible();
  expect(new URL(page.url()).host).toBe('www.elsbobinator.com');
  await expect(banner.getByRole('link', { name: 'Vai a elsbobinator.com' })).toHaveAttribute('href', 'https://elsbobinator.com');

  await banner.getByRole('button', { name: 'Apri il backup' }).click();
  await expect(page.getByRole('heading', { name: 'Archiviazione', level: 2 })).toBeVisible();
  await expect(page.getByText('Backup delle sbobine')).toBeVisible();
});

test('the privacy page opens from the app under the site policy', async ({ page, context }) => {
  const app = trackCspViolations(page);
  await page.goto('/');
  // Not an old address: no notice.
  await expect(page.getByTestId('moved-address-banner')).toHaveCount(0);

  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Privacy' }).first().click();
  const privacy = await popup;
  const violations = trackCspViolations(privacy);
  await privacy.waitForLoadState();

  expect(new URL(privacy.url()).pathname).toBe('/privacy');
  await expect(privacy.getByRole('heading', { name: 'Informativa sulla privacy', level: 1 })).toBeVisible();
  await expect(privacy.getByRole('heading', { name: 'Google Drive (facoltativo, in arrivo)' })).toBeVisible();
  // boot-theme.js ran: the only script, allowed by script-src 'self'.
  expect(await privacy.evaluate(() => document.documentElement.dataset.theme)).toMatch(/^(light|dark)$/);
  const csp = await privacy.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect([...app, ...violations]).toEqual([]);
});
