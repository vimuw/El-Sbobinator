import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { normalizeImageOffsetY, normalizeImagePosition } from './imageLayout';
import { IMAGE_WRAP_PREVIEW_EVENT } from './imageDrag';

type Gap = { pos: number; width: number; height: number };
type WrapState = { decorations: DecorationSet; affectedEnd: number | null; revision: number };
const key = new PluginKey<WrapState>('imageWrap');
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

function positionImages(root: HTMLElement, tops?: number[]) {
  const rootRect = tops ? root.getBoundingClientRect() : null;
  const scale = rootRect ? rootRect.width / root.offsetWidth || 1 : 1;
  const placements = Array.from(root.querySelectorAll<HTMLElement>('.editor-image-node[data-layout="wrap"]')).map((anchor, index) => {
    const surface = anchor.querySelector<HTMLElement>('.editor-image-surface');
    const paragraph = anchor.closest<HTMLElement>('p, h1, h2, h3, h4, h5, h6');
    if (!surface || !paragraph) return null;
    const width = paragraph.clientWidth;
    const imageWidth = width * Number(anchor.dataset.width ?? 56) / 100;
    return {
      surface, width: imageWidth,
      left: (width - imageWidth) * normalizeImagePosition(anchor.dataset.position, 'center') / 100 + normalizeImageOffsetY(anchor.dataset.offsetX),
      top: tops?.[index] !== undefined && rootRect ? tops[index] - (paragraph.getBoundingClientRect().top - rootRect.top) / scale : normalizeImageOffsetY(anchor.dataset.offsetY),
    };
  });
  for (const placement of placements) {
    if (!placement) continue;
    placement.surface.style.width = `${placement.width}px`;
    placement.surface.style.left = `${placement.left}px`;
    placement.surface.style.top = `${placement.top}px`;
  }
}

// Reserve space in each affected line with view decorations. Document text and
// marks remain ProseMirror content; copying/saving never includes these gaps.
function measure(view: EditorView): { gaps: Gap[]; affectedEnd: number | null; tops: number[] } {
  const root = view.dom;
  const images = Array.from(root.querySelectorAll<HTMLElement>('.editor-image-node[data-layout="wrap"]'));
  if (!images.length) return { gaps: [], affectedEnd: 0, tops: [] };
  if (!root.offsetWidth) return { gaps: [], affectedEnd: null, tops: [] };
  positionImages(root);

  // Content beyond the last figure cannot change its exclusion geometry. Keep
  // one following block as a buffer and preserve complete lists/tables.
  const imageRects = images.map(image => image.querySelector('.editor-image-surface')?.getBoundingClientRect()).filter((rect): rect is DOMRect => !!rect);
  const rootRect = root.getBoundingClientRect();
  const bottom = Math.max(...imageRects.map(rect => rect.bottom));
  const top = Math.min(...imageRects.map(rect => rect.top));
  const scale = rootRect.width / root.offsetWidth || 1;
  const children = Array.from(root.children);
  let last = 0;
  let first = -1;
  children.forEach((child, index) => {
    const rect = child.getBoundingClientRect();
    const hasImage = !!child.querySelector('.editor-image-node[data-layout="wrap"]');
    if (hasImage || rect.top <= bottom + GAP * scale) last = index;
    if (first === -1 && (hasImage || rect.bottom >= top - 4 * scale)) first = index;
  });
  const start = Math.max(0, first - 1);
  const count = Math.min(children.length, last + 2);

  // Lay out a hidden copy synchronously. It lets us solve all line gaps before
  // publishing a single decoration transaction, without moving the live caret.
  const clone = root.cloneNode(false) as HTMLElement;
  const measuredChildren = children.slice(start, count);
  // Earlier content only contributes a vertical origin. Preserve that origin
  // with one empty block instead of copying every paragraph and inline asset
  // before a figure near the end of a long transcript.
  if (start > 0) {
    const prefix = document.createElement('div');
    const paddingTop = Number.parseFloat(getComputedStyle(root).paddingTop) || 0;
    const marginTop = Number.parseFloat(getComputedStyle(children[start]).marginTop) || 0;
    const height = Math.max(0, (children[start].getBoundingClientRect().top - rootRect.top) / scale - paddingTop - marginTop);
    prefix.style.cssText = `height:${height}px;margin:0;padding:0;border:0;`;
    clone.appendChild(prefix);
  }
  const blocks = measuredChildren.map((child, index) => ({
    dom: child.cloneNode(true) as HTMLElement,
    from: view.posAtDOM(root, start + index),
    end: view.posAtDOM(root, start + index + 1),
  }));
  blocks.forEach(block => clone.appendChild(block.dom));
  clone.querySelectorAll('.image-wrap-gap, .editor-image-toolbar, .editor-image-resize-handles').forEach(el => el.remove());
  clone.removeAttribute('id');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.cssText += `;position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;width:${root.offsetWidth}px;max-width:none;`;
  const originals = measuredChildren.flatMap(child => textNodes(child as HTMLElement));
  const copies = textNodes(clone);
  const positions = new WeakMap<Text, number>();
  copies.forEach((node, i) => {
    if (originals[i]) positions.set(node, view.posAtDOM(originals[i], 0));
  });
  // Preserve intrinsic image geometry while the cloned assets are loading.
  const originalAssets = measuredChildren.flatMap(child => Array.from(child.querySelectorAll<HTMLImageElement>('img')));
  clone.querySelectorAll<HTMLImageElement>('img').forEach((img, i) => {
    if (originalAssets[i]?.clientHeight) img.style.height = `${originalAssets[i].clientHeight}px`;
  });
  root.parentElement?.appendChild(clone);
  try {
    const cloneRect = clone.getBoundingClientRect();
    const cloneScale = cloneRect.width / clone.offsetWidth || 1;
    positionImages(clone);
    const surfaces = Array.from(clone.querySelectorAll<HTMLElement>('.editor-image-node[data-layout="wrap"] .editor-image-surface'));
    const tops = surfaces.map(el => (el.getBoundingClientRect().top - cloneRect.top) / cloneScale);
    // Exclusion gaps move text paragraphs, including other images' anchors.
    // Freeze figure geometry before inserting gaps so the solver cannot chase
    // an obstacle down the document. Apply the same anchor compensation live.
    const obstacles = surfaces.filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.right > cloneRect.left && rect.left < cloneRect.right;
    }).map(el => {
      const rect = el.getBoundingClientRect();
      return { element: el, left: rect.left - GAP * cloneScale, right: rect.right + GAP * cloneScale, top: rect.top - 4 * cloneScale, bottom: rect.bottom + GAP * cloneScale };
    });
    const gaps: Gap[] = [];
    const atomSelector = '.math-node-wrapper, .math-block-wrapper, table, pre, .editor-video-node';
    const atoms = Array.from(clone.querySelectorAll<HTMLElement>(atomSelector));
    const liveAtoms = measuredChildren.flatMap(child => [
      ...(child.matches(atomSelector) ? [child as HTMLElement] : []),
      ...Array.from(child.querySelectorAll<HTMLElement>(atomSelector)),
    ]);
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
        const obstacle = obstacles.find(o => !atom.contains(o.element) && rect.bottom > o.top && rect.top < o.bottom && rect.right > o.left && rect.left < o.right);
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
      let collision: { text: Text; offset: number; rect: DOMRect; obstacle: typeof obstacles[number] } | undefined;
      for (const text of copies) {
        const block = text.parentElement?.closest('p, h1, h2, h3, h4, h5, h6');
        if (!block || !positions.has(text)) continue;
        const blockRect = block.getBoundingClientRect();
        if (!obstacles.some(o => blockRect.bottom > o.top && blockRect.top < o.bottom)) continue;
        // A block may span several figures and many already-cleared lines.
        // Skip text runs whose actual line boxes miss every figure before
        // measuring individual words again after each spacer insertion.
        const range = document.createRange();
        range.selectNodeContents(text);
        if (!Array.from(range.getClientRects()).some(rect => obstacles.some(o => rect.bottom > o.top && rect.top < o.bottom && rect.right > o.left + 0.5 && rect.left < o.right - 0.5))) continue;
        for (const word of (text.textContent ?? '').matchAll(/\S+/g)) {
          range.setStart(text, word.index);
          range.setEnd(text, word.index + word[0].length);
          for (const rect of range.getClientRects()) {
            const obstacle = obstacles.find(o => rect.bottom > o.top && rect.top < o.bottom && rect.right > o.left + 0.5 && rect.left < o.right - 0.5);
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
      // Nearby figures form one exclusion when the word cannot fit between
      // them. Separate spacers at the same position can wrap independently
      // and put the live word back underneath the first image.
      const exclusion = { left: obstacle.left, right: obstacle.right, bottom: obstacle.bottom };
      let expanded: boolean;
      do {
        expanded = false;
        for (const other of obstacles) {
          if (rect.bottom <= other.top || rect.top >= other.bottom || other.right <= exclusion.left - rect.width + 0.5 || other.left >= exclusion.right + rect.width - 0.5) continue;
          const left = Math.min(exclusion.left, other.left);
          const right = Math.max(exclusion.right, other.right);
          if (left !== exclusion.left || right !== exclusion.right) expanded = true;
          exclusion.left = left;
          exclusion.right = right;
          exclusion.bottom = Math.min(exclusion.bottom, other.bottom);
        }
      } while (expanded);
      const leftSpace = Math.max(0, exclusion.left - blockRect.left);
      const rightSpace = Math.max(0, blockRect.right - exclusion.right);
      const tooWide = rect.width > Math.max(leftSpace, rightSpace);
      // Leave a CSS pixel at the line edge: rounding must not make the spacer
      // itself wrap onto the next line in the live ProseMirror DOM.
      const gap = {
        pos,
        width: tooWide ? 0 : Math.max(1, (Math.min(exclusion.right, blockRect.right) - rect.left - (exclusion.right >= blockRect.right ? cloneScale : 0)) / cloneScale),
        height: tooWide ? Math.max(1, (exclusion.bottom - rect.top) / cloneScale) : 0,
      };
      const spacer = gapElement(gap);
      const tail = text.splitText(offset);
      copies.splice(copies.indexOf(text) + 1, 0, tail);
      positions.set(tail, pos);
      tail.parentNode!.insertBefore(spacer, tail);
      gaps.push(gap);
    }
    const bottom = Math.max(...obstacles.map(o => o.bottom));
    const remaining = (bottom - clone.getBoundingClientRect().bottom) / cloneScale;
    if (remaining > 0 && count === children.length) gaps.push({ pos: view.state.doc.content.size, width: 0, height: remaining });
    // The measurement buffer is not an affected region. Editing a paragraph
    // already below every figure must preserve the solved gaps, even when the
    // buffer contains that paragraph or the next heading.
    const affectedEnd = Math.max(0, ...blocks.filter(block =>
      block.dom.querySelector('.editor-image-node[data-layout="wrap"]') ||
      block.dom.getBoundingClientRect().top < bottom ||
      gaps.some(gap => gap.pos >= block.from && gap.pos <= block.end),
    ).map(block => block.end));
    return { gaps, affectedEnd, tops };
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

export function createImageWrapPlugin(): Plugin<WrapState> {
  return new Plugin({
    key,
    state: {
      init: () => ({ decorations: DecorationSet.empty, affectedEnd: null, revision: 0 }),
      apply: (tr, previous) => {
        const measured = tr.getMeta(key) as WrapState | undefined;
        if (measured) return measured;
        if (!tr.docChanged) return previous;
        let affectedEnd = previous.affectedEnd;
        let invalidated = affectedEnd === null;
        tr.steps.forEach((step, index) => {
          const map = step.getMap();
          let hasRange = false;
          map.forEach((from, _to, newFrom, newTo) => {
            hasRange = true;
            if (affectedEnd === null || from <= affectedEnd) invalidated = true;
            // A new Wrap after the cached region extends that region.
            const doc = tr.docs[index + 1] ?? tr.doc;
            if (newTo > newFrom) doc.nodesBetween(newFrom, newTo, node => {
              if (node.type.name === 'floatingImage' && node.attrs.layout === 'wrap') invalidated = true;
            });
          });
          // Attribute/mark steps can change geometry despite an empty StepMap.
          if (!hasRange) invalidated = true;
          if (affectedEnd !== null) affectedEnd = map.map(affectedEnd, -1);
        });
        return invalidated
          ? { decorations: DecorationSet.empty, affectedEnd: null, revision: previous.revision + 1 }
          : { ...previous, affectedEnd, decorations: previous.decorations.map(tr.mapping, tr.doc) };
      },
    },
    props: { decorations: state => key.getState(state)?.decorations },
    view(view) {
      let frame = 0;
      let signature = '';
      let destroyed = false;
      const schedule = () => {
        if (frame || destroyed) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (view.isDestroyed || destroyed || view.dom.querySelector('[data-image-dragging], [data-image-resizing]')) return;
          const { gaps, affectedEnd, tops } = measure(view);
          const next = JSON.stringify(gaps);
          const previous = key.getState(view.state)!;
          if (next === signature && previous.affectedEnd === affectedEnd && (gaps.length === 0 || previous.decorations.find().length)) { positionImages(view.dom, tops); return; }
          signature = next;
          const decorations = gaps.map((gap, i) => Decoration.widget(gap.pos, () => gapElement(gap), { side: -1, key: `${i}:${gap.pos}:${gap.width}:${gap.height}` }));
          view.dispatch(view.state.tr.setMeta(key, { decorations: DecorationSet.create(view.state.doc, decorations), affectedEnd, revision: previous.revision }).setMeta('addToHistory', false));
          positionImages(view.dom, tops);
        });
      };
      let width = view.dom.offsetWidth;
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
        const nextWidth = view.dom.offsetWidth;
        if (nextWidth !== width) { width = nextWidth; schedule(); }
      });
      resize?.observe(view.dom);
      view.dom.addEventListener('load', schedule, true);
      view.dom.addEventListener(IMAGE_WRAP_PREVIEW_EVENT, schedule);
      document.fonts?.addEventListener('loadingdone', schedule);
      schedule();
      return {
        update: (updated, previous) => { if (key.getState(updated.state)?.revision !== key.getState(previous)?.revision) schedule(); },
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
