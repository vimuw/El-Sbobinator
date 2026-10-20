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

    expect(screen.getByTestId('storage-usage').textContent).toBe('3 sbobine · 1.0 MB occupati');
    expect(container.querySelector('.premium-panel')).toBeNull();
    expect(screen.queryByText('Spazio occupato')).toBeNull();
    expect(screen.queryByText('Spazio disco e archivio')).toBeNull();
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
