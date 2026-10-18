import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { pointSize } from './documentFormatting';

const INDENT_PT = 36;

// Shift the direct indent of every paragraph or heading touched by the
// selection, using the same margin model as list lifting and Backspace.
function shiftIndent(state: EditorState, delta: number): Transaction | null {
  const { from, to } = state.selection;
  const tr = closeHistory(state.tr);
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!['paragraph', 'heading'].includes(node.type.name)) return;
    const style = node.attrs.documentStyle ?? {};
    const current = pointSize(style['margin-left'] ?? '', 0);
    const next = Math.max(0, current + delta);
    if (next === current) return false;
    const nextStyle = { ...style, 'margin-left': `${next}pt` };
    if (!next) delete nextStyle['margin-left'];
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, documentStyle: Object.keys(nextStyle).length ? nextStyle : null });
    changed = true;
    return false;
  });
  return changed ? tr : null;
}

/**
 * Docs keeps Tab inside the document outside lists too: a caret inserts a
 * literal tab, while a selection indents its paragraphs. Lists and tables
 * register their own Tab handling at the default priority, which runs first.
 */
export const EditorParagraphTab = Extension.create({
  name: 'paragraphTab',
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { state } = this.editor;
        const { selection } = state;
        // Objects such as images and formulas keep their own selection.
        if (!(selection instanceof TextSelection) || !selection.$from.parent.isTextblock) return false;
        if (selection.empty) {
          return this.editor.commands.command(({ tr, dispatch }) => {
            if (dispatch) closeHistory(tr).insertText('\t').scrollIntoView();
            return true;
          });
        }
        const tr = shiftIndent(state, INDENT_PT);
        if (tr) {
          this.editor.view.dispatch(tr.scrollIntoView());
          this.editor.view.dispatch(closeHistory(this.editor.state.tr));
        }
        return true;
      },
      'Shift-Tab': () => {
        const { state } = this.editor;
        if (!(state.selection instanceof TextSelection)) return false;
        const tr = shiftIndent(state, -INDENT_PT);
        // Without an indent to remove, focus may leave the editor backwards.
        if (!tr) return false;
        this.editor.view.dispatch(tr.scrollIntoView());
        this.editor.view.dispatch(closeHistory(this.editor.state.tr));
        return true;
      },
    };
  },
});
