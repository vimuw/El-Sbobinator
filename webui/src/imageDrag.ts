import type { EditorView } from '@tiptap/pm/view';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { normalizeImagePosition, normalizeImageWidth } from './imageLayout';
import { startImageAutoScroll } from './imageAutoScroll';

export const IMAGE_WRAP_PREVIEW_EVENT = 'editor-image-wrap-preview';

const refresh = (view: EditorView) => view.dom.dispatchEvent(new Event(IMAGE_WRAP_PREVIEW_EVENT));

export function createImageGhost(surface: HTMLElement, width: number): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'editor-image-drag-preview';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.contentEditable = 'false';
  ghost.style.width = `${width}px`;
  const copy = surface.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.editor-image-resize-handles, .editor-image-toolbar').forEach(el => el.remove());
  copy.style.cssText = 'position:relative;display:block;width:100%;left:0;top:0;';
  ghost.appendChild(copy);
  document.body.appendChild(ghost);
  return ghost;
}

// The React renderer's outer inline span has different bounds from the image.
// Use the visible surface to keep the native drag ghost at the grabbed point.
export function setInlineImageDragPreview(anchor: HTMLElement, event: DragEvent) {
  const surface = anchor.querySelector<HTMLElement>('.editor-image-surface');
  if (!surface || !event.dataTransfer) return;
  const rect = surface.getBoundingClientRect();
  const ghost = createImageGhost(surface, rect.width);
  ghost.style.transform = 'translate3d(-10000px, -10000px, 0)';
  event.dataTransfer.setDragImage(ghost, event.clientX - rect.left, event.clientY - rect.top);
  setTimeout(() => ghost.remove(), 0);
}

// Move only a lightweight ghost while dragging. The image and text layout stay
// untouched until release, which commits one undoable document change.
export function startImageDrag(view: EditorView, pos: number, anchor: HTMLElement, event: PointerEvent): () => void {
  const surface = anchor.querySelector<HTMLElement>('.editor-image-surface');
  if (!surface) return () => {};
  event.preventDefault();
  const start = surface.getBoundingClientRect();
  const grabX = event.clientX - start.left;
  const grabY = event.clientY - start.top;
  const pointerId = event.pointerId;
  const originalDoc = view.state.doc;
  let moved = false;
  let finished = false;
  let lastX = event.clientX;
  let lastY = event.clientY;
  let left = 0;
  let top = 0;
  let ghost: HTMLElement | null = null;
  let guide: HTMLElement | null = null;
  anchor.dataset.imageDragging = 'true';
  anchor.setPointerCapture?.(pointerId);

  const preview = () => {
    const root = view.dom.getBoundingClientRect();
    const scale = root.width / view.dom.offsetWidth || 1;
    const css = getComputedStyle(view.dom);
    const paddingLeft = Number.parseFloat(css.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(css.paddingRight) || 0;
    const paddingTop = Number.parseFloat(css.paddingTop) || 0;
    const width = start.width / scale;
    left = Math.max(paddingLeft, Math.min(view.dom.clientWidth - paddingRight - width, (lastX - grabX - root.left) / scale));
    top = Math.max(paddingTop, (lastY - grabY - root.top) / scale);
    const contentRight = view.dom.clientWidth - paddingRight;
    const targets = [
      { align: 'center', left: (paddingLeft + contentRight - width) / 2, x: (paddingLeft + contentRight) / 2 },
      { align: 'left', left: paddingLeft, x: paddingLeft },
      { align: 'right', left: contentRight - width, x: contentRight },
    ];
    const nearest = targets.reduce((best, target) => Math.abs(target.left - left) < Math.abs(best.left - left) ? target : best);
    // Keep the snap distance constant on screen, including at different zooms.
    if (Math.abs(nearest.left - left) * scale <= 6) {
      left = nearest.left;
      if (!guide) {
        guide = document.createElement('div');
        guide.className = 'editor-image-alignment-guide';
        guide.setAttribute('aria-hidden', 'true');
        guide.contentEditable = 'false';
        document.body.appendChild(guide);
      }
      let guideTop = Math.max(0, root.top);
      let guideBottom = Math.min(window.innerHeight, root.bottom);
      for (let parent = view.dom.parentElement; parent; parent = parent.parentElement) {
        if (!/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)) continue;
        const bounds = parent.getBoundingClientRect();
        guideTop = Math.max(guideTop, bounds.top);
        guideBottom = Math.min(guideBottom, bounds.bottom);
      }
      guide.dataset.align = nearest.align;
      guide.style.left = `${root.left + nearest.x * scale}px`;
      guide.style.top = `${guideTop}px`;
      guide.style.height = `${Math.max(0, guideBottom - guideTop)}px`;
    } else {
      guide?.remove();
      guide = null;
    }
    if (!ghost) {
      ghost = createImageGhost(surface, start.width);
    }
    ghost.style.transform = `translate3d(${root.left + left * scale}px, ${root.top + top * scale}px, 0)`;
  };
  const autoScroll = startImageAutoScroll(view.dom, preview);
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (!moved && Math.hypot(lastX - event.clientX, lastY - event.clientY) < 3) return;
    moved = true;
    e.preventDefault();
    preview();
    autoScroll.update(lastX, lastY);
  };
  const scrolled = () => { if (moved) preview(); };
  const cleanup = () => {
    if (finished) return;
    finished = true;
    autoScroll.stop();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', escape, true);
    window.removeEventListener('scroll', scrolled, true);
    window.removeEventListener('blur', cancel);
    if (anchor.hasPointerCapture?.(pointerId)) anchor.releasePointerCapture(pointerId);
    ghost?.remove();
    ghost = null;
    guide?.remove();
    guide = null;
    delete anchor.dataset.imageDragging;
  };
  const cancel = () => { cleanup(); if (!view.isDestroyed) refresh(view); };
  const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (moved) { lastX = e.clientX; lastY = e.clientY; preview(); }
    cleanup();
    // Do not apply stale document positions if another edit arrived mid-gesture.
    if (moved && !view.isDestroyed && view.state.doc === originalDoc) placeImage(view, pos, left, top, start.width);
    if (!view.isDestroyed) refresh(view);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', escape, true);
  window.addEventListener('scroll', scrolled, true);
  window.addEventListener('blur', cancel);
  return cancel;
}

function placeImage(view: EditorView, pos: number, left: number, top: number, visualWidth: number) {
  const image = view.state.doc.nodeAt(pos);
  if (image?.type.name !== 'floatingImage') return;
  const root = view.dom.getBoundingClientRect();
  const scale = root.width / view.dom.offsetWidth || 1;
  const desiredTop = root.top + top * scale;
  const desiredLeft = root.left + left * scale;
  let target: { pos: number; dom: HTMLElement; rect: DOMRect } | undefined;
  // The anchor follows the paragraph at the image's top, not a line beneath the
  // pointer. This preserves the grab offset when dragging into another section.
  view.state.doc.descendants((node, nodePos) => {
    if (!node.isTextblock) return;
    const dom = view.nodeDOM(nodePos);
    if (!(dom instanceof HTMLElement)) return;
    const rect = dom.getBoundingClientRect();
    if (rect.top <= desiredTop + 1 && rect.left <= desiredLeft + 1 && rect.right >= desiredLeft + visualWidth - 1 && (!target || rect.top > target.rect.top)) target = { pos: nodePos, dom, rect };
  });
  if (!target) return;
  const width = normalizeImageWidth(visualWidth / target.rect.width * 100);
  const freeWidth = Math.max(0, target.rect.width * (1 - width / 100));
  const position = normalizeImagePosition(freeWidth ? (desiredLeft - target.rect.left) / freeWidth * 100 : 50, 'center');
  const attrs = { ...image.attrs, width, position, offsetY: Math.max(0, Math.round((desiredTop - target.rect.top) / scale)), align: position === 0 ? 'left' : position === 100 ? 'right' : 'center' };
  const tr = closeHistory(view.state.tr);
  let selectedPos = pos;
  if (view.state.doc.resolve(pos).before() === target.pos) tr.setNodeMarkup(pos, undefined, attrs);
  else {
    tr.delete(pos, pos + image.nodeSize);
    selectedPos = tr.mapping.map(target.pos + 1);
    tr.insert(selectedPos, image.type.create(attrs));
  }
  tr.setSelection(NodeSelection.create(tr.doc, selectedPos));
  view.dispatch(tr);
  // Removing the old wrap gaps can move the destination paragraph. Measure its
  // final top before laying out the new wrap, then join the correction to the
  // same history group so the drop stays at the ghost's location.
  const placed = view.nodeDOM(selectedPos);
  const paragraph = placed instanceof HTMLElement ? placed.closest('p, h1, h2, h3, h4, h5, h6') : null;
  const current = view.state.doc.nodeAt(selectedPos);
  if (paragraph && current?.type.name === 'floatingImage') {
    const offsetY = Math.max(0, Math.round((desiredTop - paragraph.getBoundingClientRect().top) / scale));
    if (offsetY !== current.attrs.offsetY) {
      view.dispatch(view.state.tr.setNodeMarkup(selectedPos, undefined, { ...current.attrs, offsetY }));
    }
  }
}
