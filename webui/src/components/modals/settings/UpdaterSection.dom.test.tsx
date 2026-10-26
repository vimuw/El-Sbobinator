import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UpdaterSection, UpdateNotice } from './UpdaterSection';

describe('UpdaterSection component', () => {
  const defaultProps = {
    latestVersion: null,
    checkForUpdates: vi.fn(),
    isCheckingUpdate: false,
    hasChecked: false,
    checkFailed: false,
    updateInstallState: undefined,
    onInstallUpdate: vi.fn(),
  };

  it('renders installed application version', () => {
    render(<UpdaterSection {...defaultProps} />);
    expect(screen.getByText('Versione e aggiornamenti')).toBeTruthy();
    expect(screen.getByText(/Installata:/)).toBeTruthy();
  });

  it('triggers checkForUpdates when check button is clicked', () => {
    const checkForUpdates = vi.fn();
    render(<UpdaterSection {...defaultProps} checkForUpdates={checkForUpdates} />);

    const checkBtn = screen.getByRole('button', { name: 'Cerca aggiornamenti' });
    expect(checkBtn).toBeTruthy();
    expect(screen.getByText('Cerca aggiornamenti')).toBeTruthy();
    fireEvent.click(checkBtn);
    expect(checkForUpdates).toHaveBeenCalledWith(true);
  });

  it('renders update available banner with clean styling', () => {
    const onInstall = vi.fn();
    const { container } = render(
      <UpdateNotice
        {...defaultProps}
        latestVersion="v2.5.1"
        onInstallUpdate={onInstall}
      />,
    );

    // Verify title and version, shown as plain text
    expect(screen.getByText('Nuova versione disponibile')).toBeTruthy();
    const badge = screen.getByText('v2.5.1');
    expect(badge).toBeTruthy();
    expect(badge.className).not.toContain('rounded-full');

    // Verify card styling
    const card = container.querySelector('.bg-\\[var\\(--accent-subtle\\)\\]');
    expect(card).toBeTruthy();
    expect(card?.className).toContain('rounded-lg');

    // Verify release notes link
    expect(screen.getByText('Note di rilascio su GitHub')).toBeTruthy();

    // Verify update button and trigger
    const updateBtn = screen.getByRole('button', { name: 'Installa aggiornamento' });
    expect(updateBtn).toBeTruthy();
    fireEvent.click(updateBtn);
    expect(onInstall).toHaveBeenCalledWith('v2.5.1');
  });

  it('renders download progress state', () => {
    render(
      <UpdateNotice
        {...defaultProps}
        latestVersion="v2.5.1"
        updateInstallState={{
          version: '2.5.1',
          status: 'downloading',
          bytesDone: 5242880,
          bytesTotal: 10485760,
          percent: 50,
          error: null,
        }}
      />,
    );

    expect(screen.getByText('Download aggiornamento…')).toBeTruthy();
    expect(screen.getByText(/50%/)).toBeTruthy();
  });

  it('renders error notice when checkFailed is true', () => {
    render(
      <UpdaterSection
        {...defaultProps}
        hasChecked={true}
        checkFailed={true}
      />,
    );

    expect(screen.getByText('Verifica aggiornamenti non riuscita.')).toBeTruthy();
  });

  it('leaves an update already known on opening to the top notice', () => {
    render(
      <UpdaterSection {...defaultProps} hasChecked={true} latestVersion="v9.9.9" />,
    );

    expect(screen.queryByText(/È disponibile la versione/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Aggiorna a/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Note di rilascio ↗' })).toBeNull();
    expect(screen.queryByText('→')).toBeNull();
  });

  it('turns the check button into the install action after a manual check', () => {
    const onInstallUpdate = vi.fn().mockResolvedValue(undefined);
    const props = { ...defaultProps, hasChecked: true, latestVersion: 'v9.9.9', onInstallUpdate };
    const { rerender } = render(<UpdaterSection {...props} />);
    screen.getByRole('status').scrollIntoView = vi.fn();
    const checkButton = screen.getByRole('button', { name: 'Cerca aggiornamenti' });
    checkButton.focus();

    fireEvent.click(checkButton);
    rerender(<UpdaterSection {...props} isCheckingUpdate={true} />);
    expect(screen.queryByRole('button', { name: /Aggiorna a/ })).toBeNull();
    rerender(<UpdaterSection {...props} />);

    // One button, morphed in place and still focused; no second call to action below it.
    const installButton = screen.getByRole('button', { name: 'Aggiorna a v9.9.9' });
    expect(installButton).toBe(checkButton);
    expect(document.activeElement).toBe(installButton);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Cerca aggiornamenti' })).toBeNull();
    expect(screen.getByText(/Installata:/).textContent).toMatch(/v\d+\.\d+\.\d+→disponibile v9\.9\.9/);
    expect(screen.getByRole('link', { name: 'Note di rilascio ↗' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('È disponibile la versione v9.9.9.');

    fireEvent.click(installButton);
    expect(onInstallUpdate).toHaveBeenCalledWith('v9.9.9');
    rerender(<UpdaterSection {...props} showsInstallFeedback updateInstallState={{ status: 'downloading', bytesDone: 1, bytesTotal: 2 }} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Cerca aggiornamenti' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows install progress only where the install was started', () => {
    const updateInstallState = { status: 'downloading' as const, bytesDone: 1, bytesTotal: 2 };
    const { rerender } = render(
      <>
        <UpdateNotice latestVersion="v9.9.9" updateInstallState={updateInstallState} showsInstallFeedback={false} />
        <UpdaterSection {...defaultProps} latestVersion="v9.9.9" updateInstallState={updateInstallState} showsInstallFeedback />
      </>,
    );
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Versione e aggiornamenti' }).contains(screen.getByRole('progressbar'))).toBe(true);

    rerender(
      <>
        <UpdateNotice latestVersion="v9.9.9" updateInstallState={{ status: 'done' }} showsInstallFeedback={false} />
        <UpdaterSection {...defaultProps} latestVersion="v9.9.9" updateInstallState={{ status: 'done' }} showsInstallFeedback />
      </>,
    );
    expect(screen.getAllByText('Installer avviato. Segui le istruzioni a schermo.')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Aggiornamento applicazione' })).toBeNull();
  });

  it('renders up to date notice when checked with no update', () => {
    render(
      <UpdaterSection
        {...defaultProps}
        hasChecked={true}
        latestVersion={null}
      />,
    );

    expect(screen.getByText('Sei aggiornato alla versione più recente.')).toBeTruthy();
  });
});
