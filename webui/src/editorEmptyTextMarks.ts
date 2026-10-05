import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { attribute, emptyTextMarksTypography, parseMarks, readMarks } from './emptyTextMarks';

/** Empty paragraphs need a saved typing style: storedMarks alone is transient. */
export const EditorEmptyTextMarks = Extension.create({
  name: 'emptyTextMarks',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        emptyTextMarks: {
          default: null,
          parseHTML: parseMarks,
          renderHTML: attributes => {
            const marks = readMarks(attributes.emptyTextMarks);
            return marks ? { [attribute]: JSON.stringify(marks) } : {};
          },
        },
      },
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (!node.isTextblock || node.content.size || !node.attrs.emptyTextMarks) return;
            const style = emptyTextMarksTypography(node.attrs.emptyTextMarks);
            // The live line must have the saved font metrics before typing.
            // Decorations never become direct block styles in saved HTML.
            if (style) decorations.push(Decoration.node(pos, pos + node.nodeSize, { style }));
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
      appendTransaction(transactions, _oldState, state) {
        const { selection } = state;
        const tr = state.tr;
        // Inline marks own the style as soon as text exists. Keeping the empty
        // style on a populated paragraph would reapply it on a later reload.
        if (transactions.some(transaction => transaction.docChanged)) state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.content.size && node.attrs.emptyTextMarks) tr.setNodeAttribute(pos, 'emptyTextMarks', null);
        });
        const paragraph = selection.$from.parent;
        if (selection.empty && selection.$from.depth && !paragraph.content.size && 'emptyTextMarks' in paragraph.attrs) {
          const explicit = transactions.some(transaction => transaction.storedMarksSet) && state.storedMarks !== null;
          if (explicit) {
            const marks = readMarks(state.storedMarks!.map(mark => mark.toJSON()));
            if (JSON.stringify(marks) !== JSON.stringify(paragraph.attrs.emptyTextMarks)) tr.setNodeAttribute(selection.$from.before(), 'emptyTextMarks', marks);
          } else if (paragraph.attrs.emptyTextMarks) {
            const marks = readMarks(paragraph.attrs.emptyTextMarks) ?? [];
            const restored = marks.filter(mark => state.schema.marks[mark.type]).map(mark => state.schema.marks[mark.type].create(mark.attrs));
            if (JSON.stringify(restored.map(mark => mark.toJSON())) !== JSON.stringify((state.storedMarks ?? selection.$from.marks()).map(mark => mark.toJSON()))) tr.setStoredMarks(restored);
          }
        }
        if (!tr.docChanged && !tr.storedMarksSet) return null;
        if (!tr.storedMarksSet && state.storedMarks) tr.setStoredMarks(state.storedMarks);
        return tr;
      },
    })];
  },
});
