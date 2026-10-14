import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupErrorNotice } from './SetupErrorNotice';
import type { ValidationCheck } from '../bridge';

const apiKey = 'AQ.abcdefghijklmnopqrstuvwxyz012345';
const check: ValidationCheck = {
  id: 'api_key', label: 'API Key Gemini', status: 'error',
  message: "Google ha negato l'accesso.",
  hint: 'Controlla i permessi della chiave o del progetto in Google AI Studio.',
  model: 'gemini-3.6-flash', error_code: '403', help_action: 'ai_studio',
  details: `403 PERMISSION_DENIED: key=${apiKey}`,
};

afterEach(() => vi.unstubAllGlobals());

describe('SetupErrorNotice', () => {
  it('keeps technical details collapsed and copies a redacted report on request', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<SetupErrorNotice check={check} apiKey={apiKey} />);
    expect(screen.getByRole('alert').textContent).toContain("Google ha negato l'accesso.");
    const toggle = screen.getByRole('button', { name: 'Dettagli' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Copia dettagli' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Codice: 403')).toBeTruthy();
    expect(screen.getByText(/PERMISSION_DENIED/).textContent).not.toContain(apiKey);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copia dettagli' })); });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('Modello: gemini-3.6-flash');
    expect(copied).toContain('Codice: 403');
    expect(copied).toContain('[API_KEY_REDACTED]');
    expect(copied).not.toContain(apiKey);
    expect(screen.getByRole('button', { name: 'Copiato!' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: 'Copiato!' })).toBeNull();
  });

  it('offers manual copy when clipboard access fails', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<SetupErrorNotice check={check} apiKey={apiKey} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dettagli' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copia dettagli' })); });
    expect(screen.getByRole('status').textContent).toContain('Seleziona il testo');
    expect(screen.getByRole('button', { name: 'Copia dettagli' })).toBeTruthy();
  });

  it('does not offer unrelated actions for a local save error', () => {
    render(<SetupErrorNotice check={{ id: 'setup', label: 'Configurazione', status: 'error', message: 'Errore salvataggio.' }} apiKey={apiKey} />);
    expect(screen.queryByRole('button', { name: 'Dettagli' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Apri AI Studio/ })).toBeNull();
  });
});
