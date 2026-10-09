import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FloatingImage } from './components/FloatingImage';
import { startImageResize, type ImageResizeHandle } from './imageResize';

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(handle: ImageResizeHandle = 'mr', layout = 'wrap', scale = 1) {
  const editor = new Editor({ extensions: [StarterKit, FloatingImage], content: `<p><span data-editor-image data-layout="${layout}" data-width="35"><img src="resize.png"></span>Testo</p>` });
  editors.push(editor);
  const original = editor.getJSON();
  const anchor = document.createElement('span');
  anchor.innerHTML = '<span class="editor-image-surface"><img src="resize.png"><span class="editor-image-resize-handles"></span><div class="editor-image-toolbar">Toolbar</div></span>';
  document.body.append(anchor);
  const surface = anchor.querySelector<HTMLElement>('.editor-image-surface')!;
  const image = anchor.querySelector('img')!;
  const handleElement = anchor.querySelector<HTMLElement>('.editor-image-resize-handles')!;
  Object.defineProperty(editor.view.dom, 'offsetWidth', { value: 634 });
  vi.spyOn(editor.view.dom, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 634 * scale } as DOMRect);
  const rect = { left: 100, top: 200, width: 222 * scale, height: 148 * scale } as DOMRect;
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(rect);
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect);
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  const pointer = (type: string, dx = 0, dy = 0, id = 1) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: id, clientX: 300 + dx, clientY: 250 + dy });
    return event as PointerEvent;
  };
  const cancel = startImageResize(editor.view, 1, anchor, handleElement, pointer('pointerdown'), handle);
  const send = (type: string, dx = 0, dy = 0, id = 1) => window.dispatchEvent(pointer(type, dx, dy, id));
  return { editor, original, anchor, dispatch, send, cancel };
}

describe('image resize preview', () => {
  it.each(['inline', 'wrap'].flatMap(layout => [0.75, 1, 1.5].map(scale => ({ layout, scale }))))('keeps the top fixed while shrinking with tc in $layout at $scale', ({ layout, scale }) => {
    const { editor, send } = setup('tc', layout, scale);
    send('pointermove', 0, 30 * scale);
    const ghost = document.querySelector<HTMLElement>('.editor-image-resize-preview')!;
    expect(ghost.style.transform).toBe('translate3d(100px, 200px, 0)');
    expect(Number.parseFloat(ghost.querySelector('img')!.style.height)).toBeCloseTo(118 * scale);
    send('pointerup', 0, 30 * scale);
    expect(editor.state.doc.nodeAt(1)!.attrs.offsetY).toBe(0);
  });
  it.each(['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'] as const)('previews handle %s without transactions and commits one undoable change', handle => {
    const { editor, original, anchor, dispatch, send } = setup(handle);
    const dx = handle.endsWith('l') ? -20 : 20;
    const dy = handle.startsWith('t') ? -20 : 20;
    send('pointermove', dx, dy);
    expect(editor.getJSON()).toEqual(original);
    expect(dispatch).not.toHaveBeenCalled();
    const ghost = document.querySelector<HTMLElement>('.editor-image-resize-preview')!;
    const width = Number.parseFloat(ghost.style.width);
    const height = Number.parseFloat(ghost.querySelector('img')!.style.height);
    if (handle === 'tc' || handle === 'bc') expect(width).toBe(222);
    else expect(width).toBeGreaterThan(222);
    if (handle === 'ml' || handle === 'mr') expect(height).toBe(148);
    else expect(height).toBeGreaterThan(148);
    expect(ghost.querySelector('.editor-image-resize-handles, .editor-image-toolbar')).toBeNull();
    send('pointerup', dx, dy);
    expect(dispatch).toHaveBeenCalledTimes(1);
    if (handle === 'tc' || handle === 'bc') expect(editor.state.doc.nodeAt(1)?.attrs.width).toBe(35);
    else expect(editor.state.doc.nodeAt(1)?.attrs.width).toBeGreaterThan(35);
    expect(document.querySelector('.editor-image-resize-preview')).toBeNull();
    expect(anchor.dataset.imageResizing).toBeUndefined();
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
  });

  it.each(['tl', 'tr', 'bl', 'br'] as const)('anchors the opposite corner for %s on both axes, for growth and shrink', handle => {
    const { editor, send } = setup(handle);
    for (const delta of [30, -30]) {
      const dx = handle.endsWith('l') ? -delta : delta;
      const dy = handle.startsWith('t') ? -delta : delta;
      send('pointermove', dx, dy);
      const ghost = document.querySelector<HTMLElement>('.editor-image-resize-preview')!;
      const [left, top] = ghost.style.transform.match(/-?[\d.]+(?=px)/g)!.map(Number);
      const width = Number.parseFloat(ghost.style.width);
      const height = Number.parseFloat(ghost.querySelector('img')!.style.height);
      expect(width / height).toBeCloseTo(1.5);
      expect(handle.endsWith('l') ? left + width : left).toBeCloseTo(handle.endsWith('l') ? 322 : 100);
      expect(handle.startsWith('t') ? top + height : top).toBeCloseTo(handle.startsWith('t') ? 348 : 200);
    }
    send('pointerup', handle.endsWith('l') ? 30 : -30, handle.startsWith('t') ? 30 : -30);
    const attrs = editor.state.doc.nodeAt(1)!.attrs;
    const committedWidth = 222 / 35 * attrs.width;
    expect((634.285714 - committedWidth) * attrs.position / 100).toBeCloseTo(handle.endsWith('l') ? 145 : 100, 1);
    expect(attrs.offsetY).toBeCloseTo(handle.startsWith('t') ? 30 : 0);
  });

  it.each(['tl', 'tr', 'bl', 'br'] as const)('resizes corner %s with a purely vertical gesture', handle => {
    const { send } = setup(handle);
    send('pointermove', 0, handle.startsWith('t') ? -30 : 30);
    const ghost = document.querySelector<HTMLElement>('.editor-image-resize-preview')!;
    expect(Number.parseFloat(ghost.style.width)).toBeCloseTo(267);
    expect(Number.parseFloat(ghost.querySelector('img')!.style.height)).toBeCloseTo(178);
    send('pointerup', 0, handle.startsWith('t') ? -30 : 30);
  });

  it.each(['tc', 'bc', 'ml', 'mr'] as const)('changes only one dimension with middle handle %s and ignores the other axis', handle => {
    const { editor, send } = setup(handle);
    send('pointermove', handle === 'ml' ? -30 : 30, handle === 'tc' ? -30 : 30);
    const ghost = document.querySelector<HTMLElement>('.editor-image-resize-preview')!;
    const [left, top] = ghost.style.transform.match(/-?[\d.]+(?=px)/g)!.map(Number);
    const width = Number.parseFloat(ghost.style.width);
    const height = Number.parseFloat(ghost.querySelector('img')!.style.height);
    if (handle === 'tc' || handle === 'bc') {
      expect(width).toBe(222);
      expect(height).toBe(178);
      expect(left).toBe(100);
      expect(top).toBe(200);
    } else {
      expect(width).toBe(252);
      expect(height).toBe(148);
      expect(top).toBe(200);
      expect(handle === 'ml' ? left + width : left).toBe(handle === 'ml' ? 322 : 100);
    }
    send('pointerup', handle === 'ml' ? -30 : 30, handle === 'tc' ? -30 : 30);
    expect(editor.state.doc.nodeAt(1)!.attrs.aspectRatio).toBeCloseTo(width / height);
  });

  it.each(['inline', 'wrap'].flatMap(layout => [0.75, 1, 1.5].map(scale => ({ layout, scale }))))('grows beyond the page with the opposite corner fixed in $layout at $scale', ({ layout, scale }) => {
    const { editor, original, dispatch, send } = setup('tl', layout, scale);
    send('pointermove', -600 * scale, -400 * scale);
    const ghost = document.querySelector<HTMLElement>('.editor-image-resize-preview')!;
    const [left, top] = ghost.style.transform.match(/-?[\d.]+(?=px)/g)!.map(Number);
    const width = Number.parseFloat(ghost.style.width);
    const height = Number.parseFloat(ghost.querySelector('img')!.style.height);
    expect(left).toBeLessThan(0);
    expect(top).toBeLessThan(0);
    expect(width).toBeCloseTo(822 * scale);
    expect(height).toBeCloseTo(548 * scale);
    expect(left + width).toBeCloseTo(100 + 222 * scale);
    expect(top + height).toBeCloseTo(200 + 148 * scale);
    expect(editor.getJSON()).toEqual(original);
    expect(dispatch).not.toHaveBeenCalled();
    send('pointerup', -600 * scale, -400 * scale);
    expect(editor.state.doc.nodeAt(1)!.attrs.width).toBeCloseTo(129.59, 1);
    expect(editor.state.doc.nodeAt(1)!.attrs.aspectRatio).toBeCloseTo(1.5);
    expect(dispatch).toHaveBeenCalledTimes(1);
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
  });

  it.each(['ml', 'mr', 'tc', 'tr'] as const)('continues resizing across the page edge with handle %s', handle => {
    const { editor, send } = setup(handle);
    const dx = handle.endsWith('l') ? -600 : handle === 'tc' ? 0 : 600;
    const dy = handle.startsWith('t') ? -400 : 0;
    send('pointermove', dx, dy);
    const ghost = document.querySelector<HTMLElement>('.editor-image-resize-preview')!;
    expect(Number.parseFloat(ghost.style.width)).toBeCloseTo(handle === 'tc' ? 222 : 822);
    expect(Number.parseFloat(ghost.querySelector('img')!.style.height)).toBeCloseTo(handle === 'tc' ? 548 : handle === 'tr' ? 548 : 148);
    send('pointerup', dx, dy);
    expect(editor.state.doc.nodeAt(1)!.attrs.width).toBeCloseTo(handle === 'tc' ? 35 : 129.59, 1);
  });

  it.each([0.75, 1, 1.5])('uses screen scale %s for inline dimensions', scale => {
    const { editor, send } = setup('mr', 'inline', scale);
    send('pointermove', 40 * scale);
    expect(Number.parseFloat(document.querySelector<HTMLElement>('.editor-image-resize-preview')!.style.width)).toBeCloseTo(262 * scale, 0);
    send('pointerup', 40 * scale);
    expect(editor.state.doc.nodeAt(1)?.attrs.width).toBeCloseTo(41.31, 1);
  });

  it.each(['Escape', 'pointercancel', 'blur', 'cleanup'])('cancels without modifying the document on %s', end => {
    const { editor, original, anchor, dispatch, send, cancel } = setup();
    send('pointermove', 30);
    if (end === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    else if (end === 'cleanup') cancel();
    else window.dispatchEvent(new Event(end));
    send('pointermove', 40); send('pointerup', 40);
    expect(editor.getJSON()).toEqual(original);
    expect(dispatch).not.toHaveBeenCalled();
    expect(anchor.dataset.imageResizing).toBeUndefined();
    expect(document.querySelector('.editor-image-resize-preview')).toBeNull();
  });

  it('ignores other pointers, preserves a click with no resize, and rejects a stale document', () => {
    const first = setup();
    first.send('pointermove', 30, 0, 2); first.send('pointerup', 30, 0, 2);
    expect(document.querySelector('.editor-image-resize-preview')).toBeNull();
    first.send('pointerup');
    expect(first.dispatch).not.toHaveBeenCalled();
    const second = setup();
    second.send('pointermove', 30);
    second.editor.commands.insertContent('Altra modifica');
    const changed = second.editor.getJSON();
    second.dispatch.mockClear();
    second.send('pointerup', 30);
    expect(second.editor.getJSON()).toEqual(changed);
    expect(second.dispatch).not.toHaveBeenCalled();
    expect(document.querySelector('.editor-image-resize-preview')).toBeNull();
  });
});
