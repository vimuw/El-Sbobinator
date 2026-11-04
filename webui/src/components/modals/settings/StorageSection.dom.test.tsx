import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StorageSection } from './StorageSection';

describe('StorageSection component', () => {
  const baseProps = {
    sessionInfo: { total_bytes: 1048576, total_sessions: 3, session_root: '/home/user/sessions' },
    isMoveInProgress: false,
    moveProgress: null,
    moveError: null,
    onOpenSessionFolder: vi.fn(),
    onAskMoveFolder: vi.fn(),
    isCleaningSession: false,
    cleanupResult: null,
    onAskCleanup: vi.fn(),
  };

  it('renders session root path and triggers onOpenSessionFolder when clicked', () => {
    render(<StorageSection {...baseProps} />);

    // Verify session root is displayed
    expect(screen.getByText('/home/user/sessions')).toBeTruthy();

    // Verify clicking opens session folder
    fireEvent.click(screen.getByTitle('Apri cartella sessioni'));
    expect(baseProps.onOpenSessionFolder).toHaveBeenCalledTimes(1);
  });

  it('shows the used space as one line under the folder instead of stat cards', () => {
    const { container } = render(<StorageSection {...baseProps} />);

    expect(screen.getByTestId('storage-usage').textContent).toBe('3 sbobine · 1,0 MB occupati');
    expect(container.querySelector('.premium-panel')).toBeNull();
    expect(screen.queryByText('Spazio occupato')).toBeNull();
    expect(screen.queryByText('Spazio disco e archivio')).toBeNull();
  });

  it('shows the host breakdown under the total only when there is one', () => {
    const { rerender } = render(<StorageSection {...baseProps} />);
    expect(screen.queryByTestId('storage-usage-detail')).toBeNull();
    rerender(<StorageSection {...baseProps} sessionInfo={{ ...baseProps.sessionInfo, usage_detail: 'Audio delle lezioni 27.0 MB · stima del browser 1.1 MB' }} />);
    expect(screen.getByTestId('storage-usage-detail').textContent).toBe('Audio delle lezioni 27.0 MB · stima del browser 1.1 MB');
  });

  it('web: speaks of this browser instead of a folder on disk, without the folder cleanup', () => {
    render(<StorageSection {...baseProps} canManageSessionFolder={false} inBrowser sessionInfo={{ ...baseProps.sessionInfo, session_root: 'Memoria di questo browser' }} />);
    expect(screen.getByRole('region', { name: 'Le tue sbobine' }).textContent).toContain('salvati in questo browser, su questo dispositivo');
    expect(screen.queryByText('Cartella sessioni')).toBeNull();
    expect(screen.queryByText(/su disco/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pulisci elaborazioni incomplete' })).toBeNull();
  });

  it('web: puts the count and the total first, then what takes the space', () => {
    const sessionInfo = {
      ...baseProps.sessionInfo,
      usage_detail: 'Testi delle sbobine 1,0 MB · audio delle sbobine 0 KB · stima del browser 2 KB',
      usage_breakdown: [{ label: 'Testi delle sbobine', bytes: 1048576 }, { label: 'Audio delle sbobine', bytes: 0 }],
      browser_estimate_bytes: 2048,
    };
    render(<StorageSection {...baseProps} canManageSessionFolder={false} inBrowser sessionInfo={sessionInfo} />);
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
    const webProps = { ...baseProps, canManageSessionFolder: false, inBrowser: true, sessionInfo: { ...baseProps.sessionInfo, persisted: false } };
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
    const webProps = { ...baseProps, canManageSessionFolder: false, inBrowser: true };
    const { container, rerender } = render(<StorageSection {...webProps} sessionInfo={{ ...baseProps.sessionInfo, session_root: sessionRoot, persisted: false }} />);
    expect(screen.queryByText(sessionRoot)).toBeNull();
    expect(container.querySelector('.break-all')).toBeNull();
    expect(screen.queryByTestId('storage-persisted')).toBeNull();

    rerender(<StorageSection {...webProps} sessionInfo={{ ...baseProps.sessionInfo, session_root: sessionRoot, persisted: true }} />);
    expect(screen.getByTestId('storage-persisted').textContent).toBe('Il browser protegge questi dati dalla pulizia automatica.');
  });

  it('shows the folder total in the same units as the rest of the app', () => {
    // A second formatter wrote "0 B" here beside "0 KB" in the breakdown.
    render(<StorageSection {...baseProps} sessionInfo={{ ...baseProps.sessionInfo, total_bytes: 0 }} />);
    expect(screen.getByTestId('storage-usage').textContent).toBe('3 sbobine · 0 KB occupati');
  });

  it('web: warns that the browser may clear the data only when it did not promise to keep it', () => {
    const webProps = { ...baseProps, canManageSessionFolder: false, inBrowser: true };
    const { rerender } = render(<StorageSection {...webProps} sessionInfo={{ ...baseProps.sessionInfo, persisted: false }} />);
    const warning = screen.getByTestId('storage-persist-warning');
    expect(warning.textContent).toContain('Il browser può cancellare questi dati');
    expect(warning.textContent).toContain('circa 7');
    // Without Drive in this build, the backup is the only way to keep a copy.
    expect(warning.textContent).toContain('backup');
    expect(warning.textContent).not.toContain('Google Drive');

    rerender(<StorageSection {...webProps} sessionInfo={{ ...baseProps.sessionInfo, persisted: true }} />);
    expect(screen.queryByTestId('storage-persist-warning')).toBeNull();
    rerender(<StorageSection {...baseProps} sessionInfo={{ ...baseProps.sessionInfo, persisted: false }} />);
    expect(screen.queryByTestId('storage-persist-warning')).toBeNull();
  });

  it('says when the used space is still loading or unavailable', () => {
    const { rerender } = render(<StorageSection {...baseProps} sessionInfo={null} isLoadingSessionInfo />);
    expect(screen.getByTestId('storage-usage').textContent).toBe('Calcolo dello spazio occupato…');
    rerender(<StorageSection {...baseProps} sessionInfo={null} />);
    expect(screen.getByTestId('storage-usage').textContent).toBe('Spazio occupato non disponibile.');
  });

  it('offers only the incomplete cleanup and warns that it cannot be resumed', () => {
    render(<StorageSection {...baseProps} />);

    expect(screen.getByRole('button', { name: 'Pulisci elaborazioni incomplete' })).toBeTruthy();
    expect(screen.getByText(/non si potranno più riprendere/)).toBeTruthy();
    expect(screen.queryByText('Sbobine archiviate')).toBeNull();
    expect(screen.queryByRole('button', { name: /sbobine completate/i })).toBeNull();
  });

  it('hides folder actions when the host cannot manage local folders', () => {
    render(<StorageSection {...baseProps} canManageSessionFolder={false} />);

    expect(screen.getByText('/home/user/sessions')).toBeTruthy();
    expect(screen.queryByTitle('Apri cartella sessioni')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cambia cartella' })).toBeNull();
  });

  it('renders move progress with .alert-card.is-info', () => {
    const { container } = render(
      <StorageSection
        {...baseProps}
        isMoveInProgress={true}
        moveProgress={{ moved: 2, total: 5 }}
      />,
    );

    const alert = container.querySelector('.alert-card.is-info');
    expect(alert).toBeTruthy();
    expect(screen.getByText('Spostamento cartella in corso...')).toBeTruthy();
  });

  it('renders move error with .alert-card.is-error', () => {
    const { container } = render(
      <StorageSection
        {...baseProps}
        moveError="Permesso negato sul disco"
      />,
    );

    const alert = container.querySelector('.alert-card.is-error');
    expect(alert).toBeTruthy();
    expect(screen.getByText('Permesso negato sul disco')).toBeTruthy();
  });

  it('renders informational notice with .alert-card.is-info when cleanup removed 0 items', () => {
    const { container } = render(
      <StorageSection
        {...baseProps}
        cleanupResult={{ removed: 0, freed_bytes: 0 }}
      />,
    );

    const alert = container.querySelector('.alert-card.is-info');
    expect(alert).toBeTruthy();
    expect(screen.getByText('Nessuna elaborazione incompleta da eliminare.')).toBeTruthy();
  });

  it('renders success notice with .alert-card.is-success when cleanup removed items', () => {
    const { container } = render(
      <StorageSection
        {...baseProps}
        cleanupResult={{ removed: 2, freed_bytes: 2048 }}
      />,
    );

    const alert = container.querySelector('.alert-card.is-success');
    expect(alert).toBeTruthy();
    expect(screen.getByText(/Rimosse 2 elaborazioni incomplete/)).toBeTruthy();
  });

  it('renders close button in top right and triggers onDismissCleanupResult when clicked', () => {
    const onDismiss = vi.fn();
    render(
      <StorageSection
        {...baseProps}
        cleanupResult={{ removed: 0, freed_bytes: 0 }}
        onDismissCleanupResult={onDismiss}
      />,
    );

    const closeBtn = screen.getByRole('button', { name: 'Chiudi notifica' });
    expect(closeBtn).toBeTruthy();
    expect(closeBtn.className).toContain('absolute');
    expect(closeBtn.className).toContain('top-2.5');
    expect(closeBtn.className).toContain('right-2.5');
    expect(closeBtn.querySelector('svg')).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
