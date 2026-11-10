import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { useApiReady } from './hooks/useApiReady';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import type { EditorFullPageProps } from './components/EditorFullPage';

// The real usePreview and useArchiveSync run here (App.dom.test mocks usePreview away), so this
// covers the App wiring of the editor's title: rename_session -> archive -> open editor heading.
// The editor itself is a stub: its title field has its own tests in EditorFullPage.dom.test.
vi.mock('./hooks/useApiReady');
vi.mock('./hooks/useUpdateChecker');
vi.mock('./hooks/useQueuePersistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('./hooks/useQueuePersistence')>(),
  useQueuePersistence: vi.fn(),
}));
vi.mock('./hooks/useBridgeCallbacks', () => ({ useBridgeCallbacks: vi.fn() }));
vi.mock('./components/EditorFullPage', () => ({
  EditorFullPage: ({ document: doc, onClose }: EditorFullPageProps) => (
    <section aria-label="Editor stub">
      <h1>{doc.title}</h1>
      {doc.onRename && <button type="button" onClick={() => { void doc.onRename!('  Cardiologia 2  '); }}>Rinomina dal titolo</button>}
      <button type="button" onClick={onClose}>Chiudi editor</button>
    </section>
  ),
}));

const session = {
  name: 'Lezione cardio',
  session_dir: 'D:\\sessions\\cardio',
  completed_at_iso: '2026-11-01T10:00:00Z',
  html_path: 'D:\\sessions\\cardio\\outputs.html',
  input_path: '',
  effective_model: 'gemini-2.5-flash',
};

let renameSession: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  localStorage.clear();
  renameSession = vi.fn().mockResolvedValue({ ok: true, name: 'Cardiologia 2' });
  Object.defineProperty(window, 'pywebview', {
    value: { api: {
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [session] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      read_html_content: vi.fn().mockResolvedValue({ ok: true, content: '<html><body><p>Testo</p></body></html>' }),
      rename_session: renameSession,
    } },
    writable: true,
    configurable: true,
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
  vi.mocked(useApiReady).mockReturnValue({
    apiReady: true, bridgeDelayed: false, apiKey: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345', setApiKey: vi.fn(),
    hasProtectedKey: false, apiKeyInsecure: false, setApiKeyInsecure: vi.fn(), apiKeyInsecureReason: '',
    setApiKeyInsecureReason: vi.fn(), configRecoveredFrom: '', fallbackKeys: [], setFallbackKeys: vi.fn(),
    configuredFallbackKeyCount: 0, preferredModel: 'gemini-2.5-flash', setPreferredModel: vi.fn(),
    availableModels: [], refreshSettings: vi.fn(),
  } as unknown as ReturnType<typeof useApiReady>);
  vi.mocked(useUpdateChecker).mockReturnValue({
    updateAvailable: null, latestVersion: null, isDismissed: false, isCheckingUpdate: false,
    hasChecked: true, checkFailed: false, checkForUpdates: vi.fn(), dismissUpdate: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateChecker>);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('a rename from the editor title shows the saved name in the editor heading and in the archive', async () => {
  await act(async () => { render(<App />); });
  act(() => { fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Archivio' })); });
  // The archive shows it twice: the "Ultima sbobina aperta" card and its entry in the list.
  const cards = await screen.findAllByText('Lezione cardio');
  expect(cards).toHaveLength(2);
  fireEvent.click(cards[cards.length - 1]);

  const editor = await screen.findByRole('region', { name: 'Editor stub' });
  expect(within(editor).getByRole('heading', { level: 1 }).textContent).toBe('Lezione cardio');

  await act(async () => { fireEvent.click(within(editor).getByRole('button', { name: 'Rinomina dal titolo' })); });

  expect(renameSession).toHaveBeenCalledWith(session.session_dir, '  Cardiologia 2  ');
  // The heading takes the name the archive saved, not the raw text typed in the field.
  expect(within(editor).getByRole('heading', { level: 1 }).textContent).toBe('Cardiologia 2');

  act(() => { fireEvent.click(within(editor).getByRole('button', { name: 'Chiudi editor' })); });
  expect(await screen.findAllByText('Cardiologia 2')).toHaveLength(2);
  expect(screen.queryByText('Lezione cardio')).toBeNull();
});
