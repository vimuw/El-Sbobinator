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
    setHostCapabilities({});
    delete window.pywebview;
  });

  it('opens in a new tab from a link: this page neither leaves nor fires beforeunload', () => {
    setHostCapabilities({ kind: 'web', reportByEmail: true });
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

  it('goes through the bridge in the desktop app, without a link', async () => {
    setHostCapabilities({ kind: 'desktop' });
    const openUrl = vi.fn().mockResolvedValue({ ok: true });
    window.pywebview = { api: { open_url: openUrl } } as unknown as typeof window.pywebview;
    const { opened } = recordLinkClicks();

    openReportEmail();

    expect(openUrl).toHaveBeenCalledWith(BUG_REPORT_URL);
    expect(opened).toEqual([]);
  });
});
