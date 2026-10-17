import { expect, test } from '@playwright/test';

test('renames archived lessons in root and collections while preserving files and completion dates', async ({ page }, testInfo) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles({
    name: 'Lezione originale.wav', mimeType: 'audio/wav',
    buffer: Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'),
  });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.getByText('Sbobine completate')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Pulisci tutto' }).click();
  await page.getByRole('button', { name: 'Conferma pulizia' }).click();
  const original = await page.evaluate(async () => {
    const listing = await window.pywebview?.api?.get_completed_sessions?.(0);
    const session = listing?.sessions?.[0];
    if (!session) throw new Error('Missing completed lesson');
    const html = await window.pywebview?.api?.read_html_content?.(session.html_path);
    await window.pywebview?.api?.save_archive_folders?.([{ id: 'course', name: 'Corso di anatomia', color: '', session_dirs: [session.session_dir] }]);
    return { session, html };
  });
  await page.reload();
  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  const card = page.locator('.archive-session-card').filter({ has: page.getByRole('button', { name: 'Altre opzioni' }) }).first();
  await card.getByRole('button', { name: 'Altre opzioni' }).click();
  await page.getByRole('button', { name: 'Rinomina', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rinomina sbobina' });
  const input = dialog.getByLabel('Nome sbobina');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(original.session.name);
  await input.fill('  Anatomia: articolazioni e mobilità  ');
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText('Anatomia: articolazioni e mobilità');
  await page.reload();
  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  await page.getByPlaceholder('Cerca per nome...').fill('articolazioni');
  await expect(card).toContainText('Anatomia: articolazioni e mobilità');
  await page.getByPlaceholder('Cerca per nome...').fill('');
  await page.getByRole('region', { name: 'Raccolte' }).getByText('Corso di anatomia', { exact: true }).click();
  await card.getByRole('button', { name: 'Altre opzioni' }).click();
  await page.getByRole('button', { name: 'Rinomina', exact: true }).click();
  await input.fill('');
  await expect(dialog.getByRole('button', { name: 'Salva', exact: true })).toBeDisabled();
  await input.fill('Nome provvisorio');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText('Anatomia: articolazioni e mobilità');
  await expect(card.getByRole('button', { name: 'Altre opzioni' })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await card.getByRole('button', { name: 'Altre opzioni' }).click();
  await page.getByRole('button', { name: 'Rinomina', exact: true }).click();
  await input.fill('Anatomia – lezione 2: perché si muovono le articolazioni');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Annulla' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Salva', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Chiudi finestra' })).toBeFocused();
  await expect(dialog).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('rename-mobile.png') });
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const persisted = await page.evaluate(async () => {
    const listing = await window.pywebview?.api?.get_completed_sessions?.(0);
    const session = listing?.sessions?.[0];
    if (!session) throw new Error('Missing renamed lesson');
    return { session, html: await window.pywebview?.api?.read_html_content?.(session.html_path), folders: await window.pywebview?.api?.get_archive_folders?.() };
  });
  expect(persisted.session.name).toBe('Anatomia – lezione 2: perché si muovono le articolazioni');
  expect(persisted.session).toMatchObject({
    session_dir: original.session.session_dir, html_path: original.session.html_path,
    input_path: original.session.input_path, input_name: original.session.input_name,
    completed_at_iso: original.session.completed_at_iso,
  });
  expect(persisted.html).toEqual(original.html);
  expect(persisted.folders?.folders?.[0].session_dirs).toEqual([original.session.session_dir]);
  await page.reload();
  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  await expect(page.locator('.archive-session-card').first()).toContainText(persisted.session.name);
});
