import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`notification pointer stays joined to its frame while rows scroll (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 720 });
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('el-sbobinator.theme.v1', selectedTheme);
      localStorage.setItem('el-sbobinator.notifications.v1', JSON.stringify(
        Array.from({ length: 9 }, (_, index) => ({
          id: `caret-${index}`,
          title: `Notifica ${index}`,
          message: 'Una notifica di prova con testo abbastanza lungo da occupare piu righe nel pannello.',
          type: ['success', 'error', 'warning'][index % 3],
          category: 'processing',
          timestamp: Date.now() - index * 60_000,
          read: index % 2 === 0,
        }))
      ));
    }, theme);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Apri notifiche', exact: true })).toBeVisible();
    // The browser host clears notifications for a new instance; seed again on reload.
    await page.reload();
    await page.getByRole('button', { name: 'Apri notifiche', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Notifiche' });
    await expect(dialog).toHaveCSS('opacity', '1');
    const panel = dialog.locator('.notification-dropdown-panel');
    const list = dialog.locator('.overflow-y-auto');
    await expect(list.locator('[data-notification-id]')).toHaveCount(9);

    // Put a boundary between two differently colored rows at the pointer's center.
    await list.evaluate(element => {
      const pointer = element.closest('[role="dialog"]')!.querySelector('svg')!.getBoundingClientRect();
      const row = element.querySelector('[data-notification-id="caret-3"]')!.getBoundingClientRect();
      element.scrollTop += row.bottom - (pointer.top + pointer.height / 2);
    });
    const pointerBounds = await dialog.locator('[aria-hidden="true"] svg').boundingBox();
    expect(pointerBounds).not.toBeNull();
    const clip = { x: pointerBounds!.x, y: pointerBounds!.y + 2, width: 14, height: 14 };
    const boundary = await page.screenshot({ clip, animations: 'disabled' });
    await page.screenshot({ path: testInfo.outputPath(`notifications-${theme}.png`) });

    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const scrolled = await page.screenshot({ clip, animations: 'disabled' });
    expect(scrolled.equals(boundary)).toBe(true);

    await dialog.getByRole('button', { name: /Non lette/ }).click();
    const unread = await page.screenshot({ clip, animations: 'disabled' });
    expect(unread.equals(boundary)).toBe(true);

    const colors = await panel.evaluate(element => ({
      frame: getComputedStyle(element).backgroundColor,
      pointer: getComputedStyle(element.closest('[role="dialog"]')!.querySelector('polygon')!).fill,
    }));
    expect(colors.pointer).toBe(colors.frame);
  });
}
