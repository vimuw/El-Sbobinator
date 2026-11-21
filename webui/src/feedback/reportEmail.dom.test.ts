import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUG_REPORT_URL } from '../branding';
import { setHostCapabilities } from '../hostCapabilities';
import { openReportEmail } from './reportEmail';

function recordLinkClicks() {
  const opened: Array<{ href: string; target: string; rel: string; inPage: boolean }> = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    opened.push({ href: this.getAttribute('href') ?? '', target: this.target, rel: this.rel, inPage: this.isConnected });
  });
  return { opened, click };
}

// Regression: the email opened in place (location.href = mailto:). Chromium fired beforeunload, so
// mid-run the leave guards asked "Leave site?"; with a web mail handler (Gmail, Outlook) this tab
// became the mail site and the run stopped.
describe('report email', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.pywebview;
  });

  it('opens in a new tab from a link: this page neither leaves nor fires beforeunload', () => {
    setHostCapabilities({ reportByEmail: true });
    const { opened } = recordLinkClicks();
    let unloads = 0;
    const countUnload = () => { unloads += 1; };
    window.addEventListener('beforeunload', countUnload);
    const address = window.location.href;
    try {
      openReportEmail();
    } finally {
      window.removeEventListener('beforeunload', countUnload);
    }

    expect(opened).toEqual([{ href: BUG_REPORT_URL, target: '_blank', rel: expect.stringContaining('noopener'), inPage: true }]);
    // The link was only there for the click.
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(unloads).toBe(0);
    expect(window.location.href).toBe(address);
  });

});
