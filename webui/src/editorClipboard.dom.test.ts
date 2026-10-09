import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipboardImageSize, createNativeClipboardFormats, NATIVE_IMAGES_MIME, NATIVE_SLICE_MIME, setClipboardFormats, writeEditorClipboard } from './editorClipboard';

const jpeg = `data:image/jpeg;base64,${fs.readFileSync('e2e/fixtures/image-layout.jpg').toString('base64')}`;
const figure = (attributes = '', src = jpeg) => `<div data-editor-image="true" data-width="35" data-layout="wrap" data-align="right" data-position="100" ${attributes}><img src="${src}" alt="Figura"></div>`;
type Model = {
  resolved: {
    dsl_spacers: string;
    dsl_styleslices: Array<{ stsl_type: string; stsl_styles: Array<Record<string, unknown> | null> }>;
    dsl_entitymap: Record<string, { pe_l?: number; pe_lo?: number; pe_to?: number; ee_eo?: { i_wth: number; i_ht: number; i_cid: string; eo_ml: number; eo_mt: number }; le_nb?: Record<string, { b_sn: number; b_gt: number }> }>;
    dsl_entitypositionmap: { positioned: Array<string[] | null> };
  };
};
const model = (html: string) => {
  const formats = createNativeClipboardFormats(html)!;
  return { formats, ...JSON.parse(JSON.parse(formats[NATIVE_SLICE_MIME]).data) as Model };
};
const style = (doc: Model, type: string, index: number) => doc.resolved.dsl_styleslices.find(s => s.stsl_type === type)!.stsl_styles[index];
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.innerHTML = ''; });

describe('Editor native image clipboard', () => {
  it('preserves the HTML source and resamples only the native image derivative', () => {
    const root = document.createElement('div');
    root.innerHTML = `<img src="${jpeg}">`;
    const source = root.querySelector('img')!;
    Object.defineProperties(source, { complete: { value: true }, naturalWidth: { value: 1600 }, naturalHeight: { value: 1000 } });
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tag => tag === 'canvas' ? {
      width: 0, height: 0, getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }),
      toDataURL: () => 'data:image/jpeg;base64,native-derivative',
    } as unknown as HTMLCanvasElement : create(tag));
    const formats = createNativeClipboardFormats(figure(), root)!;
    const images = JSON.parse(JSON.parse(formats[NATIVE_IMAGES_MIME]).data).image_urls;
    expect(Object.values(images)).toEqual(['data:image/jpeg;base64,native-derivative']);
    expect(new DOMParser().parseFromString(formats['text/html'], 'text/html').querySelector('img')!.getAttribute('src')).toBe(jpeg);
    expect(source.getAttribute('src')).toBe(jpeg);
  });
  it.each([['a', 5], ['A', 4], ['i', 7], ['I', 6], ['1', 3]])('preserves ordered marker type %s and start in native and HTML copies', (type, glyph) => {
    const doc = model(`<ol type="${type}" start="3"><li><p>Prima</p><ol type="I" start="7"><li><p>Annidata</p></li></ol></li><li><p>Seconda</p></li></ol><p>Fuori</p>`);
    const after = (label: string) => style(doc, 'list', doc.resolved.dsl_spacers.indexOf(label) + label.length)!;
    const outer = doc.resolved.dsl_entitymap[after('Prima').ls_id as string].le_nb!;
    const nested = doc.resolved.dsl_entitymap[after('Annidata').ls_id as string].le_nb!;
    expect(outer.nl_0).toMatchObject({ b_gt: glyph, b_sn: 3 });
    expect(nested.nl_1).toMatchObject({ b_gt: 6, b_sn: 7 });
    expect(after('Seconda').ls_id).toBe(after('Prima').ls_id);
    const html = new DOMParser().parseFromString(doc.formats['text/html'], 'text/html');
    expect(html.querySelector('ol')?.style.listStyleType).toBe(({ a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman', '1': 'decimal' } as Record<string, string>)[type]);
    expect((html.querySelector('li') as HTMLElement).style.listStyleType).toBe((html.querySelector('ol') as HTMLElement).style.listStyleType);
  });

  it('copies continuation paragraphs without adding list markers or consuming the next number', () => {
    const doc = model('<ol start="4"><li><p>Prima</p><p>Continuazione</p><ul><li><p>Figlia</p></li></ul><p>Dopo figlia</p></li><li><p>Seconda</p></li></ol>');
    const after = (type: string, label: string) => style(doc, type, doc.resolved.dsl_spacers.indexOf(label) + label.length)!;
    expect(after('list', 'Prima').ls_id).toBe(after('list', 'Seconda').ls_id);
    expect(after('list', 'Figlia')).toMatchObject({ ls_nest: 1 });
    for (const label of ['Continuazione', 'Dopo figlia']) {
      expect(after('list', label)).toMatchObject({ ls_id: null });
      expect(after('paragraph', label)).toMatchObject({ ps_ifl: 36, ps_il: 36 });
    }
  });

  it('translates CSS leading against normal font metrics, including explicit units and inherited leading', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: Number.parseFloat(this.style.fontSize) / 11 * 17 } as DOMRect;
    });
    const doc = model('<p>A</p><div style="line-height:2"><p>B</p></div><p style="font-size:22pt;line-height:36px">C</p>');
    const paragraphs = doc.resolved.dsl_styleslices.find(slice => slice.stsl_type === 'paragraph')!.stsl_styles.filter(Boolean);
    expect(paragraphs[0]!.ps_ls).toBe(1.15);
    expect(paragraphs[1]!.ps_ls).toBeCloseTo(22 / 12.75);
    expect(paragraphs[2]!.ps_ls).toBeCloseTo(27 / 25.5);
    expect(document.querySelector('[style*="visibility: hidden"]')).toBeNull();
  });
  it('copies the resized aspect ratio instead of reverting to the intrinsic image dimensions', () => {
    const doc = model(figure('data-aspect-ratio="3"'));
    expect(Object.values(doc.resolved.dsl_entitymap)[0].ee_eo).toMatchObject({ i_wth: 166.5, i_ht: 55.5 });
  });
  it.each([[0, -20], [40, 0], [100, 18], [0, 120]])('preserves the image rectangle at position %s and vertical offset %s, accounting for wrapping margins', (position, offsetY) => {
    const doc = model(figure(`data-offset-y="${offsetY}"`).replace('data-position="100"', `data-position="${position}"`));
    const entity = Object.values(doc.resolved.dsl_entitymap)[0];
    expect(entity.pe_lo! + entity.ee_eo!.eo_ml).toBeCloseTo((634 - 222) * position / 100 * 0.75);
    expect(entity.pe_to! + entity.ee_eo!.eo_mt).toBe(offsetY * 0.75);
  });
  it.each([
    ['image', figure()],
    ['inline equation', '<p>Formula <span data-math="x^2">formula</span></p>'],
    ['block equation', '<div data-math-block="x^2">formula</div>'],
  ])('converts line spacing without removing paragraph gaps when a %s activates native copy', (_, media) => {
    const doc = model(`<h1>Titolo</h1><h2>Introduzione</h2><p>Primo <strong>grassetto</strong></p>${media}<p>Secondo paragrafo</p><ul><li><p>Prima voce</p></li><li><p>Seconda voce</p></li></ul><table><tr><td><p>Cella</p></td></tr></table>`);
    const text = doc.resolved.dsl_spacers;
    for (const paragraph of ['Primo grassetto', 'Secondo paragrafo', 'Prima voce']) {
      expect(style(doc, 'paragraph', text.indexOf(paragraph) + paragraph.length)).toMatchObject({ ps_ls: 1.15, ps_sb: 0, ps_sa: 0 });
    }
    // JSDOM has no font layout; custom CSS leading uses the fallback ratio.
    expect(style(doc, 'paragraph', text.indexOf('Cella') + 'Cella'.length)).toMatchObject({ ps_ls: 1.7142857, ps_sb: 0, ps_sa: 0 });
    expect(style(doc, 'text', text.indexOf('grassetto'))).toMatchObject({ ts_bd: true, ts_ff: 'Arial', ts_fs: 11 });
    expect(style(doc, 'paragraph', text.indexOf('Prima voce') + 'Prima voce'.length)?.ps_il).toBe(36);
    expect(style(doc, 'list', text.indexOf('Prima voce') + 'Prima voce'.length)).toMatchObject({ ls_nest: 0 });
    for (const label of ['Prima voce', 'Seconda voce']) expect(style(doc, 'paragraph', text.indexOf(label) + label.length)).toMatchObject({ ps_sm: 1 });
    expect(style(doc, 'text', 0)).toMatchObject({ ts_bd: true, ts_fs: 20 });
    expect(style(doc, 'paragraph', text.indexOf('Titolo') + 'Titolo'.length)).toMatchObject({ ps_hd: 1, ps_ls: 1.15, ps_sb: 20, ps_sa: 0 });
    expect(style(doc, 'paragraph', text.indexOf('Introduzione') + 'Introduzione'.length)).toMatchObject({ ps_hd: 2, ps_ls: 1.15, ps_sb: 18, ps_sa: 6 });
    if (media.includes('data-math-block')) {
      const equationEnd = text.indexOf('\n', text.indexOf('\u001a'));
      expect(style(doc, 'paragraph', equationEnd)).toMatchObject({ ps_al: 1, ps_ls: 1.15, ps_sb: 0, ps_sa: 0 });
    }
    expect(new DOMParser().parseFromString(doc.formats['text/html'], 'text/html').querySelector('strong')?.textContent).toBe('grassetto');
  });
  it('collapses adjacent block margins once and keeps separate list items and paragraphs', () => {
    const doc = model(`${figure()}<h3>Sezione</h3><p>A</p><p>B</p><ul><li><p>C</p></li><li><p>D</p></li></ul><p>E</p><h3>Seguente</h3><p>F</p><table><tr><td><p>G</p><p>H</p></td><td><p>I</p></td></tr></table>`);
    const after = (label: string) => style(doc, 'paragraph', doc.resolved.dsl_spacers.indexOf(label) + label.length)!;
    expect(after('Sezione')).toMatchObject({ ps_sb: 16, ps_sa: 4, ps_ls: 1.15 });
    for (const label of ['A', 'B', 'C', 'D', 'E']) expect(after(label)).toMatchObject({ ps_sb: 0, ps_sa: 0, ps_ls: 1.15 });
    for (const label of ['C', 'D']) expect(after(label)).toMatchObject({ ps_sm: 1 });
    expect(after('Seguente')).toMatchObject({ ps_sb: 16, ps_sa: 4 });
    expect(after('G')).toMatchObject({ ps_sb: 0, ps_sa: 0 });
    expect(after('H')).toMatchObject({ ps_sb: 0, ps_sa: 0 });
    expect(after('I')).toMatchObject({ ps_sb: 0, ps_sa: 0 });
  });
  it.each([[1, 6], [2, 6], [3, 4], [4, 4], [5, 4], [6, 3.6]])('preserves the editor gap between h%s and its following paragraph', (level, gap) => {
    const doc = model(`${figure()}<h${level}>Sezione</h${level}><p>Testo</p>`);
    expect(style(doc, 'paragraph', doc.resolved.dsl_spacers.indexOf('Sezione') + 'Sezione'.length)).toMatchObject({ ps_sa: gap, ps_ls: level === 6 ? 1.4 : 1.15 });
    expect(style(doc, 'paragraph', doc.resolved.dsl_spacers.indexOf('Testo') + 'Testo'.length)).toMatchObject({ ps_sb: 0, ps_sa: 0 });
  });
  it('transfers local image data without Google resource identifiers or access tokens', () => {
    const doc = model(`<p>Prima</p>${figure()}<p>Dopo</p>`);
    const images = JSON.parse(JSON.parse(doc.formats[NATIVE_IMAGES_MIME]).data);
    expect(images.placeholder_ids).toEqual({});
    expect(images.cosmo_ids).toEqual({});
    expect(Object.values(images.image_urls)).toEqual([jpeg]);
    expect(doc.formats[NATIVE_SLICE_MIME]).not.toMatch(/"edi"|"edrk"|internal-clip-id/);
    const entity = Object.values(doc.resolved.dsl_entitymap)[0];
    expect(entity).toMatchObject({ pe_l: 0, pe_lo: 297, ee_eo: { i_wth: 166.5, i_ht: 111 } });
    expect(doc.resolved.dsl_spacers).toBe('Prima\nDopo\n');
    expect(doc.resolved.dsl_entitypositionmap.positioned[6]).toHaveLength(1);
  });
  it('gives image-only selections a valid anchor and distinguishes inline from wrap', () => {
    const doc = model(figure());
    expect(doc.resolved.dsl_spacers).toBe('\n');
    expect(doc.resolved.dsl_entitypositionmap.positioned[0]).toHaveLength(1);
    const broken = model(figure().replace('data-layout="wrap"', 'data-layout="break"').replace('data-position="100"', 'data-position="40"'));
    expect(Object.values(broken.resolved.dsl_entitymap)[0].pe_l).toBeUndefined();
    expect(broken.resolved.dsl_spacers).toBe('*\n');
    expect(Object.values(broken.resolved.dsl_entitymap)[0].pe_lo).toBeUndefined();
  });
  it('preserves UTF-16 text offsets, headings, inline marks, font, colors and alignment', () => {
    const doc = model(`<h2>Titolo \u{1F600}</h2>${figure()}<p style="text-align:right"><b>B</b><i>I</i><u>U</u><s>S</s><sup>A</sup><sub>P</sub><a href="https://example.com">L</a><span style="font-size:16pt;font-family:Georgia;color:#123abc;background-color:#ffff00">C</span>N</p>`);
    expect(doc.resolved.dsl_spacers).toBe('Titolo \u{1F600}\nBIUSAPLCN\n');
    const body = doc.resolved.dsl_spacers.indexOf('B');
    expect(style(doc, 'paragraph', body - 1)).toMatchObject({ ps_hd: 2 });
    expect(style(doc, 'text', 0)).toMatchObject({ ts_fs: 16, ts_bd: true });
    for (const [offset, property] of [[0, 'ts_bd'], [1, 'ts_it'], [2, 'ts_un'], [3, 'ts_st']] as const) expect(style(doc, 'text', body + offset)?.[property]).toBe(true);
    expect(style(doc, 'text', body + 4)?.ts_va).toBe('sup');
    expect(style(doc, 'text', body + 5)?.ts_va).toBe('sub');
    expect(style(doc, 'link', body + 6)).toMatchObject({ lnks_link: { ulnk_url: 'https://example.com' } });
    expect(style(doc, 'text', body + 7)).toMatchObject({ ts_ff: 'Georgia', ts_fs: 16, ts_fgc2: { hclr_color: '#123abc' }, ts_bgc2: { hclr_color: '#ffff00' } });
    expect(style(doc, 'text', body + 8)?.ts_bd).toBe(false);
    expect(style(doc, 'paragraph', doc.resolved.dsl_spacers.length - 1)?.ps_al).toBe(2);
  });
  it('preserves nested lists, numbering starts, quotes and merged table cell dimensions', () => {
    const doc = model(`${figure()}<ul><li><p>A</p><ul><li><p>B</p></li></ul></li><li><p>C</p></li></ul><ol start="3"><li><p>D</p></li></ol><blockquote><p>Q</p></blockquote><table><tr><th colspan="2"><p>Header</p></th></tr><tr><td rowspan="2"><p>Cell</p></td><td><p>Other</p></td></tr></table>`);
    expect(doc.resolved.dsl_spacers).toContain('A\nB\nC\nD\nQ\n');
    expect(style(doc, 'list', doc.resolved.dsl_spacers.indexOf('B') + 1)).toMatchObject({ ls_nest: 1 });
    const lists = Object.values(doc.resolved.dsl_entitymap).filter(e => e.le_nb);
    expect(lists.some(e => e.le_nb!.nl_0.b_sn === 3 && e.le_nb!.nl_0.b_gt === 3)).toBe(true);
    expect(style(doc, 'paragraph', doc.resolved.dsl_spacers.indexOf('Q') + 1)).toMatchObject({ ps_il: 30, ps_ir: 30 });
    const table = doc.resolved.dsl_spacers.indexOf('\u0010');
    expect(style(doc, 'tbl', table)).toBeTruthy();
    expect(style(doc, 'cell', doc.resolved.dsl_spacers.indexOf('Header') - 1)).toMatchObject({ cell_cs: 2 });
    expect(style(doc, 'cell', doc.resolved.dsl_spacers.indexOf('Cell') - 1)).toMatchObject({ cell_rs: 2 });
    const cells = doc.resolved.dsl_styleslices.find(s => s.stsl_type === 'cell')!.stsl_styles.filter(Boolean);
    expect(cells.some(cell => cell?.cell_cs === 0 && cell?.cell_rs === 0)).toBe(true);
    expect(doc.formats['text/plain']).not.toContain('\u0010');
  });
  it.each([
    `${figure()}<span data-math="\\begin{pmatrix}a&amp;b\\end{pmatrix}">formula</span>`,
    `${figure()}<iframe src="https://example.com"></iframe>`,
    `${figure()}<figcaption>Didascalia</figcaption>`,
    figure().replace('</div>', '<figcaption>Didascalia a destra</figcaption></div>'),
    `${figure()}<img src="${jpeg}">`,
    figure('', 'data:image/jpeg;base64,broken'),
    figure('', 'https://example.com/image.jpg'),
  ])('does not replace unsupported content with a flattened native slice: %s', html => {
    expect(createNativeClipboardFormats(html)).toBeNull();
  });
  it('reads displayed remote image dimensions without an asynchronous clipboard write', () => {
    const root = document.createElement('div');
    root.innerHTML = '<img src="https://example.com/image.jpg">';
    Object.defineProperties(root.firstChild!, { naturalWidth: { value: 300 }, naturalHeight: { value: 200 } });
    expect(createNativeClipboardFormats(figure('', 'https://example.com/image.jpg'), root)).not.toBeNull();
  });
  it('keeps a caption editable inside a borderless floating table with an inline image', () => {
    const doc = model(figure().replace('data-align="right"', 'data-align="left"').replace('data-position="100"', 'data-position="0"').replace('</div>', '<figcaption>Figura 1: didascalia</figcaption></div>') + '<p>Testo</p>');
    const text = doc.resolved.dsl_spacers;
    expect(text).toBe('\u0010\u0012\u001c*\nFigura 1: didascalia\n\u0011Testo\n');
    expect(style(doc, 'tbl', 0)).toMatchObject({ tbls_bw: 0, tbls_pt: 1 });
    expect(Object.values(doc.resolved.dsl_entitymap)[0].pe_l).toBeUndefined();
    expect(style(doc, 'paragraph', text.indexOf('Figura') - 1)).toMatchObject({ ps_sa: 0, ps_sb: 0 });
    expect(style(doc, 'text', text.indexOf('Figura'))).toMatchObject({ ts_fs: 9 });
    const broken = model(figure().replace('data-layout="wrap"', 'data-layout="break"').replace('</div>', '<figcaption>Caption</figcaption></div>'));
    expect(style(broken, 'tbl', 0)).toMatchObject({ tbls_pt: 0, tbls_in: 0 });
  });
  it.each([-20, 0, 18, 120, 'invalid'])('exports a wrapping caption group vertical offset of %s in points', offsetY => {
    const doc = model(figure(`data-offset-y="${offsetY}" data-caption="Didascalia"`).replace('data-position="100"', 'data-position="0"'));
    expect(style(doc, 'tbl', 0)).toMatchObject({
      tbls_pt: 1,
      tbls_ftp: { ft_p: { p_vp: { vp_rt: 4, vp_t: 1, vp_to: typeof offsetY === 'number' ? offsetY * 0.75 : 0 } } },
    });
    expect(doc.resolved.dsl_spacers).toContain('Didascalia');
    expect(Object.values(doc.resolved.dsl_entitymap)[0].ee_eo).toMatchObject({ i_wth: 166.5, i_ht: 111 });
  });
  it('keeps inline caption tables independent of floating vertical coordinates', () => {
    const doc = model(figure('data-offset-y="18" data-caption="Didascalia"').replace('data-layout="wrap"', 'data-layout="inline"'));
    expect(style(doc, 'tbl', 0)).toMatchObject({ tbls_pt: 0, tbls_ftp: { ft_p: { p_vp: { vp_to: 0 } } } });
  });
  it.each(['table', 'caption'])('separates a preceding table from an adjacent %s in the native slice', kind => {
    const first = '<table><tr><td colwidth="210"><p><strong>Prima cella</strong></p></td></tr></table>';
    const next = kind === 'table' ? '<table><tr><td colwidth="390"><p>Seconda cella</p></td></tr></table>'
      : `<p>${figure('data-caption="Didascalia"').replace('data-position="100"', 'data-position="0"').replace('<div', '<span').replace('</div>', '</span>')}</p>`;
    const doc = model(first + next + '<p>Formula <span data-math="x^2">formula</span>.</p>');
    const text = doc.resolved.dsl_spacers;
    const boundary = text.indexOf('\u0011');
    expect(text.slice(boundary, boundary + 3)).toBe('\u0011\n\u0010');
    expect(style(doc, 'paragraph', boundary + 1)).toMatchObject({ ps_hd: 0, ps_ls: 1.15, ps_sb: 0, ps_sa: 0 });
    const tables = doc.resolved.dsl_styleslices.find(slice => slice.stsl_type === 'tbl')!.stsl_styles.filter(Boolean);
    expect(tables).toHaveLength(2);
    expect(tables[0]).toMatchObject({ tbls_cols: { cv: { opValue: [{ col_wv: 157.5 }] } } });
    expect(tables[1]).toMatchObject({ tbls_cols: { cv: { opValue: [{ col_wv: kind === 'table' ? 292.5 : 166.5 }] } } });
    expect(doc.resolved.dsl_styleslices.find(slice => slice.stsl_type === 'equation_function')!.stsl_styles.filter(Boolean)).toEqual([{ eqfs_c: '\\superscript' }]);
  });
  it('keeps inline and block equations native and resets math styles afterwards', () => {
    const doc = model('<p>Formula <span data-math="x^2">rendered HTML</span> fine.</p><div data-math-block="\\frac{a}{b}">rendered HTML</div>');
    const text = doc.resolved.dsl_spacers;
    expect(text).toBe('Formula \u001a\u0019x\u001d2\u001b\u001e fine.\n\u001a\u0019a\u001db\u001b\u001e\n');
    expect(style(doc, 'equation_function', 9)).toMatchObject({ eqfs_c: '\\superscript' });
    expect(style(doc, 'equation', text.indexOf(' fine.'))).toBeNull();
    expect(style(doc, 'paragraph', text.length - 1)).toMatchObject({ ps_al: 1 });
    expect(doc.formats['text/plain']).toContain('Formula x^2 fine.');
    expect(doc.formats['text/plain']).not.toContain('rendered HTML');
  });
  it('retains native function offsets and surrounding styles across inline and block operator limits', () => {
    const doc = model('<h2>Titolo</h2><p><span style="color:#123abc">Prima \u{1F600}</span> <span data-math="\\sin x+\\lim_{t\\to0}t">render</span> dopo</p><div data-math-block="\\lim_{t\\to0}t">render</div><ol start="4"><li><p>Quarta</p></li></ol>');
    const text = doc.resolved.dsl_spacers;
    const functions = doc.resolved.dsl_styleslices.find(slice => slice.stsl_type === 'equation_function')!.stsl_styles;
    expect(functions.filter(Boolean)).toEqual([{ eqfs_c: '\\sin' }, { eqfs_c: '\\lima' }, { eqfs_c: '\\lima' }]);
    functions.forEach((value, index) => { if (value) expect(['\u0019', '\u001f']).toContain(text[index]); });
    expect(style(doc, 'text', text.indexOf('Prima'))).toMatchObject({ ts_fgc2: { hclr_color: '#123abc' } });
    expect(style(doc, 'text', text.indexOf(' dopo'))).toMatchObject({ ts_fgc2: { hclr_color: '#000000' } });
    expect(style(doc, 'paragraph', text.indexOf(' dopo') + ' dopo'.length)).toMatchObject({ ps_ls: 1.15 });
    expect(Object.values(doc.resolved.dsl_entitymap).some(entity => entity.le_nb?.nl_0.b_sn === 4)).toBe(true);
    expect(doc.formats['text/html']).toContain('data-math="\\sin x+\\lim_{t\\to0}t"');
    expect(createNativeClipboardFormats(doc.formats['text/html'] + '<p><span data-math="\\begin{pmatrix}a&amp;b\\end{pmatrix}">matrix</span></p>')).toBeNull();
  });
  it('preserves resized table column widths and rendered wrap alignment', () => {
    const doc = model(`${figure().replace('data-position="100"', 'data-position="40"')}<table><colgroup><col style="width:200px"><col style="width:300px"></colgroup><tr><td colwidth="210"><p>A</p></td><td><p>B</p></td></tr></table>`);
    expect(Object.values(doc.resolved.dsl_entitymap)[0].pe_lo).toBeCloseTo(111.6);
    const table = style(doc, 'tbl', doc.resolved.dsl_spacers.indexOf('\u0010'))!;
    expect(table.tbls_cols).toMatchObject({ cv: { opValue: [{ col_wv: 157.5 }, { col_wv: 225 }] } });
  });
  it('reads PNG and GIF headers and rejects malformed headers', () => {
    const png = new Uint8Array(24);
    const view = new DataView(png.buffer);
    view.setUint32(16, 300); view.setUint32(20, 150);
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`;
    expect(clipboardImageSize(img)).toEqual({ width: 300, height: 150 });
    const gif = new Uint8Array(10);
    new DataView(gif.buffer).setUint16(6, 240, true); new DataView(gif.buffer).setUint16(8, 160, true);
    img.src = `data:image/gif;base64,${btoa(String.fromCharCode(...gif))}`;
    expect(clipboardImageSize(img)).toEqual({ width: 240, height: 160 });
    img.src = 'data:image/png;base64,broken';
    expect(clipboardImageSize(img)).toBeNull();
  });
  it('fills all formats synchronously during a trusted copy event', () => {
    const data = new Map<string, string>();
    const event = new Event('copy', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, text: string) => data.set(type, text) } });
    expect(setClipboardFormats(event as ClipboardEvent, model(figure()).formats)).toBe(true);
    expect(Array.from(data.keys())).toContain(NATIVE_SLICE_MIME);
    expect(event.defaultPrevented).toBe(true);
    expect(setClipboardFormats(new Event('copy') as ClipboardEvent, {})).toBe(false);
  });
  it('uses the same native formats for buttons and restores focus and selection', async () => {
    document.body.innerHTML = '<button id="focus">Copia</button><div id="selected">Testo selezionato</div>';
    const focused = document.querySelector<HTMLButtonElement>('#focus')!;
    focused.focus();
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#selected')!);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(document.getSelection()!.toString()).toBe('Testo selezionato');
    let types: string[] = [];
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => {
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string) => types.push(type) } });
      document.activeElement!.dispatchEvent(event);
      return true;
    }) });
    await writeEditorClipboard(figure(), 'Testo');
    expect(types).toContain(NATIVE_IMAGES_MIME);
    expect(document.activeElement).toBe(focused);
    expect(document.getSelection()!.toString()).toBe('Testo selezionato');
    expect(document.querySelector('textarea')).toBeNull();
    types = [];
    await writeEditorClipboard(figure(), 'Testo');
    expect(types.filter(type => type === NATIVE_IMAGES_MIME)).toHaveLength(1);
  });
  it('reports copy failure instead of claiming a successful formatted copy', async () => {
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    await expect(writeEditorClipboard(figure(), '')).rejects.toThrow('Impossibile copiare');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
