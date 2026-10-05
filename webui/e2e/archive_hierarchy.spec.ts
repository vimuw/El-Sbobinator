import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('Enter opens collection options without navigating and still opens a focused collection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Archivio', exact: true }).waitFor();
  await page.evaluate(async () => {
    await window.pywebview?.api?.save_archive_folders?.([
      { id: 'keyboard-course', name: 'Raccolta da tastiera', color: '', session_dirs: [] },
    ]);
  });
  await page.reload();
  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  const collections = page.getByRole('region', { name: 'Raccolte' });
  await collections.getByRole('button', { name: 'Altre opzioni', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Modifica', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Archivio Sbobine' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Raccolta da tastiera', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await collections.locator('[aria-roledescription="sortable"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Raccolta da tastiera', exact: true })).toBeVisible();
});

test('organizes archive lessons in nested collections and persists moves across reloads', async ({ page }, testInfo) => {
  const fixturePath = testInfo.outputPath('microbiologia.wav');
  fs.writeFileSync(fixturePath, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await page.goto('/');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles(fixturePath);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.getByText('Sbobine completate')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Pulisci tutto' }).click();
  await page.getByRole('button', { name: 'Conferma pulizia' }).click();
  const seeded = await page.evaluate(async () => {
    const response = await window.pywebview?.api?.get_completed_sessions?.(10);
    const session = response?.sessions?.[0];
    if (!session) throw new Error('Missing simulated archive session');
    const folders = [
      { id: 'year', name: '3° anno', color: '', session_dirs: [] },
      { id: 'semester', name: '2° semestre', color: '', parent_id: 'year', session_dirs: [] },
      { id: 'course', name: 'Microbiologia', color: '#4D96FF', parent_id: 'semester', session_dirs: [] },
      { id: 'module', name: 'Modulo 1', color: '', parent_id: 'course', session_dirs: [session.session_dir] },
    ];
    await window.pywebview?.api?.save_archive_folders?.(folders);
    return session;
  });
  await page.reload();
  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  const collections = page.getByRole('region', { name: 'Raccolte' });
  await expect(collections.getByText('3° anno', { exact: true })).toBeVisible();
  await expect(collections.getByText('Microbiologia', { exact: true })).toHaveCount(0);
  await expect(page.locator('.folder-indicator-chip').first()).toHaveAttribute('title', 'Raccolta: 3° anno › 2° semestre › Microbiologia › Modulo 1');
  await collections.getByText('3° anno', { exact: true }).click();
  await collections.getByText('2° semestre', { exact: true }).click();
  await collections.getByText('Microbiologia', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Microbiologia', exact: true })).toBeVisible();
  await expect(collections.getByText('Modulo 1', { exact: true })).toBeVisible();
  await expect(page.locator('.archive-session-card p').filter({ hasText: seeded.name }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('nested-collections-desktop.png') });

  await collections.getByText('Modulo 1', { exact: true }).click();
  await page.getByRole('button', { name: `Seleziona ${seeded.name}`, exact: true }).click();
  await page.getByTitle('Sposta le sbobine selezionate in una raccolta').click();
  const dialog = page.getByRole('dialog', { name: 'Sposta in…' });
  await dialog.getByRole('button', { name: 'Microbiologia', exact: true }).click();
  await dialog.getByRole('button', { name: 'Nuova raccolta…' }).click();
  await dialog.getByLabel('Nome raccolta').fill('Modulo 2');
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('move-dialog-narrow.png') });
  expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  await dialog.getByRole('button', { name: 'Sposta qui' }).click();
  await expect.poll(async () => page.evaluate(async () => (await window.pywebview?.api?.get_archive_folders?.())?.folders?.find(folder => folder.name === 'Modulo 2')?.session_dirs)).toEqual([seeded.session_dir]);

  await page.getByLabel('Torna al livello superiore').click();
  await expect(collections.getByText('Modulo 2', { exact: true })).toBeVisible();
  await expect(collections.locator('.folder-card', { hasText: 'Modulo 2' })).toHaveCSS('--folder-color', '#4D96FF');
  await page.setViewportSize({ width: 640, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('nested-collections-narrow.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);

  await page.reload();
  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  await collections.getByText('3° anno', { exact: true }).click();
  await collections.getByText('2° semestre', { exact: true }).click();
  await collections.getByText('Microbiologia', { exact: true }).click();
  await collections.getByText('Modulo 2', { exact: true }).click();
  await expect(page.locator('.archive-session-card p').filter({ hasText: seeded.name }).first()).toBeVisible();
  const saved = await page.evaluate(async () => (await window.pywebview?.api?.get_archive_folders?.())?.folders);
  expect(saved?.find(folder => folder.id === 'module')?.session_dirs).toEqual([]);
  expect(saved?.find(folder => folder.name === 'Modulo 2')).toMatchObject({ color: '', parent_id: 'course', session_dirs: [seeded.session_dir] });

  await page.getByLabel('Torna al livello superiore').click();
  await page.getByLabel('Altre opzioni').first().click();
  await page.getByText('Sposta in…', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Archivio', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sposta qui' }).click();
  await expect.poll(async () => page.evaluate(async () => (await window.pywebview?.api?.get_archive_folders?.())?.folders?.find(folder => folder.id === 'course')?.parent_id)).toBeNull();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Percorso della raccolta' }).getByRole('button', { name: 'Archivio', exact: true }).click();
  await expect(collections.getByText('Microbiologia', { exact: true })).toBeVisible();
  await collections.getByText('Microbiologia', { exact: true }).click();
  await expect(collections.getByText('Modulo 2', { exact: true })).toBeVisible();
  await expect(page.locator('.archive-session-card p').filter({ hasText: seeded.name }).first()).toBeVisible();
});
