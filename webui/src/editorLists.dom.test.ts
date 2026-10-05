import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorListItem, EditorOrderedList } from './editorLists';
import { prepareSelectionClipboard } from './editorSelectionClipboard';
import { NATIVE_SLICE_MIME } from './editorClipboard';
import { EditorDocumentStyle } from './editorDocumentStyle';

const editors: Editor[] = [];
function open(content: string) {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: [StarterKit.configure({ orderedList: false, listItem: false }), EditorOrderedList, EditorListItem, EditorDocumentStyle], content });
  editors.push(editor);
  return editor;
}
function select(editor: Editor, label: string, end?: string) {
  let from = 0, to = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(label)) from = pos + node.text.indexOf(label);
    if (node.isText && node.text?.includes(end ?? label)) to = pos + node.text.indexOf(end ?? label) + (end ?? label).length;
  });
  editor.commands.setTextSelection({ from, to });
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.innerHTML = ''; });

describe('Ordered list gestures and selected clipboard', () => {
  it.each(['ol', 'ul'].flatMap(tag => [false, true].flatMap(nested => [0, 5].map(offset => ({ tag, nested, offset })))))('exits an empty $tag parent after Enter at $offset without moving descendants (nested=$nested)', ({ tag, nested, offset }) => {
    const branch = `<${tag}${tag === 'ol' && nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><${tag}${tag === 'ol' ? ` type="${nested ? 'i' : 'a'}"` : ''}><li><p>Figlia</p></li><li><p>Sorella</p></li></${tag}></li><li><p>Seconda</p></li></${tag}>`;
    const editor = open((nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>');
    select(editor, 'Prima'); editor.commands.setTextSelection(editor.state.selection.from + offset);
    const enter = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter();
    if (!offset) {
      let empty = 0;
      editor.state.doc.descendants((node, pos) => { if (!empty && node.type.name === 'paragraph' && !node.content.size) empty = pos + 1; });
      editor.commands.setTextSelection(empty);
    }
    const split = editor.getJSON();
    enter();
    const exited = editor.getJSON();
    const caret = editor.state.selection.$from;
    expect(caret.parent.textContent).toBe('');
    expect(caret.depth).toBe(nested ? 3 : offset ? 3 : 1);
    const caretPosition = caret.pos;
    // Empty paragraphs have no text node on which inline marks can survive.
    // Returning after a saved-HTML reload must still restore their typing style.
    const reopened = open(editor.getHTML());
    reopened.commands.setTextSelection(caretPosition);
    expect(reopened.isActive('bold')).toBe(true);
    reopened.commands.insertContent('X');
    expect(reopened.state.doc.nodeAt(caretPosition)?.marks.map(mark => mark.type.name)).toContain('bold');
    editor.commands.selectAll();
    const formats = prepareSelectionClipboard(editor.view)!.formats;
    const resolved = JSON.parse(JSON.parse(formats[NATIVE_SLICE_MIME]).data).resolved;
    const lists = resolved.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'list').stsl_styles;
    const textStyles = resolved.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles;
    const blankIndex = (nested ? 1 : 0) + (offset ? 1 : 0);
    const newlines = Array.from(resolved.dsl_spacers as string).flatMap((char, i) => char === '\n' ? [i] : []);
    expect(textStyles[newlines[blankIndex]]?.ts_bd).toBe(true);
    const levels = Array.from(resolved.dsl_spacers as string).flatMap((char, i) => char === '\n' ? [lists[i]?.ls_id ? lists[i].ls_nest : null] : []);
    expect(levels.slice(0, nested ? 7 : 5)).toEqual(nested
      ? (offset ? [0, 1, 0, 2, 2, 1, 0] : [0, 0, 1, 2, 2, 1, 0])
      : (offset ? [0, null, 1, 1, 0] : [null, 0, 1, 1, 0]));
    editor.commands.setTextSelection(caretPosition);
    editor.state.doc.check();
    editor.commands.insertContent('X');
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(exited);
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(split);
    expect(editor.commands.redo()).toBe(true); expect(editor.getJSON()).toEqual(exited);
    expect(open(editor.getHTML()).getJSON()).toEqual(exited);
  });

  it('can disable and clear restored empty-paragraph marks without changing adjacent text', () => {
    const editor = open('<ol><li><p><strong>Prima</strong></p><ol><li><p>Figlia</p></li></ol></li><li><p>Seconda</p></li></ol>');
    select(editor, 'Prima'); editor.commands.setTextSelection(editor.state.selection.from);
    const enter = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter(); editor.commands.setTextSelection(3); enter();
    const reopened = open(editor.getHTML());
    reopened.commands.setTextSelection(1);
    expect(reopened.isActive('bold')).toBe(true);
    reopened.commands.toggleBold();
    reopened.commands.setTextSelection(4); reopened.commands.setTextSelection(1);
    expect(reopened.isActive('bold')).toBe(false);
    reopened.commands.insertContent('X');
    expect(reopened.state.doc.firstChild!.firstChild!.marks).toEqual([]);
    expect(reopened.getHTML()).toContain('<strong>Prima</strong>');
    reopened.commands.undo(); reopened.commands.setTextSelection(1);
    reopened.commands.toggleBold(); reopened.commands.clearDocumentFormatting();
    const cleared = open(reopened.getHTML()); cleared.commands.setTextSelection(1);
    expect(cleared.isActive('bold')).toBe(false);
  });

  it.each(['ol', 'ul'].flatMap(tag => [false, true].flatMap(nested => [0, 2, 5].map(offset => ({ tag, nested, offset })))))('splits a $tag parent at $offset keeping its children and separate undo (nested=$nested)', ({ tag, nested, offset }) => {
    const branch = `<${tag}${tag === 'ol' && nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><${tag}${tag === 'ol' ? ` type="${nested ? 'i' : 'a'}"` : ''}><li><p>Figlia</p></li><li><p>Sorella</p></li></${tag}></li><li><p>Seconda</p></li></${tag}>`;
    const editor = open((nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>');
    select(editor, 'Prima'); editor.commands.setTextSelection(editor.state.selection.from + offset);
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const split = editor.getJSON();
    const list = nested ? editor.state.doc.firstChild!.firstChild!.child(1) : editor.state.doc.firstChild!;
    expect(list.childCount).toBe(3);
    expect(list.child(0).textContent).toBe('Prima'.slice(0, offset));
    expect(list.child(0).childCount).toBe(1);
    expect(list.child(1).firstChild!.textContent).toBe('Prima'.slice(offset));
    expect(list.child(1).child(1).textContent).toBe('FigliaSorella');
    expect(list.child(2).textContent).toBe('Seconda');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    expect(editor.state.selection.$from.node(-1)).toBe(list.child(1));
    editor.state.doc.check();
    editor.commands.insertContent('X');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(split);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(original);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(split);
    const reopened = open(editor.getHTML());
    expect(reopened.getJSON()).toEqual(split);
  });

  it.each(['ol', 'ul'].flatMap(tag => [false, true].map(nested => ({ tag, nested }))))('removes and joins both children after the first $tag branch merge with separate undo (nested=$nested)', ({ tag, nested }) => {
    const branch = `<${tag}${tag === 'ol' && nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><${tag}${tag === 'ol' ? ` type="${nested ? 'i' : 'a'}"` : ''}><li><p>Figlia</p></li><li><p>Sorella</p></li></${tag}></li><li><p>Seconda</p></li></${tag}>`;
    const editor = open((nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>');
    const backspace = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    select(editor, 'Prima'); editor.commands.setTextSelection(editor.state.selection.from);
    backspace(); backspace(); backspace();
    for (let step = 1; step <= 6; step++) {
      const label = step <= 3 ? 'Figlia' : 'Sorella';
      select(editor, label); editor.commands.setTextSelection(editor.state.selection.from);
      const before = editor.getJSON();
      backspace();
      const changed = editor.getJSON();
      editor.state.doc.check();
      expect(editor.state.selection.$from.parentOffset).toBe(step % 3 ? 0 : (nested ? 5 : 0) + (step === 3 ? 5 : 11));
      editor.commands.insertContent('X'); editor.commands.undo(); expect(editor.getJSON()).toEqual(changed);
      editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
      editor.commands.redo(); expect(editor.getJSON()).toEqual(changed);
      editor.commands.selectAll();
      const native = JSON.parse(JSON.parse(prepareSelectionClipboard(editor.view)!.formats[NATIVE_SLICE_MIME]).data).resolved;
      const styles = Object.fromEntries(native.dsl_styleslices.map((slice: { stsl_type: string; stsl_styles: unknown[] }) => [slice.stsl_type, slice.stsl_styles]));
      const at = (text: string) => native.dsl_spacers.indexOf(text) + text.length;
      const first = `${nested ? 'Madre' : ''}Prima${step >= 3 ? 'Figlia' : ''}${step === 6 ? 'Sorella' : ''}`;
      const lines = [first, ...(step < 3 ? ['Figlia'] : []), ...(step < 6 ? ['Sorella'] : []), 'Seconda', ...(nested ? ['Ultima'] : []), ''];
      expect(native.dsl_spacers).toBe(lines.join('\n') + '\n');
      expect(styles.list[at('Seconda')].ls_nest).toBe(nested ? 1 : 0);
      if (tag === 'ol') expect(native.dsl_entitymap[styles.list[at('Seconda')].ls_id].le_nb[`nl_${nested ? 1 : 0}`].b_sn).toBe(step < 4 ? 2 : 1);
      if (step % 3) {
        expect(styles.list[at(label)]?.ls_id ?? null).toBeNull();
        expect(styles.paragraph[at(label)]).toMatchObject({ ps_il: step % 3 === 1 ? (nested ? 108 : 72) : 0, ps_ifl: step % 3 === 1 ? (nested ? 108 : 72) : 0 });
      }
      if (step < 4) expect(styles.list[at('Sorella')].ls_nest).toBe(nested ? 2 : 1);
      const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getJSON()).toEqual(changed);
    }
  });

  it.each(['ol', 'ul'].flatMap(tag => [false, true].map(nested => ({ tag, nested }))))('joins a first unmarked $tag branch on the third Backspace without lifting its children (nested=$nested)', ({ tag, nested }) => {
    const branch = `<${tag}${tag === 'ol' && nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><${tag}${tag === 'ol' ? ` type="${nested ? 'i' : 'a'}"` : ''}><li><p>Figlia</p></li><li><p>Sorella</p></li></${tag}></li><li><p>Seconda</p></li></${tag}>`;
    const editor = open((nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>');
    select(editor, 'Prima'); editor.commands.setTextSelection(editor.state.selection.from);
    const backspace = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    backspace(); backspace(); const reset = editor.getJSON();
    backspace(); const joined = editor.getJSON();
    if (nested) {
      const parent = editor.state.doc.firstChild!.firstChild!;
      expect(parent.firstChild!.textContent).toBe('MadrePrima');
      expect(parent.firstChild!.lastChild!.marks[0].type.name).toBe('bold');
      const list = parent.child(1);
      expect(list.firstChild!.attrs.markerHidden).toBe(true);
      expect(list.firstChild!.childCount).toBe(1);
      expect(list.firstChild!.firstChild!.type.name).toBe(tag === 'ol' ? 'orderedList' : 'bulletList');
      expect(list.firstChild!.firstChild!.textContent).toBe('FigliaSorella');
      expect(list.child(1).textContent).toBe('Seconda');
      expect(editor.state.selection.$from.parentOffset).toBe(5);
    } else {
      expect(joined).toEqual(reset);
      expect(editor.state.selection.$from.parentOffset).toBe(0);
    }
    editor.commands.insertContent('X'); editor.commands.undo(); expect(editor.getJSON()).toEqual(joined);
    if (nested) {
      editor.commands.undo(); expect(editor.getJSON()).toEqual(reset);
      editor.commands.redo(); expect(editor.getJSON()).toEqual(joined);
    }
    const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getJSON()).toEqual(joined);
    editor.state.doc.check();
    editor.commands.selectAll();
    const native = JSON.parse(JSON.parse(prepareSelectionClipboard(editor.view)!.formats[NATIVE_SLICE_MIME]).data).resolved;
    expect(native.dsl_spacers).toBe(nested ? 'MadrePrima\nFiglia\nSorella\nSeconda\nUltima\n\n' : 'Prima\nFiglia\nSorella\nSeconda\n\n');
    const styles = Object.fromEntries(native.dsl_styleslices.map((slice: { stsl_type: string; stsl_styles: unknown[] }) => [slice.stsl_type, slice.stsl_styles]));
    const at = (text: string) => native.dsl_spacers.indexOf(text) + text.length;
    expect(styles.list[at('Figlia')].ls_nest).toBe(nested ? 2 : 1);
    expect(styles.list[at('Seconda')].ls_nest).toBe(nested ? 1 : 0);
    if (tag === 'ol') expect(native.dsl_entitymap[styles.list[at('Seconda')].ls_id].le_nb[`nl_${nested ? 1 : 0}`].b_sn).toBe(2);
  });

  it.each(['ol', 'ul'].flatMap(tag => [false, true].map(nested => ({ tag, nested }))))('resets the first unmarked $tag parent indent with independent typing undo (nested=$nested)', ({ tag, nested }) => {
    const branch = `<${tag}${tag === 'ol' && nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><${tag}${tag === 'ol' ? ` type="${nested ? 'i' : 'a'}"` : ''}><li><p>Figlia</p></li><li><p>Sorella</p></li></${tag}></li><li><p>Seconda</p></li></${tag}>`;
    const editor = open((nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>');
    select(editor, 'Prima'); editor.commands.setTextSelection(editor.state.selection.from);
    const original = editor.getJSON();
    const backspace = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    backspace(); const unmarked = editor.getJSON();
    backspace(); const reset = editor.getJSON();
    const list = nested ? editor.state.doc.firstChild!.firstChild!.child(1) : editor.state.doc.firstChild!;
    expect(list.firstChild!.attrs.markerHidden).toBe(true);
    expect(list.firstChild!.firstChild!.attrs.documentStyle).toEqual({ 'margin-left': nested ? '-72pt' : '-36pt' });
    expect(list.firstChild!.child(1).textContent).toBe('FigliaSorella');
    expect(editor.state.selection.$from.parent.textContent).toBe('Prima');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    editor.commands.insertContent('X'); editor.commands.undo(); expect(editor.getJSON()).toEqual(reset);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(unmarked);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo(); editor.commands.redo(); expect(editor.getJSON()).toEqual(reset);
    const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getJSON()).toEqual(reset);
    editor.commands.selectAll();
    const native = JSON.parse(JSON.parse(prepareSelectionClipboard(editor.view)!.formats[NATIVE_SLICE_MIME]).data).resolved;
    const styles = Object.fromEntries(native.dsl_styleslices.map((slice: { stsl_type: string; stsl_styles: unknown[] }) => [slice.stsl_type, slice.stsl_styles]));
    const at = (text: string) => native.dsl_spacers.indexOf(text) + text.length;
    expect(styles.list[at('Prima')].ls_id).toBeNull();
    expect(styles.paragraph[at('Prima')]).toMatchObject({ ps_il: 0, ps_ifl: 0 });
    expect(styles.list[at('Figlia')].ls_nest).toBe(nested ? 2 : 1);
    expect(styles.list[at('Seconda')].ls_nest).toBe(nested ? 1 : 0);
    if (tag === 'ol') expect(native.dsl_entitymap[styles.list[at('Seconda')].ls_id].le_nb[`nl_${nested ? 1 : 0}`].b_sn).toBe(2);
  });

  it.each(['ol', 'ul'].flatMap(tag => [false, true].map(nested => ({ tag, nested }))))('removes the first $tag marker while preserving its child branch (nested=$nested)', ({ tag, nested }) => {
    const branch = `<${tag}${tag === 'ol' && nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><${tag}${tag === 'ol' ? ` type="${nested ? 'i' : 'a'}"` : ''}><li><p>Figlia</p></li><li><p>Sorella</p></li></${tag}></li><li><p>Seconda</p></li></${tag}>`;
    const editor = open((nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>');
    select(editor, 'Prima'); editor.commands.setTextSelection(editor.state.selection.from);
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(editor.state.selection.$from.parent.textContent).toBe('Prima');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    const list = nested ? editor.state.doc.firstChild!.firstChild!.child(1) : editor.state.doc.firstChild!;
    expect(list.childCount).toBe(2);
    expect(list.firstChild!.attrs.markerHidden).toBe(true);
    expect(list.child(1).attrs.markerHidden).toBe(false);
    expect(list.firstChild!.child(1).textContent).toBe('FigliaSorella');
    const removed = editor.getJSON();
    editor.commands.insertContent('X'); editor.commands.undo(); expect(editor.getJSON()).toEqual(removed);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo(); expect(editor.getJSON()).toEqual(removed);
    const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getJSON()).toEqual(removed);
    editor.commands.selectAll();
    const native = JSON.parse(JSON.parse(prepareSelectionClipboard(editor.view)!.formats[NATIVE_SLICE_MIME]).data).resolved;
    const styles = Object.fromEntries(native.dsl_styleslices.map((slice: { stsl_type: string; stsl_styles: unknown[] }) => [slice.stsl_type, slice.stsl_styles]));
    const at = (text: string) => native.dsl_spacers.indexOf(text) + text.length;
    expect(styles.list[at('Prima')].ls_id).toBeNull();
    expect(styles.paragraph[at('Prima')]).toMatchObject({ ps_il: nested ? 72 : 36, ps_ifl: nested ? 72 : 36 });
    expect(styles.list[at('Figlia')].ls_nest).toBe(nested ? 2 : 1);
    expect(styles.list[at('Seconda')].ls_nest).toBe(nested ? 1 : 0);
    if (tag === 'ol') expect(native.dsl_entitymap[styles.list[at('Seconda')].ls_id].le_nb[`nl_${nested ? 1 : 0}`].b_sn).toBe(2);
  });

  it.each(['ol', 'ul'].flatMap(tag => [false, true].map(nested => ({ tag, nested }))))('removes a $tag marker between child branches and continues numbering (nested=$nested)', ({ tag, nested }) => {
    const child = (body: string, start = 1) => `<${tag}${tag === 'ol' ? ` type="${nested ? 'i' : 'a'}" start="${start}"` : ''}>${body}</${tag}>`;
    const oldChildren = '<li><p>Vecchia</p></li><li><p>Precedente</p></li>';
    const newChildren = '<li><p>Figlia</p></li><li><p>Sorella</p></li>';
    const wrap = (body: string) => (nested ? `<ol><li><p>Madre</p>${body}</li><li><p>Ultima</p></li></ol>` : body) + '<p></p>';
    const source = `<${tag}><li><p>Prima</p>${child(oldChildren)}</li><li><p><strong>Seconda</strong></p>${child(newChildren)}</li><li><p>Terza</p></li></${tag}>`;
    const editor = open(wrap(source));
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from);
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    const expected = `<${tag}><li><p>Prima</p>${child(oldChildren)}<p><strong>Seconda</strong></p>${child(newChildren, 3)}</li><li><p>Terza</p></li></${tag}>`;
    expect(editor.getJSON()).toEqual(open(wrap(expected)).getJSON());
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    expect(editor.state.selection.$from.parent.textContent).toBe('Seconda');
    const removed = editor.getJSON();
    editor.commands.insertContent('X'); editor.commands.undo(); expect(editor.getJSON()).toEqual(removed);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo(); expect(editor.getJSON()).toEqual(removed);
    const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getJSON()).toEqual(removed);
    editor.commands.selectAll();
    const native = JSON.parse(JSON.parse(prepareSelectionClipboard(editor.view)!.formats[NATIVE_SLICE_MIME]).data).resolved;
    const styles = Object.fromEntries(native.dsl_styleslices.map((slice: { stsl_type: string; stsl_styles: unknown[] }) => [slice.stsl_type, slice.stsl_styles]));
    const at = (text: string) => native.dsl_spacers.indexOf(text) + text.length;
    expect(styles.list[at('Seconda')].ls_id).toBeNull();
    expect(styles.paragraph[at('Seconda')]).toMatchObject({ ps_il: nested ? 72 : 36, ps_ifl: nested ? 72 : 36 });
    expect(styles.list[at('Figlia')].ls_nest).toBe(nested ? 2 : 1);
    if (tag === 'ol') expect(native.dsl_entitymap[styles.list[at('Figlia')].ls_id].le_nb[`nl_${nested ? 2 : 1}`].b_sn).toBe(3);
  });

  it.each(['ol', 'ul'].flatMap(tag => [false, true].map(nested => ({ tag, nested }))))('removes a $tag marker before its child list without moving the branch (nested=$nested)', ({ tag, nested }) => {
    const branch = `<${tag}><li><p>Prima</p></li><li><p><strong>Seconda</strong></p><${tag}${tag === 'ol' ? ' type="i" start="4"' : ''}><li><p>Figlia</p></li><li><p>Sorella</p></li></${tag}></li><li><p>Terza</p></li></${tag}>`;
    const editor = open(nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch);
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from);
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(editor.state.selection.$from.parent.textContent).toBe('Seconda');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    const list = nested ? editor.state.doc.firstChild!.firstChild!.child(1) : editor.state.doc.firstChild!;
    expect(list.childCount).toBe(2);
    expect(list.firstChild!.childCount).toBe(3);
    expect(list.firstChild!.child(1).textContent).toBe('Seconda');
    expect(list.firstChild!.child(1).firstChild!.marks[0].type.name).toBe('bold');
    expect(list.firstChild!.child(2).textContent).toBe('FigliaSorella');
    if (tag === 'ol') expect(list.firstChild!.child(2).attrs).toMatchObject({ type: 'i', start: 4 });
    const removed = editor.getJSON();
    editor.commands.insertContent('X'); editor.commands.undo(); expect(editor.getJSON()).toEqual(removed);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo(); expect(editor.getJSON()).toEqual(removed);
    const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getHTML()).toBe(html);
    editor.commands.selectAll();
    const native = JSON.parse(JSON.parse(prepareSelectionClipboard(editor.view)!.formats[NATIVE_SLICE_MIME]).data).resolved;
    const styles = Object.fromEntries(native.dsl_styleslices.map((slice: { stsl_type: string; stsl_styles: unknown[] }) => [slice.stsl_type, slice.stsl_styles]));
    const at = (label: string) => native.dsl_spacers.indexOf(label) + label.length;
    expect(styles.list[at('Seconda')].ls_id).toBeNull();
    expect(styles.paragraph[at('Seconda')]).toMatchObject({ ps_il: nested ? 72 : 36, ps_ifl: nested ? 72 : 36 });
    expect(styles.list[at('Figlia')].ls_nest).toBe(nested ? 2 : 1);
    expect(styles.paragraph[at('Figlia')]).toMatchObject({ ps_il: nested ? 108 : 72, ps_ifl: nested ? 90 : 54 });
  });

  it.each(['ol', 'ul'].flatMap(tag => ['Madre', 'Sorella'].flatMap(label => [false, true].map(nested => ({ tag, label, nested })))))('joins forward across $tag levels at $label (nested=$nested)', ({ tag, label, nested }) => {
    const child = (body: string) => `<${tag}${tag === 'ol' ? ' type="a"' : ''}>${body}</${tag}>`;
    const source = `<${tag}><li><p>Madre</p>${child('<li><p><strong>Figlia</strong></p></li><li><p>Sorella</p></li>')}</li><li><p>Seconda</p>${child('<li><p>Nipote</p></li><li><p>Altra</p></li>')}</li><li><p>Ultima</p></li></${tag}>`;
    const wrap = (html: string) => (nested ? `<ul><li><p>Esterno</p>${html}</li></ul>` : html) + '<p></p>';
    const editor = open(wrap(source));
    select(editor, label); editor.commands.setTextSelection(editor.state.selection.to);
    editor.commands.insertContent('Y'); const typed = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    const result = label === 'Madre'
      ? `<${tag}><li><p>MadreY<strong>Figlia</strong></p>${child('<li><p>Sorella</p></li>')}</li><li><p>Seconda</p>${child('<li><p>Nipote</p></li><li><p>Altra</p></li>')}</li><li><p>Ultima</p></li></${tag}>`
      : `<${tag}><li><p>Madre</p>${child('<li><p><strong>Figlia</strong></p></li><li><p>SorellaYSeconda</p></li><li><p>Nipote</p></li><li><p>Altra</p></li>')}</li><li><p>Ultima</p></li></${tag}>`;
    expect(editor.getJSON()).toEqual(open(wrap(result)).getJSON());
    expect(editor.state.selection.$from.parentOffset).toBe(label.length + 1);
    const joined = editor.getJSON();
    editor.commands.insertContent('X');
    editor.commands.undo(); expect(editor.getJSON()).toEqual(joined);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(typed);
    editor.commands.redo(); expect(editor.getJSON()).toEqual(joined);
    const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getHTML()).toBe(html);
    editor.commands.selectAll();
    const native = JSON.parse(JSON.parse(prepareSelectionClipboard(editor.view)!.formats[NATIVE_SLICE_MIME]).data).resolved;
    const lists = native.dsl_styleslices.find((s: { stsl_type: string }) => s.stsl_type === 'list').stsl_styles;
    const at = (text: string) => native.dsl_spacers.indexOf(text) + text.length;
    expect(lists[at('Nipote')].ls_nest).toBe(nested ? 2 : 1);
    expect(lists[at('Ultima')].ls_nest).toBe(nested ? 1 : 0);
  });
  it.each(['ol', 'ul'])('joins a following %s item with a child list without grouping typing', tag => {
    const editor = open(`<${tag}><li><p>Prima</p></li><li><p><strong>Seconda</strong></p><${tag}><li><p>Nipote</p></li><li><p>Altra</p></li></${tag}></li><li><p>Ultima</p></li></${tag}><p></p>`);
    select(editor, 'Prima'); editor.commands.setTextSelection(editor.state.selection.to);
    editor.commands.insertContent('Y'); const typed = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    const list = editor.state.doc.firstChild!;
    expect(list.childCount).toBe(2);
    expect(list.firstChild!.firstChild!.textContent).toBe('PrimaYSeconda');
    expect(list.firstChild!.child(1).childCount).toBe(2);
    expect(list.firstChild!.firstChild!.lastChild!.marks[0].type.name).toBe('bold');
    const joined = editor.getJSON();
    editor.commands.insertContent('X');
    editor.commands.undo(); expect(editor.getJSON()).toEqual(joined);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(typed);
    editor.commands.redo(); expect(editor.getJSON()).toEqual(joined);
  });

  it('removes an only child wrapper and retains the indent of its continuation', () => {
    const editor = open('<ol><li><p>Madre</p><ol><li><p>Figlia</p><p style="margin-left:12pt">Segue</p></li></ol><p>Dopo</p></li></ol><p></p>');
    select(editor, 'Madre'); editor.commands.setTextSelection(editor.state.selection.to);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    const item = editor.state.doc.firstChild!.firstChild!;
    expect(item.childCount).toBe(3);
    expect(item.firstChild!.textContent).toBe('MadreFiglia');
    expect(item.child(1).attrs.documentStyle).toMatchObject({ 'margin-left': '48pt' });
    expect(item.child(2).textContent).toBe('Dopo');
  });

  it('joins a last child to a following parent with no sublist', () => {
    const editor = open('<ol><li><p>Madre</p><ol><li><p>Figlia</p></li></ol></li><li><p>Seconda</p></li><li><p>Ultima</p></li></ol><p></p>');
    select(editor, 'Figlia'); editor.commands.setTextSelection(editor.state.selection.to);
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
    expect(editor.state.selection.$from.parent.textContent).toBe('FigliaSeconda');
    expect(editor.state.selection.$from.parentOffset).toBe(6);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
  });

  it.each(['ol', 'ul'])('joins forward %s text and separates subsequent typing in history', tag => {
    const editor = open(`<${tag}><li><p>Figlia</p></li><li><p><strong>Seconda</strong></p><p>Continuazione</p></li><li><p>Terza</p></li></${tag}>`);
    select(editor, 'Figlia'); editor.commands.setTextSelection(editor.state.selection.to);
    editor.commands.insertContent('Y');
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(editor.state.doc.child(0).child(0).firstChild?.textContent).toBe('FigliaYSeconda');
    expect(editor.state.doc.child(0).child(0).child(1).textContent).toBe('Continuazione');
    expect(editor.state.selection.$from.parentOffset).toBe(7);
    const joined = editor.getJSON();
    editor.commands.insertContent('X');
    editor.commands.undo(); expect(editor.getJSON()).toEqual(joined);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo(); expect(editor.getJSON()).toEqual(joined);
    const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getHTML()).toBe(html);
  });

  it('keeps imported nested numbering, marks and continuations after a forward join', () => {
    const editor = open('<ol><li><p>Prima</p><ol type="A" start="4"><li><p>Figlia</p></li><li><p><strong>Seconda</strong></p><p>Continuazione</p></li><li><p>Terza</p></li></ol></li><li><p>Ultima</p></li></ol>');
    select(editor, 'Figlia'); editor.commands.setTextSelection(editor.state.selection.to);
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    const list = editor.state.doc.child(0).child(0).child(1);
    expect(list.attrs).toMatchObject({ start: 4, type: 'A' });
    expect(list.childCount).toBe(2);
    expect(list.child(0).firstChild?.textContent).toBe('FigliaSeconda');
    expect(list.child(0).firstChild?.lastChild?.marks[0].type.name).toBe('bold');
    expect(list.child(0).child(1).textContent).toBe('Continuazione');
    editor.commands.selectAll();
    const formats = prepareSelectionClipboard(editor.view)!.formats;
    const native = JSON.parse(JSON.parse(formats[NATIVE_SLICE_MIME]).data).resolved;
    const styles = Object.fromEntries(native.dsl_styleslices.map((s: { stsl_type: string; stsl_styles: unknown[] }) => [s.stsl_type, s.stsl_styles]));
    const at = (label: string) => native.dsl_spacers.indexOf(label) + label.length;
    expect(styles.paragraph[at('Continuazione')]).toMatchObject({ ps_il: 72, ps_ifl: 72 });
    expect(styles.list[at('Continuazione')].ls_id).toBeNull();
    expect(styles.list[at('Terza')].ls_nest).toBe(1);
    const html = editor.getHTML();
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo(); expect(editor.getHTML()).toBe(html);
    editor.commands.setContent(html); expect(editor.getHTML()).toBe(html);
  });

  it('leaves Delete within text and over a selection to the regular deletion path', () => {
    const editor = open('<ol><li><p>Figlia</p></li><li><p>Seconda</p></li></ol>');
    select(editor, 'Figlia'); const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(editor.state.doc.child(0).childCount).toBe(2);
    expect(editor.state.doc.child(0).child(0).textContent).toBe('');
    expect(editor.state.doc.child(0).child(1).textContent).toBe('Seconda');
    editor.commands.setContent(original); select(editor, 'Figlia');
    editor.commands.setTextSelection(editor.state.selection.from + 2);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(editor.getJSON()).toEqual(original);
  });

  it.each(['ol', 'ul'])('joins the unindented paragraph to the previous %s item on a third Backspace', tag => {
    const editor = open(`<${tag}><li><p>Prima</p></li><li><p><strong>Seconda</strong></p><p>Continuazione</p></li><li><p>Terza</p></li></${tag}>`);
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from);
    const backspace = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    backspace(); backspace(); const twice = editor.getJSON(); backspace();
    expect(editor.state.doc.child(0).child(0).childCount).toBe(1);
    expect(editor.state.doc.child(0).child(0).firstChild?.textContent).toBe('PrimaSeconda');
    expect(editor.state.selection.$from.parentOffset).toBe(5);
    expect(editor.state.selection.$from.parent.lastChild?.marks[0].type.name).toBe('bold');
    expect(editor.state.doc.child(1).textContent).toBe('Continuazione');
    expect(editor.state.doc.child(1).attrs.documentStyle).toMatchObject({ 'margin-left': '36pt' });
    if (tag === 'ol') expect(editor.state.doc.child(2).attrs.start).toBe(2);
    const joined = editor.getHTML();
    editor.commands.undo(); expect(editor.getJSON()).toEqual(twice);
    editor.commands.redo(); expect(editor.getHTML()).toBe(joined);
    editor.commands.setContent(joined); expect(editor.getHTML()).toBe(joined);
  });

  it('joins a zero-indent nested continuation to the preceding child text, retaining its marker and later lists', () => {
    const editor = open('<ol><li><p>Prima</p><ol type="a" start="4"><li><p>Figlia</p></li><li><p><strong>Seconda</strong></p><p>Continuazione</p></li><li><p>Terza</p></li></ol></li><li><p>Ultima</p></li></ol>');
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from);
    const backspace = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    backspace(); backspace(); const twice = editor.getJSON(); backspace();
    const parent = editor.state.doc.child(0).child(0);
    expect(parent.child(1).child(0).childCount).toBe(1);
    expect(parent.child(1).child(0).firstChild?.textContent).toBe('FigliaSeconda');
    expect(editor.state.selection.$from.parentOffset).toBe(6);
    expect(parent.child(2).textContent).toBe('Continuazione');
    expect(parent.child(2).attrs.documentStyle).toMatchObject({ 'margin-left': '36pt' });
    expect(parent.child(3).attrs).toMatchObject({ start: 5, type: 'a' });
    const joined = editor.getHTML();
    editor.commands.undo(); expect(editor.getJSON()).toEqual(twice);
    editor.commands.redo(); expect(editor.getHTML()).toBe(joined);
    editor.commands.setContent(joined); expect(editor.getHTML()).toBe(joined);
  });

  it.each(['ol', 'ul'])('resets the retained %s indent on a second Backspace without joining paragraphs', tag => {
    const editor = open(`<${tag}><li><p>Prima</p></li><li><p style="color:#123abc;line-height:1.5"><strong>Seconda</strong></p></li><li><p>Terza</p></li></${tag}>`);
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from);
    const backspace = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    backspace(); const first = editor.getJSON();
    backspace();
    expect(editor.state.doc.child(1).textContent).toBe('Seconda');
    expect(editor.state.doc.child(1).attrs.documentStyle).toEqual({ color: 'rgb(18, 58, 188)', 'line-height': '1.5' });
    expect(editor.state.doc.child(1).firstChild?.marks[0].type.name).toBe('bold');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    if (tag === 'ol') expect(editor.state.doc.child(2).attrs.start).toBe(2);
    const second = editor.getJSON();
    editor.commands.undo(); expect(editor.getJSON()).toEqual(first);
    editor.commands.redo(); expect(editor.getJSON()).toEqual(second);
    const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getHTML()).toBe(html);
  });

  it.each([1, 2])('resets the entire indent of a continuation inside %i parent lists and keeps neighboring markers', parents => {
    const inner = '<ol type="a" start="4"><li><p>Figlia</p></li><li><p><strong>Seconda</strong></p><p>Continuazione</p></li><li><p>Terza</p></li></ol>';
    const nested = parents === 1 ? inner : `<ul><li><p>Madre</p>${inner}</li></ul>`;
    const editor = open(`<ol><li><p>Prima</p>${nested}</li><li><p>Ultima</p></li></ol>`);
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from);
    const backspace = () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    backspace(); const first = editor.getJSON(); backspace();
    expect(editor.state.selection.$from.parent.attrs.documentStyle).toMatchObject({ 'margin-left': `${-36 * parents}pt` });
    expect(editor.state.selection.$from.parent.textContent).toBe('Seconda');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    editor.commands.selectAll();
    const native = JSON.parse(JSON.parse(prepareSelectionClipboard(editor.view)!.formats[NATIVE_SLICE_MIME]).data).resolved;
    const styles = Object.fromEntries(native.dsl_styleslices.map((slice: { stsl_type: string; stsl_styles: unknown[] }) => [slice.stsl_type, slice.stsl_styles]));
    const at = (label: string) => native.dsl_spacers.indexOf(label) + label.length;
    expect(styles.paragraph[at('Seconda')]).toMatchObject({ ps_il: 0, ps_ifl: 0 });
    expect(styles.list[at('Seconda')].ls_id).toBeNull();
    expect(styles.paragraph[at('Continuazione')]).toMatchObject({ ps_il: 36 * (parents + 1), ps_ifl: 36 * (parents + 1) });
    expect(styles.list[at('Terza')].ls_nest).toBe(parents);
    const html = editor.getHTML();
    editor.commands.undo(); expect(editor.getJSON()).toEqual(first);
    editor.commands.redo(); expect(editor.getHTML()).toBe(html);
    editor.commands.setContent(html); expect(editor.getHTML()).toBe(html);
  });

  it('keeps paragraph indentation when Backspace is inside text or over a selection', () => {
    const editor = open('<p>Prima</p><p style="margin-left:36pt">Seconda</p>');
    select(editor, 'Seconda'); const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(editor.state.doc.child(1).attrs.documentStyle).toMatchObject({ 'margin-left': '36pt' });
    editor.commands.setContent(original);
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from + 2);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(editor.getJSON()).toEqual(original);
  });

  it.each(['ol', 'ul'])('removes a %s marker without joining text, keeping indentation and one undo', tag => {
    const editor = open(`<${tag}><li><p>Prima</p></li><li><p><strong>Seconda</strong></p></li><li><p>Terza</p></li></${tag}>`);
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from);
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    const doc = editor.state.doc;
    expect(doc.childCount).toBe(4); // StarterKit also keeps a trailing empty paragraph.
    expect(doc.child(1).type.name).toBe('paragraph');
    expect(doc.child(1).textContent).toBe('Seconda');
    expect(doc.child(1).attrs.documentStyle).toMatchObject({ 'margin-left': '36pt' });
    expect(doc.child(1).firstChild?.marks[0].type.name).toBe('bold');
    if (tag === 'ol') expect(doc.child(2).attrs.start).toBe(2);
    expect(editor.state.selection.$from.parent.textContent).toBe('Seconda');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    const result = editor.getHTML();
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo(); expect(editor.getHTML()).toBe(result);
    editor.commands.setContent(result); expect(editor.getHTML()).toBe(result);
  });

  it('removes a nested marker without creating a parent-level item and exports the retained indent', () => {
    const editor = open('<ol><li><p>Prima</p><ol type="a" start="4"><li><p>Figlia</p></li><li><p>Seconda</p></li><li><p>Terza</p></li></ol></li><li><p>Ultima</p></li></ol>');
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from);
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    const parent = editor.state.doc.child(0).child(0);
    expect(parent.child(2).type.name).toBe('paragraph');
    expect(parent.child(2).textContent).toBe('Seconda');
    expect(parent.child(3).attrs).toMatchObject({ type: 'a', start: 5 });
    expect(editor.state.doc.child(0).childCount).toBe(2);
    editor.commands.selectAll();
    const copied = prepareSelectionClipboard(editor.view)!;
    const native = JSON.parse(JSON.parse(copied.formats[NATIVE_SLICE_MIME]).data).resolved;
    const at = native.dsl_spacers.indexOf('Seconda') + 'Seconda'.length;
    expect(native.dsl_styleslices.find((s: { stsl_type: string }) => s.stsl_type === 'paragraph').stsl_styles[at]).toMatchObject({ ps_il: 72, ps_ifl: 72 });
    expect(native.dsl_styleslices.find((s: { stsl_type: string }) => s.stsl_type === 'list').stsl_styles[at].ls_id).toBeNull();
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
  });

  it('removes the first marker while keeping the remaining imported start', () => {
    const editor = open('<ol type="I" start="7"><li><p>Prima</p></li><li><p>Seconda</p></li></ol>');
    select(editor, 'Prima'); editor.commands.setTextSelection(editor.state.selection.from);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    expect(editor.state.doc.child(1).attrs).toMatchObject({ start: 7, type: 'I' });
  });

  it.each(['ol', 'ul'])('keeps all paragraphs of a removed %s item separate and styled', tag => {
    const editor = open(`<${tag}><li><p>Prima</p></li><li><p style="margin-left:12pt;color:#123abc">Seconda</p><p>Continuazione</p></li><li><p>Terza</p></li></${tag}>`);
    select(editor, 'Seconda'); editor.commands.setTextSelection(editor.state.selection.from);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(editor.state.doc.child(1).attrs.documentStyle).toMatchObject({ 'margin-left': '48pt', color: 'rgb(18, 58, 188)' });
    expect(editor.state.doc.child(2).textContent).toBe('Continuazione');
    expect(editor.state.doc.child(2).attrs.documentStyle).toMatchObject({ 'margin-left': '36pt' });
    if (tag === 'ol') expect(editor.state.doc.child(3).attrs.start).toBe(2);
  });

  it('preserves the text selection deletion path', () => {
    const editor = open('<ol><li><p>Prima</p></li><li><p>Seconda</p></li></ol>');
    select(editor, 'Seconda');
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    // jsdom has no native deletion; the list command must leave the selection
    // to the normal browser path, without removing either item.
    expect(editor.state.doc.child(0).childCount).toBe(2);
  });

  it('creates alphabetic and roman child lists in the indentation transaction', () => {
    const editor = open('<ol start="4"><li><p>Prima</p></li><li><p>Seconda</p></li><li><p>Terza</p></li></ol>');
    select(editor, 'Seconda', 'Terza');
    const original = editor.getJSON();
    expect(editor.commands.sinkListItem('listItem')).toBe(true);
    expect(editor.state.doc.child(0).child(0).child(1).attrs).toMatchObject({ type: 'a', start: 1 });
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo();
    select(editor, 'Terza');
    expect(editor.commands.sinkListItem('listItem')).toBe(true);
    expect(editor.getHTML()).toContain('type="i"');
    const html = editor.getHTML(); editor.commands.setContent(html); expect(editor.getHTML()).toBe(html);
  });

  it('keeps an existing imported child marker and start when indenting into it', () => {
    const editor = open('<ol><li><p>Prima</p><ol type="I" start="7"><li><p>Figlia</p></li></ol></li><li><p>Seconda</p></li></ol>');
    select(editor, 'Seconda'); editor.commands.sinkListItem('listItem');
    expect(editor.state.doc.child(0).child(0).child(1).attrs).toMatchObject({ type: 'I', start: 7 });
  });

  it('does not change imported decimal children or bullet nesting during unrelated edits', () => {
    const editor = open('<ol><li><p>Prima</p><ol><li><p>Figlia</p></li></ol></li></ol><ul><li><p>Punto</p></li><li><p>Altro</p></li></ul>');
    select(editor, 'Altro'); editor.commands.sinkListItem('listItem');
    expect(editor.state.doc.child(0).child(0).child(1).attrs.type).toBeNull();
    expect(editor.getHTML()).not.toContain('type="a"');
  });

  it('preserves the actual start when copying later items of a typed list', () => {
    const editor = open('<ol type="A" start="4"><li><p>Prima</p></li><li><p>Seconda</p></li><li><p>Terza</p></li></ol>');
    select(editor, 'Seconda', 'Terza');
    const original = editor.getJSON();
    const copied = prepareSelectionClipboard(editor.view)!;
    expect(new DOMParser().parseFromString(copied.html, 'text/html').querySelector('ol')?.getAttribute('start')).toBe('5');
    const native = JSON.parse(JSON.parse(copied.formats[NATIVE_SLICE_MIME]).data).resolved;
    expect(Object.values(native.dsl_entitymap)).toEqual(expect.arrayContaining([expect.objectContaining({ le_nb: expect.objectContaining({ nl_0: expect.objectContaining({ b_gt: 4, b_sn: 5 }) }) })]));
    expect(copied.plainText).not.toContain('Prima');
    expect(editor.getJSON()).toEqual(original);
  });

  it('copies a selected word within one list item without adding a marker', () => {
    const editor = open('<ol start="4"><li><p style="margin-left:36pt">Prima scelta dopo</p></li></ol>');
    select(editor, 'scelta');
    const copied = prepareSelectionClipboard(editor.view)!;
    expect(copied.plainText.trim()).toBe('scelta');
    expect(copied.html).not.toContain('<ol');
    const native = JSON.parse(JSON.parse(copied.formats[NATIVE_SLICE_MIME]).data).resolved;
    expect(Object.values(native.dsl_entitymap)).toHaveLength(0);
    expect(native.dsl_spacers).toBe('scelta');
    expect(copied.html).not.toMatch(/<(p|h[1-6])\b/);
    expect(copied.html).not.toContain('margin-left');
    editor.commands.setContent('<p>prima dopo</p>');
    editor.commands.setTextSelection(7);
    editor.view.pasteHTML(copied.html, new Event('paste') as ClipboardEvent);
    expect(editor.getHTML()).toBe('<p>prima sceltadopo</p>');
  });

  it('adjusts starts independently for a selection across separate lists', () => {
    const editor = open('<ol start="4"><li><p>Prima</p></li><li><p>Seconda</p></li></ol><p>Tra liste</p><ol type="i" start="7"><li><p>Terza</p></li></ol>');
    select(editor, 'Seconda', 'Terza');
    const copied = prepareSelectionClipboard(editor.view)!;
    const html = new DOMParser().parseFromString(copied.html, 'text/html');
    expect(Array.from(html.querySelectorAll('ol')).map(list => list.getAttribute('start'))).toEqual(['5', '7']);
  });

  it('keeps can() indentation checks free of document changes', () => {
    const editor = open('<ol><li><p>Prima</p></li><li><p>Seconda</p></li></ol>');
    select(editor, 'Seconda');
    const original = editor.getJSON();
    expect(editor.can().sinkListItem('listItem')).toBe(true);
    expect(editor.getJSON()).toEqual(original);
    select(editor, 'Prima');
    expect(editor.can().sinkListItem('listItem')).toBe(false);
  });

  it.each(['ol', 'ul'])('inserts a tab within %s text, with one undo and HTML persistence', tag => {
    const editor = open(`<${tag}><li><p>Prima</p></li><li><p>Seconda</p></li></${tag}>`);
    select(editor, 'Seconda');
    editor.commands.setTextSelection(editor.state.selection.to);
    const original = editor.getJSON();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }));
    expect(editor.getText()).toContain('Seconda\t');
    expect(editor.getHTML()).not.toContain('type="a"');
    const withTab = editor.getHTML();
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.setContent(withTab);
    expect(editor.getText()).toContain('Seconda\t');
  });
});
