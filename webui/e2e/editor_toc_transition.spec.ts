import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

test('index fades out before its reopen button appears and supports interrupted closure', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const audio = info.outputPath('toc-transition.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'toc-transition.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  await editor.evaluate(root => {
    const content = '<h1>Fisiopatologia generale</h1>' + Array.from({ length: 35 }, (_, i) =>
      `<h2>Sezione ${i + 1}: aterosclerosi e infiammazione</h2><p>Appunti della lezione.</p>`).join('');
    (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content);
  });
  const column = page.locator('.editor-toc-col');
  const content = page.locator('.editor-toc-content');
  const trigger = page.locator('.editor-toc-trigger');
  const open = page.getByTitle('Apri indice');

  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await open.click();
    await expect(column).toHaveCSS('width', '260px');
    await expect(content).toHaveCSS('opacity', '1');
    await expect(page.locator('.editor-toc-nav .toc-item')).toHaveCount(36);

    const samples = await column.evaluate(async col => {
      const shell = col.closest('.editor-shell')!;
      const content = col.querySelector<HTMLElement>('.editor-toc-content')!;
      const nav = col.querySelector('.editor-toc-nav')!;
      const trigger = col.querySelector<HTMLElement>('.editor-toc-trigger')!;
      col.querySelector<HTMLButtonElement>('[title="Chiudi"]')!.click();
      // Let React commit and the browser create CSS transitions, then inspect
      // deterministic intermediate frames without depending on machine speed.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const transitions = shell.getAnimations({ subtree: true }).filter(animation =>
        animation instanceof CSSTransition &&
        (animation.effect as KeyframeEffect).target instanceof Element &&
        ((animation.effect as KeyframeEffect).target as Element).matches(
          '.editor-toc-col, .editor-toc-spacer, .editor-toc-content, .editor-toc-trigger'));
      transitions.forEach(animation => animation.pause());
      const sample = (time: number) => {
        transitions.forEach(animation => { animation.currentTime = time; });
        return {
          time,
          width: col.getBoundingClientRect().width,
          contentOpacity: Number(getComputedStyle(content).opacity),
          contentVisibility: getComputedStyle(content).visibility,
          contentInert: content.inert,
          navigationConnected: nav.isConnected,
          triggerOpacity: Number(getComputedStyle(trigger).opacity),
          triggerVisibility: getComputedStyle(trigger).visibility,
        };
      };
      const samples = [60, 140, 210, 270].map(sample);
      transitions.forEach(animation => animation.cancel());
      return samples;
    });
    const [fading, faded, appearing, closed] = samples;
    expect(fading.width).toBeGreaterThan(44);
    expect(fading.width).toBeLessThan(260);
    expect(fading.contentOpacity).toBeGreaterThan(0);
    expect(fading.contentOpacity).toBeLessThan(1);
    expect(fading.contentVisibility).toBe('visible');
    expect(fading.contentInert).toBe(true);
    expect(fading.navigationConnected).toBe(true);
    expect(fading.triggerOpacity).toBe(0);
    expect(faded.contentOpacity).toBe(0);
    expect(faded.contentVisibility).toBe('hidden');
    expect(faded.triggerVisibility).toBe('hidden');
    expect(appearing.triggerOpacity).toBeGreaterThan(0);
    expect(appearing.triggerOpacity).toBeLessThan(1);
    expect(closed.width).toBe(44);
    expect(closed.triggerOpacity).toBe(1);
    await expect(open).toBeVisible();
    await fs.promises.writeFile(info.outputPath(`toc-frames-${theme}.json`), JSON.stringify(samples, null, 2));

    await open.click();
    await expect(column).toHaveCSS('width', '260px');
    await page.locator('.editor-toc-nav').evaluate(nav => { nav.scrollTop = 120; });
    await page.getByTitle('Chiudi', { exact: true }).click();
    await page.keyboard.press('Control+Alt+o');
    await expect(column).toHaveCSS('width', '260px');
    await expect(content).toHaveCSS('opacity', '1');
    await expect(content).not.toHaveAttribute('inert');
    expect(await page.locator('.editor-toc-nav').evaluate(nav => nav.scrollTop)).toBe(120);
    await expect(trigger).toBeHidden();
    await page.locator('.editor-toc-sticky').screenshot({ path: info.outputPath(`toc-reopened-${theme}.png`) });
    await page.getByTitle('Chiudi', { exact: true }).click();
    await expect(open).toBeVisible();
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open.click();
  await expect(column).toHaveCSS('width', '260px');
  await page.getByTitle('Chiudi', { exact: true }).click();
  await expect(column).toHaveCSS('width', '44px');
  await expect(content).toBeHidden();
  await expect(trigger).toHaveCSS('opacity', '1');
  await expect(column).toHaveCSS('transition-duration', '0s');
  await expect(trigger).toHaveCSS('transition-delay', '0s');
});
