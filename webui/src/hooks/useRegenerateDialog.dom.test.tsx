import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRegenerateDialog } from './useRegenerateDialog';

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
});
