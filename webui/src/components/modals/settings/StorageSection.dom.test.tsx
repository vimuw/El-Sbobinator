import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StorageSection } from './StorageSection';

describe('StorageSection component', () => {
  const baseProps = {
    sessionInfo: { total_bytes: 1048576, total_sessions: 3, session_root: 'Memoria di questo browser' },
  };

  it('web: speaks of this browser instead of a folder on disk, without the folder cleanup', () => {
    render(<StorageSection {...baseProps} sessionInfo={{ ...baseProps.sessionInfo, session_root: 'Memoria di questo browser' }} />);
    expect(screen.getByRole('region', { name: 'Le tue sbobine' }).textContent).toContain('salvati in questo browser, su questo dispositivo');
    expect(screen.queryByText('Cartella sessioni')).toBeNull();
    expect(screen.queryByText(/su disco/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pulisci elaborazioni incomplete' })).toBeNull();
  });

  it('web: links the audio of the sbobine to the archive of the sbobine that keep it, only while there is some', () => {
    const onShowKeptAudio = vi.fn();
    const breakdown = (audio: number) => ({
      ...baseProps.sessionInfo,
      usage_breakdown: [
        { label: 'Testi delle sbobine', bytes: 1048576 },
        { label: 'Audio delle sbobine', bytes: audio, kind: 'session_audio' as const },
        { label: 'Audio in coda', bytes: 2048 },
      ],
    });
    const { rerender } = render(<StorageSection {...baseProps} sessionInfo={breakdown(400 * 1024 * 1024)} onShowKeptAudio={onShowKeptAudio} />);
    const link = screen.getByRole('button', { name: 'Vedi quali' });
    expect(link.closest('li')?.textContent).toContain('Audio delle sbobine');
    expect(screen.getAllByRole('button', { name: 'Vedi quali' })).toHaveLength(1);
    fireEvent.click(link);
    expect(onShowKeptAudio).toHaveBeenCalledTimes(1);

    rerender(<StorageSection {...baseProps} sessionInfo={breakdown(0)} onShowKeptAudio={onShowKeptAudio} />);
    expect(screen.queryByRole('button', { name: 'Vedi quali' })).toBeNull();
    rerender(<StorageSection {...baseProps} sessionInfo={breakdown(4096)} />);
    expect(screen.queryByRole('button', { name: 'Vedi quali' })).toBeNull();
  });

  it('web: puts the count and the total first, then what takes the space', () => {
    const sessionInfo = {
      ...baseProps.sessionInfo,
      usage_detail: 'Testi delle sbobine 1,0 MB · audio delle sbobine 0 KB · stima del browser 2 KB',
      usage_breakdown: [{ label: 'Testi delle sbobine', bytes: 1048576 }, { label: 'Audio delle sbobine', bytes: 0 }],
      browser_estimate_bytes: 2048,
    };
    render(<StorageSection {...baseProps} sessionInfo={sessionInfo} />);
    expect(screen.getByTestId('storage-count').textContent).toBe('3');
    expect(screen.getByTestId('storage-total').textContent).toBe('1,0 MB');
    expect(screen.getByTestId('storage-usage').textContent).toContain('occupati da 3 sbobine');
    const rows = screen.getAllByRole('listitem').map(row => row.textContent);
    expect(rows).toEqual(['Testi delle sbobine1,0 MB', 'Audio delle sbobine0 KB']);
    // The list replaces the one-line text, so nothing is said twice.
    expect(screen.queryByTestId('storage-usage-detail')).toBeNull();
    expect(screen.getByTestId('storage-browser-estimate').textContent).toContain('2 KB');
  });

  it('web: suggests linking Google Drive when this build has it and no account is linked', () => {
    const webProps = { ...baseProps, sessionInfo: { ...baseProps.sessionInfo, persisted: false } };
    const { rerender } = render(<StorageSection {...webProps} drive="disconnected" />);
    const warning = screen.getByTestId('storage-persist-warning');
    expect(warning.className).toContain('is-warning');
    expect(warning.textContent).toContain('Attiva la sincronizzazione: le sbobine restano anche nel tuo Google Drive.');
    // Drive keeps the texts, never the lecture audio.
    expect(warning.textContent).toContain('non gli audio delle lezioni');

    rerender(<StorageSection {...webProps} drive="connected" />);
    const note = screen.getByTestId('storage-persist-warning');
    expect(note.className).toContain('is-info');
    expect(note.textContent).toContain('copiate nel tuo Google Drive');
    expect(note.textContent).toContain('Gli audio delle lezioni restano solo qui');
    expect(screen.getByText('Salvate anche su Drive')).toBeTruthy();
    expect(screen.queryByText('Non protette')).toBeNull();
  });

  it('web: no folder path box, so the browser message is not cut mid-word or said twice', () => {
    // The path box (break-all) split "non" into "no / n" and repeated the yellow warning below it.
    const sessionRoot = 'Memoria di questo browser: il browser può svuotarla se manca spazio o se non apri il sito per molti giorni';
    const webProps = { ...baseProps };
    const { container, rerender } = render(<StorageSection {...webProps} sessionInfo={{ ...baseProps.sessionInfo, session_root: sessionRoot, persisted: false }} />);
    expect(screen.queryByText(sessionRoot)).toBeNull();
    expect(container.querySelector('.break-all')).toBeNull();
    expect(screen.queryByTestId('storage-persisted')).toBeNull();

    rerender(<StorageSection {...webProps} sessionInfo={{ ...baseProps.sessionInfo, session_root: sessionRoot, persisted: true }} />);
    expect(screen.getByTestId('storage-persisted').textContent).toBe('Il browser protegge questi dati dalla pulizia automatica.');
  });

  it('shows the total in the same units as the rest of the app', () => {
    // A second formatter wrote "0 B" here beside "0 KB" in the breakdown.
    render(<StorageSection {...baseProps} sessionInfo={{ ...baseProps.sessionInfo, total_bytes: 0 }} />);
    const usage = screen.getByTestId('storage-usage').textContent ?? '';
    expect(usage).toContain('0 KB');
    expect(usage).not.toMatch(/\b0 B\b/);
  });

  it('web: warns that the browser may clear the data only when it did not promise to keep it', () => {
    const webProps = { ...baseProps };
    const { rerender } = render(<StorageSection {...webProps} sessionInfo={{ ...baseProps.sessionInfo, persisted: false }} />);
    const warning = screen.getByTestId('storage-persist-warning');
    expect(warning.textContent).toContain('Il browser può cancellare questi dati');
    expect(warning.textContent).toContain('circa 7');
    // Without Drive in this build, the backup is the only way to keep a copy.
    expect(warning.textContent).toContain('backup');
    expect(warning.textContent).not.toContain('Google Drive');

    rerender(<StorageSection {...webProps} sessionInfo={{ ...baseProps.sessionInfo, persisted: true }} />);
    expect(screen.queryByTestId('storage-persist-warning')).toBeNull();
  });

  it('says when the used space is still loading or unavailable', () => {
    const { rerender } = render(<StorageSection {...baseProps} sessionInfo={null} isLoadingSessionInfo />);
    expect(screen.getByTestId('storage-usage').textContent).toBe('Calcolo dello spazio occupato…');
    rerender(<StorageSection {...baseProps} sessionInfo={null} />);
    expect(screen.getByTestId('storage-usage').textContent).toBe('Spazio occupato non disponibile.');
  });

});
