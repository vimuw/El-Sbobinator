import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FileItem } from '../../appState';
import type { ArchiveSession } from '../../bridge';
import { DuplicateFileModal } from './DuplicateFileModal';

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'incoming-1',
    name: 'lesson.mp3',
    size: 1024,
    duration: 60,
    status: 'queued',
    progress: 0,
    phase: 0,
    ...overrides,
  };
}

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

describe('DuplicateFileModal', () => {
  it('mentions multiple previous sessions for a single archived duplicate', () => {
    render(
      <DuplicateFileModal
        prompt={{
          kind: 'already-processed',
          matches: [{
            source: 'archive',
            incoming: makeFile(),
            sessions: [
              makeArchiveSession({ session_dir: '/sessions/one' }),
              makeArchiveSession({ session_dir: '/sessions/two' }),
            ],
          }],
        }}
        onDismiss={vi.fn()}
        onAddAgain={vi.fn()}
      />,
    );

    expect(screen.getByText(/elaborato in 2 sessioni precedenti/i)).toBeDefined();
  });
});
