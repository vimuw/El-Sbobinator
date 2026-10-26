import type { FileDescriptor } from '../appState';
import type { PywebviewApi, ValidationResult } from '../bridge';
import { APP_VERSION, WEB_PREVIEW_BUILD } from '../branding';
import { type HostCapabilities, setHostCapabilities } from '../hostCapabilities';
import { STORAGE_KEYS } from '../storageKeys';
import { GEMINI_KEY_PATTERN, formatSize } from '../utils';
import { createWorkerAudioSource } from './audioPort';
import { createCheckpointStore } from './checkpointStore';
import { type BridgeEventName, type EmitBridgeEvent, runFakePipeline } from './fakePipeline';
import { createPageState } from './pageLifecycle';
import { measureWebStorage, type WebStorageUsage } from './webDatabase';
import { CancelledError } from './pipeline/retry';
import { retryFailedSections, type AudioSource, type PipelineEnv } from './pipeline/run';
import { getWebFile, hasWebFile, isWebSupportedMedia, promptWebFiles, registerWebFile, restoreWebFile, webFileId } from './webFiles';
import { createWebMediaStore, mediaType, type WebMediaStore } from './webMedia';
import { createBackup, describeBackup, describeImport, importBackup, loadLastBackupAt, saveLastBackupAt } from './webBackup';
import { NEW_KEY_TIMEOUT_MS, REGENERATE_TIMEOUT_MS, bridgeReporter, runWebFile, sleepWithSignal, type RegenerateAnswer } from './webRun';
import { createWebArchive, requestPersistentStorage, storageErrorMessage, webSessionHtmlPath, type NewArchiveSession, type WebArchive } from './webSessions';
import { WEB_MODEL_OPTIONS, adoptSpikeKeys, loadWebKeys, loadWebModel, saveWebKeys, saveWebModel } from './webSettings';

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
  // The lecture is kept in IndexedDB with the sbobina (webMedia.ts).
  editorAudio: true,
  sbobinaPackages: false,
  environmentCheck: false,
};

// A file picked a moment ago may not be in the saved queue yet: its copy is never pruned that soon.
const MEDIA_PRUNE_GRACE_MS = 10 * 60_000;

function mediaSaveWarning(name: string, error: unknown): string {
  if ((error as { name?: string } | null)?.name === 'QuotaExceededError') {
    return `⚠ Spazio del browser esaurito: ${name} non è stato salvato in questo browser. L’elaborazione funziona lo stesso, ma se ricarichi la pagina dovrai selezionarlo di nuovo e l’editor non avrà l’audio.`;
  }
  const reason = error instanceof Error && error.message ? ` (${error.message})` : '';
  return `⚠ Impossibile salvare ${name} in questo browser${reason}: se ricarichi la pagina dovrai selezionarlo di nuovo.`;
}

/** Ids of the local:// files in the queue the UI saved in localStorage. */
function queuedFileIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const queue = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.QUEUE_V1) || '[]') as Array<{ path?: unknown }>;
    for (const item of Array.isArray(queue) ? queue : []) {
      const id = typeof item?.path === 'string' ? webFileId(item.path) : null;
      if (id) ids.add(id);
    }
  } catch {
    // Unreadable queue: only the grace period protects recent copies.
  }
  return ids;
}

// Tells the diagnostic report whether this browser could play a compact Opus copy of the lecture.
function audioSupport(): string {
  const audio = document.createElement('audio');
  const containers: Array<[string, string]> = [['WebM', 'audio/webm; codecs="opus"'], ['Ogg', 'audio/ogg; codecs="opus"'], ['MP4', 'audio/mp4; codecs="opus"']];
  const playback = containers.map(([label, type]) => `${label} ${audio.canPlayType(type) || 'no'}`).join(', ');
  const encoder = typeof (globalThis as { AudioEncoder?: unknown }).AudioEncoder === 'function' ? 'sì' : 'no';
  return `Opus riproducibile: ${playback}; codifica WebCodecs: ${encoder}`;
}

// Safari's estimate() leaves out the audio Blobs (27 MB of audio showed as 1.1 MB): the space shown
// is counted from what this app stored; the browser's figure stays as a secondary reading. Texts and
// lecture audio are the backup's figures; queue copies and run progress are named apart, since the
// backup leaves them out.
function describeUsage(usage: WebStorageUsage | null, browserEstimate: number | undefined): string {
  const parts = usage
    ? [
        `testi delle sbobine ${formatSize(usage.documents)}`,
        `audio delle sbobine ${formatSize(usage.audio)}`,
        ...(usage.queueAudio > 0 ? [`audio in coda ${formatSize(usage.queueAudio)}`] : []),
        `avanzamento elaborazioni ${formatSize(usage.checkpoints)}`,
      ]
    : ['spazio delle sbobine non calcolabile'];
  if (browserEstimate !== undefined) parts.push(`stima del browser ${formatSize(browserEstimate)}`);
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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

async function describeDevice(archive: WebArchive, space: string): Promise<string> {
  const sessions = await archive.list().then(list => String(list.length), () => 'non leggibile');
  const lines = [
    `- Versione: ${APP_VERSION} (web${WEB_PREVIEW_BUILD ? ', anteprima' : ''})`,
    `- Browser: ${navigator.userAgent}`,
    `- Finestra: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    `- Touch: ${navigator.maxTouchPoints > 0 ? 'sì' : 'no'}`,
    `- Audio: ${audioSupport()}`,
    `- Sbobine nell'archivio: ${sessions}`,
    `- Spazio usato: ${space}`,
  ];
  return lines.join('\n');
}

export interface WebHostOptions {
  /** M0 simulated run (?simulazione=1): no Gemini calls, no audio work. */
  simulation?: boolean;
  /** IndexedDB holding checkpoints and the archive (tests pass fake-indexeddb). */
  database?: IDBFactory;
  /** navigator.storage: persistence request and usage estimate. */
  storage?: StorageManager;
  /** Audio files kept in this browser (tests pass one that fails). */
  media?: WebMediaStore;
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
  const storage = options.storage ?? navigator.storage;
  const media = options.media ?? createWebMediaStore(database);
  // Copies of picked files still being written to IndexedDB, by file id: true once stored.
  const pendingSaves = new Map<string, Promise<boolean>>();
  const measureSpace = async () => {
    const [usage, estimate] = await Promise.all([
      measureWebStorage(database).catch(() => null),
      storage?.estimate?.().catch(() => undefined),
    ]);
    return { usage, detail: describeUsage(usage, estimate?.usage) };
  };
  let mediaUrl: string | null = null;
  const revokeMediaUrl = () => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = null;
  };
  // Saving never blocks the queue: without a copy the file works until the page reloads.
  const keepInBrowser = (id: string, file: File) => {
    const saving = media.save(id, file).then(() => true, error => {
      emit('appendConsole', mediaSaveWarning(file.name, error));
      return false;
    });
    pendingSaves.set(id, saving);
    void saving.then(() => {
      if (pendingSaves.get(id) === saving) pendingSaves.delete(id);
    });
  };
  const storedInBrowser = async (id: string) => (await pendingSaves.get(id)) ?? media.has(id).catch(() => false);
  // The file behind a local:// path: in this page, or copied in IndexedDB before a reload.
  const resolveFile = async (path: string): Promise<File | undefined> => {
    const inPage = getWebFile(path);
    if (inPage) return inPage;
    const id = webFileId(path);
    const stored = id ? await media.get(id).catch(() => null) : null;
    if (!stored) return undefined;
    restoreWebFile(path, stored);
    return stored;
  };
  // Copies the queue no longer lists go; copies linked to a sbobina stay with it.
  const pruneMedia = () => {
    void media.prune(queuedFileIds(), Date.now() - MEDIA_PRUNE_GRACE_MS).catch(() => {});
  };
  pruneMedia();
  // A finished sbobina is the first thing worth keeping: ask the browser not to clear the site.
  // Its audio copy moves from the queue to the sbobina, for the editor's player.
  const saveArchive = async (session: NewArchiveSession, body: string) => {
    let saved;
    try {
      saved = await archive.create(session, body);
    } catch (error) {
      throw new Error(storageErrorMessage(error), { cause: error });
    }
    const id = webFileId(session.input_path);
    if (id && await storedInBrowser(id)) await media.link(id, saved.session_dir).catch(() => false);
    void requestPersistentStorage(storage);
    return saved;
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
      if (isWebSupportedMedia(file.name)) {
        const descriptor = registerWebFile(file);
        keepInBrowser(descriptor.id, file);
        descriptors.push(descriptor);
      } else emit('appendConsole', `⚠ Formato non supportato nella versione web: ${file.name}. Usa un file MP3, M4A o MP4.`);
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
    check_path_exists: async path => {
      const id = webFileId(path);
      return { ok: true, exists: hasWebFile(path) || (id !== null && await storedInBrowser(id)) };
    },

    start_processing: async (files, apiKey, _resume, preferredModel) => {
      if (activeRun) return { ok: false, error: 'Un’elaborazione è già in corso.' };
      const file = files[0];
      if (!file) return { ok: false, error: 'Nessun file da elaborare.' };
      if (!apiKey.trim()) return { ok: false, error: 'Inserisci una chiave API Gemini nelle impostazioni.' };
      const run = new AbortController();
      setActiveRun(run);
      if (!options.simulation) {
        const blob = file.path ? await resolveFile(file.path) : undefined;
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
          pruneMedia();
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

    // The editor's player: the sbobina's stored copy, else the file behind its path. One URL at a time.
    stream_media_file: async (path, sessionDir) => {
      const file = (sessionDir ? await media.forSession(sessionDir).catch(() => null) : null) ?? (path ? await resolveFile(path) : undefined);
      if (!file) return { ok: false, has_audio: Boolean(path), error: 'Audio non salvato in questo browser.' };
      revokeMediaUrl();
      const type = mediaType(file.name, file.type);
      mediaUrl = URL.createObjectURL(type === file.type ? file : new Blob([file], { type }));
      return { ok: true, url: mediaUrl };
    },
    // "Aggiungi audio" / "Ricollega audio": the file picked with ask_media_file becomes the sbobina's.
    update_session_input_path: async (sessionDir, newPath) => {
      const id = webFileId(newPath);
      try {
        if (!id || !await storedInBrowser(id) || !await media.link(id, sessionDir)) {
          return { ok: false, error: 'Audio non salvato in questo browser.' };
        }
        const updated = await archive.update(sessionDir, { input_path: newPath, input_name: getWebFile(newPath)?.name });
        return updated ? { ok: true } : { ok: false, error: 'Sbobina non trovata.' };
      } catch (error) {
        return { ok: false, error: storageErrorMessage(error) };
      }
    },
    remove_session_audio: async sessionDir => {
      try {
        await media.unlinkSession(sessionDir);
        const updated = await archive.update(sessionDir, { input_path: '' });
        if (!updated) return { ok: false, error: 'Sbobina non trovata.' };
        revokeMediaUrl();
        return { ok: true, name: updated.name };
      } catch (error) {
        return { ok: false, error: storageErrorMessage(error) };
      }
    },

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
        if (!await archive.delete(sessionDir)) return { ok: false, error: 'Sbobina non trovata.' };
        revokeMediaUrl();
        return { ok: true };
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
    // The settings show where sbobine live and whether the browser may clear them.
    get_session_storage_info: async () => {
      const [space, persisted, sessions] = await Promise.all([
        measureSpace(),
        storage?.persisted?.().catch(() => false),
        archive.list().catch(() => []),
      ]);
      return {
        ok: true,
        total_bytes: space.usage?.total ?? 0,
        total_sessions: sessions.length,
        usage_detail: space.detail,
        persisted: Boolean(persisted),
        session_root: persisted
          ? 'Memoria di questo browser (protetta dalla pulizia automatica)'
          : 'Memoria di questo browser: il browser può svuotarla se manca spazio o se non apri il sito per molti giorni',
      };
    },
    get_storage_protection: async () => ({ ok: true, persisted: await requestPersistentStorage(storage) }),
    get_web_backup_info: async () => {
      try {
        const info = await describeBackup(database);
        return { ok: true, sessions: info.sessions, text_bytes: info.textBytes, audio_bytes: info.audioBytes, audio_files: info.audioFiles, last_backup_at: loadLastBackupAt() };
      } catch (error) {
        return { ok: false, error: `Archivio del browser non leggibile: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    create_web_backup: async (includeAudio, onProgress) => {
      try {
        const backup = await createBackup(database, { includeAudio, appVersion: APP_VERSION, onProgress });
        return { ok: true, blob: backup.blob, filename: backup.filename, sessions: backup.sessions, audio_files: backup.audioFiles };
      } catch (error) {
        return { ok: false, error: `Backup non riuscito: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    // The backup counts as done when the user taps the download link, not when it is prepared.
    record_web_backup_download: async () => {
      const at = new Date().toISOString();
      saveLastBackupAt(at);
      return { ok: true, last_backup_at: at };
    },
    import_web_backup: async file => {
      if (activeRun) return { ok: false, error: 'Elaborazione in corso: importa il backup al termine.' };
      try {
        const summary = await importBackup(database, file);
        return { ok: true, summary: describeImport(summary) };
      } catch (error) {
        return { ok: false, error: error instanceof DOMException && error.name === 'QuotaExceededError' ? storageErrorMessage(error) : error instanceof Error ? error.message : String(error) };
      }
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
      return { ok: true, report: `## El Sbobinator (web)\n${await describeDevice(archive, (await measureSpace()).detail)}\n\n### Errori recenti dell'interfaccia\n${recent}` };
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
  adoptSpikeKeys();
  // Lets index.css size controls for touch on tablets without touching the desktop app.
  document.documentElement.dataset.host = 'web';
  const emit = createBridgeEmitter(() => window.elSbobinatorBridge);
  window.pywebview = { api: createWebPywebviewApi(emit, { simulation }) };
  window.dispatchEvent(new Event('pywebviewready'));
}
