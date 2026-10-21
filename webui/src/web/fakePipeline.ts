import type { FileDescriptor } from '../appState';
import type { ArchiveSession, BridgeCallbacks } from '../bridge';
import { phaseText } from '../phaseLabels';
import { buildSampleDocument } from './sampleDocument';

// M0 PLACEHOLDER — a deterministic simulated run with no Gemini calls. It drives the real UI through
// intake → phase 1 chunks → phase 2 → export → done with the same events and phase texts as the
// desktop pipeline, and saves a sample document. M1 replaces it with the real browser pipeline.

export type BridgeEventName = keyof BridgeCallbacks;
export type EmitBridgeEvent = (name: BridgeEventName, payload?: unknown) => void;

export interface FakeRunOptions {
  file: FileDescriptor;
  model: string;
  emit: EmitBridgeEvent;
  signal: AbortSignal;
  saveDocument: (session: Omit<ArchiveSession, 'session_dir' | 'html_path'>, body: string) => ArchiveSession;
  // Pause between simulated steps; tests pass a no-op.
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  stepMs?: number;
}

const CHUNK_SECONDS = 15 * 60;
const MACRO_BLOCKS = 2;

export function fakeChunkCount(durationSeconds?: number): number {
  if (!durationSeconds || durationSeconds <= 0) return 3;
  return Math.min(6, Math.max(1, Math.ceil(durationSeconds / CHUNK_SECONDS)));
}

export function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function runFakePipeline({ file, model, emit, signal, saveDocument, wait = waitWithAbort, stepMs = 600 }: FakeRunOptions): Promise<'completed' | 'cancelled'> {
  const chunks = fakeChunkCount(file.duration);
  const cancelled = () => {
    emit('processDone', { cancelled: true, completed: 0, completed_with_warnings: 0, failed: 0, paused: 0, total: 1 });
    return 'cancelled' as const;
  };
  const step = async (phase: string, progress: number) => {
    emit('updatePhase', phase);
    emit('updateProgress', progress);
    await wait(stepMs, signal);
    return !signal.aborted;
  };

  emit('appendConsole', `File 1/1: ${file.name}`);
  emit('appendConsole', '[M0] Elaborazione simulata: nessuna richiesta a Gemini.');
  emit('setCurrentFile', { index: 0, id: file.id, total: 1 });
  emit('updateModel', model);
  if (!await step(phaseText.analysis(), 0.02)) return cancelled();
  if (!await step(phaseText.preconversion(), 0.05)) return cancelled();

  emit('setWorkTotals', { chunks, macro: MACRO_BLOCKS });
  for (let i = 1; i <= chunks; i += 1) {
    if (!await step(phaseText.transcriptionChunk(i, chunks), 0.05 + 0.65 * ((i - 1) / chunks))) return cancelled();
    emit('updateWorkDone', { kind: 'chunks', done: i, total: chunks });
  }
  for (let i = 1; i <= MACRO_BLOCKS; i += 1) {
    if (!await step(phaseText.revisionBlock(i, MACRO_BLOCKS), 0.7 + 0.25 * ((i - 1) / MACRO_BLOCKS))) return cancelled();
    emit('updateWorkDone', { kind: 'macro', done: i, total: MACRO_BLOCKS });
  }
  if (!await step(phaseText.export(), 0.97)) return cancelled();

  const baseName = file.name.replace(/\.[^.]+$/, '') || file.name;
  const session = saveDocument({
    name: baseName,
    input_name: file.name,
    completed_at_iso: new Date().toISOString(),
    effective_model: model,
    input_path: file.path ?? '',
    input_size: file.size,
    duration_sec: file.duration,
    completion_status: 'completed',
  }, buildSampleDocument(baseName, chunks));

  emit('updateProgress', 1);
  emit('updatePhase', phaseText.completed());
  emit('fileDone', {
    index: 0,
    id: file.id,
    output_html: session.html_path,
    html_path: session.html_path,
    output_dir: session.session_dir,
    session_dir: session.session_dir,
    effective_model: model,
    completion_status: 'completed',
    revision_failed_blocks: [],
  });
  emit('processDone', { cancelled: false, completed: 1, completed_with_warnings: 0, failed: 0, paused: 0, total: 1 });
  return 'completed';
}
