import { Mark, type Editor as TiptapEditor } from '@tiptap/core';
import BoldExtension from '@tiptap/extension-bold';
import { TextStyle } from '@tiptap/extension-text-style';
import type { Mark as ProseMirrorMark, Node as ProseMirrorNode, ParseRule, TagParseRule } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { DOCUMENT_FORMATTING } from './documentFormatting';

const isBoldWeight = (value: string) => value === 'bold' || value === 'bolder' || Number(value) >= 600;

/** The weight a block gives its text before any bold or unbold mark. */
export const blockIsBold = (block: ProseMirrorNode): boolean => {
  const direct = block.attrs.documentStyle?.['font-weight'];
  if (direct) return isBoldWeight(String(direct));
  return block.type.name === 'heading' && (DOCUMENT_FORMATTING.headings[Number(block.attrs.level) - 1]?.fontWeight ?? 400) >= 600;
};

const textIsBold = (marks: readonly ProseMirrorMark[], block: ProseMirrorNode) => {
  if (marks.some(mark => mark.type.name === 'bold')) return true;
  if (marks.some(mark => mark.type.name === 'unbold')) return false;
  return blockIsBold(block);
};

/**
 * Docs reports the weight the reader sees: heading text is bold through its
 * style, not through a bold mark. A range is bold only if all its text is.
 */
export const isDocumentBold = (state: EditorState): boolean => {
  const { selection } = state;
  if (selection.empty) return textIsBold(state.storedMarks ?? selection.$from.marks(), selection.$from.parent);
  let text = false;
  let bold = true;
  for (const range of selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, _pos, parent) => {
      if (!bold) return false;
      if (!node.isText || !parent) return true;
      text = true;
      bold = textIsBold(node.marks, parent);
      return false;
    });
  }
  return text ? bold : textIsBold(selection.$from.marks(), selection.$from.parent);
};

/** Without the unbold mark, a bold mark is the only weight an editor knows. */
export const editorIsBold = (editor: TiptapEditor): boolean => (editor.schema?.marks.unbold ? isDocumentBold(editor.state) : editor.isActive('bold'));

/**
 * A bold mark where the block is not bold, an unbold mark where it is. Each
 * text run carries at most the one mark that differs from its block.
 */
function applyDocumentBold(state: EditorState, tr: Transaction, bold: boolean): void {
  const { bold: boldType, unbold: unboldType } = state.schema.marks;
  const { selection } = state;
  if (selection.empty) {
    const block = selection.$from.parent;
    const marks = (state.storedMarks ?? selection.$from.marks()).filter(mark => mark.type !== boldType && mark.type !== unboldType);
    const override = bold === blockIsBold(block) ? null : (bold ? boldType : unboldType);
    tr.setStoredMarks(override ? override.create().addToSet(marks) : marks);
    return;
  }
  for (const range of selection.ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    tr.removeMark(from, to, boldType);
    tr.removeMark(from, to, unboldType);
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (bold !== blockIsBold(node)) tr.addMark(Math.max(from, pos + 1), Math.min(to, pos + node.nodeSize - 1), bold ? boldType.create() : unboldType.create());
      return false;
    });
  }
}

const toggleDocumentBold = () => ({ state, tr, dispatch }: { state: EditorState; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
  if (!state.schema.marks.unbold) return false;
  if (dispatch) applyDocumentBold(state, tr, !isDocumentBold(state));
  return true;
};

/** Bold whose toggle follows the visible weight, including heading styles. */
export const EditorBold = BoldExtension.extend({
  excludes: 'bold unbold',
  addExtensions() { return [Unbold]; },
  addCommands() {
    return { ...this.parent?.(), toggleBold: toggleDocumentBold };
  },
});

/** Whether the element's ancestors, up to its block, paint its text bold. */
const inheritsBold = (element: HTMLElement): boolean => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.style.fontWeight) return isBoldWeight(node.style.fontWeight);
    if (node.tagName === 'STRONG' || node.tagName === 'B') return true;
    const heading = /^H([1-6])$/.exec(node.tagName);
    if (heading) return (DOCUMENT_FORMATTING.headings[Number(heading[1]) - 1]?.fontWeight ?? 400) >= 600;
    if (/^(P|LI|TD|TH|DIV|BLOCKQUOTE|BODY)$/.test(node.tagName)) return false;
  }
  return false;
};

/**
 * A span styled only by its weight holds no text-style attribute. As an empty
 * text style it would join every unbold run on each reopen.
 */
export const EditorTextStyle = TextStyle.extend({
  parseHTML() {
    return (this.parent?.() ?? []).map((rule): ParseRule => {
      if (!('tag' in rule)) return rule;
      const tagRule = rule as TagParseRule;
      const { getAttrs } = tagRule;
      return {
        ...tagRule,
        getAttrs: (element: HTMLElement) => (element.style.length === 1 && element.style.fontWeight ? false : getAttrs ? getAttrs(element) : {}),
      };
    });
  },
});

const normalOverBold = (element: HTMLElement) => {
  const weight = element.style.fontWeight;
  return weight && !isBoldWeight(weight) && inheritsBold(element) ? {} : false;
};

/**
 * Normal weight written over bold heading text, as Docs does. Saved HTML
 * keeps neither data attributes nor `b` tags, so a span's context decides.
 */
export const Unbold = Mark.create({
  name: 'unbold',
  excludes: 'bold unbold',
  parseHTML() {
    return ['b', 'span'].map(tag => ({ tag, consuming: false, getAttrs: (element: HTMLElement) => normalOverBold(element) }));
  },
  renderHTML() {
    return ['span', { style: 'font-weight: 400' }, 0];
  },
});
