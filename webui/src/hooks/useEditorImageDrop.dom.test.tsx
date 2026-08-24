import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEditorImageDrop } from './useEditorImageDrop';

describe('useEditorImageDrop Hook', () => {
  it('initializes with handler functions', () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    expect(typeof result.current.insertImageFiles).toBe('function');
    expect(typeof result.current.handleDragStart).toBe('function');
    expect(typeof result.current.handlePaste).toBe('function');
    expect(typeof result.current.handleDrop).toBe('function');
    expect(typeof result.current.transformPastedHTML).toBe('function');
  });

  it('transforms pasted HTML removing color and background-color styles', () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    const inputHtml = '<p style="color: red; background-color: yellow; font-weight: bold;">Test text</p>';
    const outputHtml = result.current.transformPastedHTML(inputHtml);

    expect(outputHtml).not.toContain('color: red');
    expect(outputHtml).not.toContain('background-color');
    expect(outputHtml).toContain('Test text');
  });

  it('handlePaste returns false if no image files present in clipboard', () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    const fakeView = {} as unknown as Parameters<typeof result.current.handlePaste>[0];
    const fakeEvent = {
      clipboardData: { files: [] },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    const handled = result.current.handlePaste(fakeView, fakeEvent);
    expect(handled).toBe(false);
    expect(fakeEvent.preventDefault).not.toHaveBeenCalled();
  });
});
