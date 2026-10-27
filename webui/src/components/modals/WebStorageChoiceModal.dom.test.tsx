import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriveStatus } from '../../bridge';
import { STORAGE_KEYS } from '../../storageKeys';
import { WebStorageChoicePrompt } from './WebStorageChoiceModal';

// "Dove tengo le sbobine?": asked once, when the archive has its first sbobina, only with Drive.

const status = (connected: boolean, error: string | null = null): DriveStatus => ({
  available: true, connected, email: connected ? 'studente@example.com' : null, needs_reconnect: false, syncing: false, last_sync_at: null, error,
});

function setup(initial: DriveStatus = status(false), afterConnect: DriveStatus = status(true)) {
  const connect = vi.fn(async () => afterConnect);
  window.pywebview = { api: { get_drive_status: vi.fn(async () => initial), connect_drive: connect } as never };
  return { connect };
}

const choice = () => localStorage.getItem(STORAGE_KEYS.WEB_STORAGE_CHOICE_V1);

afterEach(() => {
  delete window.pywebview;
  localStorage.clear();
});

describe('WebStorageChoicePrompt', () => {
  it('waits for the first sbobina and for the dashboard', async () => {
    setup();
    const { rerender } = render(<WebStorageChoicePrompt sessionCount={0} blocked={false} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<WebStorageChoicePrompt sessionCount={1} blocked />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<WebStorageChoicePrompt sessionCount={1} blocked={false} />);
    expect(await screen.findByRole('dialog', { name: 'Dove tengo le sbobine?' })).toBeTruthy();
  });

  it('"Solo in questo browser" warns that the data stay on this device', async () => {
    const { connect } = setup();
    render(<WebStorageChoicePrompt sessionCount={2} blocked={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /Solo in questo browser/ }));
    expect(screen.getByRole('note').textContent).toContain('Safari può cancellarle');
    expect(choice()).toBe('browser');
    fireEvent.click(screen.getByRole('button', { name: 'Ho capito' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(connect).not.toHaveBeenCalled();
  });

  it('"In questo browser + Google Drive" starts the link inside the tap and reports a failure', async () => {
    const { connect } = setup(status(false), status(false, 'Accesso a Google Drive non concesso.'));
    const onConnectResult = vi.fn();
    render(<WebStorageChoicePrompt sessionCount={1} blocked={false} onConnectResult={onConnectResult} />);
    fireEvent.click(await screen.findByRole('button', { name: /In questo browser \+ Google Drive/ }));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(choice()).toBe('drive');
    await waitFor(() => expect(onConnectResult).toHaveBeenCalledWith(expect.objectContaining({ error: 'Accesso a Google Drive non concesso.' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('never asks a browser already linked, nor twice, nor without Drive', async () => {
    setup(status(true));
    const { unmount } = render(<WebStorageChoicePrompt sessionCount={1} blocked={false} />);
    await waitFor(() => expect(choice()).toBe('drive'));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    localStorage.setItem(STORAGE_KEYS.WEB_STORAGE_CHOICE_V1, 'browser');
    setup();
    render(<WebStorageChoicePrompt sessionCount={1} blocked={false} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(screen.queryByRole('dialog')).toBeNull();

    localStorage.clear();
    window.pywebview = { api: {} as never };
    render(<WebStorageChoicePrompt sessionCount={1} blocked={false} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
