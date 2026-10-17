import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorDocumentStyle } from './editorDocumentStyle';
import { EditorReadingColors } from './editorReadingColors';
import { prepareSelectionClipboard } from './editorSelectionClipboard';

let editor: Editor;
afterEach(() => { editor?.destroy(); document.documentElement.removeAttribute('data-theme'); });
function open(content: string) {
  editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: [StarterKit, TextStyle, Color, Highlight.configure({ multicolor: true }), EditorDocumentStyle, EditorReadingColors], content });
  return editor;
}

describe('Reading ink is a view projection', () => {
  it('adapts automatic and black ink while preserving colored inline overrides, links, and code', () => {
    open('<h2 style="color:black">Nero <span style="color:#123abc">Blu</span></h2><p><span style="color:rgb(0,0,0)"><strong>Esplicito</strong></span> Automatico <a href="https://example.com">Link</a></p><pre><code>Codice</code></pre>');
    const neutral = [...editor.view.dom.querySelectorAll('.editor-reading-neutral')].map(node => node.textContent).join('');
    expect(neutral).toContain('Nero'); expect(neutral).toContain('Esplicito'); expect(neutral).toContain('Automatico');
    expect(neutral).not.toMatch(/Blu|Link|Codice/);
    expect(editor.getHTML()).not.toContain('editor-reading');
  });

  it.each(['<mark style="background-color:#fef08a"><span style="color:black">Giallo</span></mark>', '<span style="color:black"><mark style="background-color:#fef08a">Giallo</mark></span>'])('keeps highlight ink independent of mark order: %s', html => {
    open(`<p>${html}<mark style="background-color:#112233">Scuro</mark><mark style="background-color:#fef08a"><span style="color:#123abc">Blu</span></mark></p>`);
    const highlights = editor.view.dom.querySelectorAll<HTMLElement>('.editor-reading-highlight');
    expect([...highlights].map(node => [node.textContent, node.style.getPropertyValue('--editor-highlight-ink')])).toEqual([['Giallo', '#000000'], ['Scuro', '#ffffff']]);
    expect(editor.getHTML()).not.toContain('editor-reading');
    expect(editor.getHTML()).toContain('rgb(18, 58, 188)');
  });

  it('leaves legacy HTML, native clipboard styles and undo unchanged through light/dark/light and reload', () => {
    open('<h2 style="color:#000000;margin-top:8pt">Titolo</h2><p><span style="color:rgb(18, 58, 188)">Blu</span> <mark style="background-color:#fef08a">Giallo</mark></p>');
    editor.commands.selectAll();
    const model = editor.getJSON(); const saved = editor.getHTML(); const copy = prepareSelectionClipboard(editor.view)!.formats;
    for (const theme of ['light', 'dark', 'light']) {
      document.documentElement.dataset.theme = theme;
      expect(editor.getJSON()).toEqual(model); expect(editor.getHTML()).toBe(saved);
      expect(prepareSelectionClipboard(editor.view)!.formats).toEqual(copy);
      expect(editor.commands.undo()).toBe(false);
    }
    editor.commands.setContent(saved); expect(editor.getJSON()).toEqual(model);
  });
});
