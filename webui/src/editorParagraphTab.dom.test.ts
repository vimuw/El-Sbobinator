import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection } from '@tiptap/pm/state';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorDocumentStyle } from './editorDocumentStyle';
import { CustomHeading, CustomParagraph } from './editorExtensions';
import { EditorListItem, EditorOrderedList } from './editorLists';
import { EditorParagraphTab } from './editorParagraphTab';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });

const open = (content: string) => {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [
      StarterKit.configure({ orderedList: false, listItem: false, paragraph: false, heading: false }),
      CustomParagraph, CustomHeading,
      EditorOrderedList, EditorListItem, EditorDocumentStyle, EditorParagraphTab,
      Table, TableRow, TableHeader, TableCell,
    ],
    content,
  });
  editors.push(editor);
  return editor;
};

const press = (editor: Editor, shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', shiftKey, bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
};

const positionAfter = (editor: Editor, text: string) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text) + text.length;
  });
  return found;
};

describe('Tab outside lists', () => {
  it('keeps the caret in the document and inserts a tab, with one undo and HTML persistence', () => {
    const editor = open('<p>Alfa beta</p>');
    editor.commands.setTextSelection(positionAfter(editor, 'Alfa'));
    const original = editor.getJSON();
    expect(press(editor)).toBe(true);
    expect(editor.getText()).toBe('Alfa\t beta');
    const withTab = editor.getHTML();
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.setContent(withTab);
    expect(editor.getText()).toBe('Alfa\t beta');
  });

  it('inserts a tab at the start of a paragraph and inside headings', () => {
    const editor = open('<h2>Titolo</h2><p>Testo</p>');
    editor.commands.setTextSelection(positionAfter(editor, 'Titolo') - 'Titolo'.length);
    expect(press(editor)).toBe(true);
    expect(editor.state.doc.child(0).textContent).toBe('\tTitolo');
  });

  it('indents and outdents every selected paragraph without changing their text', () => {
    const editor = open('<p>Prima</p><p>Seconda</p><p>Terza</p>');
    editor.commands.setTextSelection({ from: 2, to: positionAfter(editor, 'Sec') });
    const original = editor.getJSON();
    expect(press(editor)).toBe(true);
    expect(editor.getText()).toBe('Prima\n\nSeconda\n\nTerza');
    expect(editor.state.doc.child(0).attrs.documentStyle).toEqual({ 'margin-left': '36pt' });
    expect(editor.state.doc.child(1).attrs.documentStyle).toEqual({ 'margin-left': '36pt' });
    expect(editor.state.doc.child(2).attrs.documentStyle).toBeNull();
    expect(editor.getHTML()).toMatch(/margin-left: ?36pt/);
    expect(press(editor, true)).toBe(true);
    expect(editor.getJSON()).toEqual(original);
    // Without an indent left, Shift+Tab remains available to leave the editor.
    expect(press(editor, true)).toBe(false);
    expect(editor.getJSON()).toEqual(original);
  });

  it('leaves table cell navigation and list indentation to their own handlers', () => {
    const editor = open('<table><tbody><tr><td><p>Uno</p></td><td><p>Due</p></td></tr></tbody></table><ul><li><p>Prima</p></li><li><p>Seconda</p></li></ul>');
    editor.commands.setTextSelection(positionAfter(editor, 'Uno'));
    expect(press(editor)).toBe(true);
    expect(editor.getText()).not.toContain('\t');
    expect(editor.state.selection.$from.parent.textContent).toBe('Due');
    editor.commands.setTextSelection(positionAfter(editor, 'Seconda') - 'Seconda'.length);
    expect(press(editor)).toBe(true);
    expect(editor.getText()).not.toContain('\t');
    expect(editor.getHTML()).toContain('<li><p>Prima</p><ul><li><p>Seconda</p></li></ul></li>');
  });

  it('does not replace a selected object', () => {
    const editor = open('<p>Prima</p><hr><p>Dopo</p>');
    const hr = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hr)));
    const original = editor.getJSON();
    expect(press(editor)).toBe(false);
    expect(editor.getJSON()).toEqual(original);
  });
});
