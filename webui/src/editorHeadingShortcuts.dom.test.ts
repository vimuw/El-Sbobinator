import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { CustomHeading, FontSize } from './editorExtensions';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });

const open = () => {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [StarterKit.configure({ heading: false }), CustomHeading, FontSize],
    content: '<p>Lezione</p>',
  });
  editors.push(editor);
  return editor;
};

const press = (editor: Editor, altGraph: boolean) => {
  const event = new KeyboardEvent('keydown', {
    key: '2', code: 'Digit2', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
    modifierAltGraph: altGraph,
  } as KeyboardEventInit);
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('heading shortcuts', () => {
  it('applies Heading 2 on a real Ctrl+Alt+2', () => {
    const editor = open();
    expect(press(editor, false)).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });

  // Windows reports AltGr as Ctrl+Alt; AltGr+2 types a character on some layouts.
  it('ignores AltGr+2 and leaves the key to typing', () => {
    const editor = open();
    expect(press(editor, true)).toBe(false);
    expect(editor.getJSON().content?.[0].type).toBe('paragraph');
  });
});
