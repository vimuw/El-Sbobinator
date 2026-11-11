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
    input_size: undefined,
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
  it('recognizes moved audio by its original filename after renaming the archive title', () => {
    for (const input_name of ['lesson.mp3', undefined]) {
      const renamed = makeArchiveSession({
        name: 'Fisiopatologia – seconda lezione', input_name,
        input_path: 'C:\\old\\lesson.mp3', input_size: 1024, duration_sec: 60,
      });
      const matches = getArchiveMatchesForFile(makeFile({ path: 'D:/new/lesson.mp3', size: 1024, duration: 60 }), buildArchiveLookup([renamed]));
      expect(matches).toEqual([renamed]);
    }
  });
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

  it('matches a moved file via meta key (name + size + duration) when path differs', () => {
    const archiveSessions = [
      makeArchiveSession({
        name: 'lesson.mp3',
        input_path: 'C:/old-folder/lesson.mp3',
        input_size: 1024,
        duration_sec: 60,
        session_dir: '/sessions/moved',
      }),
    ];

    const matches = getArchiveMatchesForFile(
      makeFile({ path: 'D:/new-folder/lesson.mp3', size: 1024, duration: 60 }),
      buildArchiveLookup(archiveSessions),
    );

    expect(matches.map(s => s.session_dir)).toEqual(['/sessions/moved']);
  });

  it('does not match via meta when duration_sec or input_size is missing from the session', () => {
    const archiveSessions = [
      makeArchiveSession({
        input_path: 'C:/old-folder/lesson.mp3',
        session_dir: '/sessions/no-meta',
      }),
    ];

    const matches = getArchiveMatchesForFile(
      makeFile({ path: 'D:/new-folder/lesson.mp3', size: 1024, duration: 60 }),
      buildArchiveLookup(archiveSessions),
    );

    expect(matches).toEqual([]);
  });

  it('does not match via meta when the incoming file has no duration', () => {
    const archiveSessions = [
      makeArchiveSession({
        input_path: 'C:/old-folder/lesson.mp3',
        input_size: 1024,
        duration_sec: 60,
        session_dir: '/sessions/present',
      }),
    ];

    const matches = getArchiveMatchesForFile(
      makeFile({ path: 'D:/new-folder/lesson.mp3', size: 1024, duration: 0 }),
      buildArchiveLookup(archiveSessions),
    );

    expect(matches).toEqual([]);
  });

  it('web: matches a re-picked local:// file by name and exact size, rejecting a different size or duration', () => {
    const archived = makeArchiveSession({
      input_path: 'local://old-uuid/Lezione 3.mp3', input_name: 'Lezione 3.mp3',
      input_size: 48_123_456, duration_sec: 5400,
    });
    const lookup = buildArchiveLookup([archived]);
    const web = (overrides: Partial<FileItem>) => makeFile({
      name: 'Lezione 3.mp3', path: 'local://new-uuid/Lezione 3.mp3', size: 48_123_456, duration: 0, ...overrides,
    });

    expect(getArchiveMatchesForFile(web({}), lookup)).toEqual([archived]);
    expect(getArchiveMatchesForFile(web({ size: 48_123_457 }), lookup)).toEqual([]);
    expect(getArchiveMatchesForFile(web({ duration: 1200 }), lookup)).toEqual([]);
    // Desktop keeps requiring path or full name+size+duration metadata.
    expect(getArchiveMatchesForFile(web({ path: 'D:/audio/Lezione 3.mp3' }), lookup)).toEqual([]);
  });
});
