import type { FileDescriptor, FileFailedPayload } from '../appState';
import type { ArchiveSession } from '../bridge';
import { profileModel, sanitizeModelName } from '../generationProfile';
import { INVALID_KEY_MESSAGE, modelUnavailableMessage } from '../keyProblemMessages';
import { phaseText } from '../phaseLabels';
import type { EmitBridgeEvent } from './fakePipeline';
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
} from './pipeline/retry';
import { FileMismatchError, defaultSettings, runPipeline, type AudioSource, type PageState, type PipelineEnv, type PipelineReporter } from './pipeline/run';
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
  archiveExists: (sessionDir: string) => Promise<boolean>;
  /** Models the main key is known not to have on this device. */
  unavailableModels?: string[];
  /**
   * The main key answered "model not found": remember it so later runs skip that model.
   * `replacement` is the model this run moved to, or null when the chosen model stays (the 404 came
   * from the model a busy first block had switched to).
   */
  onModelUnavailable?: (model: string, replacement: string | null) => void;
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
  // Names only the models this run tried and found missing (the automatic switch: webRun.fallbackModel).
  if (error instanceof ModelNotFoundError) {
    return { ...base, error: modelUnavailableMessage(missingModels.map(modelLabel)) };
  }
  if (error instanceof DegenerateOutputError) return { ...base, error: 'phase1_degenerate_output', error_detail: detail(error) };
  if (error instanceof FileMismatchError) return { ...base, error: error.message };
  if (isLostFileError(error)) return { ...base, error: LOST_FILE_MESSAGE };
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

// The most reliable model (fewest 503s) and the one to use instead: a session switches between them
// only before its first block is done, so a sbobina is always written by a single model.
export const RELIABLE_MODEL = 'gemini-2.5-flash';
export const ALTERNATE_MODEL = 'gemini-3.6-flash';
export const MODEL_SWITCH_WARNING_CODE = 'web_model_switched';

// The models a run may move to, in order: 2.5 and 3.6 Flash replace each other, any other model
// (e.g. 3.8 Flash) moves to 2.5 Flash first and to 3.6 Flash when 2.5 is missing too.
function switchCandidates(model: string): string[] {
  if (model === RELIABLE_MODEL) return [ALTERNATE_MODEL];
  if (model === ALTERNATE_MODEL) return [RELIABLE_MODEL];
  return [RELIABLE_MODEL, ALTERNATE_MODEL];
}
const modelLabel = (model: string) => profileModel(model).label;

/** A 404 about the model itself (not a missing uploaded file): this key's project lacks it. */
export const isModelAccessError = (error: unknown): boolean => error instanceof ModelNotFoundError && error.message.includes('model');

/** The model a fresh run starts with: the chosen one, unless the key is known not to have it. */
export function startModel(preferred: string, unavailable: readonly string[]): string {
  const model = sanitizeModelName(preferred);
  if (!unavailable.includes(model)) return model;
  return switchCandidates(model).find(other => !unavailable.includes(other)) ?? model;
}

/**
 * The model to start the sbobina again with after `error` on its first block, or null to fail:
 * the key lacks the model, or another model than the reliable one stayed busy through every attempt.
 * `excluded` holds the models known missing for the key and those this run already used.
 */
export function fallbackModel(error: unknown, model: string, excluded: readonly string[]): string | null {
  const busy = error instanceof CircuitBreakerExhaustedError && model !== RELIABLE_MODEL;
  if (!isModelAccessError(error) && !busy) return null;
  return switchCandidates(model).find(next => !excluded.includes(next)) ?? null;
}

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
  // The models this run found missing for a key, for the failure message.
  const missingModels: string[] = [];
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
      } else if (state.stage === 'done' && state.archiveSessionDir && await options.archiveExists(state.archiveSessionDir)) {
        emit('appendConsole', 'Sbobina già pronta: uso la versione esistente.');
        outcome = finish(state, state.archiveSessionDir);
        return outcome;
      } else {
        state.resumes += 1;
      }
    } else if (state && descriptor.resume_session === false) {
      await store.delete(state.id);
      state = null;
    }
    const unavailable = [...(options.unavailableModels ?? [])];
    const chosen = startModel(options.model, unavailable);
    state ??= newSession(crypto.randomUUID(), identity, defaultSettings(chosen));
    // Like the desktop (pipeline_session): before the first chunk the current model choice wins,
    // with its chunk length (the cut is planned again); afterwards the session keeps its model.
    if (isFresh(state)) {
      if (chosen !== sanitizeModelName(options.model)) {
        emit('appendConsole', `ℹ La tua chiave non ha accesso a ${modelLabel(options.model)}: uso ${modelLabel(chosen)}.`);
      }
      state.settings = defaultSettings(chosen);
      state.plan = undefined;
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
    // Nothing was written yet: the session starts over with the given model's settings.
    const restartWith = async (session: SessionState, model: string) => {
      session.settings = defaultSettings(model);
      session.plan = undefined;
      session.prevMemory = '';
      await store.save(session);
      emit('updateModel', model);
    };
    // The busy model and its error, once the session moved away from it.
    let switchedFrom: { model: string; error: unknown } | null = null;
    const tried: string[] = [];
    for (;;) {
      try {
        await runPipeline(state, env);
        break;
      } catch (error) {
        const model = state.settings.model;
        tried.push(model);
        const noAccess = isModelAccessError(error);
        if (noAccess && !missingModels.includes(model)) missingModels.push(model);
        const mainKey = noAccess && ((error as ModelNotFoundError).keyIndex ?? 0) === 0;
        if (switchedFrom) {
          // The model a busy first block moved to is missing for this key too: the busy model's
          // pause stands, and the main key skips the missing one next time.
          if (!noAccess || signal.aborted || !isFresh(state)) throw error;
          if (mainKey) {
            unavailable.push(model);
            options.onModelUnavailable?.(model, null);
          }
          emit('appendConsole', `⚠ La tua chiave non può usare ${modelLabel(model)}: resto su ${modelLabel(switchedFrom.model)}.`);
          emit('processingWarning', { code: MODEL_SWITCH_WARNING_CODE, message: null });
          await restartWith(state, switchedFrom.model);
          throw switchedFrom.error;
        }
        // A missing model moves on to the next candidate; a busy one gets a single switch.
        const next = !signal.aborted && isFresh(state) ? fallbackModel(error, model, [...unavailable, ...tried]) : null;
        if (!next) throw error;
        if (!noAccess) switchedFrom = { model, error };
        // A reserve key's project may lack a model the main key has: switch for this run only.
        if (mainKey) {
          unavailable.push(model);
          options.onModelUnavailable?.(model, next);
        }
        const keyNumber = noAccess && !mainKey ? (error as ModelNotFoundError).keyIndex! + 1 : 0;
        const message = !noAccess
          ? `${modelLabel(model)} è sovraccarico e non ha risposto al primo blocco: ricomincio con ${modelLabel(next)}`
          : mainKey
            ? `La tua chiave non può usare ${modelLabel(model)}: sbobino con ${modelLabel(next)} (lo ricorderò su questo dispositivo)`
            : `La chiave di riserva ${keyNumber} non può usare ${modelLabel(model)}: per questa sbobina uso ${modelLabel(next)}`;
        emit('appendConsole', `⚠ ${message}`);
        emit('processingWarning', { code: MODEL_SWITCH_WARNING_CODE, message });
        await restartWith(state, next);
      }
    }

    if (!state.archiveSessionDir || !await options.archiveExists(state.archiveSessionDir)) {
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
      state.archiveSessionDir = archived.session_dir;
      await store.save(state);
    }
    const timing = state.phaseMs;
    emit('appendConsole', `Tempi: taglio ${(timing.cut / 1000).toFixed(1)}s, codifica ${(timing.encode / 1000).toFixed(1)}s, trascrizione ${(timing.phase1 / 1000).toFixed(0)}s, revisione ${(timing.phase2 / 1000).toFixed(0)}s.`);
    outcome = finish(state, state.archiveSessionDir);
    return outcome;
  } catch (error) {
    if (signal.aborted || error instanceof CancelledError) {
      emit('appendConsole', 'Elaborazione annullata. Progressi salvati.');
      outcome = 'cancelled';
      return outcome;
    }
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

  /** Before the first block is written the session can still take another model. */
  function isFresh(session: SessionState): boolean {
    return session.stage === 'phase1' && session.chunkTexts.length === 0;
  }

  function finish(done: SessionState, sessionDir: string): WebRunOutcome {
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
      effective_model: done.settings.model,
      completion_status: status,
      revision_failed_blocks: failed,
    });
    return status;
  }
}
