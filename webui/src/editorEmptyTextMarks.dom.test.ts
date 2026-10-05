import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorDocumentStyle } from './editorDocumentStyle';
import { EditorListItem, EditorOrderedList } from './editorLists';
import { FontSize } from './editorExtensions';
import { prepareSelectionClipboard } from './editorSelectionClipboard';
import { NATIVE_SLICE_MIME } from './editorClipboard';

const editors: Editor[] = [];
function open(content: string) {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: [StarterKit.configure({ orderedList: false, listItem: false }), TextStyle, Color, FontFamily, FontSize, Highlight.configure({ multicolor: true }), EditorOrderedList, EditorListItem, EditorDocumentStyle], content });
  editors.push(editor);
  return editor;
}
function caret(editor: Editor, text: string, offset = 0) {
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) editor.commands.setTextSelection(pos + offset); });
}
const expectedStyle = { ts_bd: true, ts_it: true, ts_un: true, ts_st: true, ts_ff: 'Georgia', ts_fs: 18, ts_fgc2: { hclr_color: '#123abc' }, ts_bgc2: { hclr_color: '#ffee00' } };
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.innerHTML = ''; });

describe('Saved typography of empty list paragraphs', () => {
  it.each(['ol', 'ul'].flatMap(tag => [false, true].flatMap(nested => [0, 5].map(offset => ({ tag, nested, offset })))))('preserves combined styles after two Enter gestures and HTML reopen ($tag, nested=$nested, offset=$offset)', ({ tag, nested, offset }) => {
    const styled = '<span style="font-family:Georgia;font-size:18pt;color:#123abc"><mark data-color="#ffee00" style="background-color:#ffee00"><strong><em><u><s>Prima</s></u></em></strong></mark></span>';
    const branch = `<${tag}><li><p>${styled}</p><${tag}><li><p>Figlia</p></li><li><p>Sorella</p></li></${tag}></li><li><p>Seconda</p></li></${tag}>`;
    const editor = open((nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>');
    caret(editor, 'Prima', offset);
    const originalMarks = editor.state.selection.$from.marks().map(mark => mark.toJSON());
    const enter = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter();
    if (!offset) {
      let blank = 0;
      editor.state.doc.descendants((node, pos) => { if (!blank && node.type.name === 'paragraph' && !node.content.size) blank = pos + 1; });
      editor.commands.setTextSelection(blank);
    }
    enter();
    const blankPosition = editor.state.selection.from;
    editor.commands.selectAll();
    const native = JSON.parse(JSON.parse(prepareSelectionClipboard(editor.view)!.formats[NATIVE_SLICE_MIME]).data).resolved;
    const textStyles = native.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles;
    const newlines = [...native.dsl_spacers].flatMap((char, i) => char === '\n' ? [i] : []);
    expect(textStyles[newlines[(nested ? 1 : 0) + (offset ? 1 : 0)]]).toMatchObject(expectedStyle);
    expect(textStyles[native.dsl_spacers.indexOf('Prima')]).toMatchObject(expectedStyle);
    const reopened = open(editor.getHTML());
    const reopenedBlank = reopened.getJSON();
    const blankElement = reopened.view.nodeDOM(blankPosition - 1) as HTMLElement;
    expect(blankElement.style.fontFamily).toBe('Georgia');
    expect(blankElement.style.fontSize).toBe('18pt');
    expect(blankElement.style.backgroundColor).toBe('');
    expect(reopened.state.doc.nodeAt(blankPosition - 1)?.attrs.documentStyle).toEqual(editor.state.doc.nodeAt(blankPosition - 1)?.attrs.documentStyle);
    const serialized = new DOMParser().parseFromString(reopened.getHTML(), 'text/html');
    const serializedBlank = [...serialized.querySelectorAll('p')].find(p => !p.textContent && p.hasAttribute('data-editor-empty-marks'))!;
    expect(serializedBlank.style.fontSize).toBe('');
    caret(reopened, 'Seconda'); reopened.commands.setTextSelection(blankPosition);
    expect(reopened.state.storedMarks?.map(mark => mark.toJSON())).toEqual(originalMarks);
    reopened.commands.insertContent('X');
    expect(reopened.state.doc.nodeAt(blankPosition)?.marks.map(mark => mark.toJSON())).toEqual(originalMarks);
    expect(reopened.state.selection.$from.parent.attrs.emptyTextMarks).toBeNull();
    expect((reopened.view.nodeDOM(blankPosition - 1) as HTMLElement).style.fontSize).toBe('');
    expect(reopened.commands.undo()).toBe(true); expect(reopened.getJSON()).toEqual(reopenedBlank);
    expect(reopened.commands.redo()).toBe(true); expect(reopened.state.doc.nodeAt(blankPosition)?.text).toBe('X');
    const typed = open(reopened.getHTML());
    expect(typed.getHTML()).toEqual(reopened.getHTML());
  });

  it('removes one restored mark while retaining other styles and adjacent text', () => {
    const metadata = JSON.stringify([{ type: 'bold' }, { type: 'italic' }, { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '18pt', color: '#123abc' } }]).replaceAll('"', '&quot;');
    const editor = open(`<p data-editor-empty-marks="${metadata}"></p><p><strong>Vicino</strong></p>`);
    editor.commands.setTextSelection(1); editor.commands.toggleItalic();
    caret(editor, 'Vicino'); editor.commands.setTextSelection(1);
    expect(editor.isActive('italic')).toBe(false); expect(editor.isActive('bold')).toBe(true);
    const reopened = open(editor.getHTML()); reopened.commands.setTextSelection(1);
    expect(reopened.isActive('italic')).toBe(false); expect(reopened.isActive('bold')).toBe(true);
    reopened.commands.insertContent('X');
    expect(reopened.state.doc.nodeAt(1)?.marks.map(mark => mark.type.name)).toEqual(['textStyle', 'bold']);
    expect(reopened.getHTML()).toContain('<strong>Vicino</strong>');
  });
});
