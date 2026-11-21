import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { useApiReady } from './hooks/useApiReady';
import { DEFAULT_CAPABILITIES, setHostCapabilities } from './hostCapabilities';

// Real motion/react here (App.dom.test mocks it away): page switches must not
// wait for the previous page's exit animation.
vi.mock('./hooks/useApiReady');
vi.mock('./hooks/useQueuePersistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('./hooks/useQueuePersistence')>(),
  useQueuePersistence: vi.fn(),
}));
vi.mock('./hooks/useBridgeCallbacks', () => ({ useBridgeCallbacks: vi.fn() }));
vi.mock('./components/EditorFullPage', () => ({ EditorFullPage: () => null }));

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  localStorage.clear();
  Object.defineProperty(window, 'pywebview', {
    value: { api: {
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
    } },
    writable: true,
    configurable: true,
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
  vi.mocked(useApiReady).mockReturnValue({
    apiReady: true, bridgeDelayed: false, apiKey: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345', setApiKey: vi.fn(),
    fallbackKeys: [], setFallbackKeys: vi.fn(),
    preferredModel: 'gemini-2.5-flash', setPreferredModel: vi.fn(),
    availableModels: [], refreshSettings: vi.fn(),
  } as unknown as ReturnType<typeof useApiReady>);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  // The page is in the URL: each test starts from the dashboard.
  window.history.replaceState(null, '', '/');
});

it('shows the next page in the same commit instead of after the exit animation', async () => {
  await act(async () => { render(<App />); });
  const nav = screen.getByRole('navigation');
  const mains = () => Array.from(document.querySelectorAll('main'));
  expect(mains()).toHaveLength(1);
  const queue = mains()[0];

  act(() => { fireEvent.click(within(nav).getByRole('button', { name: 'Archivio' })); });
  // One page at a time: no stacked scroll containers while a page fades out.
  expect(mains()).toHaveLength(1);
  expect(queue.isConnected).toBe(false);
  const archive = mains()[0];

  act(() => { fireEvent.click(within(nav).getByRole('button', { name: 'Dashboard' })); });
  expect(mains()).toHaveLength(1);
  expect(archive.isConnected).toBe(false);
  expect(mains()[0]).not.toBe(queue);
  // Back to the dashboard goes back in the history: let its popstate land in this test.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
});

it('web: the page is in the URL, so a reload reopens it and Back returns to the dashboard', async () => {
  window.history.replaceState(null, '', '/#/archivio');
  try {
    await act(async () => { render(<App />); });
    expect(await screen.findByText('Archivio Sbobine')).toBeTruthy();

    const nav = screen.getByRole('navigation');
    act(() => { fireEvent.click(within(nav).getByRole('button', { name: 'Dashboard' })); });
    expect(window.location.hash).toBe('');
    await act(async () => {
      window.history.back();
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(window.location.hash).toBe('#/archivio');
    expect(await screen.findByText('Archivio Sbobine')).toBeTruthy();
  } finally {
    setHostCapabilities(DEFAULT_CAPABILITIES);
    window.history.replaceState(null, '', '/');
  }
});
