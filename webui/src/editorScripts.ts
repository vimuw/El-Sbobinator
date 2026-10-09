import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// A character has one baseline shift. Keep Tiptap's native commands, HTML
// parsing and Docs shortcuts, while replacing the opposite mark atomically.
export const EditorSubscript = Subscript.extend({ excludes: 'subscript superscript' });
export const EditorSuperscript = Superscript.extend({ excludes: 'subscript superscript' });

const isScript = (name: string) => name === 'superscript' || name === 'subscript';
const caretMarks = (state: EditorState) => {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const marks = state.storedMarks ?? selection.$from.marks();
  // Also render the normal caret at a script boundary when typing marks were
  // cleared: Chromium otherwise leaves its caret inside the preceding sup/sub.
  const adjacent = [selection.$from.nodeBefore, selection.$from.nodeAfter];
  return marks.some(mark => isScript(mark.type.name)) || adjacent.some(node => node?.marks.some(mark => isScript(mark.type.name))) ? marks : null;
};

/** Reflect stored typing marks before the browser has a character to render. */
export const EditorScriptCaret = Extension.create({
  name: 'scriptCaret',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        attributes: state => caretMarks(state) ? { 'data-editor-script-caret': 'true' } : {},
        decorations(state) {
          const marks = caretMarks(state);
          if (!marks) return null;
          return DecorationSet.create(state.doc, [Decoration.widget(state.selection.from, () => {
            const caret = document.createElement('span');
            caret.className = 'editor-script-caret';
            caret.setAttribute('aria-hidden', 'true');
            // CSS supplies a zero-width glyph with the actual font's metrics.
            // No characters enter even the live DOM, model or clipboard.
            return caret;
          }, { marks, side: -1, relaxedSide: true, ignoreSelection: true, key: `script-caret:${state.selection.from}:${JSON.stringify(marks.map(mark => mark.toJSON()))}` })]);
        },
      },
      view(view) {
        const start = () => view.dom.setAttribute('data-editor-script-composing', 'true');
        const end = () => view.dom.removeAttribute('data-editor-script-composing');
        view.dom.addEventListener('compositionstart', start);
        view.dom.addEventListener('compositionend', end);
        return { destroy() {
          view.dom.removeEventListener('compositionstart', start);
          view.dom.removeEventListener('compositionend', end);
        } };
      },
    })];
  },
});
