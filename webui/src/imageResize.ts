import type { EditorView } from '@tiptap/pm/view';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { createImageGhost, IMAGE_WRAP_PREVIEW_EVENT } from './imageDrag';
import { normalizeImageLayout, normalizeImageOffsetY, normalizeImagePosition, normalizeImageWidth } from './imageLayout';

export type ImageResizeHandle = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

type LineImage = { anchor: HTMLElement; image: HTMLImageElement };

// The other inline images of the paragraph, measured where they sit on their line.
function lineImages(paragraph: HTMLElement, resized: HTMLElement): LineImage[] {
  return Array.from(paragraph.querySelectorAll<HTMLElement>('.editor-image-node[data-layout="inline"]'))
    .filter(anchor => anchor !== resized)
    .flatMap(anchor => {
      const image = anchor.querySelector('img');
      return image ? [{ anchor, image }] : [];
    });
}

// Images whose natural bottom (without their own vertical offset) is on this baseline.
function sameLine(images: LineImage[], baseline: number, scale: number): Set<HTMLElement> {
  return new Set(images
    .filter(({ anchor, image }) => Math.abs(image.getBoundingClientRect().bottom - normalizeImageOffsetY(anchor.dataset.offsetY) * scale - baseline) < 1.5)
    .map(({ anchor }) => anchor));
}

export function startImageResize(view: EditorView, pos: number, anchor: HTMLElement, handleElement: HTMLElement, event: PointerEvent, handle: ImageResizeHandle): () => void {
  const surface = anchor.querySelector<HTMLElement>('.editor-image-surface');
  const image = anchor.querySelector('img');
  const node = view.state.doc.nodeAt(pos);
  if (!surface || !image || node?.type.name !== 'floatingImage') return () => {};
  const originalDoc = view.state.doc;
  const start = image.getBoundingClientRect();
  const rootRect = view.dom.getBoundingClientRect();
  const scale = rootRect.width / view.dom.offsetWidth || 1;
  const startWidth = normalizeImageWidth(node.attrs.width);
  const paragraph = anchor.closest<HTMLElement>('p, h1, h2, h3, h4, h5, h6');
  const bounds = (paragraph ?? view.dom).getBoundingClientRect();
  const contentWidth = paragraph?.clientWidth || start.width / scale / startWidth * 100;
  if (contentWidth <= 0 || start.width <= 0 || start.height <= 0) return () => {};
  const layout = normalizeImageLayout(node.attrs.layout);
  const aspectRatio = start.width / start.height;
  const horizontal = handle !== 'tc' && handle !== 'bc';
  const vertical = handle !== 'ml' && handle !== 'mr';
  const corner = horizontal && vertical;
  const fromLeft = handle.endsWith('l');
  const fromTop = handle.startsWith('t');
  const startRight = start.left + start.width;
  const startBottom = start.top + start.height;
  // Page edges do not constrain the gesture. The opposite corner/edge stays
  // fixed even when the dragged handle crosses a margin or leaves the page.
  let width = startWidth;
  let visualWidth = start.width;
  let visualHeight = start.height;
  let left = start.left;
  let top = start.top;
  let ghost: HTMLElement | null = null;
  let finished = false;
  anchor.dataset.imageResizing = 'true';
  handleElement.setPointerCapture?.(event.pointerId);

  const preview = (pointer: PointerEvent) => {
    const dx = (pointer.clientX - event.clientX) * (fromLeft ? -1 : 1);
    const dy = (pointer.clientY - event.clientY) * (fromTop ? -1 : 1);
    if (corner) {
      // Either axis can drive a corner gesture, including a purely vertical drag.
      const delta = Math.abs(dx) >= Math.abs(dy * aspectRatio) ? dx : dy * aspectRatio;
      visualWidth = Math.max(contentWidth * scale * 0.2, 24 * scale * aspectRatio, start.width + delta);
      visualHeight = visualWidth / aspectRatio;
    } else if (horizontal) {
      visualWidth = Math.max(contentWidth * scale * 0.2, start.width + dx);
    } else {
      visualHeight = Math.max(24 * scale, start.height + dy);
    }
    width = normalizeImageWidth(visualWidth / (contentWidth * scale) * 100);
    left = fromLeft ? startRight - visualWidth : start.left;
    top = fromTop && handle !== 'tc' ? startBottom - visualHeight : start.top;
    if (visualWidth === start.width && visualHeight === start.height && !ghost) return;
    ghost ??= createImageGhost(surface, start.width);
    ghost.classList.add('editor-image-resize-preview');
    // Resize outlines belong to the asset, not its optional caption.
    ghost.querySelector('.editor-image-caption')?.remove();
    const ghostImage = ghost.querySelector('img')!;
    ghostImage.style.height = `${visualHeight}px`;
    ghostImage.style.aspectRatio = 'auto';
    ghost.style.width = `${visualWidth}px`;
    ghost.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  };
  const refresh = () => { if (!view.isDestroyed) view.dom.dispatchEvent(new Event(IMAGE_WRAP_PREVIEW_EVENT)); };
  const cleanup = () => {
    if (finished) return;
    finished = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', escape, true);
    window.removeEventListener('blur', cancel);
    if (handleElement.hasPointerCapture?.(event.pointerId)) handleElement.releasePointerCapture(event.pointerId);
    ghost?.remove();
    delete anchor.dataset.imageResizing;
  };
  const cancel = () => { cleanup(); refresh(); };
  const escape = (key: KeyboardEvent) => {
    if (key.key !== 'Escape') return;
    key.preventDefault();
    key.stopImmediatePropagation();
    cancel();
  };
  const move = (pointer: PointerEvent) => {
    if (pointer.pointerId !== event.pointerId) return;
    pointer.preventDefault();
    preview(pointer);
  };
  const release = (pointer: PointerEvent) => {
    if (pointer.pointerId !== event.pointerId) return;
    preview(pointer);
    cleanup();
    if (!view.isDestroyed && view.state.doc === originalDoc && (visualWidth !== start.width || visualHeight !== start.height)) {
      const freeWidth = contentWidth * scale - visualWidth;
      const position = normalizeImagePosition(freeWidth > 0 ? (left - bounds.left) / freeWidth * 100 : 0, 'left');
      const attrs = {
        ...node.attrs, width, aspectRatio: visualWidth / visualHeight,
        ...(layout === 'wrap' ? { position, align: position === 0 ? 'left' : position === 100 ? 'right' : 'center' } : {}),
        offsetX: normalizeImageOffsetY(layout === 'wrap'
          ? (left - bounds.left - Math.max(0, freeWidth) * position / 100) / scale
          : Number(node.attrs.offsetX) + (left - start.left) / scale),
        offsetY: normalizeImageOffsetY(Number(node.attrs.offsetY) + (top - start.top) / scale),
      };
      if (layout === 'inline') {
        // Measure the resulting line ascent once on release. React node views
        // update asynchronously, so measuring after dispatch would see old bounds.
        // Other inline images on the same line share its baseline, as in Google
        // Docs: a resized image keeps sitting on it, never above or across the
        // text, and one that moves onto another line sits on that one's baseline.
        const others = paragraph ? lineImages(paragraph, anchor) : [];
        const sharedBefore = sameLine(others, start.bottom - normalizeImageOffsetY(node.attrs.offsetY) * scale, scale);
        const anchorStyle = anchor.style.cssText;
        const imageStyle = image.style.cssText;
        let sharedAfter: Set<HTMLElement>;
        try {
          anchor.style.width = `${width}%`;
          anchor.style.marginLeft = `${attrs.offsetX}px`;
          anchor.style.top = `${attrs.offsetY}px`;
          image.style.aspectRatio = String(attrs.aspectRatio);
          const resized = image.getBoundingClientRect();
          sharedAfter = sameLine(others, resized.bottom - attrs.offsetY * scale, scale);
          attrs.offsetY = normalizeImageOffsetY(attrs.offsetY + (top - resized.top) / scale);
        } finally {
          anchor.style.cssText = anchorStyle;
          image.style.cssText = imageStyle;
        }
        if (sharedBefore.size || sharedAfter.size) {
          const stayed = sharedBefore.size === sharedAfter.size && [...sharedAfter].every(other => sharedBefore.has(other));
          attrs.offsetY = stayed ? normalizeImageOffsetY(node.attrs.offsetY) : 0;
        }
      }
      const tr = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, attrs);
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      view.dispatch(tr);
    }
    refresh();
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', escape, true);
  window.addEventListener('blur', cancel);
  return cancel;
}
