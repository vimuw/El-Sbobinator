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
  // Drive sync is available on the site: no "coming soon" left in the privacy page.
  await expect(privacy.getByRole('heading', { name: 'Google Drive (facoltativo)', exact: true })).toBeVisible();
  await expect(privacy.getByText(/in arrivo|non è ancora disponibile/i)).toHaveCount(0);
  // boot-theme.js ran: the only script, allowed by script-src 'self'.
  expect(await privacy.evaluate(() => document.documentElement.dataset.theme)).toMatch(/^(light|dark)$/);
  const csp = await privacy.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  await expect(privacy.getByRole('link', { name: 'El Sbobinator', exact: true })).toBeVisible();

  // Same look as the app in both themes: its tokens, its accent on links and its Manrope font.
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('el-sbobinator.theme.v1', value), theme);
    await page.reload();
    await privacy.reload();
    const appTokens = await page.evaluate(readTokens);
    const pageLook = await privacy.evaluate(async names => {
      await document.fonts.ready;
      const root = getComputedStyle(document.documentElement);
      const probe = (token: string, property: 'color' | 'backgroundColor') => {
        const element = document.createElement('span');
        element.style[property] = `var(${token})`;
        document.body.append(element);
        const value = getComputedStyle(element)[property];
        element.remove();
        return value;
      };
      const link = document.querySelector('article a')!;
      return {
        theme: document.documentElement.dataset.theme,
        tokens: Object.fromEntries(names.map(name => [name, root.getPropertyValue(name).trim()])),
        manrope: [...document.fonts].some(font => font.family.replace(/"/g, '') === 'Manrope' && font.status === 'loaded'),
        bodyFont: getComputedStyle(document.body).fontFamily,
        link: [getComputedStyle(link).color, probe('--accent-text', 'color')],
        background: [getComputedStyle(document.body).backgroundColor, probe('--bg-base', 'backgroundColor')],
        back: [getComputedStyle(document.querySelector('.back-button')!).backgroundColor, probe('--bg-surface', 'backgroundColor')],
      };
    }, Object.keys(appTokens));
    expect(pageLook.theme).toBe(theme);
    expect(pageLook.tokens).toEqual(appTokens);
    expect(pageLook.manrope).toBe(true);
    expect(pageLook.bodyFont).toMatch(/^"?Manrope/);
    expect(pageLook.link[0]).toBe(pageLook.link[1]);
    expect(pageLook.background[0]).toBe(pageLook.background[1]);
    expect(pageLook.back[0]).toBe(pageLook.back[1]);
  }
  expect([...app, ...violations]).toEqual([]);
});

function readTokens(): Record<string, string> {
  const root = getComputedStyle(document.documentElement);
  return Object.fromEntries(['--bg-base', '--bg-surface', '--text-primary', '--text-muted', '--accent-text', '--border-default', '--font-display']
    .map(name => [name, root.getPropertyValue(name).trim()]));
}
