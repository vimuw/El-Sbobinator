// Checkpointed state of one sbobina, saved after every chunk and every revised section so a
// reload resumes from the last completed step (the desktop keeps the same in its session folder).

export interface FileIdentity {
  name: string;
  size: number;
  /** SHA-256 hex of the first MiB: a File cannot outlive a reload on iPad, so a reselected file is checked against this. */
  headHash: string;
}

export interface PipelineSettings {
  model: string;
  chunkSec: number;
  stepSec: number;
  macroCharLimit: number;
}

export interface ChunkPlan {
  index: number;
  startSec: number;
  durationSec: number;
}

export type SessionStage = 'phase1' | 'phase2' | 'done';

export interface SessionState {
  id: string;
  createdAt: number;
  updatedAt: number;
  file: FileIdentity;
  settings: PipelineSettings;
  stage: SessionStage;
  /** Filled after the cut; chunk indexes stay stable across resumes. */
  plan?: ChunkPlan[];
  durationSec?: number;
  /** Phase 1 text per chunk, index-aligned with plan. */
  chunkTexts: string[];
  /** Tail of the previous chunk's text, passed to the next prompt. */
  prevMemory: string;
  macroBlocks?: string[];
  /** Phase 2 text per section; null = not revised yet. */
  revised?: Array<string | null>;
  /** Sections whose first revision failed (desktop rev_NNN.raw.md); retried at the end of phase 2. */
  pendingRetry?: number[];
  /** Sections included unrevised after the retry pass. */
  failedBlocks?: number[];
  title?: string;
  finalMarkdown?: string;
  /** HTML body for the archive and the editor. */
  body?: string;
  /** Archive entry of the finished sbobina. */
  archiveSessionDir?: string;
  /** Wall-clock ms per phase, summed across resumes. */
  phaseMs: { cut: number; encode: number; phase1: number; phase2: number };
  resumes: number;
  keyRotations: number;
}

export interface CheckpointStore {
  findByFile(file: FileIdentity): Promise<SessionState | null>;
  findByArchive(sessionDir: string): Promise<SessionState | null>;
  get(id: string): Promise<SessionState | null>;
  save(state: SessionState): Promise<void>;
  delete(id: string): Promise<void>;
}

export function newSession(id: string, file: FileIdentity, settings: PipelineSettings, now = Date.now()): SessionState {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    file,
    settings,
    stage: 'phase1',
    chunkTexts: [],
    prevMemory: '',
    phaseMs: { cut: 0, encode: 0, phase1: 0, phase2: 0 },
    resumes: 0,
    keyRotations: 0,
  };
}

/** True when a run already produced something worth resuming (desktop phase1_has_progress). */
export function hasProgress(state: SessionState): boolean {
  return state.stage !== 'phase1' || state.chunkTexts.length > 0;
}

export async function fileIdentity(blob: Blob, name: string): Promise<FileIdentity> {
  const head = await blob.slice(0, 1 << 20).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', head);
  const headHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { name, size: blob.size, headHash };
}

export function fileKey(file: FileIdentity): string {
  return `${file.name}\u0000${file.size}\u0000${file.headHash}`;
}

export function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return fileKey(a) === fileKey(b);
}

/** Same bytes whatever the name: a renamed copy of the lecture still matches its times. */
export function sameContent(a: FileIdentity, b: FileIdentity): boolean {
  return a.size === b.size && a.headHash === b.headHash;
}
