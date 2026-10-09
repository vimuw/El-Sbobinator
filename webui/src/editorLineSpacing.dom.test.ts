import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it, vi } from 'vitest';
import { formatPortableHtml } from './documentFormatting';
import { EditorDocumentStyle } from './editorDocumentStyle';
import { CustomParagraph } from './editorExtensions';
import { nativeLineSpacingReader, prepareHtmlLineSpacing } from './editorLineSpacing';

const portable = (html: string) => {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  formatPortableHtml(body);
  return body.innerHTML;
};

describe('HTML fallback line spacing', () => {
  it('transports the empty list/table separator without adding text or a soft break on internal import', () => {
    const source = portable('<ol><li><p>Figlia</p></li></ol><p style="line-height:1.6;margin-top:8pt" data-editor-empty-marks="[{&quot;type&quot;:&quot;bold&quot;}]"></p><table><tr><td><p>Cella</p></td></tr></table>');
    const copied = prepareHtmlLineSpacing(source);
    const body = new DOMParser().parseFromString(copied, 'text/html').body;
    const separator = body.querySelector<HTMLElement>('div[data-editor-empty-paragraph="true"]')!;
    expect(separator).not.toBeNull();
    expect(separator.textContent).toBe('');
    expect(separator.innerHTML).toBe('<br>');
    expect(separator.previousElementSibling?.tagName).toBe('OL');
    expect(separator.nextElementSibling?.tagName).toBe('TABLE');
    expect(separator.style.lineHeight).toBe('1.6');
    expect(prepareHtmlLineSpacing(copied)).toBe(copied);
    const editor = new Editor({ extensions: [StarterKit.configure({ paragraph: false }), CustomParagraph, EditorDocumentStyle], content: separator.outerHTML });
    try {
      expect(editor.state.doc.firstChild!.content.size).toBe(0);
      expect(editor.state.doc.firstChild!.attrs.documentStyle['line-height']).toBe('1.6');
      expect(editor.state.doc.firstChild!.attrs.documentStyle['margin-top']).toBe('8pt');
      expect(editor.state.doc.firstChild!.attrs.emptyTextMarks).toEqual([{ type: 'bold' }]);
      expect(editor.getHTML()).not.toMatch(/data-editor-empty-paragraph|<br|<div|calc\(/);
      const before = editor.getJSON();
      editor.commands.setContent(editor.getHTML());
      expect(editor.getJSON()).toEqual(before);
    } finally { editor.destroy(); }
  });

  it.each(['ol', 'ul'])('restores each empty paragraph in a %s/table run with its own styles and marks', list => {
    const source = portable(`<${list}><li><p>Ultima</p></li></${list}><p style="line-height:1.6;margin-top:8pt" data-editor-empty-marks="[{&quot;type&quot;:&quot;bold&quot;}]"></p><p style="line-height:1.8;margin-bottom:10pt"></p><table><tr><td><p>Cella</p></td></tr></table>`);
    const copied = prepareHtmlLineSpacing(source);
    const body = new DOMParser().parseFromString(copied, 'text/html').body;
    const separators = Array.from(body.querySelectorAll<HTMLElement>('div[data-editor-empty-paragraph="true"]'));
    expect(separators).toHaveLength(2);
    expect(separators.map(el => el.innerHTML)).toEqual(['<br>', '<br>']);
    expect(separators[0].previousElementSibling?.tagName).toBe(list.toUpperCase());
    expect(separators[1].nextElementSibling?.tagName).toBe('TABLE');
    expect(prepareHtmlLineSpacing(copied)).toBe(copied);
    const editor = new Editor({ extensions: [StarterKit.configure({ paragraph: false }), CustomParagraph, EditorDocumentStyle], content: separators.map(el => el.outerHTML).join('') });
    try {
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.state.doc.child(0).content.size).toBe(0);
      expect(editor.state.doc.child(1).content.size).toBe(0);
      expect(editor.state.doc.child(0).attrs.documentStyle['margin-top']).toBe('8pt');
      expect(editor.state.doc.child(1).attrs.documentStyle['margin-bottom']).toBe('10pt');
      expect(editor.state.doc.child(0).attrs.emptyTextMarks).toEqual([{ type: 'bold' }]);
      expect(editor.getHTML()).not.toMatch(/data-editor-empty-paragraph|<br|<div|calc\(/);
      const before = editor.getJSON();
      editor.commands.setContent(editor.getHTML());
      expect(editor.getJSON()).toEqual(before);
    } finally { editor.destroy(); }
  });

  it('does not transport runs interrupted by text, a real break or a different boundary', () => {
    for (const middle of ['<p></p><p>Testo</p><p></p>', '<p></p><p><br></p><p></p>']) {
      expect(prepareHtmlLineSpacing(portable(`<ol><li><p>Lista</p></li></ol>${middle}<table><tr><td><p>Cella</p></td></tr></table>`))).not.toContain('data-editor-empty-paragraph');
    }
    expect(prepareHtmlLineSpacing(portable('<ol><li><p>Lista</p></li></ol><p></p><p></p><p>Dopo</p>'))).not.toContain('data-editor-empty-paragraph');
  });

  it('leaves other empty blocks and real breaks unchanged and does not discard content in a forged transport wrapper', () => {
    const source = portable('<p></p><p>Testo<br></p><ul><li><p></p></li></ul><p><br></p><table><tr><td><p></p></td></tr></table><p></p>');
    expect(prepareHtmlLineSpacing(source)).not.toContain('data-editor-empty-paragraph');
    const editor = new Editor({ extensions: [StarterKit.configure({ paragraph: false }), CustomParagraph, EditorDocumentStyle], content: '<div data-editor-empty-paragraph="true">Testo<br>Ancora</div><div data-editor-empty-paragraph="true"><img src="x"><br></div>' });
    try {
      expect(editor.getText()).toContain('Testo');
      expect(editor.getText()).toContain('Ancora');
      expect(editor.state.doc.firstChild!.content.size).toBeGreaterThan(0);
    } finally { editor.destroy(); }
  });
  it('converts custom leading using the actual font metrics, with per-copy measurement caching', () => {
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.style.fontFamily === 'Georgia' ? 1600 : 1536 } as DOMRect;
    });
    try {
      const body = new DOMParser().parseFromString('<p style="font-family:Arial;font-size:11pt;line-height:1.6">A</p><p style="font-family:Georgia;font-size:18pt;line-height:1.8">G</p><p style="font-family:Arial;font-size:22pt;line-height:32pt">B</p><p style="line-height:normal">C</p>', 'text/html').body;
      const read = nativeLineSpacingReader();
      const blocks = body.querySelectorAll('p');
      expect(read(blocks[0])).toBeCloseTo(1.6 / 1.152);
      expect(read(blocks[1])).toBeCloseTo(1.5);
      expect(read(blocks[2])).toBeCloseTo(32 / (22 * 1.152));
      expect(read(blocks[3])).toBe(1);
      expect(measure).toHaveBeenCalledTimes(2);
      expect(document.body.textContent).not.toContain('M');
    } finally { measure.mockRestore(); }
  });
  it('restores CSS leading on internal import and saved HTML, without retaining transport wrappers', () => {
    const source = portable('<p>Prima<br>Seconda</p><p style="line-height:1.6;margin-top:8pt">Personalizzato</p><ol start="4"><li><p>Madre</p><ol type="a"><li><p>Figlia</p></li></ol></li></ol><table><tr><td><p>Cella</p></td></tr></table>');
    const copied = prepareHtmlLineSpacing(source);
    expect(copied).toContain('data-editor-css-line-height="1.38"');
    const editor = new Editor({ extensions: [StarterKit, EditorDocumentStyle], content: copied });
    try {
      const blocks: Array<{ text: string; leading: string }> = [];
      editor.state.doc.descendants(node => {
        if (node.type.name === 'paragraph') blocks.push({ text: node.textContent, leading: node.attrs.documentStyle?.['line-height'] });
      });
      expect(blocks[0].leading).toBe('1.38');
      expect(blocks[1].leading).toBe('1.6');
      expect(editor.getHTML()).not.toContain('data-editor-css-line-height');
      expect(editor.getHTML()).not.toContain('calc(');
      const before = editor.getJSON();
      editor.commands.setContent(editor.getHTML());
      expect(editor.getJSON()).toEqual(before);
    } finally { editor.destroy(); }
  });

  it('keeps preparation idempotent, sublists outside spans and inline-only selections unchanged', () => {
    const source = portable('<ol><li>Madre<ol type="a"><li>Figlia</li></ol>Continua</li></ol><p></p>');
    const copied = prepareHtmlLineSpacing(source);
    expect(prepareHtmlLineSpacing(copied)).toBe(copied);
    const body = new DOMParser().parseFromString(copied, 'text/html').body;
    expect(body.querySelector('span ol,span li')).toBeNull();
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(body.querySelector('p')?.textContent).toBe('');
    const inline = portable('<span style="font-family:Georgia;font-size:18pt">Una <strong>parola</strong></span>');
    expect(prepareHtmlLineSpacing(inline)).toBe(inline);
  });

  it('carries the first paragraph custom leading on the list item read by Docs', () => {
    const copied = prepareHtmlLineSpacing(portable('<ol><li><p>Madre</p><ol type="a"><li><p style="line-height:1.6">Figlia</p></li></ol></li></ol>'));
    const child = new DOMParser().parseFromString(copied, 'text/html').querySelector<HTMLElement>('ol ol li')!;
    expect(child.style.lineHeight).toBe('1.6');
    expect(child.querySelector('p')!.style.lineHeight).toBe('1.6');
  });

  it.each(['NaN', '-1', '0', '10000', 'url(https://example.com)', '1.6; color:red'])('ignores malformed transport leading %s', value => {
    const editor = new Editor({ extensions: [StarterKit, EditorDocumentStyle], content: `<p data-editor-css-line-height="${value}" style="line-height:1.15">Testo</p>` });
    try { expect(editor.state.doc.firstChild!.attrs.documentStyle['line-height']).toBe('1.15'); }
    finally { editor.destroy(); }
  });
});
