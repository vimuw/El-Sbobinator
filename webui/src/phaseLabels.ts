// Phase messages are a text contract: pipelines report progress through `updatePhase(text)` and the
// processing banner recognizes the stage, counters and retry notices from these words.
// The desktop pipeline writes them in Python (pipeline.py, phase1_service.py, revision_service.py,
// generation_service.py); the in-browser pipeline builds them here. Keep both sides in sync.

export const PHASE_PREFIX = {
  analysis: 'Fase: analisi',
  preconversion: 'Fase 0/3',
  transcription: 'Fase 1/3',
  revision: 'Fase 2/3',
  export: 'Fase: esportazione',
} as const;

// Older backends wrote the export phase without the space.
const LEGACY_EXPORT_PREFIX = 'Fase:esportazione';

export const COMPLETED_PHASE = '__completed__';

export const NOTICE_PREFIX = {
  serverBusy: 'Server Gemini occupato',
  rateLimit: 'Rate limit',
  offline: 'Connessione assente',
  emptyResponse: 'Risposta vuota da Gemini',
  temporaryError: 'Errore temporaneo di Gemini',
  invalidOutput: 'Output non valido',
} as const;

export type PhaseStage = 'analysis' | 'preconversion' | 'transcription' | 'revision' | 'export';

export function getPhaseStage(phase: string): PhaseStage | null {
  const text = phase.trim();
  if (text.startsWith(PHASE_PREFIX.analysis)) return 'analysis';
  if (text.startsWith(PHASE_PREFIX.preconversion)) return 'preconversion';
  if (text.startsWith(PHASE_PREFIX.transcription)) return 'transcription';
  if (text.startsWith(PHASE_PREFIX.revision)) return 'revision';
  if (text.startsWith(PHASE_PREFIX.export) || text.startsWith(LEGACY_EXPORT_PREFIX)) return 'export';
  return null;
}

export function isRevisionRetryPhase(phase: string): boolean {
  return getPhaseStage(phase) === 'revision' && phase.includes('retry');
}

export function parseWaitSecs(phase: string): number | null {
  const match = phase.match(/(?:tra|attesa)\s+(\d+)\s*s\b/i);
  return match ? Number(match[1]) : null;
}

export function parseAttempt(phase: string): { current: number; total: number } | null {
  const match = phase.match(/tentativo\s+(\d+)\s*\/\s*(\d+)/i);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
}

export function parseChunkIndex(phase: string): { current: number; total: number } | null {
  const match = phase.match(/chunk\s+(\d+)\s*\/\s*(\d+)/i);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
}

export function parseRevisionIndex(phase: string): { current: number; total: number } | null {
  if (getPhaseStage(phase) !== 'revision') return null;
  const match = phase.match(/\((?:blocco\s+)?(\d+)\s*\/\s*(\d+)\)/i);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
}

// Builders mirror the exact texts the desktop pipeline emits.
export const phaseText = {
  analysis: () => `${PHASE_PREFIX.analysis} file`,
  preconversion: () => `${PHASE_PREFIX.preconversion}: pre-conversione audio`,
  transcription: () => `${PHASE_PREFIX.transcription}: trascrizione (chunk)`,
  transcriptionChunk: (index: number, total: number) => `${PHASE_PREFIX.transcription}: trascrizione (chunk ${index}/${total})`,
  revision: () => `${PHASE_PREFIX.revision}: revisione`,
  revisionBlock: (index: number, total: number) => `${PHASE_PREFIX.revision}: revisione (${index}/${total})`,
  revisionRetryBlock: (index: number, total: number) => `${PHASE_PREFIX.revision}: retry revisione (blocco ${index}/${total})`,
  export: () => `${PHASE_PREFIX.export} HTML`,
  completed: () => 'Fase: completato',
  cancelled: () => 'Fase: annullato',
  serverBusy: (waitSeconds: number, attempt: number, maxAttempts: number) =>
    `${NOTICE_PREFIX.serverBusy} — riprovo tra ${waitSeconds}s (tentativo ${attempt}/${maxAttempts})`,
  rateLimit: (waitSeconds: number) => `⏳ ${NOTICE_PREFIX.rateLimit}: attesa ${waitSeconds}s prima della sonda...`,
  offline: () => `${NOTICE_PREFIX.offline} — verifica rete in corso (riprovo ogni 10s)...`,
  genericRetry: (empty: boolean, waitSeconds: number, attempt: number, maxAttempts: number) =>
    `${empty ? NOTICE_PREFIX.emptyResponse : NOTICE_PREFIX.temporaryError} — riprovo tra ${waitSeconds}s (tentativo ${attempt}/${maxAttempts})`,
  invalidOutput: (chunkIndex: number) => `${NOTICE_PREFIX.invalidOutput} nel blocco ${chunkIndex} — rigenero il blocco`,
};
