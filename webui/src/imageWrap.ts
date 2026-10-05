import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { normalizeImageOffsetY, normalizeImagePosition } from './imageLayout';
import { IMAGE_WRAP_PREVIEW_EVENT } from './imageDrag';

type Gap = { pos: number; width: number; height: number };
const key = new PluginKey<DecorationSet>('imageWrap');
const GAP = 16;
const textNodes = (root: HTMLElement): Text[] => {
  const result: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.parentElement?.closest('[data-editor-image], [contenteditable="false"], .image-wrap-gap')) result.push(node as Text);
  }
  return result;
};

function positionImages(root: HTMLElement) {
  for (const anchor of root.querySelectorAll<HTMLElement>('.editor-image-node[data-layout="wrap"]')) {
    const surface = anchor.querySelector<HTMLElement>('.editor-image-surface');
    const paragraph = anchor.closest<HTMLElement>('p, h1, h2, h3, h4, h5, h6');
    if (!surface || !paragraph) continue;
    const width = paragraph.clientWidth;
    const imageWidth = width * Number(anchor.dataset.width ?? 56) / 100;
    surface.style.width = `${imageWidth}px`;
    surface.style.left = `${(width - imageWidth) * normalizeImagePosition(anchor.dataset.position, 'center') / 100}px`;
    surface.style.top = `${normalizeImageOffsetY(anchor.dataset.offsetY)}px`;
  }
}

// Reserve space in each affected line with view decorations. Document text and
// marks remain ProseMirror content; copying/saving never includes these gaps.
function measure(view: EditorView): Gap[] {
  const root = view.dom;
  const images = Array.from(root.querySelectorAll<HTMLElement>('.editor-image-node[data-layout="wrap"]'));
  if (!images.length || !root.offsetWidth) return [];
  positionImages(root);

  // Lay out a hidden copy synchronously. It lets us solve all line gaps before
  // publishing a single decoration transaction, without moving the live caret.
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.image-wrap-gap, .editor-image-toolbar, .editor-image-resize-handles').forEach(el => el.remove());
  clone.removeAttribute('id');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.cssText += `;position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;width:${root.offsetWidth}px;max-width:none;`;
  const originals = textNodes(root);
  const copies = textNodes(clone);
  const positions = new WeakMap<Text, number>();
  copies.forEach((node, i) => {
    if (originals[i]) positions.set(node, view.posAtDOM(originals[i], 0));
  });
  // Preserve intrinsic image geometry while the cloned assets are loading.
  const originalAssets = root.querySelectorAll<HTMLImageElement>('img');
  clone.querySelectorAll<HTMLImageElement>('img').forEach((img, i) => {
    if (originalAssets[i]?.clientHeight) img.style.height = `${originalAssets[i].clientHeight}px`;
  });
  root.parentElement?.appendChild(clone);
  try {
    const cloneRect = clone.getBoundingClientRect();
    const cloneScale = cloneRect.width / clone.offsetWidth || 1;
    const obstacles = () => {
      positionImages(clone);
      return Array.from(clone.querySelectorAll<HTMLElement>('.editor-image-node[data-layout="wrap"] .editor-image-surface')).map(el => {
        const rect = el.getBoundingClientRect();
        return { element: el, paragraph: el.closest('p, h1, h2, h3, h4, h5, h6')!, left: rect.left - GAP * cloneScale, right: rect.right + GAP * cloneScale, top: rect.top - 4 * cloneScale, bottom: rect.bottom + GAP * cloneScale };
      });
    };
    // Moving content before an image's paragraph also moves its anchor, so a
    // negative offset can never be cleared by pushing that earlier content.
    const canClear = (element: Element, obstacle: ReturnType<typeof obstacles>[number]) =>
      !(obstacle.paragraph.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING);
    const gaps: Gap[] = [];
    const atomSelector = '.math-node-wrapper, .math-block-wrapper, table, pre, .editor-video-node';
    const atoms = Array.from(clone.querySelectorAll<HTMLElement>(atomSelector));
    const liveAtoms = root.querySelectorAll<HTMLElement>(atomSelector);
    const documentAtoms: Array<{ dom: globalThis.Node; pos: number }> = [];
    view.state.doc.descendants((node, pos) => {
      if (node.isAtom || node.type.name === 'table' || node.type.name === 'codeBlock') {
        const dom = view.nodeDOM(pos);
        if (dom) documentAtoms.push({ dom, pos });
      }
    });
    const atomPositions = new Map(atoms.map((atom, i) => [atom, documentAtoms.find(n => n.dom.contains(liveAtoms[i]))?.pos]));
    for (let attempt = 0; attempt < 1000; attempt++) {
      let cleared = false;
      for (const atom of atoms) {
        if (atomPositions.get(atom) === undefined) continue;
        const rect = atom.getBoundingClientRect();
        const obstacle = obstacles().find(o => !atom.contains(o.element) && canClear(atom, o) && rect.bottom > o.top && rect.top < o.bottom && rect.right > o.left && rect.left < o.right);
        if (!obstacle) continue;
        const gap = { pos: atomPositions.get(atom)!, width: 0, height: Math.max(1, (obstacle.bottom - rect.top) / cloneScale) };
        // Complex blocks keep their own geometry below the figure. Inline math
        // participates in the same line flow as words when a side is wide enough.
        if (atom.matches('.math-node-wrapper')) {
          const block = atom.closest('p, h1, h2, h3, h4, h5, h6');
          const br = block?.getBoundingClientRect();
          if (br && rect.width <= Math.max(obstacle.left - br.left, br.right - obstacle.right)) {
            gap.height = 0;
            gap.width = Math.max(1, (Math.min(obstacle.right, br.right) - rect.left) / cloneScale);
          }
        }
        atom.before(gapElement(gap));
        gaps.push(gap);
        cleared = true;
        break;
      }
      if (cleared) continue;
      let collision: { text: Text; offset: number; rect: DOMRect; obstacle: ReturnType<typeof obstacles>[number] } | undefined;
      for (const text of textNodes(clone)) {
        const block = text.parentElement?.closest('p, h1, h2, h3, h4, h5, h6');
        if (!block || !positions.has(text)) continue;
        const blockRect = block.getBoundingClientRect();
        if (blockRect && !obstacles().some(o => canClear(block, o) && blockRect.bottom > o.top && blockRect.top < o.bottom)) continue;
        for (const word of (text.textContent ?? '').matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(text, word.index);
          range.setEnd(text, word.index + word[0].length);
          for (const rect of range.getClientRects()) {
            const obstacle = obstacles().find(o => canClear(block, o) && rect.bottom > o.top && rect.top < o.bottom && rect.right > o.left + 0.5 && rect.left < o.right - 0.5);
            if (obstacle) { collision = { text, offset: word.index, rect, obstacle }; break; }
          }
          if (collision) break;
        }
        if (collision) break;
      }
      if (!collision) break;
      const { text, offset, rect, obstacle } = collision;
      const pos = (positions.get(text) ?? 0) + offset;
      const blockRect = text.parentElement!.closest('p, h1, h2, h3, h4, h5, h6')!.getBoundingClientRect();
      const leftSpace = Math.max(0, obstacle.left - blockRect.left);
      const rightSpace = Math.max(0, blockRect.right - obstacle.right);
      const tooWide = rect.width > Math.max(leftSpace, rightSpace);
      const gap = {
        pos,
        width: tooWide ? 0 : Math.max(1, (Math.min(obstacle.right, blockRect.right) - rect.left) / cloneScale),
        height: tooWide ? Math.max(1, (obstacle.bottom - rect.top) / cloneScale) : 0,
      };
      const spacer = gapElement(gap);
      const tail = text.splitText(offset);
      positions.set(tail, pos);
      tail.parentNode!.insertBefore(spacer, tail);
      gaps.push(gap);
    }
    const bottom = Math.max(...obstacles().map(o => o.bottom));
    const remaining = (bottom - clone.getBoundingClientRect().bottom) / cloneScale;
    if (remaining > 0) gaps.push({ pos: view.state.doc.content.size, width: 0, height: remaining });
    return gaps;
  } finally { clone.remove(); }
}

function gapElement(gap: Gap): HTMLElement {
  const element = document.createElement('span');
  element.className = 'image-wrap-gap';
  element.contentEditable = 'false';
  element.setAttribute('aria-hidden', 'true');
  element.style.cssText = gap.height
    ? `display:block;height:${gap.height}px;pointer-events:none;user-select:none;`
    : `display:inline-block;width:${gap.width}px;height:1px;vertical-align:baseline;pointer-events:none;user-select:none;`;
  return element;
}

export function createImageWrapPlugin(): Plugin<DecorationSet> {
  return new Plugin({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, previous) => tr.getMeta(key) ?? (tr.docChanged ? DecorationSet.empty : previous),
    },
    props: { decorations: state => key.getState(state) },
    view(view) {
      let frame = 0;
      let signature = '';
      let destroyed = false;
      const schedule = () => {
        if (frame || destroyed) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (view.isDestroyed || destroyed || view.dom.querySelector('[data-image-dragging], [data-image-resizing]')) return;
          const gaps = measure(view);
          const next = JSON.stringify(gaps);
          if (next === signature && (gaps.length === 0 || key.getState(view.state)?.find().length)) return;
          signature = next;
          const decorations = gaps.map((gap, i) => Decoration.widget(gap.pos, () => gapElement(gap), { side: -1, key: `${i}:${gap.pos}:${gap.width}:${gap.height}` }));
          view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decorations)).setMeta('addToHistory', false));
          positionImages(view.dom);
        });
      };
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
      resize?.observe(view.dom);
      view.dom.addEventListener('load', schedule, true);
      view.dom.addEventListener(IMAGE_WRAP_PREVIEW_EVENT, schedule);
      document.fonts?.addEventListener('loadingdone', schedule);
      schedule();
      return {
        update: (updated, previous) => { if (updated.state.doc !== previous.doc) schedule(); },
        destroy: () => {
          destroyed = true;
          cancelAnimationFrame(frame);
          resize?.disconnect();
          view.dom.removeEventListener('load', schedule, true);
          view.dom.removeEventListener(IMAGE_WRAP_PREVIEW_EVENT, schedule);
          document.fonts?.removeEventListener('loadingdone', schedule);
        },
      };
    },
  });
}
