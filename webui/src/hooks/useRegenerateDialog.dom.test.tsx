import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRegenerateDialog } from './useRegenerateDialog';
import * as diagnostics from '../diagnostics';

import { type PywebviewApi } from '../bridge';

describe('useRegenerateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { pywebview?: unknown }).pywebview;
  });

  it('sends answer_regenerate answer to Python API', async () => {
    const answerRegenMock = vi.fn().mockResolvedValue({ ok: true });
    window.pywebview = {
      api: {
        answer_regenerate: answerRegenMock,
      } as unknown as PywebviewApi,
    };

    const closePreview = vi.fn();
    const { result } = renderHook(() =>
      useRegenerateDialog({
        previewContent: null,
        previewSessionDir: '',
        closePreview,
      }),
    );

    act(() => {
      result.current.setRegeneratePrompt({ filename: 'test.mp3', mode: 'resume' });
    });

    await act(async () => {
      await result.current.handleRegenerateAnswer(true);
    });

    expect(answerRegenMock).toHaveBeenCalledWith(true);
    expect(result.current.regeneratePrompt).toBeNull();
  });

  it('reports a failed answer and still closes the prompt', async () => {
    const failure = new Error('host gone');
    window.pywebview = {
      api: {
        answer_regenerate: vi.fn().mockRejectedValue(failure),
      } as unknown as PywebviewApi,
    };
    const report = vi.spyOn(diagnostics, 'reportClientError').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useRegenerateDialog({
        previewContent: null,
        previewSessionDir: '',
        closePreview: vi.fn(),
      }),
    );
    act(() => {
      result.current.setRegeneratePrompt({ filename: 'test.mp3', mode: 'resume' });
    });

    await act(async () => {
      await result.current.handleRegenerateAnswer(false);
    });

    expect(report).toHaveBeenCalledWith('Failed to send the regenerate answer:', failure);
    expect(result.current.regeneratePrompt).toBeNull();
    report.mockRestore();
  });

  it('checks dirty content and flushes via editorControllerRef before showing dirty confirm', async () => {
    const answerRegenMock = vi.fn().mockResolvedValue({ ok: true });
    window.pywebview = {
      api: {
        answer_regenerate: answerRegenMock,
      } as unknown as PywebviewApi,
    };

    const closePreview = vi.fn();
    const getDirtyContent = vi.fn().mockReturnValue({ path: '/dir/test.html', content: '<p>Unsaved</p>' });
    const flushPendingAutosave = vi.fn().mockResolvedValue(true);
    const cancelPendingAutosave = vi.fn();
    const editorControllerRef = {
      current: {
        getDirtyContent,
        flushPendingAutosave,
        cancelPendingAutosave,
      },
    };

    const { result } = renderHook(() =>
      useRegenerateDialog({
        previewContent: '<p>Original</p>',
        previewSessionDir: '/dir',
        closePreview,
        editorControllerRef,
      }),
    );

    act(() => {
      result.current.setRegeneratePrompt({ filename: 'test.mp3', mode: 'resume', sessionDir: '/dir' });
    });

    await act(async () => {
      await result.current.handleRegenerateAnswer(true);
    });

    expect(getDirtyContent).toHaveBeenCalled();
    expect(flushPendingAutosave).toHaveBeenCalled();
    expect(result.current.regenDirtyConfirm).toEqual({ filename: 'test.mp3' });
    expect(answerRegenMock).not.toHaveBeenCalled();
  });
});
