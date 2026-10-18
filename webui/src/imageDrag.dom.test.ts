import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import type { EditorView } from '@tiptap/pm/view';
import { FloatingImage } from './components/FloatingImage';
import { EDITOR_ZOOM_EVENT, startImageDrag } from './imageDrag';

const cleanups: Array<() => void> = [];
const editors: Editor[] = [];

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setupTableDrag(scale = 1) {
  const editor = new Editor({
    extensions: [StarterKit, Table, TableRow, TableCell, TableHeader, FloatingImage.extend({ addNodeView: () => null })],
    content: '<p>Intro <span data-editor-image data-layout="wrap" data-width="35"><img src="drag.png"></span></p><table><tr><td><p>Left</p></td><td><p>Right</p></td></tr></table><p>Fine</p>',
  });
  editors.push(editor);
  document.body.append(editor.view.dom);
  const original = editor.getJSON();
  const rect = (left: number, top: number, width: number, height = 40): DOMRect => new DOMRect(left * scale, top * scale, width * scale, height * scale);
  Object.defineProperties(editor.view.dom, { offsetWidth: { value: 640 }, clientWidth: { value: 640 } });
  vi.spyOn(editor.view.dom, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, 640, 600));
  const [intro, end] = Array.from(editor.view.dom.querySelectorAll(':scope > p'));
  vi.spyOn(intro, 'getBoundingClientRect').mockImplementation(() => rect(0, 40, 640));
  vi.spyOn(end, 'getBoundingClientRect').mockImplementation(() => rect(0, 200, 640));
  editor.view.dom.querySelectorAll('td p').forEach((paragraph, cell) => vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(() => rect([100, 330][cell], 100, 200)));
  let pos = 0;
  editor.state.doc.descendants((node, nodePos) => { if (node.type.name === 'floatingImage') pos = nodePos; });
  const anchor = editor.view.nodeDOM(pos) as HTMLElement;
  vi.spyOn(anchor.querySelector<HTMLElement>('.editor-image-surface')!, 'getBoundingClientRect').mockReturnValue(rect(350, 100, 70));
  const pointer = (type: string, left: number) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, clientX: (left + 10) * scale, clientY: 110 * scale });
    return event as PointerEvent;
  };
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  cleanups.push(startImageDrag(editor.view, pos, anchor, pointer('pointerdown', 350)));
  const drop = (left: number) => {
    window.dispatchEvent(pointer('pointermove', left));
    window.dispatchEvent(pointer('pointerup', left));
  };
  const images = () => {
    const found: Array<{ node: NonNullable<ReturnType<typeof editor.state.doc.nodeAt>>; inCell: boolean }> = [];
    editor.state.doc.descendants((node, nodePos) => {
      if (node.type.name !== 'floatingImage') return;
      const $pos = editor.state.doc.resolve(nodePos);
      found.push({ node, inCell: Array.from({ length: $pos.depth }, (_, depth) => $pos.node(depth + 1).type.name).includes('tableCell') });
    });
    return found;
  };
  return { editor, original, drop, images };
}

describe('wrap drop over a table', () => {
  // Docs anchors floating images only to paragraphs outside tables.
  it.each([0.75, 1, 1.5])('anchors above the table and keeps the displayed position at scale %s', scale => {
    const { editor, original, drop, images } = setupTableDrag(scale);
    drop(380);
    const [image] = images();
    expect(images()).toHaveLength(1);
    expect(image.inCell).toBe(false);
    expect(editor.state.doc.child(0).textContent).toBe('Intro ');
    const { layout, width, position, offsetX, offsetY } = image.node.attrs;
    expect(layout).toBe('wrap');
    expect(640 * (1 - width / 100) * position / 100 + offsetX).toBeCloseTo(380, 1);
    expect(40 + offsetY).toBeCloseTo(100, 1);
    const moved = editor.getJSON();
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
    editor.commands.redo();
    expect(editor.getJSON()).toEqual(moved);
  });

  it.each([-120, 700])('keeps a free drop at X=%s outside the table', left => {
    const { drop, images } = setupTableDrag();
    drop(left);
    const [image] = images();
    expect(image.inCell).toBe(false);
    const { width, position, offsetX } = image.node.attrs;
    expect(640 * (1 - width / 100) * position / 100 + offsetX).toBeCloseTo(left);
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

describe('wrap drop across paragraphs', () => {
  it('skips a code block target and keeps the link mark when moving to another paragraph', () => {
    const editor = new Editor({
      extensions: [StarterKit, FloatingImage.extend({ addNodeView: () => null })],
      content: '<p>Intro</p><pre><code>codice</code></pre><p>Fine <a href="https://example.com/lezione"><span data-editor-image data-layout="wrap" data-width="35"><img src="drag.png"></span></a></p>',
    });
    editors.push(editor);
    document.body.append(editor.view.dom);
    Object.defineProperties(editor.view.dom, { offsetWidth: { value: 640 }, clientWidth: { value: 640 } });
    vi.spyOn(editor.view.dom, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 640, 600));
    const [intro, end] = Array.from(editor.view.dom.querySelectorAll(':scope > p'));
    vi.spyOn(intro, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 40, 640, 40));
    vi.spyOn(editor.view.dom.querySelector('pre')!, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100, 640, 40));
    vi.spyOn(end, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 200, 640, 40));
    let pos = 0;
    editor.state.doc.descendants((node, nodePos) => { if (node.type.name === 'floatingImage') pos = nodePos; });
    const anchor = editor.view.nodeDOM(pos) as HTMLElement;
    vi.spyOn(anchor.querySelector<HTMLElement>('.editor-image-surface')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(350, 200, 70, 40));
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const pointer = (type: string, clientY: number) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { pointerId: 1, clientX: 360, clientY });
      return event as PointerEvent;
    };
    cleanups.push(startImageDrag(editor.view, pos, anchor, pointer('pointerdown', 210)));
    // The image top lands on the code block line, so the paragraph above anchors it.
    window.dispatchEvent(pointer('pointermove', 110));
    expect(() => window.dispatchEvent(pointer('pointerup', 110))).not.toThrow();
    expect(editor.state.doc.child(1).textContent).toBe('codice');
    const image = editor.state.doc.child(0).firstChild!;
    expect(image.type.name).toBe('floatingImage');
    expect(image.marks.map(mark => [mark.type.name, mark.attrs.href])).toEqual([['link', 'https://example.com/lezione']]);
  });
});

describe('wrap drag across a zoom change', () => {
  // Docs zoom is only a view scale: the stored width never follows it.
  it.each([[110, 'its own'], [210, 'another']])('keeps the stored width when dropped at Y=%s in %s paragraph', dropY => {
    const editor = new Editor({
      extensions: [StarterKit, FloatingImage.extend({ addNodeView: () => null })],
      content: '<p>Intro <span data-editor-image data-layout="wrap" data-width="35"><img src="drag.png"></span></p><p>Fine</p>',
    });
    editors.push(editor);
    document.body.append(editor.view.dom);
    let scale = 1;
    const rect = (top: number, width: number) => new DOMRect(0, top * scale, width * scale, 40 * scale);
    Object.defineProperties(editor.view.dom, { offsetWidth: { value: 640 }, clientWidth: { value: 640 } });
    vi.spyOn(editor.view.dom, 'getBoundingClientRect').mockImplementation(() => rect(0, 640));
    const [intro, end] = Array.from(editor.view.dom.querySelectorAll(':scope > p'));
    vi.spyOn(intro, 'getBoundingClientRect').mockImplementation(() => rect(100, 640));
    vi.spyOn(end, 'getBoundingClientRect').mockImplementation(() => rect(200, 640));
    let pos = 0;
    editor.state.doc.descendants((node, nodePos) => { if (node.type.name === 'floatingImage') pos = nodePos; });
    const anchor = editor.view.nodeDOM(pos) as HTMLElement;
    vi.spyOn(anchor.querySelector<HTMLElement>('.editor-image-surface')!, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100 * scale, 224 * scale, 40 * scale));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { fn(16); return 0; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const pointer = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { pointerId: 1, clientX, clientY });
      return event as PointerEvent;
    };
    cleanups.push(startImageDrag(editor.view, pos, anchor, pointer('pointerdown', 10, 110)));
    window.dispatchEvent(pointer('pointermove', 40, 120));
    scale = 1.1;
    window.dispatchEvent(new Event(EDITOR_ZOOM_EVENT));
    window.dispatchEvent(pointer('pointermove', 60 * scale, dropY * scale));
    expect(document.querySelector<HTMLElement>('.editor-image-drag-preview')!.style.width).toBe(`${224 * scale}px`);
    window.dispatchEvent(pointer('pointerup', 60 * scale, dropY * scale));
    const images: number[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'floatingImage') images.push(node.attrs.width); });
    expect(images).toEqual([35]);
  });
});
