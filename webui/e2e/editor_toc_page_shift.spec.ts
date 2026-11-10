import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

// As in Google Docs, opening the index never narrows the page: it moves the page right, and the
// editor scrolls sideways when the window has no room for both. The text does not rewrap, so the
// line being read stays where it was.
test('the open index moves the page instead of narrowing it', async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const audio = info.outputPath('toc-page-shift.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'toc-page-shift.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  await page.locator('.tiptap-editor').evaluate(root => {
    const content = '<h1>Fisiopatologia generale</h1>' + Array.from({ length: 20 }, (_, i) =>
      `<h2>Sezione ${i + 1}</h2><p>${'Il nefrone filtra il sangue e riassorbe i soluti lungo il tubulo. '.repeat(6)}</p>`).join('');
    (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content);
  });

  const layout = () => page.locator('.editor-page-container').evaluate(container => {
    const sheet = container.querySelector('.editor-page')!.getBoundingClientRect();
    const heading = Array.from(container.querySelectorAll('h2')).find(h => h.textContent === 'Sezione 8')!;
    return {
      left: Math.round(sheet.left - container.getBoundingClientRect().left),
      width: Math.round(sheet.width),
      overflow: container.scrollWidth - container.clientWidth,
      scrollLeft: container.scrollLeft,
      heading: Math.round(heading.getBoundingClientRect().top - container.getBoundingClientRect().top),
    };
  });
  await page.locator('.editor-page-container').evaluate(container => {
    const heading = Array.from(container.querySelectorAll('h2')).find(h => h.textContent === 'Sezione 8')!;
    container.scrollTop += heading.getBoundingClientRect().top - container.getBoundingClientRect().top - 40;
  });
  const closed = await layout();
  expect(closed.width).toBe(794);
  expect(closed.overflow).toBe(0);

  await page.getByTitle('Apri indice').click();
  await expect(page.locator('.editor-toc-col')).toHaveCSS('width', '260px');
  const open = await layout();
  expect(open.width).toBe(closed.width);
  expect(open.left).toBeGreaterThan(closed.left);
  expect(open.overflow).toBeGreaterThan(0);
  expect(open.scrollLeft).toBe(0);
  expect(open.heading).toBe(closed.heading);

  await page.getByTitle('Chiudi', { exact: true }).click();
  await expect(page.locator('.editor-toc-col')).toHaveCSS('width', '44px');
  expect(await layout()).toEqual(closed);

  // A tablet keeps the page that fits the window with the index closed, and that page moves too.
  await page.setViewportSize({ width: 820, height: 1000 });
  await expect.poll(async () => (await layout()).overflow).toBe(0);
  const narrow = await layout();
  expect(narrow.width).toBeLessThan(794);
  await page.getByTitle('Apri indice').click();
  await expect(page.locator('.editor-toc-col')).toHaveCSS('width', '260px');
  const narrowOpen = await layout();
  expect(narrowOpen.width).toBe(narrow.width);
  expect(narrowOpen.left).toBeGreaterThan(narrow.left);
});
