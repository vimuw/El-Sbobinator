import type { FileDescriptor, FileFailedPayload } from '../appState';
import type { ArchiveSession } from '../bridge';
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
  };
}

const detail = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).replace(/\s+/g, ' ').slice(0, 400);

/** The fileFailed payload the desktop would send for this error (keys known to utils.errorLabel). */
export function failurePayload(error: unknown, state: SessionState | null, base: { index: number; id: string }, now = Date.now()): FileFailedPayload {
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
    return { ...base, error: 'Chiave API non valida: controlla di averla copiata per intero da Google AI Studio (Impostazioni → Chiave API).' };
  }
  if (error instanceof ModelNotFoundError) return { ...base, error: 'Modello non disponibile per questa chiave: scegline un altro nelle impostazioni.' };
  if (error instanceof DegenerateOutputError) return { ...base, error: 'phase1_degenerate_output', error_detail: detail(error) };
  if (error instanceof FileMismatchError) return { ...base, error: error.message };
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
    state ??= newSession(crypto.randomUUID(), identity, defaultSettings(options.model));
    // Like the desktop (pipeline_session): before the first chunk the current model choice wins,
    // with its chunk length (the cut is planned again); afterwards the session keeps its model.
    if (state.stage === 'phase1' && state.chunkTexts.length === 0) {
      state.settings = defaultSettings(options.model);
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
    await runPipeline(state, env);

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
    const payload = failurePayload(error, state, base);
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
