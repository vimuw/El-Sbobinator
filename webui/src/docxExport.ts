import { prepareHtmlForClipboardSync } from './utils';
import { DOCUMENT_FORMATTING, DOCUMENT_PARAGRAPH_SELECTOR, EDITOR_CONTENT_WIDTH_PX, headingStyle, orderedListStyle, paragraphSpacing, pointSize } from './documentFormatting';
import { nativeLineSpacingReader } from './editorLineSpacing';
import { clipboardImageSize, displayedWrapOffsetY } from './editorClipboard';
import { normalizeImageAlignment, normalizeImageAspectRatio, normalizeImageLayout, normalizeImageOffsetY, normalizeImagePosition, normalizeImageWidth } from './imageLayout';
import { videoLink } from './editorLinks';
import { latexToOmml } from './docxEquations';
import { createZipSync } from './web/zipArchive';

// A Word file for devices whose clipboard cannot carry images into Google Docs
// (iPad, phones): images travel inside the file, Wrap as anchored drawings.
// Built from the same portable HTML as "Copia documento", synchronously, so the
// download can start inside the tap.

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
const TWIPS_PER_PX = 15;
const CONTENT_TWIPS = EDITOR_CONTENT_WIDTH_PX * TWIPS_PER_PX;
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DOCUMENT_NS = `${NS} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`;
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'DIV', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'HR', 'FIGURE', 'IFRAME', 'VIDEO']);

/** XML text; drops the control characters XML 1.0 cannot contain. */
const xml = (text: string) => text
  .replace(/[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hexColor = (value: string): string | null => {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return short.slice(1).map(c => c + c).join('').toUpperCase();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.slice(1).toUpperCase();
  const rgb = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) === 0)) return null;
  return rgb.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
};

type RunStyle = {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; heading?: boolean;
  color?: string; shade?: string; sizePt?: number; font?: string; vert?: 'superscript' | 'subscript';
};

const runStyle = (el: HTMLElement, inherited: RunStyle): RunStyle => {
  const result = { ...inherited };
  const tag = el.tagName.toLowerCase();
  if (['strong', 'b', 'th'].includes(tag)) result.bold = true;
  if (['em', 'i'].includes(tag)) result.italic = true;
  if (tag === 'u') result.underline = true;
  if (['s', 'del', 'strike'].includes(tag)) result.strike = true;
  if (tag === 'sup') result.vert = 'superscript';
  if (tag === 'sub') result.vert = 'subscript';
  if (['code', 'pre'].includes(tag)) result.font = 'Courier New';
  const heading = headingStyle(el);
  if (heading) {
    result.heading = true;
    result.bold = heading.fontWeight >= 600;
    result.sizePt = heading.fontSizePt;
  }
  const css = el.style;
  if (css.fontSize) result.sizePt = pointSize(css.fontSize, result.sizePt ?? DOCUMENT_FORMATTING.fontSizePt);
  if (css.fontFamily) result.font = css.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
  if (css.fontWeight) result.bold = css.fontWeight === 'bold' || Number(css.fontWeight) >= 600;
  if (css.fontStyle) result.italic = css.fontStyle === 'italic';
  if (css.textDecoration) {
    // Decorations add to an ancestor's, as in the native clipboard adapter.
    result.underline = Boolean(inherited.underline) || css.textDecoration.includes('underline');
    result.strike = Boolean(inherited.strike) || css.textDecoration.includes('line-through');
  }
  if (css.color && css.color !== 'inherit') result.color = hexColor(css.color) ?? result.color;
  if (css.backgroundColor) result.shade = hexColor(css.backgroundColor) ?? result.shade;
  if (tag === 'mark' && !css.backgroundColor) result.shade = 'FFFF00';
  if (tag === 'a' && !css.textDecoration) result.underline = true;
  return result;
};

const runProperties = (style: RunStyle): string => {
  let props = '';
  if (style.font && style.font !== DOCUMENT_FORMATTING.fontFamily) props += `<w:rFonts w:ascii="${xml(style.font)}" w:hAnsi="${xml(style.font)}" w:cs="${xml(style.font)}"/>`;
  if (style.bold) props += '<w:b/><w:bCs/>';
  else if (style.heading) props += '<w:b w:val="0"/><w:bCs w:val="0"/>';
  if (style.italic) props += '<w:i/><w:iCs/>';
  if (style.strike) props += '<w:strike/>';
  if (style.color) props += `<w:color w:val="${style.color}"/>`;
  if (style.sizePt) props += `<w:sz w:val="${Math.round(style.sizePt * 2)}"/><w:szCs w:val="${Math.round(style.sizePt * 2)}"/>`;
  if (style.underline) props += '<w:u w:val="single"/>';
  if (style.shade) props += `<w:shd w:val="clear" w:color="auto" w:fill="${style.shade}"/>`;
  if (style.vert) props += `<w:vertAlign w:val="${style.vert}"/>`;
  return props ? `<w:rPr>${props}</w:rPr>` : '';
};

const textRun = (text: string, style: RunStyle, preformatted = false): string => {
  if (!text) return '';
  const pieces = (preformatted ? text : text.replace(/\n/g, ' ')).split(/(\t|\n)/);
  const content = pieces.map(piece => piece === '\t' ? '<w:tab/>' : piece === '\n' ? '<w:br/>' : piece ? `<w:t xml:space="preserve">${xml(piece)}</w:t>` : '').join('');
  return `<w:r>${runProperties(style)}${content}</w:r>`;
};

type Block = { kind: 'p' | 'tbl'; xml: string };
type ListContext = { numId: number; depth: number; item?: { hasMarker: boolean } };
type Context = { quote: number; style: RunStyle; list?: ListContext; inCell: boolean };
type Media = { rid: string; path: string; width: number; height: number };

const decodeDataUrl = (src: string): { bytes: Uint8Array<ArrayBuffer>; extension: string } | null => {
  const match = /^data:image\/(png|jpeg|gif);base64,(.*)$/s.exec(src);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, extension: match[1] === 'jpeg' ? 'jpeg' : match[1] };
};

/** The editor's image as Word can embed it; other formats are redrawn from the displayed copy. */
const embeddableImage = (img: HTMLImageElement, sourceRoot?: HTMLElement) => {
  const src = img.getAttribute('src') ?? '';
  const direct = decodeDataUrl(src);
  if (direct) return { ...direct, size: clipboardImageSize(img, sourceRoot) };
  const displayed = Array.from(sourceRoot?.querySelectorAll('img') ?? []).find(candidate => candidate.getAttribute('src') === src);
  if (!displayed?.naturalWidth || !displayed.naturalHeight) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = displayed.naturalWidth;
    canvas.height = displayed.naturalHeight;
    canvas.getContext('2d')?.drawImage(displayed, 0, 0);
    // A remote image without CORS taints the canvas and throws here.
    const png = decodeDataUrl(canvas.toDataURL('image/png'));
    return png ? { ...png, size: { width: displayed.naturalWidth, height: displayed.naturalHeight } } : null;
  } catch {
    return null;
  }
};

/** A title as a file name every system accepts. */
export function docxFileName(title: string): string {
  const safe = Array.from(title, ch => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '-' : ch)).join('');
  return `${safe.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sbobina'}.docx`;
}

/**
 * Converts editor HTML into a .docx Blob. `sourceRoot` is the live editor, used
 * for image sizes and the displayed position of Wrap images.
 */
export function createDocx(editorHtml: string, sourceRoot?: HTMLElement): Blob {
  const body = new DOMParser().parseFromString(prepareHtmlForClipboardSync(editorHtml, sourceRoot), 'text/html').body;
  const spacing = paragraphSpacing(body);
  const lineSpacing = nativeLineSpacingReader();
  const displayedFigures = Array.from(sourceRoot?.querySelectorAll<HTMLElement>('.editor-image-node') ?? []);
  let figureIndex = 0;
  const files: Array<{ name: string; data: Uint8Array<ArrayBuffer> }> = [];
  const relationships: string[] = [
    `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>`,
  ];
  const media = new Map<string, Media | null>();
  const links = new Map<string, string>();
  const abstractNums: string[] = [];
  let drawingId = 0;

  const relationship = (type: string, target: string, external = false) => {
    const rid = `rId${relationships.length + 1}`;
    relationships.push(`<Relationship Id="${rid}" Type="${REL}/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
    return rid;
  };

  const linkId = (href: string) => {
    if (!links.has(href)) links.set(href, relationship('hyperlink', href, true));
    return links.get(href)!;
  };

  const mediaFor = (img: HTMLImageElement): Media | null => {
    const src = img.getAttribute('src') ?? '';
    if (!media.has(src)) {
      const image = embeddableImage(img, sourceRoot);
      if (!image) media.set(src, null);
      else {
        const path = `media/image${files.length + 1}.${image.extension}`;
        files.push({ name: `word/${path}`, data: image.bytes });
        const size = image.size ?? { width: 4, height: 3 };
        media.set(src, { rid: relationship('image', path), path, width: size.width, height: size.height });
      }
    }
    return media.get(src) ?? null;
  };

  const graphic = (item: Media, cx: number, cy: number, id: number, alt: string) =>
    `<wp:docPr id="${id}" name="Immagine ${id}" descr="${xml(alt)}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${xml(item.path.slice(6))}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${item.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic>';

  const inlineDrawing = (item: Media, widthPx: number, heightPx: number, alt: string) => {
    const cx = Math.round(widthPx * EMU_PER_PX);
    const cy = Math.round(heightPx * EMU_PER_PX);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${graphic(item, cx, cy, ++drawingId, alt)}</wp:inline></w:drawing></w:r>`;
  };

  const anchoredDrawing = (item: Media, widthPx: number, heightPx: number, leftPx: number, topPx: number, alt: string) => {
    const cx = Math.round(widthPx * EMU_PER_PX);
    const cy = Math.round(heightPx * EMU_PER_PX);
    const id = ++drawingId;
    // Same text gap around a Wrap image as the native Docs clipboard.
    return `<w:r><w:drawing><wp:anchor distT="${3 * EMU_PER_PT}" distB="${12 * EMU_PER_PT}" distL="${12 * EMU_PER_PT}" distR="${12 * EMU_PER_PT}" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
      + '<wp:simplePos x="0" y="0"/>'
      + `<wp:positionH relativeFrom="column"><wp:posOffset>${Math.round(leftPx * EMU_PER_PX)}</wp:posOffset></wp:positionH>`
      + `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round(topPx * EMU_PER_PX)}</wp:posOffset></wp:positionV>`
      + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>${graphic(item, cx, cy, id, alt)}</wp:anchor></w:drawing></w:r>`;
  };

  const paragraph = (properties: string, content: string) => `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${content}</w:p>`;

  const paragraphProperties = (el: HTMLElement | null, ctx: Context, extra: { align?: string } = {}) => {
    let props = '';
    const level = el ? /^H([1-6])$/.exec(el.tagName)?.[1] : undefined;
    if (level) props += `<w:pStyle w:val="Heading${level}"/>`;
    const list = ctx.list;
    if (list && !list.item?.hasMarker) props += `<w:numPr><w:ilvl w:val="${list.depth}"/><w:numId w:val="${list.numId}"/></w:numPr>`;
    const gap = el ? spacing.get(el) : undefined;
    const measured = el && (el.matches(DOCUMENT_PARAGRAPH_SELECTOR) || el.matches('li,td,th')) ? lineSpacing(el) : null;
    if (gap || measured) {
      props += `<w:spacing w:before="${Math.round((gap?.beforePt ?? 0) * 20)}" w:after="${Math.round((gap?.afterPt ?? 0) * 20)}"${measured ? ` w:line="${Math.round(measured * 240)}" w:lineRule="auto"` : ''}/>`;
    }
    const marginPt = el ? pointSize(el.style.marginLeft, 0) : 0;
    const quotePt = ctx.quote * 30;
    if (list) {
      const left = (36 + list.depth * 36 + marginPt + quotePt) * 20;
      props += `<w:ind w:left="${left}"${list.item?.hasMarker ? '' : ' w:hanging="360"'}${quotePt ? ` w:right="${quotePt * 20}"` : ''}/>`;
      if (list.item) list.item.hasMarker = true;
    } else if (marginPt || quotePt) props += `<w:ind w:left="${Math.round((marginPt + quotePt) * 20)}"${quotePt ? ` w:right="${quotePt * 20}"` : ''}/>`;
    const align = extra.align ?? ({ left: 'left', center: 'center', right: 'right', justify: 'both' } as Record<string, string>)[el?.style.textAlign ?? ''];
    if (align) props += `<w:jc w:val="${align}"/>`;
    return props;
  };

  // A captioned figure is a borderless one-cell table of the image's width, as
  // in the native clipboard: Docs keeps its caption under the image.
  const captionedFigure = (item: Media, widthPx: number, heightPx: number, alt: string, caption: string, position: number) => {
    const width = Math.round(widthPx * TWIPS_PER_PX);
    const align = position >= 67 ? 'right' : position > 33 ? 'center' : 'left';
    const captionStyle: RunStyle = { sizePt: DOCUMENT_FORMATTING.caption.fontSizePt, color: '374151' };
    const captionLine = Math.round(DOCUMENT_FORMATTING.caption.lineHeight / DOCUMENT_FORMATTING.lineHeight * DOCUMENT_FORMATTING.nativeLineHeight * 240);
    return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:jc w:val="${align}"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>`
      + `<w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>`
      + paragraph('<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>', inlineDrawing(item, widthPx, heightPx, alt))
      + paragraph(`<w:spacing w:before="${DOCUMENT_FORMATTING.caption.beforePt * 20}" w:after="0" w:line="${captionLine}" w:lineRule="auto"/><w:jc w:val="center"/>`, textRun(caption, captionStyle))
      + '</w:tc></w:tr></w:tbl>';
  };

  const image = (img: HTMLImageElement, container: HTMLElement | null, ctx: Context, after: Block[]): string => {
    const displayed = container ? displayedFigures[figureIndex++] : undefined;
    const item = mediaFor(img);
    const alt = img.getAttribute('alt') ?? '';
    if (!item) return textRun(`[immagine non inclusa${alt ? `: ${alt}` : ''}]`, { ...ctx.style, italic: true });
    if (!container) {
      // A foreign image keeps its own size, within the text column.
      const widthPx = Math.min(EDITOR_CONTENT_WIDTH_PX, item.width);
      return inlineDrawing(item, widthPx, widthPx * item.height / item.width, alt);
    }
    const widthPx = EDITOR_CONTENT_WIDTH_PX * normalizeImageWidth(container.getAttribute('data-width') ?? 56) / 100;
    const heightPx = widthPx / (normalizeImageAspectRatio(container.getAttribute('data-aspect-ratio')) ?? item.width / item.height);
    const align = normalizeImageAlignment(container.getAttribute('data-align'));
    const position = normalizeImagePosition(container.getAttribute('data-position'), align);
    const caption = container.querySelector('figcaption, .editor-image-caption')?.textContent ?? container.getAttribute('data-caption') ?? '';
    if (caption) {
      after.push({ kind: 'tbl', xml: captionedFigure(item, widthPx, heightPx, alt, caption, position) });
      return '';
    }
    if (normalizeImageLayout(container.getAttribute('data-layout')) !== 'wrap' || ctx.inCell) return inlineDrawing(item, widthPx, heightPx, alt);
    const offsetX = normalizeImageOffsetY(container.getAttribute('data-offset-x'));
    const offsetY = displayedWrapOffsetY(img, normalizeImageOffsetY(container.getAttribute('data-offset-y')), displayed, sourceRoot);
    return anchoredDrawing(item, widthPx, heightPx, (EDITOR_CONTENT_WIDTH_PX - widthPx) * position / 100 + offsetX, offsetY, alt);
  };

  const equation = (el: HTMLElement, style: RunStyle, display: boolean): string => {
    const latex = el.getAttribute('data-math') ?? el.getAttribute('data-math-block') ?? '';
    const omml = latexToOmml(latex, display);
    if (!omml) return textRun(`$$${latex}$$`, style);
    return display ? `<m:oMathPara>${omml}</m:oMathPara>` : omml;
  };

  const inline = (node: Node, style: RunStyle, ctx: Context, after: Block[], link: string | null, preformatted: boolean): string => {
    if (node.nodeType === Node.TEXT_NODE) return textRun(node.textContent ?? '', style, preformatted);
    if (!(node instanceof HTMLElement)) return '';
    const tag = node.tagName.toLowerCase();
    if (['script', 'style'].includes(tag)) return '';
    if (node.hasAttribute('data-math')) return equation(node, runStyle(node, style), false);
    if (node.hasAttribute('data-editor-image')) {
      const img = node.querySelector('img');
      return img ? image(img, node, ctx, after) : '';
    }
    if (tag === 'img') return image(node as HTMLImageElement, null, ctx, after);
    if (tag === 'br') return '<w:r><w:br/></w:r>';
    if (tag === 'iframe' || tag === 'video') {
      const url = videoLink(node.getAttribute('src') ?? node.querySelector('source')?.getAttribute('src') ?? '', tag === 'video');
      return url ? `<w:hyperlink r:id="${linkId(url)}" w:history="1">${textRun(url, { ...style, underline: true, color: '1155CC' })}</w:hyperlink>` : '';
    }
    const current = runStyle(node, style);
    const href = tag === 'a' ? node.getAttribute('href') ?? '' : '';
    const content = Array.from(node.childNodes).map(child => inline(child, current, ctx, after, link || (href ? href : null), preformatted)).join('');
    // Word allows no nested hyperlinks; only web and mail addresses become links.
    if (href && !link && /^(https?:|mailto:)/i.test(href)) return `<w:hyperlink r:id="${linkId(href)}" w:history="1">${content}</w:hyperlink>`;
    return content;
  };

  const paragraphBlocks = (el: HTMLElement | null, nodes: Node[], ctx: Context, extra: { align?: string } = {}): Block[] => {
    const after: Block[] = [];
    const preformatted = Boolean(el?.closest('pre'));
    const style = el ? runStyle(el, ctx.style) : ctx.style;
    const content = nodes.map(node => inline(node, style, { ...ctx, style }, after, null, preformatted)).join('');
    // A paragraph that held only captioned figures is replaced by them.
    if (!content && after.length) return after;
    return [{ kind: 'p', xml: paragraph(paragraphProperties(el, ctx, extra), content) }, ...after];
  };

  const isBlock = (node: Node): node is HTMLElement => node instanceof HTMLElement && (BLOCK_TAGS.has(node.tagName) || node.hasAttribute('data-math-block'));
  const meaningful = (node: Node) => node instanceof HTMLElement || Boolean(node.textContent?.trim());

  const blocks = (nodes: Node[], parent: HTMLElement | null, ctx: Context, out: Block[]) => {
    let pending: Node[] = [];
    const flush = () => {
      if (pending.some(meaningful)) out.push(...paragraphBlocks(parent, pending, ctx));
      pending = [];
    };
    for (const node of nodes) {
      if (isBlock(node)) { flush(); block(node, ctx, out); }
      else pending.push(node);
    }
    flush();
  };

  const listNumbering = (list: HTMLElement, depth: number): number => {
    const numId = abstractNums.length + 1;
    const ordered = list.tagName === 'OL';
    const format = ({ decimal: 'decimal', 'upper-alpha': 'upperLetter', 'lower-alpha': 'lowerLetter', 'upper-roman': 'upperRoman', 'lower-roman': 'lowerRoman' } as Record<string, string>)[orderedListStyle(list)] ?? 'decimal';
    // The hidden first item still occupies a number in saved HTML.
    const firstItem = list.firstElementChild as HTMLElement | null;
    const start = Number(list.getAttribute('start') ?? 1) + (firstItem?.style.listStyleType === 'none' ? 1 : 0);
    const levels = Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="${level === depth ? start : 1}"/>`
      + (ordered ? `<w:numFmt w:val="${format}"/><w:lvlText w:val="%${level + 1}."/>` : `<w:numFmt w:val="bullet"/><w:lvlText w:val="${['●', '○', '■'][level % 3]}"/>`)
      + `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${(36 + level * 36) * 20}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
    abstractNums.push(`<w:abstractNum w:abstractNumId="${numId}"><w:multiLevelType w:val="multilevel"/>${levels}</w:abstractNum>`);
    return numId;
  };

  const table = (node: HTMLTableElement, ctx: Context): string => {
    const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node);
    // Every grid slot, including those covered by a rowspan/colspan, as in the native adapter.
    const grid: Array<Array<HTMLTableCellElement | null | undefined>> = rows.map(() => []);
    const owner = new Map<string, { cell: HTMLTableCellElement; row: number; column: number }>();
    rows.forEach((row, rowIndex) => {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        while (grid[rowIndex][column] !== undefined) column++;
        grid[rowIndex][column] = cell;
        for (let r = rowIndex; r < Math.min(rows.length, rowIndex + cell.rowSpan); r++) {
          for (let c = column; c < column + cell.colSpan; c++) {
            if (r !== rowIndex || c !== column) {
              grid[r][c] = null;
              owner.set(`${r}:${c}`, { cell, row: rowIndex, column });
            }
          }
        }
        column += cell.colSpan;
      }
    });
    const columns = Math.max(1, ...grid.map(row => row.length));
    const widths: Array<number | null> = Array.from({ length: columns }, () => null);
    Array.from(node.querySelectorAll('col')).filter(col => col.closest('table') === node).forEach((col, column) => {
      const width = Number.parseFloat((col as HTMLElement).style.width);
      if (column < columns && Number.isFinite(width) && width > 0) widths[column] = width * TWIPS_PER_PX;
    });
    for (const row of grid) {
      row.forEach((cell, column) => {
        if (!cell) return;
        (cell.getAttribute('colwidth') ?? '').split(',').map(Number).forEach((width, offset) => {
          if (column + offset < columns && width > 0) widths[column + offset] = width * TWIPS_PER_PX;
        });
      });
    }
    const fixed = widths.reduce<number>((sum, width) => sum + (width ?? 0), 0);
    const flexible = widths.filter(width => width === null).length;
    const columnWidths = widths.map(width => Math.round(width ?? Math.max(0, CONTENT_TWIPS - fixed) / flexible));
    const span = (column: number, count: number) => columnWidths.slice(column, column + count).reduce((sum, width) => sum + width, 0);
    const border = '<w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="6" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="6" w:space="0" w:color="000000"/>';
    const vertical = DOCUMENT_FORMATTING.table.paddingVerticalPt * 20;
    const horizontal = DOCUMENT_FORMATTING.table.paddingHorizontalPt * 20;
    let result = `<w:tbl><w:tblPr><w:tblW w:w="${span(0, columns)}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/>`
      + `<w:tblCellMar><w:top w:w="${vertical}" w:type="dxa"/><w:left w:w="${horizontal}" w:type="dxa"/><w:bottom w:w="${vertical}" w:type="dxa"/><w:right w:w="${horizontal}" w:type="dxa"/></w:tblCellMar></w:tblPr>`
      + `<w:tblGrid>${columnWidths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;
    grid.forEach((row, rowIndex) => {
      result += '<w:tr>';
      for (let column = 0; column < columns; column++) {
        const cell = row[column];
        if (cell === null) {
          const covering = owner.get(`${rowIndex}:${column}`)!;
          // A rowspan continues in its first column; colspan slots belong to the cell on their left.
          if (covering.row === rowIndex || covering.column !== column) continue;
          const spanned = covering.cell.colSpan;
          result += `<w:tc><w:tcPr><w:tcW w:w="${span(column, spanned)}" w:type="dxa"/>${spanned > 1 ? `<w:gridSpan w:val="${spanned}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`;
          continue;
        }
        if (!cell) {
          result += `<w:tc><w:tcPr><w:tcW w:w="${columnWidths[column]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
          continue;
        }
        const shade = cell.style.backgroundColor ? hexColor(cell.style.backgroundColor) : null;
        const content: Block[] = [];
        blocks(Array.from(cell.childNodes), cell, { quote: 0, style: runStyle(cell, ctx.style), inCell: true }, content);
        result += `<w:tc><w:tcPr><w:tcW w:w="${span(column, cell.colSpan)}" w:type="dxa"/>${cell.colSpan > 1 ? `<w:gridSpan w:val="${cell.colSpan}"/>` : ''}${cell.rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : ''}`
          + `${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:tcPr>${joinBlocks(content)}</w:tc>`;
      }
      result += '</w:tr>';
    });
    return `${result}</w:tbl>`;
  };

  const block = (node: HTMLElement, ctx: Context, out: Block[]) => {
    const tag = node.tagName;
    if (node.hasAttribute('data-math-block')) {
      out.push({ kind: 'p', xml: paragraph(paragraphProperties(node, ctx, { align: 'center' }), equation(node, runStyle(node, ctx.style), true)) });
      return;
    }
    if (/^(P|H[1-6]|PRE)$/.test(tag)) { out.push(...paragraphBlocks(node, Array.from(node.childNodes), ctx)); return; }
    if (tag === 'TABLE') { out.push({ kind: 'tbl', xml: table(node as HTMLTableElement, ctx) }); return; }
    if (tag === 'HR') { out.push({ kind: 'p', xml: paragraph('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>', '') }); return; }
    if (tag === 'IFRAME' || tag === 'VIDEO') { out.push(...paragraphBlocks(null, [node], ctx)); return; }
    const style = runStyle(node, ctx.style);
    if (tag === 'BLOCKQUOTE') { blocks(Array.from(node.childNodes), null, { ...ctx, style, quote: ctx.quote + 1 }, out); return; }
    if (tag === 'UL' || tag === 'OL') {
      const depth = ctx.list ? ctx.list.depth + 1 : 0;
      const numId = listNumbering(node, depth);
      for (const child of Array.from(node.children)) {
        if (child instanceof HTMLElement) block(child, { ...ctx, style, list: { numId, depth } }, out);
      }
      return;
    }
    if (tag === 'LI' && ctx.list) {
      // Each item owns one marker; later paragraphs of the item continue without one.
      const list = { ...ctx.list, item: { hasMarker: node.style.listStyleType === 'none' } };
      blocks(Array.from(node.childNodes), node, { ...ctx, style, list }, out);
      return;
    }
    blocks(Array.from(node.childNodes), null, { ...ctx, style }, out);
  };

  // Word needs a paragraph between two tables and after the last one in a cell or document.
  const joinBlocks = (items: Block[]) => {
    let result = '';
    items.forEach((item, index) => {
      result += item.xml;
      if (item.kind === 'tbl' && (index === items.length - 1 || items[index + 1].kind === 'tbl')) result += '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>';
    });
    return result || '<w:p/>';
  };

  const content: Block[] = [];
  blocks(Array.from(body.childNodes), null, { quote: 0, style: {}, inCell: false }, content);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${DOCUMENT_NS}><w:body>${joinBlocks(content)}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';

  const headingStyles = DOCUMENT_FORMATTING.headings.map((heading, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:spacing w:before="${Math.round(heading.beforePt * 20)}" w:after="${Math.round(heading.afterPt * 20)}"/><w:outlineLvl w:val="${index}"/></w:pPr>`
    + `<w:rPr>${heading.fontWeight >= 600 ? '<w:b/><w:bCs/>' : ''}<w:color w:val="${hexColor(heading.color) ?? '000000'}"/><w:sz w:val="${heading.fontSizePt * 2}"/><w:szCs w:val="${heading.fontSizePt * 2}"/></w:rPr></w:style>`).join('');
  const font = xml(DOCUMENT_FORMATTING.fontFamily);
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>`
    + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="${DOCUMENT_FORMATTING.fontSizePt * 2}"/><w:szCs w:val="${DOCUMENT_FORMATTING.fontSizePt * 2}"/><w:lang w:val="it-IT"/></w:rPr></w:rPrDefault>`
    + `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${Math.round(DOCUMENT_FORMATTING.nativeLineHeight * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + headingStyles
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '</w:styles>';
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>${abstractNums.join('')}${abstractNums.map((_, index) => `<w:num w:numId="${index + 1}"><w:abstractNumId w:val="${index + 1}"/></w:num>`).join('')}</w:numbering>`;
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>';
  const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`;

  const encoder = new TextEncoder();
  const text = (name: string, value: string) => ({ name, data: encoder.encode(value) as Uint8Array<ArrayBuffer> });
  return createZipSync([
    text('[Content_Types].xml', contentTypes),
    text('_rels/.rels', packageRels),
    text('word/document.xml', documentXml),
    text('word/styles.xml', styles),
    text('word/numbering.xml', numbering),
    text('word/_rels/document.xml.rels', documentRels),
    ...files,
  ], DOCX_MIME);
}

/** Starts the download inside the current tap; Safari refuses one started later. */
export function downloadDocx(editorHtml: string, title: string, sourceRoot?: HTMLElement): void {
  const url = URL.createObjectURL(createDocx(editorHtml, sourceRoot));
  const link = document.createElement('a');
  link.href = url;
  link.download = docxFileName(title);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // iOS hands the file to its download sheet asynchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
