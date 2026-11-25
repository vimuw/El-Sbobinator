import type { FileDescriptor, FileFailedPayload } from '../appState';
import type { ArchiveSession } from '../bridge';
import { profileModel, sanitizeModelName } from '../generationProfile';
import { INVALID_KEY_MESSAGE, modelUnavailableMessage } from '../keyProblemMessages';
import { phaseText } from '../phaseLabels';
import { getModelDisplayName } from '../utils';
import type { EmitBridgeEvent } from './fakePipeline';
import { isUnsupportedFormatError } from './chunker/types';
import { createScreenWakeLock, type ScreenWakeLock } from './pageLifecycle';
import {
  CancelledError,
  CircuitBreakerExhaustedError,
  DegenerateOutputError,
  InvalidKeyError,
  ModelNotFoundError,
  PermanentError,
  QuotaDailyLimitError,
  isLostFileError,
  isModelAccessError,
} from './pipeline/retry';
import { FileMismatchError, defaultSettings, duration, runPipeline, type AudioSource, type PageState, type PipelineEnv, type PipelineReporter } from './pipeline/run';
import { webSessionHtmlPath } from './webSessions';
import { fileIdentity, hasProgress, newSession, type CheckpointStore, type SessionState } from './pipeline/session';

// One file through the real pipeline, reported to the UI with the same bridge events as the
// desktop: setCurrentFile, updatePhase/updateProgress, work totals, fileDone/fileFailed, processDone.

export const KEEP_PAGE_OPEN_WARNING = {
  code: 'web_keep_page_open',
  message: 'Tieni questa pagina aperta e in primo piano finché l’elaborazione non finisce: se cambi app o blocchi lo schermo il browser può sospenderla. Quando torni riprende da sola.',
};
export const REGENERATE_TIMEOUT_MS = 120_000;
export const NEW_KEY_TIMEOUT_MS = 120_000;
const PAUSE_RECOMMENDATION_MS = 30 * 60_000;
export const LOST_FILE_MESSAGE = 'Il browser non riesce più a leggere il file audio: è stato spostato, rinominato o modificato dopo averlo scelto. Rimuovilo dalla coda e aggiungilo di nuovo.';
// Also covers a damaged or incomplete file (an interrupted recording: M4A without its index): the
// chunker cannot tell it from another format, so the text names both ways out.
export const UNSUPPORTED_FORMAT_MESSAGE = 'Audio non leggibile: in questo file non c’è audio MP3 o AAC (anche dentro un M4A o MP4) che la versione web riesca a leggere, qualunque sia l’estensione. Se il file si ascolta con un altro programma, convertilo in MP3 o M4A e aggiungilo di nuovo alla coda; se non si apre nemmeno lì, la registrazione è probabilmente incompleta o danneggiata.';

export type RegenerateAnswer = boolean | null | 'timeout';

export interface WebRunOptions {
  descriptor: FileDescriptor;
  file: Blob;
  keys: string[];
  model: string;
  emit: EmitBridgeEvent;
  controller: AbortController;
  store: CheckpointStore;
  createAudio: (file: Blob) => AudioSource & { dispose(): void };
  page: PageState;
  /** Shows the regenerate/resume dialog and waits for answer_regenerate. */
  askRegenerate: (mode: 'completed' | 'resume', sessionDir: string) => Promise<RegenerateAnswer>;
  /** Shows the new key dialog and waits for answer_new_key. */
  askNewKey: () => Promise<string | null | 'timeout'>;
  saveArchive: (session: Omit<ArchiveSession, 'session_dir' | 'html_path'>, body: string) => Promise<ArchiveSession>;
  /** The archived sbobina's name, or null when it is gone (deleted or in the trash). */
  archivedName: (sessionDir: string) => Promise<string | null>;
  sleep?: PipelineEnv['sleep'];
  now?: () => number;
  wakeLock?: ScreenWakeLock;
  geminiBase?: string;
  usage?: PipelineEnv['usage'];
}

export function sleepWithSignal(seconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new CancelledError('annullato'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, seconds * 1000);
    function abort() {
      clearTimeout(timer);
      reject(new CancelledError('annullato'));
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Pipeline progress as the desktop bridge events. */
export function bridgeReporter(emit: EmitBridgeEvent): PipelineReporter {
  return {
    phase: text => emit('updatePhase', text),
    notice: text => emit('updatePhase', text),
    console: line => emit('appendConsole', line),
    progress: value => emit('updateProgress', value),
    totals: (chunks, macro) => emit('setWorkTotals', { chunks, macro }),
    workDone: (kind, done, total) => emit('updateWorkDone', { kind, done, total }),
    warning: (code, message) => emit('processingWarning', { code, message }),
  };
}

const detail = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).replace(/\s+/g, ' ').slice(0, 400);

/** The fileFailed payload the desktop would send for this error (keys known to utils.errorLabel). */
export function failurePayload(
  error: unknown,
  state: SessionState | null,
  base: { index: number; id: string },
  now = Date.now(),
  missingModels: readonly string[] = [],
): FileFailedPayload {
  const stage = state?.stage ?? 'phase1';
  const chunk = (state?.chunkTexts.length ?? 0) + 1;
  if (error instanceof QuotaDailyLimitError) {
    return {
      ...base,
      error: stage === 'phase2' ? 'quota_daily_limit_phase2' : 'quota_daily_limit_phase1',
      ...(error.message === 'api_key_prompt_timeout' ? { error_detail: 'api_key_prompt_timeout' } : {}),
    };
  }
  if (error instanceof InvalidKeyError) {
    return { ...base, error: INVALID_KEY_MESSAGE };
  }
  // Names the model the key lacks (the run's own: there is no automatic switch).
  if (error instanceof ModelNotFoundError) {
    return { ...base, error: modelUnavailableMessage(missingModels.map(modelLabel)) };
  }
  if (error instanceof DegenerateOutputError) return { ...base, error: 'phase1_degenerate_output', error_detail: detail(error) };
  if (error instanceof FileMismatchError) return { ...base, error: error.message };
  if (isLostFileError(error)) return { ...base, error: LOST_FILE_MESSAGE };
  // Checked before the phase-1 fallback: it fails before any request, so no "block N after 4 attempts".
  if (isUnsupportedFormatError(error)) return { ...base, error: UNSUPPORTED_FORMAT_MESSAGE, error_detail: detail(error) };
  if (error instanceof PermanentError && stage === 'phase1') return { ...base, error: 'bad_request_phase1', error_detail: detail(error) };
  if (error instanceof CircuitBreakerExhaustedError) {
    return {
      ...base,
      error: stage === 'phase1' ? `phase1_chunk_failed_${chunk}` : 'processing_failed',
      error_detail: 'CircuitBreakerExhaustedError: Gemini non risponde dopo vari tentativi (server occupato). Progressi salvati.',
      retryable: true,
      retry_reason: 'circuit_breaker_paused',
      recommended_retry_at: new Date(now + PAUSE_RECOMMENDATION_MS).toISOString(),
    };
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return { ...base, error: 'Spazio del browser esaurito: libera spazio (o elimina sbobine vecchie) e riprendi.' };
  }
  if (stage === 'phase1') return { ...base, error: `phase1_chunk_failed_${chunk}`, error_detail: detail(error) };
  return { ...base, error: 'processing_failed', error_detail: detail(error) };
}

const modelLabel = (model: string) => profileModel(model).label;

export type WebRunOutcome = 'completed' | 'completed_with_warnings' | 'cancelled' | 'failed' | 'paused';

export async function runWebFile(options: WebRunOptions): Promise<WebRunOutcome> {
  const { descriptor, file, emit, controller, store } = options;
  const signal = controller.signal;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? sleepWithSignal;
  const wakeLock = options.wakeLock ?? createScreenWakeLock();
  const base = { index: 0, id: descriptor.id };
  let state: SessionState | null = null;
  let audio: (AudioSource & { dispose(): void }) | null = null;
  let quotaExhausted = false;
  let outcome: WebRunOutcome = 'failed';

  emit('appendConsole', `File 1/1: ${descriptor.name}`);
  emit('setCurrentFile', { index: 0, id: descriptor.id, total: 1 });
  emit('processingWarning', KEEP_PAGE_OPEN_WARNING);
  await wakeLock.start();
  try {
    emit('updatePhase', phaseText.analysis());
    emit('updateProgress', 0.01);
    const identity = await fileIdentity(file, descriptor.name);
    state = await store.findByFile(identity);

    if (state && hasProgress(state) && descriptor.resume_session !== false) {
      const answer = await options.askRegenerate(state.stage === 'done' ? 'completed' : 'resume', state.archiveSessionDir ?? '');
      if (answer === 'timeout') {
        emit('appendConsole', '⚠ Nessuna risposta entro 120 secondi: sbobina in pausa, potrai riprenderla quando vuoi.');
        emit('fileFailed', { ...base, error: 'regenerate_prompt_timeout' });
        return outcome;
      }
      if (answer === null || signal.aborted) throw new CancelledError('annullato');
      if (answer) {
        emit('appendConsole', `Rigenero ${descriptor.name} da capo: elimino la sessione precedente...`);
        await store.delete(state.id);
        state = null;
      } else {
        const doneDir = state.stage === 'done' ? state.archiveSessionDir : undefined;
        const existingName = doneDir ? await options.archivedName(doneDir) : null;
        if (doneDir && existingName !== null) {
          emit('appendConsole', 'Sbobina già pronta: uso la versione esistente.');
          outcome = finish(state, doneDir, existingName, true);
          return outcome;
        }
        state.resumes += 1;
      }
    } else if (state && descriptor.resume_session === false) {
      await store.delete(state.id);
      state = null;
    }
    const chosen = sanitizeModelName(options.model);
    state ??= newSession(crypto.randomUUID(), identity, defaultSettings(chosen));
    // Like the desktop (pipeline_session): before the first chunk the current model choice wins,
    // with its chunk length (the cut is planned again); afterwards the session keeps its model.
    if (isFresh(state)) {
      state.settings = defaultSettings(chosen);
      state.plan = undefined;
    } else if (sanitizeModelName(state.settings.model) !== state.settings.model) {
      // A model Google retired (2.5 Flash) goes on with its successor, which the session then records.
      const successor = sanitizeModelName(state.settings.model);
      emit('appendConsole', `ℹ ${getModelDisplayName(state.settings.model)} non è più disponibile: continuo con ${modelLabel(successor)}.`);
      state.settings = { ...state.settings, model: successor };
      await store.save(state);
    }
    emit('updateModel', state.settings.model);

    audio = options.createAudio(file);
    const env: PipelineEnv = {
      keys: options.keys,
      store,
      audio,
      page: options.page,
      signal,
      sleep,
      now,
      geminiBase: options.geminiBase,
      usage: options.usage,
      requestNewKey: async () => {
        emit('appendConsole', '⚠ Quota esaurita su tutte le chiavi: inserisci una nuova chiave per continuare.');
        const key = await options.askNewKey();
        if (key === 'timeout') {
          emit('appendConsole', '⚠ Nessuna nuova chiave API inserita in tempo: sbobina in pausa, potrai riprenderla quando vuoi.');
          throw new QuotaDailyLimitError('api_key_prompt_timeout');
        }
        if (!key) controller.abort();
        return key;
      },
      reporter: bridgeReporter(emit),
    };
    await runPipeline(state, env);

    let sessionDir = state.archiveSessionDir;
    let archivedName = sessionDir ? await options.archivedName(sessionDir) : null;
    if (!sessionDir || archivedName === null) {
      const failed = (state.failedBlocks ?? []).map(index => index + 1);
      const archived = await options.saveArchive({
        name: state.title ?? descriptor.name.replace(/\.[^.]+$/, ''),
        input_name: descriptor.name,
        completed_at_iso: new Date().toISOString(),
        effective_model: state.settings.model,
        input_path: descriptor.path ?? '',
        input_size: descriptor.size,
        duration_sec: state.durationSec ?? descriptor.duration,
        completion_status: failed.length ? 'completed_with_warnings' : 'completed',
        revision_failed_blocks: failed,
        input_identity: state.file,
      }, state.body!);
      sessionDir = state.archiveSessionDir = archived.session_dir;
      archivedName = archived.name;
      await store.save(state);
    }
    const timing = state.phaseMs;
    emit('appendConsole', `Tempi: taglio ${duration(timing.cut)}, codifica ${duration(timing.encode)}, trascrizione ${duration(timing.phase1)}, revisione ${duration(timing.phase2)}.`);
    outcome = finish(state, sessionDir, archivedName);
    return outcome;
  } catch (error) {
    if (signal.aborted || error instanceof CancelledError) {
      emit('appendConsole', 'Elaborazione annullata. Progressi salvati.');
      outcome = 'cancelled';
      return outcome;
    }
    const missingModels = isModelAccessError(error) && state ? [state.settings.model] : [];
    const payload = failurePayload(error, state, base, Date.now(), missingModels);
    quotaExhausted = error instanceof QuotaDailyLimitError;
    emit('appendConsole', `❌ ${payload.error}${payload.error_detail ? ` — ${payload.error_detail}` : ''}`);
    emit('fileFailed', payload);
    outcome = payload.retry_reason === 'circuit_breaker_paused' ? 'paused' : 'failed';
    return outcome;
  } finally {
    audio?.dispose();
    await wakeLock.stop();
    emit('processingWarning', { code: KEEP_PAGE_OPEN_WARNING.code, message: null });
    emit('processDone', {
      cancelled: outcome === 'cancelled',
      completed: outcome === 'completed' ? 1 : 0,
      completed_with_warnings: outcome === 'completed_with_warnings' ? 1 : 0,
      failed: outcome === 'failed' ? 1 : 0,
      paused: outcome === 'paused' ? 1 : 0,
      total: 1,
      ...(quotaExhausted ? { quota_exhausted: true } : {}),
    });
  }

  /** Before the first block is written the session still takes the current model choice. */
  function isFresh(session: SessionState): boolean {
    return session.stage === 'phase1' && session.chunkTexts.length === 0;
  }

  // The archive's name, not the audio file's: Recenti and the editor show what the archive shows.
  function finish(done: SessionState, sessionDir: string, title: string, reusedExisting = false): WebRunOutcome {
    const failed = (done.failedBlocks ?? []).map(index => index + 1);
    const status = failed.length ? 'completed_with_warnings' : 'completed';
    const htmlPath = webSessionHtmlPath(sessionDir);
    emit('updateProgress', 1);
    emit('updatePhase', phaseText.completed());
    emit('fileDone', {
      ...base,
      output_html: htmlPath,
      html_path: htmlPath,
      output_dir: sessionDir,
      session_dir: sessionDir,
      title,
      effective_model: done.settings.model,
      completion_status: status,
      revision_failed_blocks: failed,
      ...(reusedExisting ? { reused_existing: true } : {}),
    });
    return status;
  }
}
