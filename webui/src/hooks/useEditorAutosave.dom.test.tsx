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

function flushEditorAutosave(): Promise<boolean> {
  const hooks = window as unknown as Record<string, () => Promise<boolean>>;
  return hooks.__elSbobinatorFlushPendingAutosave();
}

describe('useEditorAutosave', () => {
  it.each([
    ['flush', 'before'], ['flush', 'after'],
    ['debounce', 'before'], ['debounce', 'after'],
  ] as const)('persists undo through %s when the old save completes %s restoration', async (route, order) => {
    const original = '<p>Original</p>';
    let html = original;
    let disk = original;
    let committedGeneration = 0;
    let finishOldSave!: () => void;
    const commit = (content: string, generation: number) => {
      if (generation <= committedGeneration) return { ok: false, saved: false };
      disk = content;
      committedGeneration = generation;
      return { ok: true, saved: true };
    };
    const saveMock = vi.fn((_path: string, content: string, generation: number) => {
      if (saveMock.mock.calls.length === 1) {
        return new Promise<{ ok: boolean; saved: boolean }>(resolve => {
          finishOldSave = () => resolve(commit(content, generation));
        });
      }
      return Promise.resolve(commit(content, generation));
    });
    setPywebview({ save_html_content: saveMock });
    const getHtmlRef = { current: () => html };
    const { result } = renderHook(() => useEditorAutosave({
      htmlPath: '/undo-during-save.html', previewContent: original,
      getHtmlRef, onClose: vi.fn(),
    }));
    html = '<p>Edited</p>';
    act(() => result.current.scheduleAutosave());
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    html = original;
    act(() => result.current.scheduleAutosave());
    if (order === 'before') await act(async () => { finishOldSave(); });
    const hooks = window as unknown as Record<string, () => unknown>;
    expect(hooks.__elSbobinatorGetDirtyEditorContent()).toEqual({
      path: '/undo-during-save.html', content: original,
    });
    await act(async () => {
      if (route === 'flush') expect(await flushEditorAutosave()).toBe(true);
      else await vi.advanceTimersByTimeAsync(700);
    });
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[1][1]).toBe(original);
    expect(saveMock.mock.calls[1][2]).toBeGreaterThan(saveMock.mock.calls[0][2]);
    if (order === 'after') await act(async () => { finishOldSave(); });
    expect(disk).toBe(original);
    expect(result.current.lastPersistedRef.current).toBe(original);
    expect(result.current.isDirtyRef.current).toBe(false);
    expect(result.current.autosaveStatus).toBe('saved');
    await act(async () => { expect(await flushEditorAutosave()).toBe(true); });
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it('waits for the restoring write before authorizing close after undo', async () => {
    let finishOldSave!: (value: { ok: boolean; saved: boolean }) => void;
    let finishRestore!: (value: { ok: boolean; saved: boolean }) => void;
    const saveMock = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishOldSave = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishRestore = resolve; }));
    setPywebview({ save_html_content: saveMock });
    let html = '<p>Edited</p>';
    const onClose = vi.fn();
    const getHtmlRef = { current: () => html };
    const { result } = renderHook(() => useEditorAutosave({
      htmlPath: '/undo-close.html', previewContent: '<p>Original</p>',
      getHtmlRef, onClose,
    }));
    act(() => result.current.scheduleAutosave());
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    html = '<p>Original</p>';
    act(() => result.current.scheduleAutosave());
    let closing!: Promise<void>;
    act(() => { closing = result.current.flushAndClose(); });
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finishOldSave({ ok: true, saved: true }); });
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.isDirtyRef.current).toBe(true);
    await act(async () => {
      finishRestore({ ok: true, saved: true });
      await closing;
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(['rejection', 'exception'])('retries a restoring write after %s even when undo matches loaded HTML', async failure => {
    let finishOldSave!: (value: { ok: boolean; saved: boolean }) => void;
    const saveMock = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishOldSave = resolve; }));
    if (failure === 'exception') saveMock.mockRejectedValueOnce(new Error('Write acknowledgement lost'));
    else saveMock.mockResolvedValueOnce({ ok: false, saved: false });
    saveMock.mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });
    let html = '<p>Edited</p>';
    const getHtmlRef = { current: () => html };
    const { result } = renderHook(() => useEditorAutosave({
      htmlPath: '/undo-retry.html', previewContent: '<p>Original</p>',
      getHtmlRef, onClose: vi.fn(),
    }));
    act(() => result.current.scheduleAutosave());
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    html = '<p>Original</p>';
    act(() => result.current.scheduleAutosave());
    await act(async () => { finishOldSave({ ok: true, saved: true }); });
    await act(async () => { expect(await flushEditorAutosave()).toBe(false); });
    expect(result.current.isDirtyRef.current).toBe(true);
    expect(result.current.autosaveStatus).toBe('error');
    await act(async () => { expect(await flushEditorAutosave()).toBe(true); });
    expect(saveMock).toHaveBeenCalledTimes(3);
    expect(result.current.isDirtyRef.current).toBe(false);
  });

  it.each(['flush', 'debounce'])('skips %s writing after undo if no changed snapshot was submitted', async route => {
    const saveMock = vi.fn().mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });
    let html = '<p>Edited</p>';
    const getHtmlRef = { current: () => html };
    const { result } = renderHook(() => useEditorAutosave({
      htmlPath: '/undo-before-save.html', previewContent: '<p>Original</p>',
      getHtmlRef, onClose: vi.fn(),
    }));
    act(() => result.current.scheduleAutosave());
    html = '<p>Original</p>';
    act(() => result.current.scheduleAutosave());
    if (route === 'debounce') await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    await act(async () => { expect(await flushEditorAutosave()).toBe(true); });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('does not authorize close after undo when the restoring save bridge is missing', async () => {
    let finishOldSave!: (value: { ok: boolean; saved: boolean }) => void;
    const saveMock = vi.fn(() => new Promise(resolve => { finishOldSave = resolve; }));
    setPywebview({ save_html_content: saveMock });
    let html = '<p>Edited</p>';
    const getHtmlRef = { current: () => html };
    const { result } = renderHook(() => useEditorAutosave({
      htmlPath: '/undo-missing-bridge.html', previewContent: '<p>Original</p>',
      getHtmlRef, onClose: vi.fn(),
    }));
    act(() => result.current.scheduleAutosave());
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    html = '<p>Original</p>';
    act(() => result.current.scheduleAutosave());
    await act(async () => { finishOldSave({ ok: true, saved: true }); });
    setPywebview(undefined);
    await act(async () => { expect(await flushEditorAutosave()).toBe(false); });
    expect(result.current.isDirtyRef.current).toBe(true);
    expect(result.current.autosaveStatus).toBe('error');
  });

  it('submits restored content on unmount if an older write is unconfirmed', async () => {
    const saveMock = vi.fn().mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });
    let html = '<p>Edited</p>';
    const getHtmlRef = { current: () => html };
    const { result, unmount } = renderHook(() => useEditorAutosave({
      htmlPath: '/undo-unmount.html', previewContent: '<p>Original</p>',
      getHtmlRef, onClose: vi.fn(),
    }));
    act(() => result.current.scheduleAutosave());
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    html = '<p>Original</p>';
    act(() => result.current.scheduleAutosave());
    unmount();
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[1]).toEqual(['/undo-unmount.html', html, expect.any(Number)]);
    expect(saveMock.mock.calls[1][2]).toBeGreaterThan(saveMock.mock.calls[0][2]);
  });

  it('resets disk confirmation when changing to a document with identical loaded HTML', async () => {
    let finishOldSave!: (value: { ok: boolean; saved: boolean }) => void;
    const saveMock = vi.fn(() => new Promise(resolve => { finishOldSave = resolve; }));
    setPywebview({ save_html_content: saveMock });
    let html = '<p>Original</p>';
    const getHtmlRef = { current: () => html };
    const { result, rerender } = renderHook(({ path }) => useEditorAutosave({
      htmlPath: path, previewContent: '<p>Original</p>', getHtmlRef, onClose: vi.fn(),
    }), { initialProps: { path: '/same-content-a.html' } });
    html = '<p>Edited</p>';
    act(() => result.current.scheduleAutosave());
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    html = '<p>Original</p>';
    rerender({ path: '/same-content-b.html' });
    await act(async () => { finishOldSave({ ok: true, saved: true }); });
    act(() => result.current.scheduleAutosave());
    await act(async () => { expect(await flushEditorAutosave()).toBe(true); });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(result.current.isDirtyRef.current).toBe(false);
    expect(result.current.autosaveStatus).toBe('idle');
  });

  it('retries an explicit flush after a write error without losing dirty content', async () => {
    const saveMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, saved: false })
      .mockResolvedValueOnce({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });
    const { result } = renderHook(() => useEditorAutosave({
      htmlPath: '/retry-close.html', previewContent: '<p>Original</p>',
      getHtmlRef: { current: () => '<p>Unsaved changes</p>' }, onClose: vi.fn(),
    }));
    act(() => result.current.scheduleAutosave());
    await act(async () => { expect(await flushEditorAutosave()).toBe(false); });
    expect(result.current.isDirtyRef.current).toBe(true);
    await act(async () => { expect(await flushEditorAutosave()).toBe(true); });
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(result.current.isDirtyRef.current).toBe(false);
    expect(result.current.autosaveStatus).toBe('saved');
  });

  it('does not authorize closing when more text is typed while a flush is pending', async () => {
    let finishSave!: (value: { ok: boolean; saved: boolean }) => void;
    const saveMock = vi.fn(() => new Promise<{ ok: boolean; saved: boolean }>(resolve => { finishSave = resolve; }));
    setPywebview({ save_html_content: saveMock });
    let html = '<p>First edit</p>';
    const getHtmlRef = { current: () => html };
    const { result } = renderHook(() => useEditorAutosave({
      htmlPath: '/pending-close.html', previewContent: '<p>Original</p>',
      getHtmlRef, onClose: vi.fn(),
    }));
    act(() => result.current.scheduleAutosave());
    let flushed!: Promise<boolean>;
    act(() => { flushed = flushEditorAutosave(); });
    html = '<p>Latest edit</p>';
    act(() => result.current.scheduleAutosave());
    await act(async () => {
      finishSave({ ok: true, saved: true });
      expect(await flushed).toBe(false);
    });
    expect(result.current.isDirtyRef.current).toBe(true);
    expect(result.current.lastPersistedRef.current).toBe('<p>Original</p>');
  });

  it('does not authorize closing dirty content when the save bridge is missing', async () => {
    const { result } = renderHook(() => useEditorAutosave({
      htmlPath: '/missing-bridge.html', previewContent: '<p>Original</p>',
      getHtmlRef: { current: () => '<p>Unsaved changes</p>' }, onClose: vi.fn(),
    }));
    act(() => result.current.scheduleAutosave());
    await act(async () => { expect(await flushEditorAutosave()).toBe(false); });
    expect(result.current.isDirtyRef.current).toBe(true);
    expect(result.current.autosaveStatus).toBe('error');
  });

  it('does not apply an old flush response to another document', async () => {
    let finishSave!: (value: { ok: boolean; saved: boolean }) => void;
    const saveMock = vi.fn(() => new Promise<{ ok: boolean; saved: boolean }>(resolve => { finishSave = resolve; }));
    setPywebview({ save_html_content: saveMock });
    let html = '<p>Edited A</p>';
    const getHtmlRef = { current: () => html };
    const { result, rerender } = renderHook(({ path, content }) => useEditorAutosave({
      htmlPath: path, previewContent: content, getHtmlRef, onClose: vi.fn(),
    }), { initialProps: { path: '/document-a.html', content: '<p>Original A</p>' } });
    act(() => result.current.scheduleAutosave());
    let flushed!: Promise<boolean>;
    act(() => { flushed = flushEditorAutosave(); });
    html = '<p>Original B</p>';
    rerender({ path: '/document-b.html', content: html });
    await act(async () => {
      finishSave({ ok: true, saved: true });
      expect(await flushed).toBe(false);
    });
    expect(saveMock).toHaveBeenCalledWith('/document-a.html', '<p>Edited A</p>', expect.any(Number));
    expect(result.current.lastPersistedRef.current).toBe('<p>Original B</p>');
    expect(result.current.autosaveStatus).toBe('idle');
    expect(result.current.isDirtyRef.current).toBe(false);
  });

  it('ignores an old autosave exception after a newer edit has saved', async () => {
    let rejectOldSave!: (reason: Error) => void;
    const saveMock = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOldSave = reject; }))
      .mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveMock });
    let html = '<p>First edit</p>';
    const getHtmlRef = { current: () => html };
    const { result } = renderHook(() => useEditorAutosave({
      htmlPath: '/overlapping-autosaves.html', previewContent: '<p>Original</p>',
      getHtmlRef, onClose: vi.fn(),
    }));
    act(() => result.current.scheduleAutosave());
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    html = '<p>Latest edit</p>';
    act(() => result.current.scheduleAutosave());
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.autosaveStatus).toBe('saved');
    await act(async () => { rejectOldSave(new Error('Delayed bridge failure')); });
    expect(result.current.autosaveStatus).toBe('saved');
    expect(result.current.lastPersistedRef.current).toBe(html);
    expect(result.current.isDirtyRef.current).toBe(false);
    expect(saveMock.mock.calls.map(call => call[1])).toEqual(['<p>First edit</p>', html]);
  });

  it('ignores an old autosave exception after changing documents', async () => {
    let rejectOldSave!: (reason: Error) => void;
    const saveMock = vi.fn(() => new Promise((_resolve, reject) => { rejectOldSave = reject; }));
    setPywebview({ save_html_content: saveMock });
    let html = '<p>Edited A</p>';
    const getHtmlRef = { current: () => html };
    const { result, rerender } = renderHook(({ path, content }) => useEditorAutosave({
      htmlPath: path, previewContent: content, getHtmlRef, onClose: vi.fn(),
    }), { initialProps: { path: '/document-a.html', content: '<p>Original A</p>' } });
    act(() => result.current.scheduleAutosave());
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    html = '<p>Original B</p>';
    rerender({ path: '/document-b.html', content: html });
    await act(async () => { rejectOldSave(new Error('Delayed bridge failure')); });
    expect(result.current.autosaveStatus).toBe('idle');
    expect(result.current.lastPersistedRef.current).toBe(html);
    expect(result.current.isDirtyRef.current).toBe(false);
  });

  it.each(['rejection', 'exception'])('allows discard after a close-time save %s without retrying on unmount', async failure => {
    const saveMock = failure === 'exception'
      ? vi.fn().mockRejectedValue(new Error('Bridge unavailable'))
      : vi.fn().mockResolvedValue({ ok: false, saved: false });
    setPywebview({ save_html_content: saveMock });
    const onClose = vi.fn();
    const { result, unmount } = renderHook(() => useEditorAutosave({
      htmlPath: '/failed-close.html', previewContent: '<p>Original</p>',
      getHtmlRef: { current: () => '<p>Unsaved changes</p>' }, onClose,
    }));
    act(() => result.current.scheduleAutosave());
    await act(async () => { await result.current.flushAndClose(); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { await result.current.flushAndClose(); });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

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
