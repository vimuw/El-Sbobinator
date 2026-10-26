import { describe, expect, it, vi } from 'vitest';
import type { ArchiveSession } from '../bridge';
import { getPhaseStage, parseChunkIndex, parseRevisionIndex } from '../phaseLabels';
import { type BridgeEventName, fakeChunkCount, runFakePipeline } from './fakePipeline';

const file = { id: 'file-1', path: 'local://abc/Lezione 1.mp3', name: 'Lezione 1.mp3', size: 1234, duration: 40 * 60 };

function record() {
  const events: Array<{ name: BridgeEventName; payload: unknown }> = [];
  return { events, emit: (name: BridgeEventName, payload?: unknown) => { events.push({ name, payload }); } };
}

async function saveDocument(input: Omit<ArchiveSession, 'session_dir' | 'html_path'>, body: string): Promise<ArchiveSession> {
  saved.push(body);
  return { ...input, session_dir: 'web-session://s1', html_path: 'web-session://s1/sbobina.html' };
}
const saved: string[] = [];

describe('fake pipeline (M0)', () => {
  it('sizes the run from the audio duration like 15-minute chunks', () => {
    expect(fakeChunkCount(undefined)).toBe(3);
    expect(fakeChunkCount(10 * 60)).toBe(1);
    expect(fakeChunkCount(40 * 60)).toBe(3);
    expect(fakeChunkCount(10 * 60 * 60)).toBe(6);
  });

  it('walks through every stage with the phase texts the banner parses', async () => {
    const { events, emit } = record();
    const result = await runFakePipeline({ file, model: 'gemini-3.6-flash', emit, signal: new AbortController().signal, saveDocument, wait: async () => {} });

    expect(result).toBe('completed');
    const phases = events.filter(e => e.name === 'updatePhase').map(e => String(e.payload));
    expect(phases.map(getPhaseStage)).toEqual([
      'analysis', 'preconversion', 'transcription', 'transcription', 'transcription', 'revision', 'revision', 'export', null,
    ]);
    expect(phases.map(parseChunkIndex).filter(Boolean)).toEqual([{ current: 1, total: 3 }, { current: 2, total: 3 }, { current: 3, total: 3 }]);
    expect(phases.map(parseRevisionIndex).filter(Boolean)).toEqual([{ current: 1, total: 2 }, { current: 2, total: 2 }]);

    expect(events.find(e => e.name === 'setCurrentFile')?.payload).toEqual({ index: 0, id: 'file-1', total: 1 });
    expect(events.find(e => e.name === 'setWorkTotals')?.payload).toEqual({ chunks: 3, macro: 2 });
    expect(events.filter(e => e.name === 'updateWorkDone')).toHaveLength(5);
    const progress = events.filter(e => e.name === 'updateProgress').map(e => Number(e.payload));
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);

    const names = events.map(e => e.name);
    expect(names.slice(-2)).toEqual(['fileDone', 'processDone']);
    expect(events.at(-2)?.payload).toMatchObject({ id: 'file-1', output_html: 'web-session://s1/sbobina.html', session_dir: 'web-session://s1', completion_status: 'completed' });
    expect(events.at(-1)?.payload).toMatchObject({ cancelled: false, completed: 1, total: 1 });
    expect(saved.at(-1)).toContain('<h1>Lezione 1</h1>');
    expect(saved.at(-1)).toContain('Documento di esempio');
  });

  it('stops at the next step when cancelled and saves nothing', async () => {
    const { events, emit } = record();
    const controller = new AbortController();
    const save = vi.fn(saveDocument);
    let steps = 0;
    const result = await runFakePipeline({
      file, model: 'gemini-3.6-flash', emit, signal: controller.signal, saveDocument: save,
      wait: async () => { steps += 1; if (steps === 3) controller.abort(); },
    });

    expect(result).toBe('cancelled');
    expect(save).not.toHaveBeenCalled();
    expect(events.some(e => e.name === 'fileDone')).toBe(false);
    expect(events.at(-1)).toEqual({ name: 'processDone', payload: expect.objectContaining({ cancelled: true, completed: 0 }) });
  });
});
