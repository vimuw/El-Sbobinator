import type { FileDescriptor } from '../appState';
import type { PywebviewApi, ValidationResult } from '../bridge';
import { APP_VERSION } from '../branding';
import { type HostCapabilities, setHostCapabilities } from '../hostCapabilities';
import { GEMINI_KEY_PATTERN } from '../utils';
import { createWorkerAudioSource } from './audioPort';
import { createCheckpointStore } from './checkpointStore';
import { type BridgeEventName, type EmitBridgeEvent, runFakePipeline } from './fakePipeline';
import { createPageState } from './pageLifecycle';
import { CancelledError } from './pipeline/retry';
import { retryFailedSections, type AudioSource, type PipelineEnv } from './pipeline/run';
import { getWebFile, hasWebFile, isWebSupportedMedia, promptWebFiles, registerWebFile } from './webFiles';
import { NEW_KEY_TIMEOUT_MS, REGENERATE_TIMEOUT_MS, bridgeReporter, runWebFile, sleepWithSignal, type RegenerateAnswer } from './webRun';
import { createWebArchive, storageErrorMessage, webSessionHtmlPath, type NewArchiveSession, type WebArchive } from './webSessions';
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
  realPipeline: true,
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

async function describeDevice(archive: WebArchive): Promise<string> {
  const sessions = await archive.list().then(list => String(list.length), () => 'non leggibile');
  const lines = [
    `- Versione: ${APP_VERSION} (web)`,
    `- Browser: ${navigator.userAgent}`,
    `- Finestra: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    `- Touch: ${navigator.maxTouchPoints > 0 ? 'sì' : 'no'}`,
    `- Sbobine nell'archivio: ${sessions}`,
  ];
  return lines.join('\n');
}

export interface WebHostOptions {
  /** M0 simulated run (?simulazione=1): no Gemini calls, no audio work. */
  simulation?: boolean;
  /** IndexedDB holding checkpoints and the archive (tests pass fake-indexeddb). */
  database?: IDBFactory;
  createAudio?: (file: Blob) => AudioSource & { dispose(): void };
  createPage?: () => PipelineEnv['page'] & { dispose(): void };
  sleep?: PipelineEnv['sleep'];
  geminiBase?: string;
}

type AnswerSlot<T> = { current: ((value: T) => void) | null };

/** Resolves with the UI's answer, or timeoutValue after ms, or cancelValue when the run stops. */
function waitForAnswer<T>(slot: AnswerSlot<T>, timeoutValue: T, cancelValue: T, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise(resolve => {
    const done = (value: T) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (slot.current === done) slot.current = null;
      resolve(value);
    };
    const timer = setTimeout(() => done(timeoutValue), ms);
    const onAbort = () => done(cancelValue);
    signal.addEventListener('abort', onAbort, { once: true });
    slot.current = done;
  });
}

const noAudio: AudioSource = {
  cut: () => Promise.reject(new Error('Audio non necessario per la revisione.')),
  prepare: () => Promise.reject(new Error('Audio non necessario per la revisione.')),
  toBase64: () => Promise.reject(new Error('Audio non necessario per la revisione.')),
};

export function createWebPywebviewApi(emit: EmitBridgeEvent, options: WebHostOptions = {}): PywebviewApi {
  let activeRun: AbortController | null = null;
  // Leaving or reloading the page stops the run: the browser asks first while one is active.
  const confirmLeave = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };
  const setActiveRun = (run: AbortController | null) => {
    activeRun = run;
    if (run) window.addEventListener('beforeunload', confirmLeave);
    else window.removeEventListener('beforeunload', confirmLeave);
  };
  const endRun = (run: AbortController) => {
    if (activeRun === run) setActiveRun(null);
  };
  const frontendEvents: string[] = [];
  const regenerateAnswer: AnswerSlot<RegenerateAnswer> = { current: null };
  const newKeyAnswer: AnswerSlot<string | null | 'timeout'> = { current: null };
  const database = options.database ?? globalThis.indexedDB;
  const checkpointStore = createCheckpointStore(database);
  const checkpoints = () => checkpointStore;
  const archive = createWebArchive(database);
  const saveArchive = async (session: NewArchiveSession, body: string) => {
    try {
      return await archive.create(session, body);
    } catch (error) {
      throw new Error(storageErrorMessage(error), { cause: error });
    }
  };
  const createPage = options.createPage ?? (() => createPageState());
  const sleep = options.sleep ?? sleepWithSignal;
  // Main key first, then the saved ones, without duplicates.
  const runKeys = (apiKey: string) => [...new Set([apiKey.trim(), ...loadWebKeys()].filter(Boolean))];
  // The NewKeyModal: a key for this run only; closing it stops the run, no answer pauses it.
  const askNewKey = async (signal: AbortSignal) => {
    emit('askNewKey');
    const answer = await waitForAnswer(newKeyAnswer, 'timeout', null, NEW_KEY_TIMEOUT_MS, signal);
    if (answer === 'timeout') emit('dismissNewKey');
    return answer;
  };

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
      setActiveRun(run);
      if (!options.simulation) {
        const blob = file.path ? getWebFile(file.path) : undefined;
        if (!blob) {
          setActiveRun(null);
          return { ok: false, error: 'Audio non più disponibile in questa pagina: selezionalo di nuovo.' };
        }
        const page = createPage();
        void runWebFile({
          descriptor: file,
          file: blob,
          keys: runKeys(apiKey),
          model: preferredModel,
          emit,
          controller: run,
          store: checkpoints(),
          createAudio: options.createAudio ?? (audioFile => createWorkerAudioSource(audioFile)),
          page,
          sleep,
          geminiBase: options.geminiBase,
          askRegenerate: (mode, sessionDir) => {
            emit('askRegenerate', { filename: file.name, mode, sessionDir });
            return waitForAnswer<RegenerateAnswer>(regenerateAnswer, 'timeout', null, REGENERATE_TIMEOUT_MS, run.signal);
          },
          askNewKey: () => askNewKey(run.signal),
          saveArchive,
          archiveExists: async sessionDir => (await archive.generation(sessionDir)) !== null,
        }).catch(error => {
          emit('fileFailed', { index: 0, id: file.id, error: error instanceof Error ? error.message : String(error) });
          emit('processDone', { cancelled: false, completed: 0, failed: 1, total: 1 });
        }).finally(() => {
          page.dispose();
          endRun(run);
        });
        return { ok: true };
      }
      void runFakePipeline({
        file,
        model: preferredModel,
        emit,
        signal: run.signal,
        saveDocument: saveArchive,
      }).catch(error => {
        emit('fileFailed', { index: 0, id: file.id, error: error instanceof Error ? error.message : String(error) });
        emit('processDone', { cancelled: false, completed: 0, failed: 1, total: 1 });
      }).finally(() => {
        endRun(run);
      });
      return { ok: true };
    },
    stop_processing: async () => {
      activeRun?.abort();
      return { ok: true };
    },
    is_processing_active: async () => ({ ok: true, active: activeRun !== null }),
    answer_regenerate: async regenerate => {
      regenerateAnswer.current?.(regenerate);
      return { ok: true };
    },
    answer_new_key: async key => {
      newKeyAnswer.current?.(key?.trim() || null);
      return { ok: true };
    },
    retry_failed_revision_blocks: async sessionDir => {
      if (activeRun) return { ok: false, error: 'Elaborazione in corso: riprova al termine.' };
      const generation = await archive.generation(sessionDir).catch(() => null);
      const state = generation === null ? null : await checkpoints().findByArchive(sessionDir);
      if (generation === null || !state || state.stage !== 'done') return { ok: false, error: 'Sessione non completata.' };
      // The editor saved the document: a new export would overwrite the user's edits.
      if (generation > 0) {
        return { ok: false, error: "HTML modificato dall'utente: retry annullato per evitare sovrascritture.", conflict: true, session_dir: sessionDir };
      }
      const htmlPath = webSessionHtmlPath(sessionDir);
      if (!state.failedBlocks?.length && !(state.revised ?? []).includes(null)) {
        return { ok: true, retried_blocks: [], remaining_failed_blocks: [], html_path: htmlPath, session_dir: sessionDir };
      }
      const keys = runKeys('');
      if (!keys.length) return { ok: false, error: 'API key mancante: aggiungila nelle impostazioni.' };
      const run = new AbortController();
      setActiveRun(run);
      const page = createPage();
      try {
        const result = await retryFailedSections(state, {
          keys,
          store: checkpoints(),
          audio: noAudio,
          reporter: bridgeReporter(emit),
          page,
          signal: run.signal,
          sleep,
          now: () => performance.now(),
          geminiBase: options.geminiBase,
          requestNewKey: async () => {
            const answer = await askNewKey(run.signal);
            if (answer === null || answer === 'timeout') {
              run.abort();
              throw new CancelledError('annullato');
            }
            return answer;
          },
        });
        const retried = result.retried.map(index => index + 1);
        const remaining = result.remaining.map(index => index + 1);
        const flags = { cancelled: result.cancelled, quota_exhausted: result.quotaExhausted };
        if (!retried.length) {
          if (!result.cancelled && !result.quotaExhausted && !remaining.length) {
            return { ok: true, retried_blocks: [], remaining_failed_blocks: [], html_path: htmlPath, session_dir: sessionDir };
          }
          const error = result.cancelled ? 'Operazione annullata.' : result.quotaExhausted ? 'Quota giornaliera esaurita: riprova domani.' : 'Nessun blocco recuperato. Riprova piu tardi.';
          return { ok: false, error, retried_blocks: [], remaining_failed_blocks: remaining, session_dir: sessionDir, ...flags };
        }
        const completionStatus = remaining.length ? 'completed_with_warnings' as const : 'completed' as const;
        const saved = await archive.saveHtml(htmlPath, state.body ?? '');
        if (!saved.ok) return { ok: false, error: saved.error ?? 'Salvataggio non riuscito.' };
        await archive.update(sessionDir, { completion_status: completionStatus, revision_failed_blocks: remaining, effective_model: state.settings.model });
        return {
          ok: true,
          retried_blocks: retried,
          remaining_failed_blocks: remaining,
          completion_status: completionStatus,
          html_path: htmlPath,
          session_dir: sessionDir,
          effective_model: state.settings.model,
          ...flags,
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        page.dispose();
        endRun(run);
      }
    },

    read_html_content: async path => {
      const content = await archive.readHtml(path).catch(() => null);
      return content === null ? { ok: false, error: 'Sbobina non trovata in questo browser.' } : { ok: true, content };
    },
    save_html_content: async (path, content, generation) => archive.saveHtml(path, content, generation),

    get_completed_sessions: async limit => {
      try {
        const sessions = await archive.list();
        return { ok: true, sessions: typeof limit === 'number' && limit > 0 ? sessions.slice(0, limit) : sessions, total: sessions.length };
      } catch (error) {
        return { ok: false, error: `Archivio del browser non leggibile: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    delete_session: async sessionDir => {
      try {
        return (await archive.delete(sessionDir)) ? { ok: true } : { ok: false, error: 'Sbobina non trovata.' };
      } catch (error) {
        return { ok: false, error: storageErrorMessage(error) };
      }
    },
    rename_session: async (sessionDir, name) => {
      const updated = await archive.update(sessionDir, { name: name.trim() }).catch(() => null);
      return updated ? { ok: true, name: updated.name } : { ok: false, error: 'Sbobina non trovata.' };
    },
    touch_session_opened: async sessionDir => {
      const lastOpened = new Date().toISOString();
      const updated = await archive.update(sessionDir, { last_opened_at_iso: lastOpened }).catch(() => null);
      return updated ? { ok: true, last_opened_at_iso: lastOpened } : { ok: false };
    },
    get_archive_folders: async () => {
      try {
        return { ok: true, folders: await archive.loadFolders() };
      } catch (error) {
        return { ok: false, folders: [], error: storageErrorMessage(error) };
      }
    },
    save_archive_folders: async folders => {
      try {
        await archive.saveFolders(folders);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: storageErrorMessage(error) };
      }
    },
    search_sessions: async (query, limit) => {
      const results = await archive.search(query, limit);
      return { ok: true, results, total: results.length };
    },
    get_session_storage_info: async () => {
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      const sessions = await archive.list().catch(() => []);
      return { ok: true, total_bytes: estimate?.usage ?? 0, total_sessions: sessions.length };
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
      return { ok: true, report: `## El Sbobinator (web)\n${await describeDevice(archive)}\n\n### Errori recenti dell'interfaccia\n${recent}` };
    },
    record_frontend_event: async (kind, message) => {
      frontendEvents.push(`${new Date().toISOString()} ${kind}: ${String(message ?? '').slice(0, 300)}`);
      if (frontendEvents.length > 100) frontendEvents.shift();
      return { ok: true };
    },
  };
}

export function initWebHost(): void {
  // ?simulazione=1 keeps the M0 simulated run (no Gemini calls) for demos and the smoke test.
  const simulation = new URLSearchParams(window.location.search).get('simulazione') === '1';
  setHostCapabilities(WEB_CAPABILITIES);
  const emit = createBridgeEmitter(() => window.elSbobinatorBridge);
  window.pywebview = { api: createWebPywebviewApi(emit, { simulation }) };
  window.dispatchEvent(new Event('pywebviewready'));
}
