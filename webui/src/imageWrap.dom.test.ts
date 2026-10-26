import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { afterEach, describe, expect, it } from 'vitest';
import { FloatingImage } from './components/FloatingImage';
import { createImageWrapPlugin } from './imageWrap';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));

function setup() {
  const editor = new Editor({ extensions: [StarterKit, FloatingImage.extend({ addNodeView: () => null, addProseMirrorPlugins: () => [] })], content: '<p>Prima</p><p>Dopo</p><p>Ultima</p>' });
  editors.push(editor);
  const plugin = createImageWrapPlugin();
  editor.registerPlugin(plugin);
  const affectedEnd = editor.state.doc.firstChild!.nodeSize;
  const decorations = DecorationSet.create(editor.state.doc, [Decoration.widget(2, () => document.createElement('span'))]);
  editor.view.dispatch(editor.state.tr.setMeta(plugin, { decorations, affectedEnd, revision: 0 }));
  return { editor, plugin, affectedEnd };
}

describe('wrap layout invalidation', () => {
  it('preserves measured gaps through typing and undo after the affected region', () => {
    const { editor, plugin, affectedEnd } = setup();
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' testo');
    expect(plugin.getState(editor.state)?.affectedEnd).toBe(affectedEnd);
    expect(plugin.getState(editor.state)?.decorations.find()).toHaveLength(1);
    expect(plugin.getState(editor.state)?.revision).toBe(0);
    editor.commands.undo();
    expect(plugin.getState(editor.state)?.decorations.find()).toHaveLength(1);
    expect(plugin.getState(editor.state)?.revision).toBe(0);
  });

  it('invalidates a change before the region even when the caret is after it', () => {
    const { editor, plugin } = setup();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContentAt(1, 'X');
    expect(plugin.getState(editor.state)?.affectedEnd).toBeNull();
    expect(plugin.getState(editor.state)?.decorations.find()).toHaveLength(0);
    expect(plugin.getState(editor.state)?.revision).toBe(1);
  });

  it('invalidates a new wrap image beyond the previously affected region', () => {
    const { editor, plugin } = setup();
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, { type: 'floatingImage', attrs: { src: 'figure.png', layout: 'wrap' } });
    expect(plugin.getState(editor.state)?.affectedEnd).toBeNull();
  });

  it('invalidates attribute and mark changes whose step maps are empty', () => {
    const { editor, plugin } = setup();
    editor.commands.setTextSelection({ from: editor.state.doc.content.size - 4, to: editor.state.doc.content.size - 1 });
    editor.commands.toggleBold();
    expect(plugin.getState(editor.state)?.affectedEnd).toBeNull();
  });

  it('keeps the solved gaps when an edit above the measured region only shifts it down', () => {
    const editor = new Editor({ extensions: [StarterKit, FloatingImage.extend({ addNodeView: () => null, addProseMirrorPlugins: () => [] })], content: '<p>Sopra</p><p>Figura</p><p>Dopo</p>' });
    editors.push(editor);
    const plugin = createImageWrapPlugin();
    editor.registerPlugin(plugin);
    const affectedStart = editor.state.doc.firstChild!.nodeSize;
    const affectedEnd = affectedStart + editor.state.doc.child(1).nodeSize;
    const decorations = DecorationSet.create(editor.state.doc, [Decoration.widget(affectedStart + 2, () => document.createElement('span'))]);
    editor.view.dispatch(editor.state.tr.setMeta(plugin, { decorations, affectedStart, affectedEnd, revision: 0 }));

    // Typing, Enter and list toggles above the figures move everything below as one block.
    const size = editor.state.doc.content.size;
    editor.commands.insertContentAt(2, 'ABC');
    editor.commands.setTextSelection(2);
    editor.commands.splitBlock();
    editor.commands.toggleBulletList();
    const state = plugin.getState(editor.state)!;
    expect(state.revision).toBe(0);
    const shift = editor.state.doc.content.size - size;
    expect(shift).toBeGreaterThan(3);
    expect(state.affectedStart).toBe(affectedStart + shift);
    expect(state.affectedEnd).toBe(affectedEnd + shift);
    expect(state.decorations.find().map(d => d.from)).toEqual([affectedStart + 2 + shift]);
    expect(editor.state.doc.textBetween(state.affectedStart!, state.affectedEnd!)).toBe('Figura');

    // A block inserted right above the region start shifts it too.
    editor.commands.insertContentAt(state.affectedStart!, '<p>Nuovo</p>');
    const inserted = plugin.getState(editor.state)!;
    expect(inserted.revision).toBe(0);
    expect(editor.state.doc.textBetween(inserted.affectedStart!, inserted.affectedEnd!)).toBe('Figura');

    // Joining the first measured block with the one above changes its lines.
    editor.commands.deleteRange({ from: inserted.affectedStart! - 1, to: inserted.affectedStart! + 1 });
    expect(plugin.getState(editor.state)?.affectedEnd).toBeNull();
    expect(plugin.getState(editor.state)?.revision).toBe(1);
  });

  it('still invalidates an edit inside a region that starts below the document top', () => {
    const editor = new Editor({ extensions: [StarterKit, FloatingImage.extend({ addNodeView: () => null, addProseMirrorPlugins: () => [] })], content: '<p>Sopra</p><p>Figura</p><p>Dopo</p>' });
    editors.push(editor);
    const plugin = createImageWrapPlugin();
    editor.registerPlugin(plugin);
    const affectedStart = editor.state.doc.firstChild!.nodeSize;
    editor.view.dispatch(editor.state.tr.setMeta(plugin, { decorations: DecorationSet.empty, affectedStart, affectedEnd: affectedStart + 8, revision: 0 }));
    editor.commands.insertContentAt(affectedStart + 3, 'X');
    expect(plugin.getState(editor.state)?.affectedEnd).toBeNull();
  });
});
