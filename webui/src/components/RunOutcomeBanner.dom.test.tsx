import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunOutcome } from '../appState';
import { InvalidKeyError, ModelNotFoundError } from '../web/pipeline/retry';
import { failurePayload } from '../web/webRun';
import { RunOutcomeBanner, type RunOutcomeActions } from './RunOutcomeBanner';

function actions(): RunOutcomeActions {
  return { onResume: vi.fn(), onRemove: vi.fn(), onOpenSettings: vi.fn(), onOpenStorage: vi.fn(), onOpenSbobina: vi.fn(), onReviseSections: vi.fn(), onDismiss: vi.fn() };
}

const stopped = (overrides: Partial<RunOutcome>): RunOutcome => ({ kind: 'error', fileId: 'f1', fileName: 'Lezione 4.mp3', warnings: [], ...overrides });

describe('RunOutcomeBanner', () => {
  it('pauses on a busy Gemini with the saved progress, a retry time and Riprendi', () => {
    const handlers = actions();
    const retryAt = new Date(Date.now() + 30 * 60_000);
    render(
      <RunOutcomeBanner
        outcome={stopped({ kind: 'paused', error: 'phase1_chunk_failed_2', retryReason: 'circuit_breaker_paused', recommendedRetryAt: retryAt.toISOString(), warnings: [{ code: 'fallback_key_in_use', message: 'Quota della chiave 1 esaurita' }] })}
        actions={handlers}
        canResume
      />,
    );
    const banner = screen.getByTestId('run-outcome-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.className).toContain('is-warning');
    expect(screen.getByRole('heading').textContent).toBe('Sbobina in pausa: Gemini è sovraccarico');
    expect(screen.getByText('Lezione 4.mp3')).toBeTruthy();
    const time = retryAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    expect(banner.textContent).toContain(`meglio dopo le ${time}`);
    expect(screen.getByRole('list', { name: 'Avvisi' }).textContent).toBe('Quota della chiave 1 esaurita');
    fireEvent.click(screen.getByRole('button', { name: 'Riprendi' }));
    expect(handlers.onResume).toHaveBeenCalledWith('f1');
  });

  it('sends the daily quota to the keys, with Riprendi as the second choice', () => {
    const handlers = actions();
    render(<RunOutcomeBanner outcome={stopped({ error: 'quota_daily_limit_phase1' })} actions={handlers} canResume />);
    expect(screen.getByRole('heading').textContent).toBe('Quota giornaliera esaurita');
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi una chiave' }));
    expect(handlers.onOpenSettings).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Riprendi' })).toBeTruthy();
  });

  it('shows a key problem as an error that opens the settings', () => {
    const handlers = actions();
    render(<RunOutcomeBanner outcome={stopped({ error: 'Chiave API non valida: controlla di averla copiata per intero.' })} actions={handlers} canResume />);
    const banner = screen.getByTestId('run-outcome-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.className).toContain('is-error');
    expect(screen.getByRole('heading').textContent).toBe('Chiave API da controllare');
    fireEvent.click(screen.getByRole('button', { name: 'Apri le impostazioni' }));
    expect(handlers.onOpenSettings).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Riprendi' })).toBeNull();
  });

  it.each([
    ['an invalid key', new InvalidKeyError('401'), []],
    ['a model missing for the key', new ModelNotFoundError('models/x is not found'), []],
    ['2.5 Flash missing', new ModelNotFoundError('models/x is not found'), ['gemini-2.5-flash']],
    ['every model tried missing', new ModelNotFoundError('models/x is not found'), ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.6-flash']],
  ])('recognises the web run failure for %s as a key problem', (_case, error, missingModels) => {
    const { error: text } = failurePayload(error, null, { index: 0, id: 'f1' }, Date.now(), missingModels);
    render(<RunOutcomeBanner outcome={stopped({ error: text })} actions={actions()} canResume />);
    expect(screen.getByRole('heading').textContent).toBe('Chiave API da controllare');
    expect(screen.getByTestId('run-outcome-banner').textContent).toContain(text);
    expect(screen.getByRole('button', { name: 'Apri le impostazioni' })).toBeTruthy();
  });

  it('names the failed block and hides Riprendi while the app cannot run', () => {
    render(<RunOutcomeBanner outcome={stopped({ error: 'phase1_chunk_failed_3', errorDetail: 'Error: boom' })} actions={actions()} canResume={false} />);
    expect(screen.getByRole('heading').textContent).toBe('Sbobina interrotta al blocco 3');
    expect(screen.getByTestId('run-outcome-banner').textContent).toContain('Errore al blocco 3 dopo 4 tentativi');
    expect(screen.queryByRole('button', { name: 'Riprendi' })).toBeNull();
  });

  it('lists what to check in a finished sbobina and opens it or revises the sections', () => {
    const handlers = actions();
    render(
      <RunOutcomeBanner
        outcome={{
          kind: 'warning',
          fileId: 'f1',
          fileName: 'Lezione 4',
          htmlPath: 'web-session://s1/sbobina.html',
          sessionDir: 'web-session://s1',
          revisionFailedBlocks: [2, 5],
          warnings: [{ code: 'truncated_output', message: 'Gemini ha troncato il testo del blocco 1' }],
        }}
        actions={handlers}
        canResume
      />,
    );
    expect(screen.getByRole('heading').textContent).toBe('Sbobina pronta, con avvisi');
    // Without the host's own warning, the sections come from fileDone.
    expect(Array.from(screen.getByRole('list', { name: 'Avvisi' }).querySelectorAll('li'), li => li.textContent)).toEqual([
      'Gemini ha troncato il testo del blocco 1',
      '2 sezioni incluse senza revisione (sezioni 2, 5)',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Apri la sbobina' }));
    expect(handlers.onOpenSbobina).toHaveBeenCalledWith('web-session://s1/sbobina.html', 'Lezione 4', 'web-session://s1');
    fireEvent.click(screen.getByRole('button', { name: 'Rivedi le sezioni' }));
    expect(handlers.onReviseSections).toHaveBeenCalledWith('web-session://s1', 'f1');
  });

  it('offers to remove a file that retrying cannot fix', () => {
    const handlers = actions();
    const { rerender } = render(<RunOutcomeBanner outcome={stopped({ error: 'Il browser non riesce più a leggere il file audio: è stato spostato.' })} actions={handlers} canResume />);
    expect(screen.getByRole('heading').textContent).toBe('File audio non più leggibile');
    expect(screen.queryByRole('button', { name: /Riprova|Riprendi/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi dalla coda' }));
    expect(handlers.onRemove).toHaveBeenCalledWith('f1');

    rerender(<RunOutcomeBanner outcome={stopped({ error: 'Il file ha prodotto 5 blocchi invece di 6: non è lo stesso audio.' })} actions={handlers} canResume />);
    expect(screen.getByRole('heading').textContent).toBe('Non è lo stesso file audio');
    expect(screen.getByRole('button', { name: 'Rimuovi dalla coda' })).toBeTruthy();
  });

  it('sends a full browser storage to Archiviazione, with Riprendi as the second choice', () => {
    const handlers = actions();
    render(<RunOutcomeBanner outcome={stopped({ error: 'Spazio del browser esaurito: libera spazio (o elimina sbobine vecchie) e riprendi.' })} actions={handlers} canResume />);
    expect(screen.getByRole('heading').textContent).toBe('Spazio del browser esaurito');
    fireEvent.click(screen.getByRole('button', { name: 'Apri Archiviazione' }));
    expect(handlers.onOpenStorage).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Riprendi' })).toBeTruthy();
  });

  it('gives the common failures their own title', () => {
    const { rerender } = render(<RunOutcomeBanner outcome={stopped({ error: 'processing_failed', errorDetail: 'NetworkError: connessione di rete non disponibile' })} actions={actions()} canResume />);
    expect(screen.getByRole('heading').textContent).toBe('Connessione persa');
    expect(screen.getByRole('button', { name: 'Riprendi' })).toBeTruthy();
    rerender(<RunOutcomeBanner outcome={stopped({ error: 'phase1_degenerate_output' })} actions={actions()} canResume />);
    expect(screen.getByRole('heading').textContent).toBe('Testo non valido da Gemini');
    rerender(<RunOutcomeBanner outcome={stopped({ error: 'bad_request_phase1' })} actions={actions()} canResume />);
    expect(screen.getByRole('heading').textContent).toBe('Richiesta rifiutata da Gemini');
  });

  it('puts the actions beside the text, not inside it', () => {
    render(<RunOutcomeBanner outcome={stopped({ error: 'quota_daily_limit_phase1' })} actions={actions()} canResume />);
    const banner = screen.getByTestId('run-outcome-banner');
    const buttons = screen.getByTestId('run-outcome-actions');
    expect(buttons.parentElement).toBe(banner);
    expect(banner.querySelector('.run-outcome-body')!.contains(buttons)).toBe(false);
  });

  it('closes on the X', () => {
    const handlers = actions();
    render(<RunOutcomeBanner outcome={stopped({ error: 'processing_failed' })} actions={handlers} canResume />);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi avviso' }));
    expect(handlers.onDismiss).toHaveBeenCalled();
  });
});
