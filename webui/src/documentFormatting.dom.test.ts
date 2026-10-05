import { describe, expect, it } from 'vitest';
import { clipboardPlainText, DOCUMENT_FORMATTING, editorFormattingVariables, formatPortableHtml, pointSize } from './documentFormatting';
import { createNativeClipboardFormats, NATIVE_SLICE_MIME } from './editorClipboard';
import { prepareHtmlForClipboardSync } from './utils';

const body = (html: string) => new DOMParser().parseFromString(html, 'text/html').body;
const native = (html: string) => JSON.parse(JSON.parse(createNativeClipboardFormats(html)![NATIVE_SLICE_MIME]).data).resolved;
const styles = (model: ReturnType<typeof native>, type: string) => model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === type).stsl_styles;

describe('Shared document formatting', () => {
  it.each([
    '<s><u>X</u></s>', '<u><s>X</s></u>',
    '<span style="text-decoration:line-through"><u>X</u></span>',
    '<span style="text-decoration:underline"><s><a style="text-decoration:none" href="https://example.com">X</a></s></span>',
  ])('preserves both underline and strike through nested clipboard decorations: %s', content => {
    const model = native(`<p>${content}</p>`);
    expect(styles(model, 'text')[model.dsl_spacers.indexOf('X')]).toMatchObject({ ts_un: true, ts_st: true });
  });
  it('transfers saved empty-line marks without adding text or styling populated paragraphs', () => {
    const marks = JSON.stringify([{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '18pt', color: '#123abc' } }, { type: 'highlight', attrs: { color: '#ffee00' } }]);
    const root = body('<p></p><p>Normale</p>');
    root.querySelectorAll('p').forEach(p => p.setAttribute('data-editor-empty-marks', marks));
    const portable = body(prepareHtmlForClipboardSync(root.innerHTML));
    expect(portable.querySelector('p')!.textContent).toBe('');
    expect(portable.querySelector('p')!.style.fontWeight).toBe('700');
    expect(portable.querySelectorAll('p')[1].style.fontWeight).toBe('');
    expect(styles(native(root.innerHTML), 'text')[0]).toMatchObject({ ts_bd: true, ts_it: true, ts_un: true, ts_st: true, ts_ff: 'Georgia', ts_fs: 18, ts_fgc2: { hclr_color: '#123abc' }, ts_bgc2: { hclr_color: '#ffee00' } });
    expect(clipboardPlainText(portable)).toBe('\nNormale\n');
    expect(prepareHtmlForClipboardSync(portable.innerHTML)).toBe(portable.innerHTML);
  });

  it.each(['invalid', '{}', '[null,{"type":"unknown"},{"type":"bold","attrs":[]} ]'])('ignores malformed empty-line metadata %s', value => {
    const root = body('<p></p>'); root.querySelector('p')!.setAttribute('data-editor-empty-marks', value);
    expect(styles(native(root.innerHTML), 'text')[0].ts_bd).toBe(false);
  });
  it('transfers paragraph indentation in points for body text and list continuations', () => {
    const html = '<p style="margin-left:48px">Fuori</p><ol><li><p>Prima</p><p style="margin-left:36pt">Continuazione</p></li></ol>';
    const portable = body(prepareHtmlForClipboardSync(html));
    expect(portable.querySelector('p')?.style.marginLeft).toBe('48px');
    expect(styles(native(html), 'paragraph').filter(Boolean)).toMatchObject([
      { ps_il: 36, ps_ifl: 36 }, { ps_il: 36, ps_ifl: 18 }, { ps_il: 72, ps_ifl: 72 },
    ]);
    expect(Array.from(body(prepareHtmlForClipboardSync(portable.innerHTML)).querySelectorAll('p')).map(p => p.style.marginLeft)).toEqual(['48px', '', '36pt']);
  });
  it('writes one plain-text boundary per list paragraph, including nested continuations', () => {
    expect(clipboardPlainText(body('<ol><li><p>Prima</p><p>Continua</p><ul><li><p>Figlia</p></li></ul><p>Dopo figlia</p></li><li><p>Seconda</p></li></ol>'))).toBe('Prima\nContinua\nFiglia\nDopo figlia\nSeconda\n');
  });
  it('keeps foreground color through highlight nesting in both HTML and native formats', () => {
    const html = '<p><span style="color:#123abc"><mark data-color="#ffee00" style="background-color:#ffee00">Blu</mark></span> <mark><span style="color:#bc321a">Rosso</span></mark></p>';
    const portable = body(prepareHtmlForClipboardSync(html));
    expect(portable.querySelector('mark')?.style.color).toBe('inherit');
    const model = native(html);
    expect(styles(model, 'text')[model.dsl_spacers.indexOf('Blu')]).toMatchObject({ ts_fgc2: { hclr_color: '#123abc' }, ts_bgc2: { hclr_color: '#ffee00' } });
    expect(styles(model, 'text')[model.dsl_spacers.indexOf('Rosso')]).toMatchObject({ ts_fgc2: { hclr_color: '#bc321a' }, ts_bgc2: { hclr_color: '#ffff00' } });
  });

  it('keeps explicit paragraph distances and leading independent of the default profile', () => {
    const html = '<p style="line-height:1.6;margin-bottom:13.75pt">Prima</p><p style="line-height:1.6;margin-top:13.75pt">Dopo</p>';
    const portable = prepareHtmlForClipboardSync(html);
    expect(prepareHtmlForClipboardSync(portable)).toBe(portable);
    expect(styles(native(portable), 'paragraph').filter(Boolean)).toMatchObject([{ ps_ls: 1.6, ps_sb: 0, ps_sa: 13.75 }, { ps_ls: 1.6, ps_sb: 0, ps_sa: 0 }]);
  });

  it('exports text-only documents with identical semantic gaps in HTML and native Docs', () => {
    const html = '<h3>Sezione</h3><p>Primo</p><ul><li><p>Voce uno</p></li><li><p>Voce due</p></li></ul><p>Ultimo</p>';
    const portable = body(prepareHtmlForClipboardSync(html));
    const model = native(html);
    const paragraphs = styles(model, 'paragraph').filter(Boolean);
    const blocks = Array.from(portable.querySelectorAll<HTMLElement>('h3,p'));
    expect(blocks).toHaveLength(5);
    expect(paragraphs).toHaveLength(blocks.length);
    blocks.forEach((block, i) => {
      expect(block.style.fontFamily).toBe(DOCUMENT_FORMATTING.fontFamily);
      expect(paragraphs[i].ps_sb).toBe(pointSize(block.style.marginTop, -1));
      expect(paragraphs[i].ps_sa).toBe(pointSize(block.style.marginBottom, -1));
    });
    expect(paragraphs[0]).toMatchObject({ ps_hd: 3, ps_sb: 16, ps_sa: 4 });
    expect(paragraphs[2]).toMatchObject({ ps_sm: 1, ps_sa: 0 });
    expect(blocks[1].style.lineHeight).toBe('1.38');
    expect(paragraphs[1].ps_ls).toBe(1.15);
  });

  it('preserves explicit fonts, relative sizes, colors, alignment and inherited formatting', () => {
    const html = '<div style="font-family:Georgia;font-size:20pt;color:#123abc"><p style="text-align:right;margin:24px 0 12px"><span style="font-size:150%"><em>Grande</em></span> normale</p><p style="margin-top:2em"><strong>Secondo</strong></p></div>';
    const portable = body(prepareHtmlForClipboardSync(html));
    expect(portable.querySelector('em')?.style.fontFamily).toBe('Georgia');
    expect(portable.querySelector('em')?.style.fontSize).toBe('30pt');
    expect(portable.querySelector('p')?.style.textAlign).toBe('right');
    expect(portable.querySelector('p')?.style.marginTop).toBe('18pt');
    const model = native(portable.innerHTML);
    expect(styles(model, 'text')[model.dsl_spacers.indexOf('Grande')]).toMatchObject({ ts_fs: 30, ts_ff: 'Georgia', ts_it: true, ts_fgc2: { hclr_color: '#123abc' } });
    expect(styles(model, 'paragraph').filter(Boolean)[0]).toMatchObject({ ps_al: 2, ps_sb: 18, ps_sa: 0 });
    expect(styles(model, 'paragraph').filter(Boolean)[1]).toMatchObject({ ps_sb: 40, ps_sa: 0 });
    expect(portable.querySelectorAll('p')[1].style.marginTop).toBe('40pt');
  });

  it('keeps table cells independent and retains spans, numbering, links and editable text', () => {
    const html = '<ol start="4"><li>Quattro<ul><li>Cinque</li></ul></li></ol><table><tr><td colspan="2"><p>A</p><p>B</p></td><td><p><a href="https://example.com">C</a></p></td></tr></table>';
    const portable = body(prepareHtmlForClipboardSync(html));
    expect(portable.querySelector('ol')?.getAttribute('start')).toBe('4');
    expect(portable.querySelectorAll('li')).toHaveLength(2);
    expect(portable.querySelector('td')?.getAttribute('colspan')).toBe('2');
    expect(portable.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(Array.from(portable.querySelectorAll('p')).map(el => el.style.marginBottom)).toEqual(['0pt', '0pt', '0pt']);
    expect(clipboardPlainText(portable)).toContain('A\nB\nC\n');
  });

  it('resolves inherited paragraph alignment and HTML leading without double-counting explicit margins', () => {
    const html = '<div style="text-align:center;line-height:2"><p>A</p><p style="margin-top:24pt">B</p></div>';
    const portable = body(prepareHtmlForClipboardSync(html));
    expect(Array.from(portable.querySelectorAll('p')).map(el => [el.style.textAlign, el.style.lineHeight, el.style.marginTop, el.style.marginBottom])).toEqual([
      ['center', '2', '0pt', '0pt'], ['center', '2', '24pt', '0pt'],
    ]);
    expect(styles(native(html), 'paragraph').filter(Boolean)).toMatchObject([
      { ps_al: 1, ps_sb: 0, ps_sa: 0 }, { ps_al: 1, ps_sb: 24, ps_sa: 0 },
    ]);
  });

  it('does not multiply gaps, wrappers or styles on repeated preparation', () => {
    const once = prepareHtmlForClipboardSync('<h2>Sezione</h2><p>A</p><p>B</p><pre><code>x = 1</code></pre>');
    expect(prepareHtmlForClipboardSync(once)).toBe(once);
    expect(createNativeClipboardFormats(once)!['text/html']).toBe(once);
    expect(body(once).querySelector('code')?.style.fontFamily).toContain('Courier New');
  });

  it('formats partial inline selections without requiring a paragraph or media', () => {
    const formats = createNativeClipboardFormats('Una <strong>parola</strong>')!;
    expect(formats).toBeTruthy();
    expect(body(formats['text/html']).querySelector<HTMLElement>('[data-document-format]')?.style.fontSize).toBe('11pt');
    expect(formats['text/plain']).toBe('Una parola');
  });

  it('removes temporary layout controls and keeps plain text boundaries and LaTeX', () => {
    const root = body('<p>A<br>B<span class="image-wrap-gap">gap</span></p><p><span data-math="x^2">rendered</span></p><div data-math-block="y^2">rendered</div><script>bad()</script><style>p{color:red}</style>');
    formatPortableHtml(root);
    expect(root.querySelector('script,style,.image-wrap-gap')).toBeNull();
    expect(clipboardPlainText(root)).toBe('A\nB\nx^2\ny^2\n');
  });

  it('keeps the portable fallback styled when native conversion cannot represent the document', () => {
    const html = '<h2>Matrici</h2><p>Testo</p><div data-math-block="\\begin{matrix}a&b\\end{matrix}">Formula originale</div>';
    const portable = prepareHtmlForClipboardSync(html);
    expect(createNativeClipboardFormats(portable)).toBeNull();
    expect(body(portable).querySelector('h2')?.style.fontSize).toBe('16pt');
    expect(body(portable).querySelector('[data-math-block]')?.textContent).toBe('Formula originale');
  });

  it.each([['12pt', 12], ['16px', 12], ['1.5em', 18], ['2rem', 24], ['150%', 18], ['invalid', 12]])('resolves %s in document units', (value, expected) => {
    expect(pointSize(value, 12)).toBe(expected);
  });

  it('derives editor typography variables from the common profile', () => {
    expect(editorFormattingVariables()).toContain('--document-paragraph-gap:0pt');
    expect(editorFormattingVariables()).toContain('--document-h6-size:10pt');
  });
});
