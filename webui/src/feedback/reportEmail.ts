import { BUG_REPORT_URL } from '../branding';

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

/** The email to the developer, opened from a new-tab link. */
export function openReportEmail(): void {
  openEmailInNewTab(BUG_REPORT_URL);
}
