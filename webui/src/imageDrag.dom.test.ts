import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import type { EditorView } from '@tiptap/pm/view';
import { FloatingImage } from './components/FloatingImage';
import { startImageDrag } from './imageDrag';

const cleanups: Array<() => void> = [];
const editors: Editor[] = [];

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setupTableDrag(sourceCell = 1, scale = 1) {
  const editor = new Editor({
    extensions: [StarterKit, Table, TableRow, TableCell, TableHeader, FloatingImage.extend({ addNodeView: () => null })],
    content: `<table><tr>${['Left', 'Right'].map((text, cell) => `<td><p>${cell === sourceCell ? '<span data-editor-image data-layout="wrap" data-width="35"><img src="drag.png"></span>' : ''}${text}</p></td>`).join('')}</tr></table><p></p>`,
  });
  editors.push(editor);
  document.body.append(editor.view.dom);
  const original = editor.getJSON();
  const rect = (left: number, top: number, width: number, height = 40): DOMRect => new DOMRect(left * scale, top * scale, width * scale, height * scale);
  Object.defineProperties(editor.view.dom, { offsetWidth: { value: 640 }, clientWidth: { value: 640 } });
  vi.spyOn(editor.view.dom, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, 640, 600));
  const paragraphs = editor.view.dom.querySelectorAll('td p');
  [100, 330].forEach((left, cell) => vi.spyOn(paragraphs[cell], 'getBoundingClientRect').mockImplementation(() => rect(left, 100, 200)));
  let pos = 0;
  editor.state.doc.descendants((node, nodePos) => { if (node.type.name === 'floatingImage') pos = nodePos; });
  const anchor = editor.view.nodeDOM(pos) as HTMLElement;
  const startLeft = (sourceCell === 0 ? 100 : 330) + 20;
  vi.spyOn(anchor.querySelector<HTMLElement>('.editor-image-surface')!, 'getBoundingClientRect').mockReturnValue(rect(startLeft, 100, 70));
  const pointer = (type: string, left: number) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, clientX: (left + 10) * scale, clientY: 110 * scale });
    return event as PointerEvent;
  };
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  cleanups.push(startImageDrag(editor.view, pos, anchor, pointer('pointerdown', startLeft)));
  const drop = (left: number) => {
    window.dispatchEvent(pointer('pointermove', left));
    window.dispatchEvent(pointer('pointerup', left));
  };
  const cells = () => editor.state.doc.firstChild!.firstChild!.content;
  const imageInCell = (cell: number) => {
    let image: ReturnType<typeof editor.state.doc.nodeAt> | undefined;
    cells().child(cell).descendants(node => { if (node.type.name === 'floatingImage') image = node; });
    return image;
  };
  return { editor, original, drop, cells, imageInCell, setScale: (value: number) => { scale = value; }, move: (left: number) => window.dispatchEvent(pointer('pointermove', left)) };
}

describe('wrap drop anchors in table columns', () => {
  it.each([0.9, 1.1])('refreshes geometry on release after zoom changes to %s without scroll or resize', scale => {
    const { editor, original, move, setScale, drop, imageInCell } = setupTableDrag();
    move(370);
    expect(editor.getJSON()).toEqual(original);
    setScale(scale);
    drop(380);
    const image = imageInCell(1)!;
    expect(image).toBeDefined();
    expect(imageInCell(0)).toBeUndefined();
    const { width, position, offsetX, offsetY } = image.attrs;
    // Preserve the original screen-space grab offset under the new scale.
    expect(330 + 200 * (1 - width / 100) * position / 100 + offsetX).toBeCloseTo(390 - 10 / scale, 1);
    expect(100 + offsetY).toBeCloseTo(110 - 10 / scale, 1);
    const moved = editor.getJSON();
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
    editor.commands.redo();
    expect(editor.getJSON()).toEqual(moved);
  });

  it.each([0.75, 1, 1.5])('keeps a drag inside the second cell in that cell at scale %s', scale => {
    const { editor, original, drop, cells, imageInCell } = setupTableDrag(1, scale);
    drop(380);
    expect(imageInCell(0)).toBeUndefined();
    expect(imageInCell(1)).toBeDefined();
    expect(cells().child(0).textContent).toBe('Left');
    expect(cells().child(1).textContent).toBe('Right');
    const moved = editor.getJSON();
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
    editor.commands.redo();
    expect(editor.getJSON()).toEqual(moved);
  });

  it.each([{ source: 0, destination: 1, left: 380 }, { source: 1, destination: 0, left: 150 }])('moves from cell $source to cell $destination', ({ source, destination, left }) => {
    const { drop, imageInCell } = setupTableDrag(source);
    drop(left);
    expect(imageInCell(source)).toBeUndefined();
    expect(imageInCell(destination)).toBeDefined();
  });

  it.each([-120, 700])('keeps a free drop at X=%s when no column contains the image origin', left => {
    const { drop, imageInCell } = setupTableDrag();
    drop(left);
    const image = imageInCell(0)!;
    expect(image).toBeDefined();
    const { width, position, offsetX } = image.attrs;
    expect(100 + 200 * (1 - width / 100) * position / 100 + offsetX).toBeCloseTo(left);
  });
});

function setup(scale = 1, paintImmediately = true) {
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { callbacks.set(++id, fn); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { callbacks.delete(id); });
  const frame = () => { const current = [...callbacks.values()]; callbacks.clear(); current.forEach(fn => fn(16)); };
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
  cleanups.push(cancel);
  return { root, anchor, viewport, cancel, frame, move: (x: number, id = 1) => { window.dispatchEvent(pointer('pointermove', x, id)); if (paintImmediately) frame(); } };
}

describe('wrap alignment guides', () => {
  it('coalesces pointer bursts into one paint without rereading editor layout', () => {
    const { root, move, cancel, frame } = setup(1, false);
    const bounds = vi.mocked(root.getBoundingClientRect); bounds.mockClear();
    for (let x = 400; x <= 500; x += 5) move(x);
    expect(bounds).not.toHaveBeenCalled();
    expect(document.querySelector('.editor-image-drag-preview')).toBeNull();
    frame();
    expect(document.querySelector<HTMLElement>('.editor-image-drag-preview')!.style.transform).toContain('translate3d(480px,');
    expect(bounds).not.toHaveBeenCalled();
    move(525); cancel();
    frame();
    expect(document.querySelector('.editor-image-drag-preview')).toBeNull();
  });
  it('refreshes cached guide geometry after scroll and viewport resize', () => {
    const { root, viewport, move, cancel, frame } = setup();
    move(165);
    const bounds = vi.mocked(root.getBoundingClientRect); bounds.mockClear();
    vi.mocked(viewport.getBoundingClientRect).mockReturnValue({ top: 120, bottom: 450 } as DOMRect);
    window.dispatchEvent(new Event('scroll')); frame();
    expect(bounds).toHaveBeenCalledTimes(1);
    const guide = document.querySelector<HTMLElement>('.editor-image-alignment-guide')!;
    expect(guide.style.top).toBe('120px'); expect(guide.style.height).toBe('330px');
    root.style.padding = '50px';
    window.dispatchEvent(new Event('resize')); frame();
    move(170);
    expect(document.querySelector<HTMLElement>('.editor-image-alignment-guide')!.style.left).toBe('150px');
    expect(bounds).toHaveBeenCalledTimes(2);
    cancel();
  });
  it('allows crossing both page edges and removes guides outside the snap distance', () => {
    const { move, cancel } = setup();
    move(-100);
    expect(document.querySelector<HTMLElement>('.editor-image-drag-preview')!.style.transform).toContain('translate3d(-120px,');
    expect(document.querySelector('.editor-image-alignment-guide')).toBeNull();
    move(1200);
    expect(document.querySelector<HTMLElement>('.editor-image-drag-preview')!.style.transform).toContain('translate3d(1180px,');
    expect(document.querySelector('.editor-image-alignment-guide')).toBeNull();
    cancel();
  });
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
