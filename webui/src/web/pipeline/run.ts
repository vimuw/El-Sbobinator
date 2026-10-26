// The browser pipeline: phase 1 transcription, phase 2 revision, export. Mirrors
// el_sbobinator/services/phase1_service.py, revision_service.py and export_service.py.
// Audio work (cut, Opus encode) lives behind AudioSource, in a worker in the browser.

import { PROMPT_REVISIONE, PROMPT_SISTEMA, buildChunkPrompt, profileModel } from '../../generationProfile';
import { phaseText } from '../../phaseLabels';
import { buildBody, buildFinalMarkdown } from './export';
import { GeminiClient, type GeminiFile, type GenerateResult, type GenerateUsage, type Part } from './gemini';
import {
  CancelledError,
  DegenerateOutputError,
  QuotaDailyLimitError,
  errorCode,
  errorText,
  isInvalidKey,
  isQuotaRelated,
  retryWithQuota,
  withKeyRotation,
  type KeyRing,
  type RetryEnv,
} from './retry';
import type { ChunkPlan, CheckpointStore, PipelineSettings, SessionState } from './session';
import { buildMacroBlocks, detectDegenerateOutput, localMacroCleanup, safeOutputBasename } from './text';

// Desktop defaults for new sessions (pipeline_settings.build_default_pipeline_settings and the services).
export const PIPELINE_DEFAULTS = {
  overlapSeconds: 60,
  phase2Temperature: 0.1,
  /** inline_audio_max_mb: larger chunks go through the Files API. */
  inlineMaxBytes: 6 * 1024 * 1024,
  /** phase1_service: prev_memory = generated_text[-2000:]. */
  prevMemoryChars: 2000,
  /** sleep_with_cancel(cancelled, 5) between chunks and between sections. */
  pauseBetweenCallsSec: 5,
  phase1RetrySleepSec: 30,
  phase2RetrySleepSec: 20,
  requestTimeoutSec: 600,
};

export function defaultSettings(model: string): PipelineSettings {
  const option = profileModel(model);
  const chunkSec = option.default_chunk_minutes * 60;
  return { model: option.id, chunkSec, stepSec: Math.max(1, chunkSec - PIPELINE_DEFAULTS.overlapSeconds), macroCharLimit: option.default_macro_char_limit };
}

export interface PreparedAudio {
  blob: Blob;
  mimeType: string;
  /** opus: re-encoded for inline sending; original: the cut chunk, sent through the Files API. */
  codec: 'opus' | 'original';
  encodeMs: number;
  note?: string;
}

export interface CutResult {
  plan: ChunkPlan[];
  durationSec: number;
  cutMs: number;
  description: string;
}

export interface AudioSource {
  cut(chunkSec: number, stepSec: number): Promise<CutResult>;
  prepare(index: number): Promise<PreparedAudio>;
  toBase64(blob: Blob): Promise<string>;
}

export interface PipelineReporter {
  /** The step's phase text (updatePhase); retry notices replace it until restorePhase. */
  phase(text: string): void;
  notice(text: string): void;
  console(line: string): void;
  progress(fraction: number): void;
  totals(chunks: number, macro: number | null): void;
  workDone(kind: 'chunks' | 'macro', done: number, total: number): void;
}

export interface PageState {
  isOffline(): boolean;
  waitOnline(signal: AbortSignal): Promise<void>;
  isHidden(): boolean;
  wasHiddenSince(since: number): boolean;
  waitVisible(signal: AbortSignal): Promise<void>;
}

export interface PipelineEnv {
  /** Main key first, then fallback keys. */
  keys: string[];
  store: CheckpointStore;
  audio: AudioSource;
  reporter: PipelineReporter;
  page: PageState;
  signal: AbortSignal;
  /** Rejects with CancelledError when the signal aborts. */
  sleep(seconds: number, signal: AbortSignal): Promise<void>;
  now(): number;
  /** "Inserisci una nuova chiave" when every key has run out; null when none was given. */
  requestNewKey?: () => Promise<string | null>;
  geminiBase?: string;
  /** Per-key availability shown in the settings (apiUsage.ts). */
  usage?: GenerateUsage;
}

const PHASE1_SPAN: [number, number] = [0.05, 0.7];
const PHASE2_SPAN: [number, number] = [0.7, 0.95];
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function withTimeout(timeoutSec: number, outer: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutSec * 1000);
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([outer, timeout]);
  // Safari before 17.4.
  const controller = new AbortController();
  for (const source of [outer, timeout]) source.addEventListener('abort', () => controller.abort(source.reason), { once: true });
  return controller.signal;
}

/** Thrown when a reselected file cuts into a different number of chunks than the checkpoint. */
export class FileMismatchError extends Error {
  name = 'FileMismatchError';
}

/** Runs (or resumes) the session to the end; the state is checkpointed after every step. */
export async function runPipeline(state: SessionState, env: PipelineEnv): Promise<SessionState> {
  return createPipeline(state, env).run();
}

export interface SectionRetryResult {
  /** 0-based sections revised by this retry. */
  retried: number[];
  /** 0-based sections still unrevised. */
  remaining: number[];
  cancelled: boolean;
  quotaExhausted: boolean;
}

/**
 * Revises again the sections a finished session included unrevised (desktop
 * retry_failed_revision_blocks) and exports the body again when at least one succeeded.
 */
export async function retryFailedSections(state: SessionState, env: PipelineEnv): Promise<SectionRetryResult> {
  return createPipeline(state, env).retrySections();
}

function createPipeline(state: SessionState, env: PipelineEnv) {
  if (!env.keys.length) throw new Error('Nessuna chiave API');
  const { reporter, signal } = env;
  const ring: KeyRing = { keys: [...env.keys], index: 0 };
  let client = new GeminiClient(ring.keys[0], env.geminiBase, env.usage);
  const model = profileModel(state.settings.model);
  let currentPhase = '';

  const save = async () => {
    state.updatedAt = Date.now();
    await env.store.save(state);
  };
  const setPhase = (text: string) => {
    currentPhase = text;
    reporter.phase(text);
  };
  const throwIfCancelled = () => {
    if (signal.aborted) throw new CancelledError('annullato');
  };
  const retryEnv: RetryEnv = {
    sleep: secs => env.sleep(secs, signal),
    isOffline: () => env.page.isOffline(),
    waitOnline: () => env.page.waitOnline(signal),
    isHidden: () => env.page.isHidden(),
    wasHiddenSince: since => env.page.wasHiddenSince(since),
    waitVisible: () => env.page.waitVisible(signal),
    now: env.now,
    notice: text => reporter.phase(text),
    restorePhase: () => reporter.phase(currentPhase),
    log: line => reporter.console(line),
    signal,
  };
  const withKeys = <T>(run: () => Promise<T>) => withKeyRotation(ring, run, (from, to, why) => {
    client = new GeminiClient(ring.keys[to], env.geminiBase, env.usage);
    state.keyRotations += 1;
    reporter.console(why === 'quota'
      ? `⚠ Quota giornaliera della chiave ${from + 1} esaurita: continuo con la chiave ${to + 1}/${ring.keys.length}.`
      : `⚠ Chiave di riserva ${from + 1} non valida: continuo con la chiave ${to + 1}/${ring.keys.length}.`);
  }, env.requestNewKey);

  return { run, retrySections };

  async function run(): Promise<SessionState> {
    if (state.stage === 'phase1') await phase1();
    if (state.stage === 'phase2') await phase2();
    if (!state.body) await exportBody();
    return state;
  }

  async function retrySections(): Promise<SectionRetryResult> {
    const blocks = state.macroBlocks ?? [];
    const revised = (state.revised ??= blocks.map(() => null));
    const failed = new Set(state.failedBlocks ?? []);
    const targets = blocks.map((_, i) => i).filter(i => revised[i] === null || failed.has(i));
    const total = blocks.length;
    const retried: number[] = [];
    let cancelled = false;
    let quotaExhausted = false;
    reporter.totals(state.plan?.length ?? state.chunkTexts.length, total);
    try {
      for (const [n, i] of targets.entries()) {
        throwIfCancelled();
        setPhase(phaseText.revisionRetryBlock(i + 1, total));
        reporter.progress(n / targets.length);
        if (await revise(i, total)) {
          failed.delete(i);
          retried.push(i);
        } else {
          revised[i] ??= blocks[i].trim();
          failed.add(i);
        }
        state.failedBlocks = [...failed].sort((a, b) => a - b);
        await save();
        reporter.workDone('macro', total - failed.size, total);
        if (n + 1 < targets.length) await env.sleep(PIPELINE_DEFAULTS.pauseBetweenCallsSec, signal);
      }
    } catch (error) {
      if (error instanceof CancelledError || signal.aborted) cancelled = true;
      else if (error instanceof QuotaDailyLimitError) quotaExhausted = true;
      else throw error;
    }
    for (const i of targets) {
      if (revised[i] === null) {
        revised[i] = blocks[i].trim();
        failed.add(i);
      }
    }
    state.failedBlocks = [...failed].sort((a, b) => a - b);
    if (retried.length) await exportBody();
    else await save();
    return { retried, remaining: state.failedBlocks, cancelled, quotaExhausted };
  }

  // ------------------------------------------------------------------ phase 1
  async function phase1() {
    setPhase(phaseText.preconversion());
    const cut = await env.audio.cut(state.settings.chunkSec, state.settings.stepSec);
    throwIfCancelled();
    state.phaseMs.cut += cut.cutMs;
    if (state.plan && state.plan.length !== cut.plan.length) {
      throw new FileMismatchError(`Il file ha prodotto ${cut.plan.length} blocchi invece di ${state.plan.length}: non è lo stesso audio.`);
    }
    state.plan = cut.plan;
    state.durationSec = cut.durationSec;
    await save();
    const total = cut.plan.length;
    reporter.console(`Audio: ${cut.description}, ${total} blocchi da ${Math.round(state.settings.chunkSec / 60)} min (taglio in ${seconds(cut.cutMs)}).`);
    reporter.totals(total, null);
    reporter.workDone('chunks', state.chunkTexts.length, total);
    if (state.chunkTexts.length) reporter.console(`Ripresa dal blocco ${state.chunkTexts.length + 1}/${total}.`);

    const prepared = new Map<number, Promise<PreparedAudio>>();
    const prepare = (index: number) => {
      if (index >= total || prepared.has(index)) return;
      const promise = env.audio.prepare(index).then(audio => {
        state.phaseMs.encode += audio.encodeMs;
        if (audio.note) reporter.console(`ℹ Blocco ${index + 1}: ${audio.note}.`);
        return audio;
      });
      promise.catch(() => undefined);
      prepared.set(index, promise);
    };

    const started = env.now();
    try {
      for (let i = state.chunkTexts.length; i < total; i += 1) {
        throwIfCancelled();
        setPhase(phaseText.transcriptionChunk(i + 1, total));
        reporter.progress(PHASE1_SPAN[0] + (PHASE1_SPAN[1] - PHASE1_SPAN[0]) * (i / total));
        prepare(i);
        const audio = await prepared.get(i)!;
        prepared.delete(i);
        // Pipelining: the next chunk is encoded while Gemini works on this one.
        prepare(i + 1);
        let regenerated = false;
        for (;;) {
          try {
            const text = await transcribe(i, total, audio);
            state.chunkTexts[i] = text;
            state.prevMemory = text.slice(-PIPELINE_DEFAULTS.prevMemoryChars);
            await save();
            break;
          } catch (error) {
            if (error instanceof DegenerateOutputError && !regenerated) {
              regenerated = true;
              reporter.console(`⚠ Output non valido nel blocco ${i + 1} (${error.message}): rigenero il blocco.`);
              reporter.phase(phaseText.invalidOutput(i + 1));
              continue;
            }
            throw error;
          }
        }
        reporter.workDone('chunks', i + 1, total);
        if (i + 1 < total) await env.sleep(PIPELINE_DEFAULTS.pauseBetweenCallsSec, signal);
      }
    } finally {
      state.phaseMs.phase1 += env.now() - started;
    }
    state.stage = 'phase2';
    await save();
  }

  async function transcribe(index: number, total: number, audio: PreparedAudio): Promise<string> {
    const prompt = buildChunkPrompt(state.prevMemory);
    const label = `blocco ${index + 1}/${total}`;
    let mode: 'inline' | 'upload' = audio.codec === 'opus' && audio.blob.size <= PIPELINE_DEFAULTS.inlineMaxBytes ? 'inline' : 'upload';
    let triedUpload = mode === 'upload';
    let inlineData: string | null = null;
    let file: GeminiFile | null = null;
    // Uploaded files belong to the key's project: after a rotation, upload again.
    let fileClient: GeminiClient | null = null;
    // Uploaded but not yet ACTIVE (or abandoned by Stop): still has to be deleted.
    let pending: { name: string; client: GeminiClient } | null = null;

    const ensureUpload = async (): Promise<GeminiFile> => {
      if (file && fileClient === client) return file;
      if (file && fileClient) void fileClient.deleteFile(file.name).catch(() => undefined);
      file = null;
      fileClient = client;
      reporter.console(`Caricamento dell'audio del ${label} su Google (${mib(audio.blob.size)})…`);
      let uploaded = await client.uploadFile(audio.blob, audio.mimeType, `sbobina-blocco-${index + 1}`, withTimeout(PIPELINE_DEFAULTS.requestTimeoutSec, signal));
      pending = { name: uploaded.name, client };
      // Stop during the upload: the file is deleted in the finally below and no request is sent.
      throwIfCancelled();
      const deadline = env.now() + 15 * 60_000;
      while (uploaded.state && uploaded.state !== 'ACTIVE') {
        if (uploaded.state === 'FAILED') throw new Error(`Caricamento fallito (state=${uploaded.state}).`);
        if (env.now() > deadline) throw new Error("Timeout durante l'elaborazione del file audio sui server Google.");
        await env.sleep(3, signal);
        uploaded = await client.getFile(uploaded.name, withTimeout(60, signal));
      }
      file = uploaded;
      pending = null;
      return uploaded;
    };

    const call = async (): Promise<GenerateResult> => {
      for (;;) {
        try {
          const audioPart: Part = mode === 'inline'
            ? { inlineData: { mimeType: audio.mimeType, data: (inlineData ??= await env.audio.toBase64(audio.blob)) } }
            : { fileData: { mimeType: audio.mimeType, fileUri: (await ensureUpload()).uri } };
          const startedAt = env.now();
          const result = await client.generate({
            model: model.id,
            systemInstruction: PROMPT_SISTEMA,
            parts: [{ text: prompt }, audioPart],
            temperature: model.phase1_temperature,
            thinkingBudget: model.phase1_thinking_budget,
            signal: withTimeout(PIPELINE_DEFAULTS.requestTimeoutSec, signal),
          });
          // A request left running after Stop must not log or apply its late answer.
          throwIfCancelled();
          reporter.console(`Risposta Gemini per il ${label} in ${seconds(env.now() - startedAt)}: ${result.text.length} caratteri.`);
          if (!result.text) throw new Error('Risposta vuota dal modello (text=None)');
          if (result.finishReason === 'MAX_TOKENS') reporter.console(`⚠ Risposta troncata per il ${label} (MAX_TOKENS).`);
          const degenerate = detectDegenerateOutput(result.text);
          if (degenerate) throw new DegenerateOutputError(degenerate);
          return result;
        } catch (error) {
          const text = errorText(error);
          const code = errorCode(error);
          const rejectedInline = code === 400 || ['invalid_argument', 'badrequest', 'payload', 'too large', 'size'].some(marker => text.includes(marker));
          if (mode === 'inline' && !triedUpload && rejectedInline && !isQuotaRelated(text, code) && !isInvalidKey(text, code)) {
            triedUpload = true;
            mode = 'upload';
            reporter.console(`ℹ Invio diretto non accettato per il ${label}: carico il file.`);
            continue;
          }
          throw error;
        }
      }
    };

    try {
      const result = await withKeys(() => retryWithQuota(call, retryEnv, PIPELINE_DEFAULTS.phase1RetrySleepSec, label));
      return result.text;
    } finally {
      const uploaded = file as GeminiFile | null;
      if (uploaded && fileClient) void fileClient.deleteFile(uploaded.name).catch(() => undefined);
      const abandoned = pending as { name: string; client: GeminiClient } | null;
      if (abandoned) void abandoned.client.deleteFile(abandoned.name).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ phase 2
  async function phase2() {
    if (!state.macroBlocks) {
      const full = state.chunkTexts.map(text => `\n\n${text}\n\n`).join('');
      state.macroBlocks = buildMacroBlocks(full, state.settings.macroCharLimit);
      state.revised = state.macroBlocks.map(() => null);
      state.pendingRetry = [];
      state.failedBlocks = [];
      await save();
    }
    const blocks = state.macroBlocks;
    const revised = state.revised!;
    const total = blocks.length;
    const done = () => revised.filter(text => text !== null).length;
    reporter.totals(state.plan?.length ?? state.chunkTexts.length, total);
    reporter.workDone('chunks', state.chunkTexts.length, state.plan?.length ?? state.chunkTexts.length);
    reporter.workDone('macro', done(), total);
    setPhase(phaseText.revision());
    reporter.console(`Revisione: ${total} sezioni (limite ${state.settings.macroCharLimit} caratteri).`);
    const started = env.now();
    try {
      for (let i = 0; i < total; i += 1) {
        if (revised[i] !== null || state.pendingRetry!.includes(i)) continue;
        throwIfCancelled();
        setPhase(phaseText.revisionBlock(i + 1, total));
        reporter.progress(PHASE2_SPAN[0] + (PHASE2_SPAN[1] - PHASE2_SPAN[0]) * (done() / total));
        if (!await revise(i, total)) {
          state.pendingRetry!.push(i);
          await save();
        }
        reporter.workDone('macro', done(), total);
        if (i + 1 < total) await env.sleep(PIPELINE_DEFAULTS.pauseBetweenCallsSec, signal);
      }
      // Retry pass: a second attempt, then the section goes in unrevised.
      for (const i of [...state.pendingRetry!]) {
        throwIfCancelled();
        setPhase(phaseText.revisionRetryBlock(i + 1, total));
        if (!await revise(i, total)) {
          revised[i] = blocks[i].trim();
          state.failedBlocks!.push(i);
          reporter.console(`⚠ Sezione ${i + 1} inclusa senza revisione.`);
        }
        state.pendingRetry = state.pendingRetry!.filter(item => item !== i);
        await save();
        reporter.workDone('macro', done(), total);
      }
    } finally {
      state.phaseMs.phase2 += env.now() - started;
    }
    state.stage = 'done';
    await save();
  }

  /** False on a failure that is not quota or cancel: the section goes to the retry pass. */
  async function revise(index: number, total: number): Promise<boolean> {
    const source = state.macroBlocks![index].trim();
    const [cleaned, removedExact, removedAdjacent] = localMacroCleanup(source);
    if (removedExact + removedAdjacent) reporter.console(`Sezione ${index + 1}: ${removedExact + removedAdjacent} ripetizioni rimosse prima della revisione.`);
    const text = (cleaned || source).trim();
    const label = `sezione ${index + 1}/${total}`;
    try {
      const result = await withKeys(() => retryWithQuota(async () => {
        const response = await client.generate({
          model: model.id,
          systemInstruction: PROMPT_REVISIONE,
          parts: [{ text }],
          temperature: PIPELINE_DEFAULTS.phase2Temperature,
          signal: withTimeout(PIPELINE_DEFAULTS.requestTimeoutSec, signal),
        });
        if (!response.text) throw new Error('Risposta vuota dal modello in revisione.');
        return response;
      }, retryEnv, PIPELINE_DEFAULTS.phase2RetrySleepSec, label));
      throwIfCancelled();
      state.revised![index] = result.text;
      await save();
      return true;
    } catch (error) {
      if (error instanceof QuotaDailyLimitError || error instanceof CancelledError) throw error;
      reporter.console(`⚠ Revisione della ${label} non riuscita: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
      return false;
    }
  }

  // ------------------------------------------------------------------ export
  async function exportBody() {
    setPhase(phaseText.export());
    reporter.progress(0.97);
    const title = safeOutputBasename(state.file.name.replace(/\.[^.]+$/, ''));
    const markdown = buildFinalMarkdown(title, (state.revised ?? []).map(text => text ?? ''), state.chunkTexts.join('\n\n'));
    state.title = title;
    state.finalMarkdown = markdown;
    state.body = buildBody(markdown, (state.failedBlocks ?? []).length > 0);
    await save();
  }
}
