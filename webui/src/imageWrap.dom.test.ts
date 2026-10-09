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
});
