import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NOTICE_PREFIX,
  getPhaseStage,
  isRevisionRetryPhase,
  parseAttempt,
  parseChunkIndex,
  parseRevisionIndex,
  parseWaitSecs,
  phaseText,
} from './phaseLabels';

function pythonSource(relativePath: string): string {
  return readFileSync(new URL(`../../el_sbobinator/${relativePath}`, import.meta.url), 'utf8');
}

describe('phaseLabels', () => {
  it('recognizes every stage the builders produce', () => {
    expect(getPhaseStage(phaseText.analysis())).toBe('analysis');
    expect(getPhaseStage(phaseText.preconversion())).toBe('preconversion');
    expect(getPhaseStage(phaseText.transcriptionChunk(2, 6))).toBe('transcription');
    expect(getPhaseStage(phaseText.revisionBlock(1, 3))).toBe('revision');
    expect(getPhaseStage(phaseText.export())).toBe('export');
    expect(getPhaseStage('Fase:esportazione HTML')).toBe('export');
    expect(getPhaseStage(phaseText.completed())).toBeNull();
    expect(getPhaseStage('  ')).toBeNull();
  });

  it('parses counters from chunk and revision phases', () => {
    expect(parseChunkIndex(phaseText.transcriptionChunk(3, 7))).toEqual({ current: 3, total: 7 });
    expect(parseRevisionIndex(phaseText.revisionBlock(2, 5))).toEqual({ current: 2, total: 5 });
    expect(parseRevisionIndex(phaseText.revisionRetryBlock(1, 2))).toEqual({ current: 1, total: 2 });
    expect(parseRevisionIndex(phaseText.transcriptionChunk(1, 2))).toBeNull();
    expect(isRevisionRetryPhase(phaseText.revisionRetryBlock(1, 2))).toBe(true);
    expect(isRevisionRetryPhase(phaseText.revisionBlock(1, 2))).toBe(false);
  });

  it('parses wait and attempt from retry notices', () => {
    const busy = phaseText.serverBusy(30, 2, 5);
    expect(busy.startsWith(NOTICE_PREFIX.serverBusy)).toBe(true);
    expect(parseWaitSecs(busy)).toBe(30);
    expect(parseAttempt(busy)).toEqual({ current: 2, total: 5 });
    expect(parseWaitSecs(phaseText.rateLimit(12))).toBe(12);
    expect(phaseText.genericRetry(true, 5, 1, 3).startsWith(NOTICE_PREFIX.emptyResponse)).toBe(true);
    expect(phaseText.genericRetry(false, 5, 1, 3).startsWith(NOTICE_PREFIX.temporaryError)).toBe(true);
    expect(phaseText.invalidOutput(4).startsWith(NOTICE_PREFIX.invalidOutput)).toBe(true);
  });

  // The desktop pipeline writes the same texts in Python; a rename on either side must fail here.
  it('matches the phase texts the desktop pipeline emits', () => {
    const pipeline = pythonSource('pipeline/pipeline.py');
    expect(pipeline).toContain(`"${phaseText.analysis()}"`);
    expect(pipeline).toContain(`"${phaseText.transcription()}"`);
    expect(pipeline).toContain(`"${phaseText.revision()}"`);
    expect(pipeline).toContain(`"${phaseText.export()}"`);
    expect(pipeline).toContain(`"${phaseText.completed()}"`);
    expect(pythonSource('pipeline/pipeline_session.py')).toContain(`"${phaseText.preconversion()}"`);
    expect(pythonSource('services/phase1_service.py')).toContain(
      phaseText.transcriptionChunk(0, 0).replace('chunk 0/0', 'chunk {chunk_idx}/{total_chunks}'),
    );
    const revision = pythonSource('services/revision_service.py');
    expect(revision).toContain(phaseText.revisionBlock(0, 0).replace('0/0', '{index}/{macro_total}'));
    expect(revision).toContain(phaseText.revisionRetryBlock(0, 0).replace('0/0', '{index}/{macro_total}'));
    const generation = pythonSource('services/generation_service.py');
    for (const prefix of [NOTICE_PREFIX.serverBusy, NOTICE_PREFIX.offline, NOTICE_PREFIX.emptyResponse, NOTICE_PREFIX.temporaryError]) {
      expect(generation).toContain(prefix);
    }
    expect(generation).toContain(`${NOTICE_PREFIX.rateLimit}: attesa`);
  });
});
