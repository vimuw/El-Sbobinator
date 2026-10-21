import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1024, height: 720 }, { width: 390, height: 844 }]) {
  test(`manual update can be installed locally with shared progress at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    // Exercise the desktop update UI with a mocked release, without installing it.
    await page.route('**/api/bootstrap', async route => {
      const response = await route.fetch();
      const bootstrap = await response.json();
      await route.fulfill({
        response,
        json: { ...bootstrap, capabilities: { ...bootstrap.capabilities, updateInstallation: true } },
      });
    });
    let latestVersion = 'v1.0.0';
    await page.route('https://api.github.com/repos/vimuw/El-Sbobinator/releases/latest', route =>
      route.fulfill({ json: { tag_name: latestVersion } }),
    );
    await page.goto('/');
    const updateRequests: string[] = [];
    await page.exposeFunction('recordSettingsUpdate', (version: string) => { updateRequests.push(version); });
    await page.getByRole('button', { name: /Apri impostazioni/i }).click();
    await page.evaluate(() => {
      if (!window.pywebview?.api) throw new Error('Browser bridge unavailable');
      window.pywebview.api.download_and_install_update = async version => {
        await (window as Window & { recordSettingsUpdate: (version: string) => Promise<void> }).recordSettingsUpdate(version);
        return { ok: true };
      };
    });
    const heading = page.getByRole('heading', { name: 'Generale', exact: true });
    await expect(heading).toBeVisible();
    // The page title stays above the scrolling content.
    const content = page.getByTestId('settings-content');
    const section = page.getByRole('region', { name: 'Versione e aggiornamenti' });
    await expect(page.getByText('Sei aggiornato alla versione più recente.')).toHaveCount(1);
    await content.evaluate(element => { element.scrollTop = element.scrollHeight; });

    latestVersion = 'v9.9.9';
    await page.getByRole('button', { name: 'Cerca aggiornamenti' }).click();
    const feedback = page.getByText('È disponibile la versione v9.9.9.');
    // Subpixel layout can report a fully shown element as 0.9999997 visible.
    await expect(feedback).toBeInViewport({ ratio: 0.99 });
    const installButton = section.getByRole('button', { name: 'Installa aggiornamento' });
    await expect(installButton).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByRole('button', { name: 'Mostra aggiornamento' })).toHaveCount(0);
    const notice = page.getByRole('region', { name: 'Aggiornamento applicazione' });
    await expect(notice).not.toBeInViewport();
    await expect(page.getByRole('button', { name: 'Installa aggiornamento' })).toHaveCount(2);
    expect(updateRequests).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('update-check-feedback.png'), animations: 'disabled' });

    await installButton.click();
    await expect.poll(() => updateRequests).toEqual(['v9.9.9']);
    await expect(section.getByText('Download aggiornamento…')).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByRole('button', { name: 'Installa aggiornamento' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cerca aggiornamenti' })).toBeDisabled();
    await expect(notice).not.toBeInViewport();

    await page.evaluate(() => {
      window.elSbobinatorBridge?.updateDownloadProgress({ status: 'downloading', bytes_done: 5242880, bytes_total: 10485760 });
    });
    await expect(section.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    await expect(notice.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    await expect(section.getByText('5.0 MB / 10.0 MB (50%)')).toBeInViewport({ ratio: 0.99 });
    await page.screenshot({ path: testInfo.outputPath('update-download-local.png'), animations: 'disabled' });

    await page.getByRole('button', { name: 'Chiudi finestra' }).click();
    await page.getByRole('button', { name: /Apri impostazioni/i }).click();
    await expect(notice).toBeInViewport();
    await expect(notice.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    await page.screenshot({ path: testInfo.outputPath('update-notice-top.png'), animations: 'disabled' });
    await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(section.getByText('Download aggiornamento…')).toBeInViewport({ ratio: 0.99 });
    await page.evaluate(() => {
      window.elSbobinatorBridge?.updateDownloadProgress({ status: 'error', bytes_done: 5242880, bytes_total: 10485760, error: 'Download interrotto di prova.' });
    });
    await expect(section.getByText('Download interrotto di prova.')).toBeInViewport({ ratio: 0.99 });
    await expect(notice.getByText('Download interrotto di prova.')).toHaveCount(1);
    // Reopened with the update already known, only the notice at the top offers the retry.
    await expect(installButton).toHaveCount(0);
    const retryButton = notice.getByRole('button', { name: 'Installa aggiornamento' });
    await expect(retryButton).toBeEnabled();
    expect(updateRequests).toEqual(['v9.9.9']);
    await page.screenshot({ path: testInfo.outputPath('update-error-local.png'), animations: 'disabled' });

    await retryButton.click();
    await expect.poll(() => updateRequests).toEqual(['v9.9.9', 'v9.9.9']);
    await expect(notice.getByText('Download aggiornamento…')).toBeInViewport({ ratio: 0.99 });
    await expect(section.getByText('Download aggiornamento…')).toHaveCount(1);
    await expect(page.getByText('Download interrotto di prova.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Chiudi finestra' }).click();
    await page.getByRole('button', { name: /Apri impostazioni/i }).click();
    await expect(notice).toBeInViewport();
    await page.evaluate(() => {
      window.elSbobinatorBridge?.updateDownloadProgress({ status: 'done', bytes_done: 10485760, bytes_total: 10485760 });
    });
    await expect(notice.getByText('Installer avviato. Segui le istruzioni a schermo.')).toBeInViewport({ ratio: 0.99 });
    await expect(section.getByText('Installer avviato. Segui le istruzioni a schermo.')).toHaveCount(1);
    await expect(section).not.toBeInViewport();
    await expect(page.getByRole('button', { name: 'Installa aggiornamento' })).toHaveCount(0);
  });
}
