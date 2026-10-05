import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { useEditorImageDrop } from './useEditorImageDrop';
import * as utils from '../utils';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FloatingImage } from '../components/FloatingImage';

describe('useEditorImageDrop Hook', () => {
  it('uses only the visible image surface for the inline drag ghost and preserves its grab offset', async () => {
    const editor = new Editor({ extensions: [StarterKit, FloatingImage], content: '<p>A<img src="drag.png">B</p>' });
    const original = editor.getJSON();
    const { result } = renderHook(() => useEditorImageDrop({ editorRef: { current: editor } }));
    const anchor = document.createElement('span');
    anchor.className = 'editor-image-node';
    anchor.innerHTML = '<span class="editor-image-surface" style="left:206px;top:28px"><img src="drag.png"><span class="editor-image-resize-handles"></span><div class="editor-image-toolbar">Toolbar</div></span>';
    const surface = anchor.querySelector<HTMLElement>('.editor-image-surface')!;
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 200, width: 222, height: 148 } as DOMRect);
    vi.spyOn(editor.view, 'posAtDOM').mockReturnValue(2);
    const setDragImage = vi.fn();
    expect(result.current.handleDragStart(editor.view, { target: anchor.querySelector('img'), clientX: 125, clientY: 230, dataTransfer: { setDragImage } } as unknown as DragEvent)).toBe(false);
    expect(setDragImage).toHaveBeenCalledWith(expect.any(HTMLElement), 25, 30);
    const ghost = setDragImage.mock.calls[0][0] as HTMLElement;
    expect(ghost.style.width).toBe('222px');
    expect(ghost.querySelector('img')?.getAttribute('src')).toBe('drag.png');
    expect(ghost.querySelector('.editor-image-resize-handles, .editor-image-toolbar')).toBeNull();
    expect(ghost.querySelector<HTMLElement>('.editor-image-surface')?.style.left).toBe('0px');
    expect(editor.getJSON()).toEqual(original);
    await waitFor(() => expect(ghost.isConnected).toBe(false));
    editor.destroy();
  });
  it('blocks native wrapping-image drag and leaves unrelated native drops to the editor', () => {
    const editor = new Editor({ extensions: [StarterKit, FloatingImage], content: '<p><span data-editor-image data-layout="wrap"><img src="drag.png"></span>Testo che segue</p>' });
    const original = editor.getJSON();
    const { result } = renderHook(() => useEditorImageDrop({ editorRef: { current: editor } }));
    const container = document.createElement('span'); container.className = 'editor-image-node';
    const image = document.createElement('img'); container.appendChild(image);
    vi.spyOn(editor.view, 'posAtDOM').mockReturnValue(1);
    const event = { target: image, preventDefault: vi.fn() } as unknown as DragEvent;
    expect(result.current.handleDragStart(editor.view, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    editor.commands.setNodeSelection(1);
    const drop = { dataTransfer: { files: [] }, preventDefault: vi.fn() } as unknown as DragEvent;
    expect(result.current.handleDrop(editor.view, drop)).toBe(false);
    expect(drop.preventDefault).not.toHaveBeenCalled();
    expect(editor.getJSON()).toEqual(original);
    editor.destroy();
  });
  it('drags an inline image into another paragraph without losing either paragraph and can undo', () => {
    const editor = new Editor({ extensions: [StarterKit, FloatingImage], content: '<p>A<span data-editor-image><img src="drag.png"></span>B</p><p>CD</p>' });
    const { result } = renderHook(() => useEditorImageDrop({ editorRef: { current: editor } }));
    const original = editor.getJSON();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 7, inside: 5 });
    editor.commands.setNodeSelection(2);
    result.current.handleDrop(editor.view, { dataTransfer: { files: [] }, clientX: 0, clientY: 0, preventDefault: vi.fn() } as unknown as DragEvent);
    expect(editor.getJSON().content?.[0].content).toEqual([{ type: 'text', text: 'AB' }]);
    expect(editor.getJSON().content?.[1].content?.map(n => n.type)).toEqual(['text', 'floatingImage', 'text']);
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
    editor.destroy();
  });
  it('initializes with handler functions', () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    expect(typeof result.current.insertImageFiles).toBe('function');
    expect(typeof result.current.handleDragStart).toBe('function');
    expect(typeof result.current.handlePaste).toBe('function');
    expect(typeof result.current.handleDrop).toBe('function');
    expect(typeof result.current.transformPastedHTML).toBe('function');
  });

  it('retains explicit color and background-color during formatted paste', () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    const inputHtml = '<p style="color: red; background-color: yellow; font-weight: bold;">Test text</p>';
    const outputHtml = result.current.transformPastedHTML(inputHtml);

    expect(outputHtml).toContain('color: red');
    expect(outputHtml).toContain('background-color: yellow');
    expect(outputHtml).toContain('Test text');
  });

  it('retains explicit font sizes in pasted headings and nested spans', () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    const inputHtml = '<h1 style="font-size: 14pt; color: red;"><span style="font-size: 11pt;">Heading Text</span></h1>';
    const outputHtml = result.current.transformPastedHTML(inputHtml);

    expect(outputHtml).toContain('font-size: 14pt');
    expect(outputHtml).toContain('font-size: 11pt');
    expect(outputHtml).toContain('color: red');
    expect(outputHtml).toContain('Heading Text');
  });

  it('insertImageFiles does nothing if editorRef is null or no image files passed', async () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    await result.current.insertImageFiles([]);
    const nonImageFile = new File(['hello'], 'test.txt', { type: 'text/plain' });
    await result.current.insertImageFiles([nonImageFile]);
  });

  it('insertImageFiles optimizes image and inserts floatingImage content into editor', async () => {
    const insertContentMock = vi.fn().mockReturnThis();
    const focusMock = vi.fn().mockReturnValue({ insertContent: insertContentMock });
    const runMock = vi.fn();
    insertContentMock.mockReturnValue({ run: runMock });

    const mockEditor = {
      chain: vi.fn().mockReturnValue({ focus: focusMock }),
    } as unknown as TiptapEditor;

    const editorRef = { current: mockEditor };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    const optimizeSpy = vi.spyOn(utils, 'readAndOptimizeImageAsDataUrl').mockResolvedValue('data:image/jpeg;base64,mockoptimized');

    const imageFile = new File(['binarydata'], 'photo.png', { type: 'image/png' });
    await result.current.insertImageFiles([imageFile]);

    expect(optimizeSpy).toHaveBeenCalledWith(imageFile);
    expect(insertContentMock).toHaveBeenCalledWith([
      {
        type: 'floatingImage',
        attrs: {
          src: 'data:image/jpeg;base64,mockoptimized',
          alt: 'photo.png',
          title: 'photo.png',
          width: 56,
        },
      },
    ]);
    expect(runMock).toHaveBeenCalled();
  });

  it('handlePaste returns false if no image files present in clipboard', () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    const fakeView = {} as unknown as EditorView;
    const fakeEvent = {
      clipboardData: { files: [] },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    const handled = result.current.handlePaste(fakeView, fakeEvent);
    expect(handled).toBe(false);
    expect(fakeEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('handlePaste intercepts image files and prevents default', () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    const imageFile = new File(['img'], 'pic.png', { type: 'image/png' });
    const fakeView = {} as unknown as EditorView;
    const fakeEvent = {
      clipboardData: { files: [imageFile] },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    const handled = result.current.handlePaste(fakeView, fakeEvent);
    expect(handled).toBe(true);
    expect(fakeEvent.preventDefault).toHaveBeenCalled();
  });

  it('handleDrop handles file drops directly', () => {
    const editorRef = { current: null };
    const { result } = renderHook(() => useEditorImageDrop({ editorRef }));

    const imageFile = new File(['img'], 'drop.png', { type: 'image/png' });
    const fakeView = {} as unknown as EditorView;
    const fakeEvent = {
      dataTransfer: { files: [imageFile] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    const handled = result.current.handleDrop(fakeView, fakeEvent);
    expect(handled).toBe(true);
    expect(fakeEvent.preventDefault).toHaveBeenCalled();
  });

});
