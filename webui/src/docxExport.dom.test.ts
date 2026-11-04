import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDITOR_CONTENT_WIDTH_PX } from './documentFormatting';
import { createDocx, docxFileName, downloadDocx, DOCX_MIME } from './docxExport';
import { latexToOmml } from './docxEquations';
import { readZip } from './web/zipArchive';

const jpegBytes = fs.readFileSync('e2e/fixtures/image-layout.jpg');
const jpeg = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;
const figure = (attributes: string) => `<div data-editor-image="true" data-width="35" ${attributes}><img src="${jpeg}" alt="Figura"></div>`;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const unpack = async (html: string, sourceRoot?: HTMLElement) => {
  const blob = createDocx(html, sourceRoot);
  const entries = await readZip(blob);
  const text = async (name: string) => (await (await entries.get(name)!.blob()).text());
  const parse = async (name: string) => {
    const doc = new DOMParser().parseFromString(await text(name), 'application/xml');
    expect(doc.querySelector('parsererror'), name).toBeNull();
    return doc;
  };
  return { blob, entries, text, parse };
};
const all = (doc: Document | Element, local: string, ns = W) => Array.from(doc.getElementsByTagNameNS(ns, local));
const attr = (el: Element | undefined, name: string) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('createDocx', () => {
  it('builds a valid Word package that embeds the image bytes unchanged', async () => {
    const { blob, entries, parse } = await unpack(`<p>Prima</p>${figure('data-layout="inline"')}<p>${figure('data-layout="inline"').replace('div', 'span').replace('</div>', '</span>')}</p>`);
    expect(blob.type).toBe(DOCX_MIME);
    expect([...entries.keys()].slice(0, 6)).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels']);
    // The same picture twice is stored once, byte-for-byte as the editor has it.
    const media = [...entries.keys()].filter(name => name.startsWith('word/media/'));
    expect(media).toEqual(['word/media/image1.jpeg']);
    expect(Buffer.from(await (await entries.get(media[0])!.blob()).arrayBuffer()).equals(jpegBytes)).toBe(true);
    const rels = await parse('word/_rels/document.xml.rels');
    expect(Array.from(rels.querySelectorAll('Relationship')).map(rel => rel.getAttribute('Target'))).toContain('media/image1.jpeg');
    await parse('word/styles.xml');
    await parse('[Content_Types].xml');
  });

  it('keeps headings, marks, links, lists and tables as Word structures', async () => {
    const { parse } = await unpack(
      '<h2>Capitolo</h2><p>Testo <strong>forte</strong> e <a href="https://example.com/x?a=1&amp;b=2">link</a></p>'
      + '<ol start="4"><li><p>Quarta</p><ul><li><p>Sotto</p></li></ul></li></ol>'
      + '<table><tbody><tr><td colspan="2"><p>Unita</p></td></tr><tr><td><p>A</p></td><td style="background-color:#ffeeaa"><p>B</p></td></tr></tbody></table>',
    );
    const doc = await parse('word/document.xml');
    const paragraphs = all(doc, 'p');
    expect(attr(all(paragraphs[0], 'pStyle')[0], 'val')).toBe('Heading2');
    expect(paragraphs[0].textContent).toBe('Capitolo');
    const bold = all(paragraphs[1], 'r').find(run => run.textContent === 'forte')!;
    expect(all(bold, 'b')).toHaveLength(1);
    const hyperlink = all(paragraphs[1], 'hyperlink')[0];
    expect(hyperlink.textContent).toBe('link');
    const rels = await parse('word/_rels/document.xml.rels');
    const linkRel = Array.from(rels.querySelectorAll('Relationship')).find(rel => rel.getAttribute('Id') === hyperlink.getAttribute('r:id'))!;
    expect(linkRel.getAttribute('Target')).toBe('https://example.com/x?a=1&b=2');
    expect(linkRel.getAttribute('TargetMode')).toBe('External');

    const item = paragraphs.find(p => p.textContent === 'Quarta')!;
    const nested = paragraphs.find(p => p.textContent === 'Sotto')!;
    expect(attr(all(item, 'ilvl')[0], 'val')).toBe('0');
    expect(attr(all(nested, 'ilvl')[0], 'val')).toBe('1');
    const numbering = await parse('word/numbering.xml');
    const orderedId = attr(all(item, 'numId')[0], 'val');
    const ordered = all(numbering, 'abstractNum').find(abstract => attr(abstract, 'abstractNumId') === orderedId)!;
    expect(attr(all(ordered, 'start')[0], 'val')).toBe('4');
    expect(attr(all(ordered, 'numFmt')[0], 'val')).toBe('decimal');
    expect(attr(all(numbering, 'abstractNum').find(abstract => abstract !== ordered)!.getElementsByTagNameNS(W, 'numFmt')[1], 'val')).toBe('bullet');

    const rows = all(all(doc, 'tbl')[0], 'tr');
    expect(attr(all(rows[0], 'gridSpan')[0], 'val')).toBe('2');
    expect(attr(all(all(rows[1], 'tc')[1], 'shd')[0], 'fill')).toBe('FFEEAA');
    expect(all(all(doc, 'tbl')[0], 'gridCol')).toHaveLength(2);
  });

  it('places a Wrap image as an anchored drawing beside the text, and a captioned one under its caption', async () => {
    const { parse } = await unpack(
      `<p>${figure('data-layout="wrap" data-align="right" data-position="100" data-offset-y="12"').replace(/div/g, 'span')}Testo accanto</p>`
      + `<p>${figure('data-layout="inline" data-caption="Didascalia"').replace(/div/g, 'span')}</p>`,
    );
    const doc = await parse('word/document.xml');
    const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
    const anchor = all(doc, 'anchor', WP)[0];
    const width = EDITOR_CONTENT_WIDTH_PX * 0.35;
    expect(Number(anchor.getElementsByTagNameNS(WP, 'extent')[0].getAttribute('cx'))).toBe(Math.round(width * 9525));
    expect(all(anchor, 'wrapSquare', WP)).toHaveLength(1);
    const [left, top] = all(anchor, 'posOffset', WP).map(el => Number(el.textContent));
    expect(left).toBe(Math.round((EDITOR_CONTENT_WIDTH_PX - width) * 9525));
    expect(top).toBe(12 * 9525);
    expect(all(anchor.closest('p')!, 't').map(t => t.textContent).join('')).toBe('Testo accanto');

    const figureTable = all(doc, 'tbl')[0];
    expect(all(figureTable, 'inline', WP)).toHaveLength(1);
    expect(figureTable.textContent).toBe('Didascalia');
    // Word needs a paragraph after a final table.
    expect(doc.getElementsByTagNameNS(W, 'body')[0].lastElementChild?.previousElementSibling?.localName).toBe('p');
  });

  it('writes formulas as editable equations and keeps LaTeX text for the rest', async () => {
    const { parse } = await unpack('<p>Area <span data-math="\\frac{a}{b^2}">f</span></p><div data-math-block="\\sqrt{x}">r</div><p><span data-math="\\boxed{x}">b</span></p>');
    const doc = await parse('word/document.xml');
    const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
    expect(all(doc, 'f', M)).toHaveLength(1);
    expect(all(all(doc, 'f', M)[0], 'sSup', M)).toHaveLength(1);
    expect(all(doc, 'oMathPara', M)).toHaveLength(1);
    expect(all(doc, 'rad', M)).toHaveLength(1);
    expect(all(doc, 'p').at(-1)?.textContent).toBe('$$\\boxed{x}$$');
  });

  it('marks an image it cannot embed instead of breaking the file', async () => {
    const { parse, entries } = await unpack(`<p>${figure('data-layout="inline"').replace(/div/g, 'span').replace(jpeg, 'https://example.com/remote.png')}</p>`);
    expect([...entries.keys()].some(name => name.startsWith('word/media/'))).toBe(false);
    expect((await parse('word/document.xml')).documentElement.textContent).toContain('[immagine non inclusa: Figura]');
  });
});

describe('latexToOmml', () => {
  it('converts matrices, accents and fences', () => {
    expect(latexToOmml('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', false)).toContain('<m:m>');
    expect(latexToOmml('\\hat{x}+\\overline{y}', false)).toMatch(/<m:acc>.*<m:bar>/);
    expect(latexToOmml('\\left(x\\right)', false)).toContain('<m:begChr m:val="("/>');
    expect(latexToOmml('\\frac{', false)).toBeNull();
  });
});

describe('docxFileName and downloadDocx', () => {
  it('turns the title into a safe file name', () => {
    expect(docxFileName('Lezione 3: cuore/polmoni?')).toBe('Lezione 3- cuore-polmoni-.docx');
    expect(docxFileName('   ')).toBe('Sbobina.docx');
  });

  it('starts the download synchronously with the sbobina title', () => {
    const urls: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => { urls.push('blob:docx'); return 'blob:docx'; }), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('Anatomia.docx');
      expect(this.href).toBe('blob:docx');
    });
    downloadDocx('<p>Testo</p>', 'Anatomia');
    expect(click).toHaveBeenCalledTimes(1);
    expect(urls).toEqual(['blob:docx']);
    vi.unstubAllGlobals();
  });
});
