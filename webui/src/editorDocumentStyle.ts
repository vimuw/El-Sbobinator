import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { DOCUMENT_FORMATTING, pointSize } from './documentFormatting';
import { EditorEmptyTextMarks } from './editorEmptyTextMarks';
import { clipboardCssLineHeight } from './editorLineSpacing';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    documentStyle: { clearDocumentFormatting: () => ReturnType };
  }
}

const properties = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'line-height', 'margin-top', 'margin-bottom', 'margin-left'] as const;
const paragraphProperties = ['line-height', 'margin-top', 'margin-bottom', 'margin-left'];

/** Keep direct block formatting distinct from the document's default profile. */
export const EditorDocumentStyle = Extension.create({
  name: 'documentStyle',
  addExtensions() { return [EditorEmptyTextMarks]; },
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        documentStyle: {
          default: null,
          parseHTML: element => {
            const style = (element as HTMLElement).style;
            const generated = Number(element.getAttribute('data-generated-space-before'));
            const values = Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)]).filter(([property, value]) => value && !(property === 'margin-top' && generated > 0 && pointSize(value, -1) === generated)));
            if (/^H[1-6]$/.test(element.tagName) && element.closest('[data-document-format="1"]')
              && element.getAttribute('data-editor-default-heading-color') === style.color) delete values.color;
            const clipboardLeading = clipboardCssLineHeight(element as HTMLElement);
            if (clipboardLeading) values['line-height'] = clipboardLeading;
            return Object.keys(values).length ? values : null;
          },
          renderHTML: attributes => {
            const style = Object.entries(attributes.documentStyle ?? {}).filter(([property]) => properties.includes(property as typeof properties[number])).map(([property, value]) => `${property}:${value}`).join(';');
            return style ? { style } : {};
          },
        },
        nativeLineSpacing: {
          default: null,
          parseHTML: element => {
            const value = Number(element.getAttribute('data-document-line-spacing'));
            return value > 0 && value <= 10 ? value : null;
          },
          renderHTML: attributes => attributes.nativeLineSpacing ? { 'data-document-line-spacing': attributes.nativeLineSpacing } : {},
        },
        generatedSpaceBefore: {
          default: null,
          keepOnSplit: false,
          parseHTML: element => {
            const value = Number(element.getAttribute('data-generated-space-before'));
            return Number.isFinite(value) && value > 0 && value <= 1000 ? value : null;
          },
          renderHTML: attributes => attributes.generatedSpaceBefore ? {
            'data-generated-space-before': attributes.generatedSpaceBefore,
            style: `margin-top:${attributes.documentStyle?.['margin-top'] ?? `${attributes.generatedSpaceBefore}pt`}`,
          } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      clearDocumentFormatting: () => ({ tr, state, dispatch }) => {
        if (!dispatch) return true;
        closeHistory(tr);
        const { from, to, empty } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!['paragraph', 'heading'].includes(node.type.name)) return;
          const direct = node.attrs.documentStyle;
          if (!direct) return;
          const size = pointSize(direct['font-size'] ?? '', DOCUMENT_FORMATTING.fontSizePt);
          // Resetting a block's direct typography must not restyle text outside
          // a partial selection. Move its inherited typography onto that text.
          node.forEach((child, offset) => {
            if (!child.isText) return;
            const start = pos + 1 + offset;
            const end = start + child.nodeSize;
            for (const [left, right] of [[start, Math.min(end, from)], [Math.max(start, to), end]]) {
              if (left >= right) continue;
              const textStyle = state.schema.marks.textStyle;
              if (textStyle) {
                const inherited = { fontFamily: direct['font-family'], fontSize: direct['font-size'] ? `${size}pt` : undefined, color: direct.color };
                const explicit = child.marks.find(mark => mark.type === textStyle)?.attrs ?? {};
                const values = { ...Object.fromEntries(Object.entries(inherited).filter(([, value]) => value)), ...Object.fromEntries(Object.entries(explicit).filter(([, value]) => value)) };
                if (explicit.fontSize) values.fontSize = `${pointSize(explicit.fontSize, size, size)}pt`;
                if (Object.keys(values).length) tr.addMark(left, right, textStyle.create(values));
              }
              if ((direct['font-weight'] === 'bold' || Number(direct['font-weight']) >= 600) && state.schema.marks.bold) tr.addMark(left, right, state.schema.marks.bold.create());
              if (direct['font-style'] === 'italic' && state.schema.marks.italic) tr.addMark(left, right, state.schema.marks.italic.create());
            }
          });
        });
        // Docs preserves links and structural nodes while resetting direct styles.
        if (!empty) Object.values(state.schema.marks).filter(mark => mark.name !== 'link').forEach(mark => tr.removeMark(from, to, mark));
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            // Docs resets paragraph layout only when its entire text is selected.
            // Partial selections and an empty caret clear character formatting.
            const wholeBlock = !empty && from <= pos + 1 && to >= pos + node.nodeSize - 1;
            const layout = Object.fromEntries(Object.entries(node.attrs.documentStyle ?? {}).filter(([property]) => paragraphProperties.includes(property)));
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              textAlign: wholeBlock ? null : node.attrs.textAlign,
              documentStyle: wholeBlock || !Object.keys(layout).length ? null : layout,
              nativeLineSpacing: wholeBlock ? null : node.attrs.nativeLineSpacing,
              generatedSpaceBefore: wholeBlock ? null : node.attrs.generatedSpaceBefore,
            });
          }
        });
        // Document transactions clear stored marks. Set them after changing the
        // blocks so subsequent typing cannot inherit the styles just moved out.
        if (empty) tr.setStoredMarks((state.storedMarks ?? state.selection.$from.marks()).filter(mark => mark.type.name === 'link'));
        return true;
      },
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-\\': () => this.editor.commands.clearDocumentFormatting() };
  },
});
