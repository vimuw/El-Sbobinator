import { BUG_REPORT_URL } from '../branding';
import { reportClientError } from '../diagnostics';
import { getHostCapabilities } from '../hostCapabilities';

/**
 * Opens a mailto: link for another tab, never this page. In place (location.href) Chromium fires
 * beforeunload, so mid-run the leave guards (App.tsx, webHost.ts) asked "Leave site?"; and with a
 * web mail handler (Gmail, Outlook) the page itself became the mail site and the run stopped.
 * Through an anchor with target="_blank" the app tab stays and fires no beforeunload: a web handler
 * opens in a new tab, a mail app opens without leaving an empty one (Chromium closes it).
 * window.open leaves that empty tab, and outside a click a browser may block it.
 */
export function openEmailInNewTab(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.hidden = true;
  // In the page while clicked: some browsers (Safari) ignore a click on a detached link.
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}

/**
 * The email to the developer. Only the desktop app needs its bridge (the WebView has no mail
 * handler); a browser opens mailto: from a new-tab link.
 */
export function openReportEmail(): void {
  const api = window.pywebview?.api;
  if (getHostCapabilities().kind !== 'desktop' || !api?.open_url) {
    openEmailInNewTab(BUG_REPORT_URL);
    return;
  }
  // Written as `open_url?.(CONSTANT)` so the allowlist contract test can see this call-site.
  void Promise.resolve(api.open_url?.(BUG_REPORT_URL))
    .then(result => {
      if (!result?.ok) throw new Error(result?.error || 'Impossibile aprire l’email.');
    })
    .catch(error => reportClientError('bug-report-open', error));
}
