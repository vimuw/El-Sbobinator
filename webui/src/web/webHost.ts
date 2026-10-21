import type { FileDescriptor } from '../appState';
import type { PywebviewApi, ValidationResult } from '../bridge';
import { APP_VERSION } from '../branding';
import { type HostCapabilities, setHostCapabilities } from '../hostCapabilities';
import { GEMINI_KEY_PATTERN } from '../utils';
import { type BridgeEventName, type EmitBridgeEvent, runFakePipeline } from './fakePipeline';
import { hasWebFile, isWebSupportedMedia, promptWebFiles, registerWebFile } from './webFiles';
import {
  createWebSession,
  deleteWebSession,
  listWebSessions,
  loadWebFolders,
  readWebHtml,
  saveWebFolders,
  saveWebHtml,
  searchWebSessions,
  updateWebSession,
} from './webSessions';
import { WEB_MODEL_OPTIONS, loadWebKeys, loadWebModel, saveWebKeys, saveWebModel } from './webSettings';

// Third host: the whole app runs in this page (static site, no backend). It implements the same
// PywebviewApi contract as pywebview and the FastAPI dev host, and delivers bridge events by calling
// window.elSbobinatorBridge directly. Methods left out are features the web build hides.

export const WEB_CAPABILITIES: Partial<HostCapabilities> = {
  kind: 'web',
  fileUpload: true,
  fileDrop: true,
  nativeFolderPicker: false,
  openLocalPath: false,
  osNotifications: false,
  updateInstallation: false,
  // M0: the run is simulated (fakePipeline.ts).
  realPipeline: false,
  credentialPersistence: true,
  windowControls: false,
  keyStorage: 'browser',
  // M2b brings audio stored in OPFS.
  editorAudio: false,
  sbobinaPackages: false,
  environmentCheck: false,
};

type QueuedEvent = { name: BridgeEventName; payload: unknown };

// Events are delivered asynchronously and in order, like the desktop dispatcher; if the UI has not
// registered its callbacks yet they wait.
export function createBridgeEmitter(target: () => Window['elSbobinatorBridge']): EmitBridgeEvent {
  const queue: QueuedEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const drain = () => {
    timer = null;
    const bridge = target() as unknown as Record<string, ((payload: unknown) => void) | undefined> | null | undefined;
    if (!bridge) {
      if (queue.length > 0) timer = setTimeout(drain, 10);
      return;
    }
    while (queue.length > 0) {
      const event = queue.shift()!;
      bridge[event.name]?.(event.payload);
    }
  };
  return (name, payload) => {
    queue.push({ name, payload });
    if (timer === null) timer = setTimeout(drain, 0);
  };
}

function describeDevice(): string {
  const lines = [
    `- Versione: ${APP_VERSION} (web)`,
    `- Browser: ${navigator.userAgent}`,
    `- Finestra: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    `- Touch: ${navigator.maxTouchPoints > 0 ? 'sì' : 'no'}`,
    `- Sbobine nell'archivio: ${listWebSessions().length}`,
  ];
  return lines.join('\n');
}

export function createWebPywebviewApi(emit: EmitBridgeEvent): PywebviewApi {
  let activeRun: AbortController | null = null;
  const frontendEvents: string[] = [];

  const acceptFiles = (picked: File[]): FileDescriptor[] => {
    const descriptors: FileDescriptor[] = [];
    for (const file of picked) {
      if (isWebSupportedMedia(file.name)) descriptors.push(registerWebFile(file));
      else emit('appendConsole', `⚠ Formato non supportato nella versione web: ${file.name}. Usa un file MP3, M4A o MP4.`);
    }
    return descriptors;
  };

  return {
    load_settings: async () => {
      const keys = loadWebKeys();
      return {
        api_key: keys[0] ?? '',
        fallback_keys: keys.slice(1),
        preferred_model: loadWebModel(),
        available_models: WEB_MODEL_OPTIONS,
        has_protected_key: false,
      };
    },
    save_settings: async (apiKey, fallbackKeys, preferredModel) => {
      const current = loadWebKeys();
      const primary = apiKey === null ? current[0] ?? '' : apiKey.trim();
      const reserves = fallbackKeys === null ? current.slice(1) : fallbackKeys;
      const saved = saveWebKeys([primary, ...reserves]) && saveWebModel(preferredModel);
      return saved ? { ok: true } : { ok: false, error: 'Il browser non consente di salvare le impostazioni (memoria locale non disponibile).' };
    },
    save_theme_preference: async () => {},
    // Format check only: a real request would spend free-tier quota.
    validate_environment: async (apiKey) => {
      const key = (apiKey ?? loadWebKeys()[0] ?? '').trim();
      const valid = GEMINI_KEY_PATTERN.test(key);
      const result: ValidationResult = {
        ok: valid,
        summary: valid ? 'Chiave API nel formato corretto.' : 'Chiave API mancante o nel formato sbagliato.',
        checks: [{ id: 'api_key', label: 'Chiave API', status: valid ? 'ok' : 'error', message: valid ? 'Formato valido' : 'Inserisci una chiave che inizia con AIza… o AQ.' }],
      };
      return { ok: true, result };
    },

    ask_files: async () => acceptFiles(await promptWebFiles(true)),
    upload_browser_files: async files => acceptFiles(files),
    ask_media_file: async () => acceptFiles(await promptWebFiles(false))[0] ?? null,
    check_path_exists: async path => ({ ok: true, exists: hasWebFile(path) }),

    start_processing: async (files, apiKey, _resume, preferredModel) => {
      if (activeRun) return { ok: false, error: 'Un’elaborazione è già in corso.' };
      const file = files[0];
      if (!file) return { ok: false, error: 'Nessun file da elaborare.' };
      if (!apiKey.trim()) return { ok: false, error: 'Inserisci una chiave API Gemini nelle impostazioni.' };
      const run = new AbortController();
      activeRun = run;
      void runFakePipeline({
        file,
        model: preferredModel,
        emit,
        signal: run.signal,
        saveDocument: createWebSession,
      }).catch(error => {
        emit('fileFailed', { index: 0, id: file.id, error: error instanceof Error ? error.message : String(error) });
        emit('processDone', { cancelled: false, completed: 0, failed: 1, total: 1 });
      }).finally(() => {
        if (activeRun === run) activeRun = null;
      });
      return { ok: true };
    },
    stop_processing: async () => {
      activeRun?.abort();
      return { ok: true };
    },
    is_processing_active: async () => ({ ok: true, active: activeRun !== null }),
    answer_regenerate: async () => ({ ok: true }),
    answer_new_key: async () => ({ ok: true }),

    read_html_content: async path => {
      const content = readWebHtml(path);
      return content === null ? { ok: false, error: 'Sbobina non trovata in questo browser.' } : { ok: true, content };
    },
    save_html_content: async (path, content, generation) => saveWebHtml(path, content, generation),

    get_completed_sessions: async limit => {
      const sessions = listWebSessions(limit);
      return { ok: true, sessions, total: listWebSessions().length };
    },
    delete_session: async sessionDir => (deleteWebSession(sessionDir) ? { ok: true } : { ok: false, error: 'Sbobina non trovata.' }),
    rename_session: async (sessionDir, name) => {
      const updated = updateWebSession(sessionDir, { name: name.trim() });
      return updated ? { ok: true, name: updated.name } : { ok: false, error: 'Sbobina non trovata.' };
    },
    touch_session_opened: async sessionDir => {
      const lastOpened = new Date().toISOString();
      return updateWebSession(sessionDir, { last_opened_at_iso: lastOpened }) ? { ok: true, last_opened_at_iso: lastOpened } : { ok: false };
    },
    get_archive_folders: async () => ({ ok: true, folders: loadWebFolders() }),
    save_archive_folders: async folders => (saveWebFolders(folders) ? { ok: true } : { ok: false, error: 'Spazio del browser esaurito.' }),
    search_sessions: async (query, limit) => {
      const results = searchWebSessions(query, limit);
      return { ok: true, results, total: results.length };
    },
    get_session_storage_info: async () => {
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      return { ok: true, total_bytes: estimate?.usage ?? 0, total_sessions: listWebSessions().length };
    },
    cleanup_old_sessions: async () => ({ ok: true, removed: 0, freed_bytes: 0, errors: 0, candidates: 0 }),

    open_url: async url => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true };
    },
    open_link: async url => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true };
    },
    show_notification: async () => {},
    flash_window: async () => ({ ok: true }),
    close_window: async () => ({ ok: true }),

    get_diagnostic_report: async () => {
      const recent = frontendEvents.slice(-20).map(line => `- ${line}`).join('\n') || '- nessuno';
      return { ok: true, report: `## El Sbobinator (web)\n${describeDevice()}\n\n### Errori recenti dell'interfaccia\n${recent}` };
    },
    record_frontend_event: async (kind, message) => {
      frontendEvents.push(`${new Date().toISOString()} ${kind}: ${String(message ?? '').slice(0, 300)}`);
      if (frontendEvents.length > 100) frontendEvents.shift();
      return { ok: true };
    },
  };
}

export function initWebHost(): void {
  setHostCapabilities(WEB_CAPABILITIES);
  const emit = createBridgeEmitter(() => window.elSbobinatorBridge);
  window.pywebview = { api: createWebPywebviewApi(emit) };
  window.dispatchEvent(new Event('pywebviewready'));
}
