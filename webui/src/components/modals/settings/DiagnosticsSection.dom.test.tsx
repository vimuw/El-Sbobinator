import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { DESKTOP_CAPABILITIES, setHostCapabilities } from '../../../hostCapabilities';
import { AUTO_REPORTS_KEY } from '../../../monitoring/config';
import { BUG_REPORT_URL, SUPPORT_EMAIL } from '../../../branding';
import { rememberReport, resetReportHistoryForTests } from '../../../feedback/history';
import { DiagnosticsSection } from './DiagnosticsSection';

// The report dates below are fixed: the clock is pinned near them, so they never turn 30 days old.
function pinClockNearReports() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'));
}

afterEach(() => {
  vi.useRealTimers();
  delete window.pywebview;
  setHostCapabilities(DESKTOP_CAPABILITIES);
  localStorage.clear();
  resetReportHistoryForTests();
});

const baseProps = {
  onCopyReport: vi.fn().mockResolvedValue(undefined),
};

describe('DiagnosticsSection', () => {
  it('keeps support to an email and a copied report, scoped to the selected sbobina', async () => {
    const exportBundle = vi.fn();
    window.pywebview = { api: {
      list_diagnostic_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [{ path: 'archive/lesson', label: 'Lezione' }] }),
      export_diagnostics: exportBundle,
    } } as unknown as NonNullable<typeof window.pywebview>;
    const copy = vi.fn().mockResolvedValue(undefined);
    render(<DiagnosticsSection {...baseProps} onCopyReport={copy} />);
    await screen.findByText('Lezione');

    const support = within(screen.getByRole('region', { name: 'Segnala un problema' }));
    const emailLink = support.getByRole('link', { name: 'Segnala un problema' });
    const copyButton = support.getByRole('button', { name: 'Copia report diagnostico' });
    expect(support.getByLabelText('Sbobina con il problema (facoltativa)')).toBeTruthy();
    // Two numbered steps in the order they are done, each button on its own row's right.
    expect(copyButton.previousElementSibling?.textContent).toContain('1. Copia il report');
    expect(emailLink.previousElementSibling?.textContent).toContain('2. Scrivimi un’email');
    expect(emailLink.getAttribute('href')).toBe(BUG_REPORT_URL);
    expect(screen.getByRole('region', { name: 'Segnala un problema' }).textContent).not.toMatch(/modulo/i);
    expect(copyButton.compareDocumentPosition(emailLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Esporta diagnostica' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apri cartella log' })).toBeNull();
    // The email has no automatic reports to turn off.
    expect(screen.queryByRole('region', { name: 'Report automatici' })).toBeNull();

    fireEvent.click(screen.getByLabelText('Sbobina con il problema (facoltativa)'));
    fireEvent.click(screen.getByRole('option', { name: 'Lezione' }));
    await act(async () => { fireEvent.click(support.getByRole('button', { name: 'Copia report diagnostico' })); });
    expect(copy).toHaveBeenCalledWith('archive/lesson');
    expect(exportBundle).not.toHaveBeenCalled();
  });

  it('hides the sbobina picker when there is nothing to choose', () => {
    render(<DiagnosticsSection {...baseProps} />);
    expect(screen.queryByLabelText('Sbobina con il problema (facoltativa)')).toBeNull();
  });

  it('shows the copied state when the report is copied', async () => {
    const onCopyReport = vi.fn().mockResolvedValue(undefined);
    render(<DiagnosticsSection {...baseProps} onCopyReport={onCopyReport} />);

    fireEvent.click(screen.getByLabelText('Copia report diagnostico'));

    expect(onCopyReport).toHaveBeenCalledTimes(1);
    expect(await screen.findByTitle('Report copiato!')).toBeTruthy();
  });

  it('reports a copy failure without the copied state', async () => {
    const onCopyReport = vi.fn().mockRejectedValue(new Error('Generation failed'));
    render(<DiagnosticsSection {...baseProps} onCopyReport={onCopyReport} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Copia report diagnostico'));
    });

    expect(screen.queryByTitle('Report copiato!')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Generation failed');
  });

  it('sends reports from the app in web builds with Sentry, and lets the user stop the automatic ones', async () => {
    setHostCapabilities({ kind: 'web', reportByEmail: false, environmentCheck: false });
    render(<DiagnosticsSection {...baseProps} />);

    const support = within(screen.getByRole('region', { name: 'Segnala un problema' }));
    // One step: the window attaches the report itself, so no copy and no email.
    expect(support.queryByRole('button', { name: 'Copia report diagnostico' })).toBeNull();
    expect(support.queryByRole('link')).toBeNull();
    fireEvent.click(support.getByRole('button', { name: 'Segnala un problema' }));
    expect(await screen.findByRole('dialog', { name: 'Segnala un problema' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // A standing choice, not a way to report: its own section after the report button.
    expect(support.queryByRole('switch')).toBeNull();
    const automaticSection = screen.getByRole('region', { name: 'Report automatici' });
    expect(automaticSection.textContent).toContain('senza i tuoi testi né l’audio');
    expect(screen.getByRole('region', { name: 'Segnala un problema' }).compareDocumentPosition(automaticSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const automatic = within(automaticSection).getByRole('switch', { name: 'Invia report automatici degli errori' });
    expect(automatic.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(automatic);
    expect(automatic.getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(localStorage.getItem(AUTO_REPORTS_KEY)).toBe('off'));
  });

  it('lists the codes of the reports sent from this browser, a new one at once', () => {
    pinClockNearReports();
    setHostCapabilities({ kind: 'web', reportByEmail: false, environmentCheck: false });
    rememberReport({ code: 'A1B2C3D4', sentAt: '2026-11-17T10:30:00.000Z', kind: 'bug' });
    render(<DiagnosticsSection {...baseProps} />);

    const list = screen.getByRole('list', { name: 'Le tue segnalazioni' });
    // The reports belong with the button that sent them.
    expect(within(screen.getByRole('region', { name: 'Segnala un problema' })).getByRole('list', { name: 'Le tue segnalazioni' })).toBe(list);
    const codes = () => within(list).getAllByRole('listitem').map(item => [
      within(item).getByText(/^[0-9A-F]{8}$/).textContent,
      item.querySelector('time')?.getAttribute('dateTime'),
      item.textContent?.includes('Bug') ? 'Bug' : item.textContent?.includes('Suggerimento') ? 'Suggerimento' : '?',
    ]);
    expect(codes()).toEqual([['A1B2C3D4', '2026-11-17T10:30:00.000Z', 'Bug']]);
    act(() => { rememberReport({ code: 'E5F60718', sentAt: '2026-11-17T11:00:00.000Z', kind: 'idea' }); });
    expect(codes()).toEqual([
      ['E5F60718', '2026-11-17T11:00:00.000Z', 'Suggerimento'],
      ['A1B2C3D4', '2026-11-17T10:30:00.000Z', 'Bug'],
    ]);
  });

  // Regression: code, type and date alone did not say which report a code was for.
  it('names each report by what the user wrote, with its code beside type and date', () => {
    pinClockNearReports();
    setHostCapabilities({ kind: 'web', reportByEmail: false, environmentCheck: false });
    rememberReport({ code: 'A1B2C3D4', sentAt: '2026-11-17T10:30:00.000Z', kind: 'bug' });
    rememberReport({ code: 'E5F60718', sentAt: '2026-11-17T11:00:00.000Z', kind: 'idea', excerpt: 'Il titolo della lezione non si salva' });
    render(<DiagnosticsSection {...baseProps} />);

    const [withExcerpt, older] = within(screen.getByRole('list', { name: 'Le tue segnalazioni' })).getAllByRole('listitem');
    const title = within(withExcerpt).getByText('Il titolo della lezione non si salva');
    expect(title.getAttribute('title')).toBe('Il titolo della lezione non si salva');
    const code = within(withExcerpt).getByText('E5F60718');
    expect(code.closest('p')?.textContent).toMatch(/^E5F60718 · Suggerimento · /);
    expect(within(withExcerpt).getByRole('button', { name: 'Copia codice E5F60718' })).toBeTruthy();
    // Saved before the excerpt was kept: the code stays the title, as before.
    expect(within(older).getByText('A1B2C3D4').closest('p')).toBeNull();
    expect(older.querySelector('p')?.textContent).toMatch(/^Bug · /);
  });

  it('copies a report code with its own button, and says when it cannot', async () => {
    pinClockNearReports();
    setHostCapabilities({ kind: 'web', reportByEmail: false, environmentCheck: false });
    rememberReport({ code: 'A1B2C3D4', sentAt: '2026-11-17T10:30:00.000Z', kind: 'bug' });
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DiagnosticsSection {...baseProps} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copia codice A1B2C3D4' })); });
    expect(writeText).toHaveBeenCalledWith('A1B2C3D4');
    expect(screen.getByRole('button', { name: 'Codice A1B2C3D4 copiato' })).toBeTruthy();

    writeText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Codice A1B2C3D4 copiato' })); });
    expect(screen.getByRole('alert').textContent).toBe('Non riesco a copiarlo: selezionalo e copialo a mano.');
    expect(screen.getByRole('button', { name: 'Copia codice A1B2C3D4' })).toBeTruthy();
  });

  // Regression: with the email, the address was nowhere in the app. Without a mail app the button
  // opens nothing (the browser stays silent, the desktop app only logs the failure).
  it('shows the support address next to the email button and copies it, saying when it cannot', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DiagnosticsSection {...baseProps} />);

    const support = within(screen.getByRole('region', { name: 'Segnala un problema' }));
    const emailLink = support.getByRole('link', { name: 'Segnala un problema' });
    const row = emailLink.closest('[data-testid="settings-row"]') as HTMLElement;
    expect(within(row).getByText(SUPPORT_EMAIL)).toBeTruthy();
    const copyAddress = within(row).getByRole('button', { name: 'Copia indirizzo email' });
    expect(emailLink.compareDocumentPosition(copyAddress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => { fireEvent.click(copyAddress); });
    expect(writeText).toHaveBeenCalledWith(SUPPORT_EMAIL);
    expect(within(row).getByRole('button', { name: 'Indirizzo email copiato' })).toBeTruthy();

    writeText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Indirizzo email copiato' })); });
    expect(support.getByRole('alert').textContent).toBe('Non riesco a copiarlo: selezionalo e copialo a mano.');
    expect(within(row).getByRole('button', { name: 'Copia indirizzo email' })).toBeTruthy();
  });

  it('shows no report list before the first report, nor with the email', () => {
    pinClockNearReports();
    render(<DiagnosticsSection {...baseProps} />);
    rememberReport({ code: 'A1B2C3D4', sentAt: '2026-11-17T10:30:00.000Z', kind: 'bug' });
    expect(screen.queryByRole('list', { name: 'Le tue segnalazioni' })).toBeNull();
  });

  it('keeps the automatic-reports choice when the Sentry chunk does not load', async () => {
    vi.stubEnv('MODE', 'web');
    const blocked = new TypeError('Failed to fetch dynamically imported module: /assets/sentry-abc123.js');
    vi.doMock('../../../monitoring/sentry', () => { throw blocked; });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setHostCapabilities({ kind: 'web', reportByEmail: false, environmentCheck: false });
      render(<DiagnosticsSection {...baseProps} />);

      fireEvent.click(screen.getByRole('switch', { name: 'Invia report automatici degli errori' }));
      expect(localStorage.getItem(AUTO_REPORTS_KEY)).toBe('off');
      // Reported, not an unhandled rejection (which fails the run).
      await waitFor(() => expect(consoleError).toHaveBeenCalledWith('monitoring', expect.anything()));
    } finally {
      vi.doUnmock('../../../monitoring/sentry');
      vi.unstubAllEnvs();
      consoleError.mockRestore();
    }
  });
});
