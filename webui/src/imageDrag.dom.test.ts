import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@tiptap/pm/view';
import { startImageDrag } from './imageDrag';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(scale = 1) {
  const viewport = document.createElement('div');
  viewport.style.overflowY = 'auto';
  const root = document.createElement('div');
  root.style.padding = '40px';
  root.innerHTML = '<span><span class="editor-image-surface"><img src="test.png"></span></span>';
  viewport.append(root);
  document.body.append(viewport);
  Object.defineProperties(root, { offsetWidth: { value: 800 }, clientWidth: { value: 800 } });
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 0, bottom: 1000, width: 800 * scale } as DOMRect);
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 500 } as DOMRect);
  const anchor = root.firstElementChild as HTMLElement;
  const surface = anchor.firstElementChild as HTMLElement;
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 300, top: 200, width: 200 * scale } as DOMRect);
  const view = { dom: root, state: { doc: {} }, isDestroyed: false } as unknown as EditorView;
  const pointer = (type: string, x: number, pointerId = 1) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX: x, clientY: 230, pointerId });
    return event as PointerEvent;
  };
  const cancel = startImageDrag(view, 0, anchor, pointer('pointerdown', 320));
  return { root, anchor, cancel, move: (x: number, id = 1) => window.dispatchEvent(pointer('pointermove', x, id)) };
}

describe('wrap alignment guides', () => {
  it.each([1, 0.75, 1.5])('snaps left, center and right within six screen pixels at scale %s', scale => {
    const { root, cancel, move } = setup(scale);
    const targets = [
      { align: 'left', left: 40, x: 40 },
      { align: 'center', left: 300, x: 400 },
      { align: 'right', left: 560, x: 760 },
    ];
    for (const target of targets) {
      move(100 + target.left * scale + 20 + (target.align === 'right' ? -5 : 5));
      const guide = document.querySelector<HTMLElement>('.editor-image-alignment-guide')!;
      expect(guide.dataset.align).toBe(target.align);
      expect(guide.style.left).toBe(`${100 + target.x * scale}px`);
      expect(guide.style.top).toBe('100px');
      expect(guide.style.height).toBe('400px');
      expect(document.querySelector<HTMLElement>('.editor-image-drag-preview')!.style.transform).toContain(`translate3d(${100 + target.left * scale}px,`);
      expect(root.querySelector('.editor-image-alignment-guide')).toBeNull();
    }
    move(100 + 300 * scale + 20 + 7);
    expect(document.querySelector('.editor-image-alignment-guide')).toBeNull();
    cancel();
  });

  it.each(['pointercancel', 'blur', 'Escape', 'cleanup'])('cleans up guides, ghost and listeners on %s', end => {
    const { anchor, cancel, move } = setup();
    move(320);
    expect(document.querySelector('.editor-image-drag-preview')).toBeNull();
    move(165, 2);
    expect(document.querySelector('.editor-image-alignment-guide')).toBeNull();
    move(165);
    expect(document.querySelector('.editor-image-alignment-guide')).not.toBeNull();
    if (end === 'cleanup') cancel();
    else if (end === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    else window.dispatchEvent(new Event(end));
    expect(document.querySelector('.editor-image-alignment-guide, .editor-image-drag-preview')).toBeNull();
    expect(anchor.dataset.imageDragging).toBeUndefined();
    move(425);
    expect(document.querySelector('.editor-image-alignment-guide, .editor-image-drag-preview')).toBeNull();
    cancel();
  });
});
