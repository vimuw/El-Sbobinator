import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// A dummy key in the right format: these tests never call Gemini (the run is the M0 simulation).
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';

function trackCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', message => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

async function saveKey(page: Page, url = '/') {
  await page.goto(url);
  await page.getByLabel('Chiave API Gemini').fill(DUMMY_KEY);
  await expect(page.getByTestId('setup-browser-key-note')).toBeVisible();
  await page.getByRole('button', { name: 'Salva e inizia' }).click();
  await expect(page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i })).toBeVisible();
}

test('runs the simulated pipeline and opens the sample document without a backend @web-smoke', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.setViewportSize({ width: 810, height: 1080 });
  await saveKey(page, '/?simulazione=1');

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'Lezione web.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048) });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();

  await expect(page.getByText('Trascrizione e sbobinatura')).toBeVisible();
  await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 20_000 });
  await page.locator('.queue-card.is-completed', { hasText: 'Lezione web.mp3' }).click();

  await expect(page.locator('.tiptap-editor h1')).toHaveText('Lezione web');
  // The player is docked with the file kept in this browser (blob: URL allowed by the CSP).
  await expect(page.locator('.editor-player-dock audio')).toHaveAttribute('src', /^blob:/);
  // iPad portrait width: the page fits without sideways scrolling.
  const overflow = await page.locator('.editor-page-container').evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The document stays in this browser across a reload.
  await page.getByRole('button', { name: 'Torna indietro' }).click();
  // Closing steps back in the history: let it land before reloading.
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await page.reload();
  await expect(page.locator('.queue-card.is-completed', { hasText: 'Lezione web.mp3' })).toBeVisible();
  expect(violations).toEqual([]);
});

// Regression: the report email opened in place (location.href = mailto:). Chromium fired
// beforeunload, so mid-run the browser asked "Leave site?"; with a web mail handler (Gmail, Outlook
// registered in the browser) the app tab itself became the mail site and the run stopped. Full
// Chromium with its own profile, the only one that keeps a registered handler. This build has no
// Sentry DSN, so the sidebar button writes an email.
const MAIL_HANDLER = 'https://mail.example/compose?u=%s';
for (const webHandler of [true, false]) {
  test(`opens the report email in a new tab during a run, ${webHandler ? 'with' : 'without'} a web mail handler @web-smoke`, async ({ playwright, baseURL }, testInfo) => {
    const profile = testInfo.outputPath('profile');
    mkdirSync(path.join(profile, 'Default'), { recursive: true });
    if (webHandler) {
      writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
        custom_handlers: {
          enabled: true,
          registered_protocol_handlers: [{ default: true, protocol: 'mailto', url: MAIL_HANDLER, last_modified: '13300000000000000' }],
        },
      }));
    }
    const context = await playwright.chromium.launchPersistentContext(profile, { channel: 'chromium', baseURL });
    try {
      await context.route('https://mail.example/**', route => route.fulfill({ contentType: 'text/html', body: 'Posta' }));
      await context.addInitScript(() => {
        addEventListener('beforeunload', () => {
          const page = window as unknown as { leaveAttempts?: number };
          page.leaveAttempts = (page.leaveAttempts ?? 0) + 1;
        });
      });
      const page = context.pages()[0] ?? await context.newPage();
      const dialogs: string[] = [];
      page.on('dialog', dialog => {
        dialogs.push(dialog.type());
        void dialog.dismiss();
      });
      await saveKey(page, '/?simulazione=1');

      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
      const chooser = await chooserPromise;
      await chooser.setFiles({ name: 'Lezione email.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048) });
      await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
      await expect(page.getByText('Trascrizione e sbobinatura')).toBeVisible();

      const address = page.url();
      const mailTab = webHandler ? context.waitForEvent('page') : null;
      await page.getByRole('button', { name: 'Segnala un problema' }).click();
      // No feedback window in an email build: the button only opens the email.
      await expect(page.getByRole('dialog', { name: 'Segnala un problema' })).toHaveCount(0);
      if (mailTab) {
        // The mail site opens in its own tab.
        await expect.poll(async () => (await mailTab).url()).toMatch(/^https:\/\/mail\.example\/compose\?u=mailto%3Asupporto%40elsbobinator\.com/);
      }
      await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 20_000 });
      expect(page.url()).toBe(address);
      expect(await page.evaluate(() => (window as unknown as { leaveAttempts?: number }).leaveAttempts ?? 0)).toBe(0);
      expect(dialogs).toEqual([]);
      // Without a web handler no empty tab is left behind.
      expect(context.pages()).toHaveLength(webHandler ? 2 : 1);
    } finally {
      await context.close();
    }
  });
}

test('settings keep keys in the browser and hide desktop-only sections @web-smoke', async ({ page }) => {
  await saveKey(page);
  await page.getByRole('button', { name: 'Apri impostazioni' }).click();

  // The desktop key list: the saved key as a masked row, an add field and the quota matrix.
  await expect(page.getByText('Principale', { exact: true })).toBeVisible();
  await expect(page.getByText(`...${DUMMY_KEY.slice(-4)}`)).toBeVisible();
  await expect(page.getByLabel('Nuova chiave di riserva')).toBeVisible();
  await expect(page.getByText('Quote per modello')).toBeVisible();
  await expect(page.getByTestId('shared-device-warning')).toBeVisible();
  await expect(page.getByText('Versione e aggiornamenti')).toHaveCount(0);
  await expect(page.getByText('Notifiche di sistema')).toHaveCount(0);

  await page.getByRole('button', { name: 'Rimuovi la chiave', exact: true }).click();
  await page.getByRole('button', { name: 'Rimuovi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configura la tua API Key' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('el-sbobinator.web.gemini-keys.v1'))).toBeNull();
});

// iPad Safari's 100vh includes the area behind its toolbars and cut off the sidebar bottom and the
// footer links. Chromium has no such toolbars, so this checks the layout follows the visible
// height (dvh) and that the bottom controls are on screen at tablet sizes, including a short one.
for (const viewport of [{ width: 810, height: 1080 }, { width: 810, height: 700 }]) {
  test(`sidebar bottom and footer links stay on screen at ${viewport.width}x${viewport.height} @web-smoke`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await saveKey(page);

    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim())).toBe('100dvh');
    for (const control of [
      page.getByRole('button', { name: 'Apri impostazioni' }),
      page.getByRole('button', { name: 'Apri notifiche' }),
      page.getByRole('button', { name: 'Segnala un problema' }),
      page.getByRole('link', { name: 'Progetto Open-Source — GitHub' }),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
  });
}
