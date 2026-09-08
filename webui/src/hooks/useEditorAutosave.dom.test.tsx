import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorAutosave } from './useEditorAutosave';

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

describe('useEditorAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPywebview(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    setPywebview(undefined);
  });

  it('schedules debounced autosave when content changes', async () => {
    const saveMock = vi.fn().mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });

    let currentHtml = '<p>Initial</p>';
    const getHtmlRef = { current: () => currentHtml };
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useEditorAutosave({
        htmlPath: '/path/to/test.html',
        previewContent: '<p>Initial</p>',
        getHtmlRef,
        onClose,
      })
    );

    expect(result.current.autosaveStatus).toBe('idle');
    expect(result.current.isDirtyRef.current).toBe(false);

    // Modify content and schedule autosave
    currentHtml = '<p>Updated content</p>';
    act(() => {
      result.current.scheduleAutosave();
    });

    expect(result.current.isDirtyRef.current).toBe(true);

    // Advance timer to trigger autosave (700ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(saveMock).toHaveBeenCalledWith('/path/to/test.html', '<p>Updated content</p>', expect.any(Number));
    expect(result.current.autosaveStatus).toBe('saved');
    expect(result.current.isDirtyRef.current).toBe(false);

    // After 1500ms saved status returns to idle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.autosaveStatus).toBe('idle');
  });

  it('suspends autosave during collaborative session if content drops >75%', async () => {
    const saveMock = vi.fn().mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });

    const longContent = '<p>' + 'A'.repeat(500) + '</p>';
    let currentHtml = longContent;
    const getHtmlRef = { current: () => currentHtml };
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useEditorAutosave({
        htmlPath: '/path/to/test.html',
        previewContent: longContent,
        collabRoom: 'room-123',
        getHtmlRef,
        onClose,
      })
    );

    // Drastically truncate text in collab mode
    currentHtml = '<p>Short</p>';
    act(() => {
      result.current.scheduleAutosave();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(saveMock).not.toHaveBeenCalled();
    expect(result.current.isAutosaveSuspended).toBe(true);
    expect(result.current.autosaveStatus).toBe('error');
  });

  it('handles force save immediately', async () => {
    const saveMock = vi.fn().mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });

    const getHtmlRef = { current: () => '<p>Forced save text</p>' };
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useEditorAutosave({
        htmlPath: '/path/to/test.html',
        previewContent: '<p>Initial</p>',
        getHtmlRef,
        onClose,
      })
    );

    await act(async () => {
      await result.current.handleForceSave();
    });

    expect(saveMock).toHaveBeenCalledWith('/path/to/test.html', '<p>Forced save text</p>', expect.any(Number));
    expect(result.current.autosaveStatus).toBe('saved');
  });

  it('registers window global dirty content and flush hooks', async () => {
    const saveMock = vi.fn().mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });

    let currentHtml = '<p>Initial</p>';
    const getHtmlRef = { current: () => currentHtml };
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useEditorAutosave({
        htmlPath: '/path/to/test.html',
        previewContent: '<p>Initial</p>',
        getHtmlRef,
        onClose,
      })
    );

    currentHtml = '<p>Dirty</p>';
    act(() => {
      result.current.scheduleAutosave();
    });

    const globalObj = window as unknown as Record<string, () => unknown>;
    expect(typeof globalObj.__elSbobinatorGetDirtyEditorContent).toBe('function');
    expect(globalObj.__elSbobinatorGetDirtyEditorContent()).toEqual({
      path: '/path/to/test.html',
      content: '<p>Dirty</p>',
    });

    // Flush dirty content
    const flushFn = globalObj.__elSbobinatorFlushPendingAutosave as () => Promise<boolean>;
    let flushResult = false;
    await act(async () => {
      flushResult = await flushFn();
    });

    expect(flushResult).toBe(true);
    expect(saveMock).toHaveBeenCalledWith('/path/to/test.html', '<p>Dirty</p>', expect.any(Number));
  });

  it('flushes dirty changes and calls onClose in flushAndClose', async () => {
    const saveMock = vi.fn().mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });

    let currentHtml = '<p>Initial</p>';
    const getHtmlRef = { current: () => currentHtml };
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useEditorAutosave({
        htmlPath: '/path/to/test.html',
        previewContent: '<p>Initial</p>',
        getHtmlRef,
        onClose,
      })
    );

    currentHtml = '<p>Closing content</p>';
    act(() => {
      result.current.scheduleAutosave();
    });

    await act(async () => {
      await result.current.flushAndClose();
    });

    expect(saveMock).toHaveBeenCalledWith('/path/to/test.html', '<p>Closing content</p>', expect.any(Number));
    expect(onClose).toHaveBeenCalled();
  });

  it('exposes imperative dirty getter and flush through saveControllerRef', async () => {
    const saveMock = vi.fn().mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });

    let currentHtml = '<p>Initial</p>';
    const getHtmlRef = { current: () => currentHtml };
    const onClose = vi.fn();
    const saveControllerRef = { current: null };

    const { result, unmount } = renderHook(() =>
      useEditorAutosave({
        htmlPath: '/path/to/test.html',
        previewContent: '<p>Initial</p>',
        getHtmlRef,
        onClose,
        saveControllerRef,
      })
    );

    expect(saveControllerRef.current).not.toBeNull();
    expect(saveControllerRef.current?.getDirtyContent()).toBeNull();

    currentHtml = '<p>Dirty</p>';
    act(() => {
      result.current.scheduleAutosave();
    });

    expect(saveControllerRef.current?.getDirtyContent()).toEqual({
      path: '/path/to/test.html',
      content: '<p>Dirty</p>',
    });

    let flushed = false;
    await act(async () => {
      flushed = await saveControllerRef.current!.flushPendingAutosave();
    });
    expect(flushed).toBe(true);
    expect(saveMock).toHaveBeenCalledWith('/path/to/test.html', '<p>Dirty</p>', expect.any(Number));

    unmount();
    expect(saveControllerRef.current).toBeNull();
  });
});
