import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueueProcessing, isSupportedMediaPath } from './useQueueProcessing';
import { type FileItem } from '../appState';
import { type PywebviewApi } from '../bridge';

describe('useQueueProcessing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { pywebview?: unknown }).pywebview;
    localStorage.clear();
  });

  it('correctly identifies supported and unsupported media formats', () => {
    expect(isSupportedMediaPath('audio.mp3')).toBe(true);
    expect(isSupportedMediaPath('video.mp4')).toBe(true);
    expect(isSupportedMediaPath('recording.m4a')).toBe(true);
    expect(isSupportedMediaPath('document.pdf')).toBe(false);
    expect(isSupportedMediaPath('image.png')).toBe(false);
    expect(isSupportedMediaPath('')).toBe(false);
  });

  it('handles startProcessing when queue has files and valid apiKey', async () => {
    const startProcessingMock = vi.fn().mockResolvedValue({ ok: true });
    window.pywebview = {
      api: {
        check_path_exists: vi.fn().mockResolvedValue({ exists: true }),
        start_processing: startProcessingMock,
      } as unknown as PywebviewApi,
    };

    const files: FileItem[] = [
      { id: '1', path: '/test/audio.mp3', name: 'audio.mp3', size: 1000, duration: 10, status: 'queued', progress: 0, phase: 0 },
    ];
    const filesRef = { current: files };
    const appStateRef = { current: 'idle' as const };
    const dispatch = vi.fn();
    const appendConsole = vi.fn();
    const setConfirmAction = vi.fn();
    const refreshArchiveSessions = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useQueueProcessing({
        filesRef,
        appStateRef,
        apiKey: 'AIzaSyTestKey_123456789012345678901',
        preferredModel: 'gemini-2.5-flash',
        fallbackModels: [],
        dispatch,
        appendConsole,
        setConfirmAction,
        refreshArchiveSessions,
      }),
    );

    let started = false;
    await act(async () => {
      started = await result.current.startProcessing();
    });

    expect(started).toBe(true);
    expect(startProcessingMock).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'app/set_status', status: 'processing' });
  });

  it('handles low disk warning during start_processing', async () => {
    const lowDiskWarning = {
      needed_bytes: 3000000000,
      free_bytes: 1500000000,
      location: 'C:\\',
      kind: 'system',
      file_name: 'audio.mp3',
    };
    const startProcessingMock = vi.fn().mockResolvedValue({ ok: false, low_disk_warning: lowDiskWarning });
    window.pywebview = {
      api: {
        check_path_exists: vi.fn().mockResolvedValue({ exists: true }),
        start_processing: startProcessingMock,
        flash_window: vi.fn(),
      } as unknown as PywebviewApi,
    };

    const files: FileItem[] = [
      { id: '1', path: '/test/audio.mp3', name: 'audio.mp3', size: 1000, duration: 10, status: 'queued', progress: 0, phase: 0 },
    ];
    const filesRef = { current: files };
    const appStateRef = { current: 'idle' as const };
    const dispatch = vi.fn();
    const appendConsole = vi.fn();
    const setConfirmAction = vi.fn();
    const refreshArchiveSessions = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useQueueProcessing({
        filesRef,
        appStateRef,
        apiKey: 'AIzaSyTestKey_123456789012345678901',
        preferredModel: 'gemini-2.5-flash',
        fallbackModels: [],
        dispatch,
        appendConsole,
        setConfirmAction,
        refreshArchiveSessions,
      }),
    );

    let started = false;
    await act(async () => {
      started = await result.current.startProcessing();
    });

    expect(started).toBe(false);
    expect(setConfirmAction).toHaveBeenCalledWith({ type: 'low-disk-warning', warning: lowDiskWarning });
  });
});
