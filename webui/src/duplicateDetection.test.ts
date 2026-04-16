import { describe, expect, it } from 'vitest';

import type { FileItem } from './appState';
import type { ArchiveSession } from './bridge';
import { buildArchiveLookup, filterArchiveSessionsByInputPath, getArchiveMatchesForFile } from './duplicateDetection';

function makeArchiveSession(overrides: Partial<ArchiveSession> = {}): ArchiveSession {
  return {
    name: 'lesson',
    completed_at_iso: '2026-04-14T12:00:00Z',
    html_path: '/archive/lesson.html',
    effective_model: 'gemini',
    input_path: '/archive/lesson.mp3',
    session_dir: '/sessions/one',
    ...overrides,
  };
}

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'file-1',
    name: 'lesson.mp3',
    size: 1024,
    duration: 60,
    status: 'queued',
    progress: 0,
    phase: 0,
    ...overrides,
  };
}

describe('duplicateDetection', () => {
  it('filters archive cleanup sessions by exact input path', () => {
    const sessions = [
      makeArchiveSession({
        input_path: 'C:/audio/day-1/lesson.mp3',
        session_dir: '/sessions/day-1',
      }),
      makeArchiveSession({
        input_path: 'D:/imports/day-2/lesson.mp3',
        session_dir: '/sessions/day-2',
      }),
    ];

    const matches = filterArchiveSessionsByInputPath('C:/audio/day-1/lesson.mp3', sessions);

    expect(matches.map(session => session.session_dir)).toEqual(['/sessions/day-1']);
  });

  it('does not treat archive sessions with the same basename as duplicates', () => {
    const archiveSessions = [
      makeArchiveSession({
        input_path: 'C:/audio/day-1/lesson.mp3',
        session_dir: '/sessions/day-1',
      }),
      makeArchiveSession({
        input_path: 'D:/imports/day-2/lesson.mp3',
        session_dir: '/sessions/day-2',
      }),
    ];

    const matches = getArchiveMatchesForFile(
      makeFile({ path: 'E:/new-drop/lesson.mp3' }),
      buildArchiveLookup(archiveSessions),
    );

    expect(matches).toEqual([]);
  });

  it('returns archive sessions only for exact path matches', () => {
    const archiveSessions = [
      makeArchiveSession({
        input_path: 'C:/audio/lesson.mp3',
        session_dir: '/sessions/exact',
      }),
      makeArchiveSession({
        input_path: 'D:/audio/lesson.mp3',
        session_dir: '/sessions/basename',
      }),
    ];

    const matches = getArchiveMatchesForFile(
      makeFile({ path: 'C:/audio/lesson.mp3' }),
      buildArchiveLookup(archiveSessions),
    );

    expect(matches.map(session => session.session_dir)).toEqual(['/sessions/exact']);
  });

  it('does not match archived sessions when the incoming file has no path', () => {
    const archiveSessions = [
      makeArchiveSession({
        input_path: 'C:/audio/lesson.mp3',
        session_dir: '/sessions/exact',
      }),
    ];

    const matches = getArchiveMatchesForFile(
      makeFile({ path: undefined }),
      buildArchiveLookup(archiveSessions),
    );

    expect(matches).toEqual([]);
  });
});
