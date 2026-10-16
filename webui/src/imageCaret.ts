import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

const placeNativeCaret = (view: EditorView) => {
  if (view.isDestroyed || !view.hasFocus() || view.composing) return;
  const anchor = view.dom.querySelector('.editor-image-caret-anchor');
  if (!anchor?.firstChild) return;
  const selection = view.dom.ownerDocument.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode || !view.dom.contains(selection.anchorNode)) return;
  if (selection.anchorNode === anchor.firstChild && selection.anchorOffset === 0) return;
  // Do not pull a mouse selection back to an old position while focus changes.
  if (view.posAtDOM(selection.anchorNode, selection.anchorOffset) !== view.state.selection.from) return;
  selection.collapse(anchor.firstChild, 0);
};

const restoreDocumentSelection = (view: EditorView) => {
  const selection = view.dom.ownerDocument.getSelection();
  const anchor = view.dom.querySelector('.editor-image-caret-anchor');
  if (selection?.isCollapsed && anchor?.contains(selection.anchorNode)) {
    const { node, offset } = view.domAtPos(view.state.selection.from);
    selection.collapse(node, offset);
  }
  return false;
};

// Chromium paints an element-boundary caret using the tall atomic image box.
// An empty text anchor provides a font-metric position for the browser's own
// caret. Keep it in a view-only widget; all actual input goes to the document.
export const createImageCaretPlugin = () => {
  let composing = false;
  const refresh = (view: EditorView) => { if (!composing) placeNativeCaret(view); };
  return new Plugin({
    props: {
      decorations(state) {
        const { selection } = state;
        if (!(selection instanceof TextSelection) || !selection.empty) return null;
        const adjacent = [selection.$from.nodeBefore, selection.$from.nodeAfter];
        if (!adjacent.some(node => node?.type.name === 'floatingImage' && node.attrs.layout !== 'wrap')) return null;
        const marks = state.storedMarks ?? selection.$from.marks();
        if ([...marks, ...adjacent.flatMap(node => node?.marks ?? [])].some(mark => ['subscript', 'superscript'].includes(mark.type.name))) return null;
        return DecorationSet.create(state.doc, [Decoration.widget(selection.from, () => {
          const anchor = document.createElement('span');
          anchor.className = 'editor-image-caret-anchor';
          anchor.setAttribute('aria-hidden', 'true');
          anchor.contentEditable = 'true';
          anchor.appendChild(document.createTextNode(''));
          return anchor;
        }, { marks, side: -1, relaxedSide: true, ignoreSelection: true, key: `image-caret:${selection.from}:${JSON.stringify(marks.map(mark => mark.toJSON()))}` })]);
      },
      handleDOMEvents: {
        focus(view) { queueMicrotask(() => refresh(view)); return false; },
        keydown: restoreDocumentSelection,
        beforeinput: restoreDocumentSelection,
        compositionstart(view) { composing = true; return restoreDocumentSelection(view); },
        compositionend(view) { composing = false; queueMicrotask(() => refresh(view)); return false; },
      },
    },
    view(view) {
      const selectionChanged = () => refresh(view);
      view.dom.ownerDocument.addEventListener('selectionchange', selectionChanged);
      refresh(view);
      return {
        update: refresh,
        destroy() { view.dom.ownerDocument.removeEventListener('selectionchange', selectionChanged); },
      };
    },
  });
};
