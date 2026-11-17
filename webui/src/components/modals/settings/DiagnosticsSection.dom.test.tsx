import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { DESKTOP_CAPABILITIES, setHostCapabilities } from '../../../hostCapabilities';
import { AUTO_REPORTS_KEY } from '../../../monitoring/config';
import { DiagnosticsSection } from './DiagnosticsSection';

afterEach(() => {
  delete window.pywebview;
  setHostCapabilities(DESKTOP_CAPABILITIES);
  localStorage.clear();
});

const baseProps = {
  isValidatingEnvironment: false,
  onRunValidation: vi.fn(),
  validationResult: null,
  onCopyReport: vi.fn().mockResolvedValue(undefined),
};

describe('DiagnosticsSection', () => {
  it('keeps support to the form and a copied report, scoped to the selected sbobina', async () => {
    const exportBundle = vi.fn();
    window.pywebview = { api: {
      list_diagnostic_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [{ path: 'archive/lesson', label: 'Lezione' }] }),
      export_diagnostics: exportBundle,
    } } as unknown as NonNullable<typeof window.pywebview>;
    const copy = vi.fn().mockResolvedValue(undefined);
    render(<DiagnosticsSection {...baseProps} onCopyReport={copy} />);
    await screen.findByText('Lezione');

    const support = within(screen.getByRole('region', { name: 'Segnala un problema' }));
    const formLink = support.getByRole('link', { name: 'Segnala un problema' });
    const copyButton = support.getByRole('button', { name: 'Copia report diagnostico' });
    expect(support.getByLabelText('Sbobina con il problema (facoltativa)')).toBeTruthy();
    // Two numbered steps in the order they are done, each button on its own row's right.
    expect(copyButton.previousElementSibling?.textContent).toContain('1. Copia il report');
    expect(formLink.previousElementSibling?.textContent).toContain('2. Apri il modulo');
    expect(copyButton.compareDocumentPosition(formLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Esporta diagnostica' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apri cartella log' })).toBeNull();

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

  it('shows no check rows before the environment check runs', () => {
    const onRunValidation = vi.fn();
    render(<DiagnosticsSection {...baseProps} onRunValidation={onRunValidation} />);

    const environment = within(screen.getByRole('region', { name: 'Verifica ambiente' }));
    expect(screen.queryByText('da verificare')).toBeNull();
    expect(screen.queryByText('FFmpeg')).toBeNull();
    expect(environment.getByText('Verifica ora')).toBeTruthy();
    fireEvent.click(environment.getByRole('button', { name: 'Verifica ambiente' }));
    expect(onRunValidation).toHaveBeenCalledOnce();
  });

  it('renders "Verifica in corso..." and is disabled while validating', () => {
    render(<DiagnosticsSection {...baseProps} isValidatingEnvironment />);

    const btn = screen.getByTitle('Verifica in corso…');
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Verifica in corso...')).toBeTruthy();
  });

  it('shows only the summary when every check passes', () => {
    const { container } = render(
      <DiagnosticsSection
        {...baseProps}
        validationResult={{
          ok: true,
          summary: 'Ambiente pronto.',
          checks: [
            { id: 'api_key', label: 'API Key Gemini', status: 'ok', message: 'Chiave API valida' },
            { id: 'config', label: 'Config locale', status: 'ok', message: 'Config scrivibile' },
          ],
        }}
      />,
    );

    expect(screen.getByText('Ambiente pronto.')).toBeTruthy();
    expect(container.querySelector('.alert-card.is-success')).toBeTruthy();
    expect(screen.queryByText('API Key Gemini')).toBeNull();
    expect(screen.queryByText('Config locale')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Problemi rilevati' })).toBeNull();
    expect(screen.getByLabelText('Riesegui verifica ambiente')).toBeTruthy();
  });

  it('lists only the failing and warning checks with their details', () => {
    const { container } = render(
      <DiagnosticsSection
        {...baseProps}
        validationResult={{
          ok: false,
          summary: 'Ambiente incompleto: correggi gli errori segnalati.',
          checks: [
            { id: 'api_key', label: 'API Key Gemini', status: 'warning', message: 'API key assente', details: "Inserisci una chiave se vuoi verificare l'accesso al modello." },
            { id: 'ffmpeg', label: 'FFmpeg', status: 'error', message: 'FFmpeg mancante' },
            { id: 'config', label: 'Config locale', status: 'ok', message: 'Config scrivibile' },
          ],
        }}
      />,
    );

    expect(container.querySelector('.alert-card.is-error')).toBeTruthy();
    const problems = within(screen.getByRole('list', { name: 'Problemi rilevati' }));
    expect(problems.getAllByRole('listitem')).toHaveLength(2);
    expect(problems.getByText('FFmpeg mancante')).toBeTruthy();
    expect(problems.getByText(/Inserisci una chiave/)).toBeTruthy();
    expect(screen.queryByText('Config locale')).toBeNull();
  });

  it('uses a warning banner when the only problems are warnings', () => {
    const { container } = render(
      <DiagnosticsSection
        {...baseProps}
        validationResult={{
          ok: true,
          has_warnings: true,
          summary: 'Ambiente pronto con avvisi: verifica le segnalazioni.',
          checks: [{ id: 'api_key', label: 'API Key Gemini', status: 'warning', message: 'API key assente' }],
        }}
      />,
    );

    expect(container.querySelector('.alert-card.is-warning')).toBeTruthy();
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
    setHostCapabilities({ kind: 'web', reportForm: false, environmentCheck: false });
    render(<DiagnosticsSection {...baseProps} showEnvironmentCheck={false} />);

    const support = within(screen.getByRole('region', { name: 'Segnala un problema' }));
    // One step: the window attaches the report itself, so no copy and no form.
    expect(support.queryByRole('button', { name: 'Copia report diagnostico' })).toBeNull();
    expect(support.queryByRole('link')).toBeNull();
    fireEvent.click(support.getByRole('button', { name: 'Segnala un problema' }));
    expect(await screen.findByRole('dialog', { name: 'Segnala un problema' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const automatic = support.getByRole('switch', { name: 'Invia report automatici degli errori' });
    expect(automatic.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(automatic);
    expect(automatic.getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(localStorage.getItem(AUTO_REPORTS_KEY)).toBe('off'));
  });

  it('keeps the automatic-reports choice when the Sentry chunk does not load', async () => {
    vi.stubEnv('MODE', 'web');
    const blocked = new TypeError('Failed to fetch dynamically imported module: /assets/sentry-abc123.js');
    vi.doMock('../../../monitoring/sentry', () => { throw blocked; });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setHostCapabilities({ kind: 'web', reportForm: false, environmentCheck: false });
      render(<DiagnosticsSection {...baseProps} showEnvironmentCheck={false} />);

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
