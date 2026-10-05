import { normalizeImageAspectRatio, normalizeImageAlignment, normalizeImageLayout, normalizeImagePosition, normalizeImageOffsetY } from './imageLayout';
import { clipboardPlainText, DOCUMENT_FORMATTING, EDITOR_CONTENT_WIDTH_PX, formatPortableHtml, headingStyle, orderedListStyle, paragraphSpacing, pointSize } from './documentFormatting';
import { createClipboardEquation, type ClipboardEquation } from './clipboardEquations';

// Docs ignores CSS floats on HTML paste. Its native clipboard slice carries the
// positioned entities. Keep this adapter separate from saved editor HTML.
export const NATIVE_SLICE_MIME = 'application/x-vnd.google-docs-document-slice-clip+wrapped';
export const NATIVE_IMAGES_MIME = 'application/x-vnd.google-docs-image-clip+wrapped';
type Style = Record<string, unknown>;
type ImageSize = { width: number; height: number };
export type ClipboardFormats = Record<string, string>;
const color = (value: string | null) => ({ clr_type: 0, hclr_color: value });
const baseText = (): Style => ({
  ts_bd: false, ts_fs: DOCUMENT_FORMATTING.fontSizePt, ts_ff: DOCUMENT_FORMATTING.fontFamily, ts_it: false, ts_sc: false,
  ts_st: false, ts_tw: 400, ts_un: false, ts_va: 'nor',
  ts_bgc2: color(null), ts_fgc2: color('#000000'),
});
// Native line spacing is a multiple of the font's normal line, whereas CSS
// unitless line-height is a multiple of font-size. Convert between those units;
// paragraph margins remain a separate, collapsed semantic gap.
const baseParagraph = (): Style => ({
  ps_al: 0, ps_awao: true, ps_hd: 0, ps_hdid: '', ps_ifl: 0, ps_il: 0,
  ps_ir: 0, ps_klt: false, ps_kwn: false, ps_ltr: true, ps_ls: DOCUMENT_FORMATTING.nativeLineHeight,
  ps_lslm: 1, ps_pbb: false, ps_sm: 0, ps_sa: 0, ps_sb: 0,
});
const normalizeColor = (value: string): string => {
  const rgb = value.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
  return rgb ? `#${rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : value;
};

// Ctrl+C must finish during the copy event. Read already displayed images or
// their PNG/JPEG/GIF headers; never launch an asynchronous clipboard overwrite.
export const clipboardImageSize = (img: HTMLImageElement, sourceRoot?: HTMLElement): ImageSize | null => {
  const displayed = Array.from(sourceRoot?.querySelectorAll('img') ?? [])
    .find(candidate => candidate.getAttribute('src') === img.getAttribute('src'));
  if (displayed?.naturalWidth && displayed.naturalHeight) {
    return { width: displayed.naturalWidth, height: displayed.naturalHeight };
  }
  const src = img.getAttribute('src') ?? '';
  try {
    const bytes = Uint8Array.from(atob(src.split(',')[1] ?? ''), c => c.charCodeAt(0));
    const data = new DataView(bytes.buffer);
    if (src.startsWith('data:image/png') && bytes.length >= 24) return { width: data.getUint32(16), height: data.getUint32(20) };
    if (src.startsWith('data:image/gif') && bytes.length >= 10) return { width: data.getUint16(6, true), height: data.getUint16(8, true) };
    if (src.startsWith('data:image/jpeg')) {
      for (let i = 2; i + 8 < bytes.length;) {
        if (bytes[i] !== 0xff) break;
        const marker = bytes[i + 1];
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return { width: data.getUint16(i + 7), height: data.getUint16(i + 5) };
        }
        i += 2 + data.getUint16(i + 2);
      }
    }
  } catch { /* Malformed or remote source: leave the browser's HTML copy intact. */ }
  return null;
};

/** Return null for content we cannot represent faithfully in the native format. */
export function createNativeClipboardFormats(html: string, sourceRoot?: HTMLElement, inlineSelection = false): ClipboardFormats | null {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  if (body.querySelector('iframe, video, figcaption:not([data-editor-image] figcaption)')) return null;
  for (const figure of body.querySelectorAll<HTMLElement>('[data-editor-image]')) {
    const caption = figure.querySelector('figcaption, .editor-image-caption')?.textContent ?? figure.getAttribute('data-caption');
    // Docs resets floating-table X coordinates even on its own native paste.
    // A caption groups with its image in a table, so wrapping at a nonzero X cannot use
    // this adapter without moving the figure.
    if (caption && normalizeImageLayout(figure.getAttribute('data-layout')) === 'wrap' && normalizeImagePosition(figure.getAttribute('data-position'), normalizeImageAlignment(figure.getAttribute('data-align'))) > 0) return null;
  }
  const equations = new Map<HTMLElement, ClipboardEquation>();
  for (const element of body.querySelectorAll<HTMLElement>('[data-math], [data-math-block]')) {
    const equation = createClipboardEquation(element.getAttribute('data-math') ?? element.getAttribute('data-math-block') ?? '', element.hasAttribute('data-math-block'));
    if (!equation) return null;
    equations.set(element, equation);
  }
  const sizes = new Map<HTMLImageElement, ImageSize>();
  for (const img of body.querySelectorAll('img')) {
    if (!img.closest('[data-editor-image]')) return null;
    const size = clipboardImageSize(img, sourceRoot);
    if (!size?.width || !size.height) return null;
    sizes.set(img, size);
  }
  formatPortableHtml(body);
  const spacing = paragraphSpacing(body);
  const normalLines = new Map<string, number>();
  const lineSpacing = (element: HTMLElement): number => {
    const profileSpacing = Number(element.getAttribute('data-document-line-spacing'));
    if (profileSpacing > 0 && profileSpacing <= 10) return profileSpacing;
    const fontPt = pointSize(element.style.fontSize, DOCUMENT_FORMATTING.fontSizePt);
    const leading = element.style.lineHeight || String(DOCUMENT_FORMATTING.lineHeight);
    if (leading === 'normal') return 1;
    const unitless = /^\d*\.?\d+$/.test(leading);
    const desiredPt = unitless ? Number(leading) * fontPt : pointSize(leading, fontPt, fontPt);
    const key = `${element.style.fontFamily}:${element.style.fontWeight}`;
    let normalEm = normalLines.get(key);
    if (normalEm === undefined) {
      const probe = document.createElement('div');
      probe.textContent = 'M';
      probe.style.cssText = 'all:initial;position:fixed;left:-10000px;top:0;display:block;width:max-content;height:auto;padding:0;border:0;margin:0;line-height:normal;visibility:hidden;';
      probe.style.fontFamily = element.style.fontFamily || DOCUMENT_FORMATTING.fontFamily;
      // Measure at a large em size: at 11pt the browser rounds the normal line
      // to whole pixels, which would amplify rounding into native line spacing.
      const measurementFontPt = 1000;
      probe.style.fontSize = `${measurementFontPt}pt`;
      probe.style.fontWeight = element.style.fontWeight || '400';
      document.body.appendChild(probe);
      normalEm = probe.getBoundingClientRect().height * 0.75 / measurementFontPt;
      probe.remove();
      normalLines.set(key, normalEm);
    }
    // DOM-only environments have no font layout. Preserve the requested ratio
    // there; the browser path measures the actual font rather than fixing 1.
    return normalEm > 0 ? desiredPt / (normalEm * fontPt) : desiredPt / fontPt;
  };

  let spacers = '';
  let serial = 0;
  const styles = new Map<string, Array<Style | null>>();
  const entities: Record<string, Style> = {};
  const entityTypes: Record<string, string> = {};
  const positioned: Array<string[] | null> = [];
  const inline: Array<string[] | null> = [];
  const imageUrls: Record<string, string> = {};
  const id = () => `kix.sbobinator${++serial}`;
  const setStyle = (type: string, at: number, style: Style) => {
    if (!styles.has(type)) styles.set(type, []);
    styles.get(type)![at] = style;
  };
  const append = (text: string, style: Style, link: string | null = null) => {
    if (!text) return;
    setStyle('text', spacers.length, style);
    setStyle('link', spacers.length, { lnks_link: link ? { lnk_type: 0, ulnk_url: link } : null });
    spacers += text;
  };
  const separateAdjacentTables = () => {
    // Docs requires a paragraph between tables, including the borderless table
    // that groups an image with its caption. Adjacent table markers render in
    // the client but their save is rejected by the service.
    if (!spacers.endsWith('\u0011')) return;
    append('\n', baseText());
    setStyle('paragraph', spacers.length - 1, baseParagraph());
  };
  const textStyle = (el: HTMLElement, inherited: Style): Style => {
    const result = { ...inherited };
    const tag = el.tagName.toLowerCase();
    if (['strong', 'b', 'th'].includes(tag)) result.ts_bd = true;
    if (['em', 'i'].includes(tag)) result.ts_it = true;
    if (tag === 'u') result.ts_un = true;
    if (['s', 'del', 'strike'].includes(tag)) result.ts_st = true;
    if (['sup', 'sub'].includes(tag)) result.ts_va = tag;
    if (['code', 'pre'].includes(tag)) result.ts_ff = 'Courier New';
    const heading = /^H([1-6])$/.exec(el.tagName);
    if (heading) {
      result.ts_bd = headingStyle(el)!.fontWeight >= 600;
      result.ts_fs = headingStyle(el)!.fontSizePt;
    }
    const css = el.style;
    if (css.fontSize) result.ts_fs = pointSize(css.fontSize, Number(result.ts_fs));
    if (css.fontFamily) result.ts_ff = css.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    if (css.fontWeight) result.ts_bd = css.fontWeight === 'bold' || Number(css.fontWeight) >= 600;
    if (css.fontStyle) result.ts_it = css.fontStyle === 'italic';
    if (css.textDecoration) {
      // Descendant decorations add to those painted by an ancestor. A nested
      // underline (or a link with none) cannot erase an ancestor's strike.
      result.ts_un = Boolean(inherited.ts_un) || css.textDecoration.includes('underline');
      result.ts_st = Boolean(inherited.ts_st) || css.textDecoration.includes('line-through');
    }
    if (css.color && css.color !== 'inherit') result.ts_fgc2 = color(normalizeColor(css.color));
    if (css.backgroundColor) result.ts_bgc2 = color(normalizeColor(css.backgroundColor));
    if (tag === 'mark' && !css.backgroundColor) result.ts_bgc2 = color('#ffff00');
    if (tag === 'a' && !css.textDecoration) result.ts_un = true;
    return result;
  };
  const paragraphStyle = (el: HTMLElement, quoteDepth: number): Style => {
    const result = baseParagraph();
    result.ps_ls = lineSpacing(el);
    result.ps_al = ({ left: 0, center: 1, right: 2, justify: 3 } as Record<string, number>)[el.style.textAlign] ?? 0;
    result.ps_il = result.ps_ifl = quoteDepth * 30 + pointSize(el.style.marginLeft, 0);
    result.ps_ir = quoteDepth * 30;
    const heading = /^H([1-6])$/.exec(el.tagName);
    if (heading) {
      const level = Number(heading[1]);
      result.ps_hd = level;
    }
    return result;
  };
  const setParagraph = (at: number, element: HTMLElement, style: Style) => {
    const gap = spacing.get(element);
    style.ps_sb = gap?.beforePt ?? 0;
    style.ps_sa = gap?.afterPt ?? 0;
    setStyle('paragraph', at, style);
  };
  const image = (img: HTMLImageElement, container: HTMLElement) => {
    const size = sizes.get(img)!;
    const rawWidth = Number.parseFloat(container.getAttribute('data-width') ?? '56');
    const width = Math.round(EDITOR_CONTENT_WIDTH_PX * Math.min(100, Math.max(20, Number.isFinite(rawWidth) ? rawWidth : 56)) / 100);
    const height = width / (normalizeImageAspectRatio(container.getAttribute('data-aspect-ratio')) ?? size.width / size.height);
    const align = normalizeImageAlignment(container.getAttribute('data-align'));
    const layout = normalizeImageLayout(container.getAttribute('data-layout'));
    const position = normalizeImagePosition(container.getAttribute('data-position'), align);

    const entityId = id();
    const placeholder = `PLACEHOLDER_sbobinator_${serial}`;
    const caption = container.querySelector('figcaption, .editor-image-caption')?.textContent ?? container.getAttribute('data-caption') ?? '';
    const wrapMargins = !caption && layout === 'wrap' ? { top: 3, bottom: 12, left: 12, right: 12 } : { top: 0, bottom: 0, left: 0, right: 0 };
    imageUrls[placeholder] = img.getAttribute('src')!;
    if (caption) {
      separateAdjacentTables();
      setStyle('tbl', spacers.length, {
        tbls_bc2: color('#000000'), tbls_bw: 0, tbls_al: 0, tbls_in: 0, tbls_ltr: true,
        tbls_cols: { cv: { op: 'set', opValue: [{ col_wt: 0, col_wv: width * 0.75 }] } },
        tbls_pt: layout === 'wrap' ? 1 : 0,
        tbls_ftp: {
          ft_p: {
            p_hp: { hp_rt: 4, hp_t: 1, hp_a: 0, hp_lo: 0 },
            // Preserve the source coordinate; Docs currently resets it on paste,
            // including when copying its own floating tables.
            p_vp: { vp_rt: 4, vp_t: 1, vp_a: 0, vp_to: layout === 'wrap' ? normalizeImageOffsetY(container.getAttribute('data-offset-y')) * 0.75 : 0 }, p_tw: { tw_t: 2, tw_wd: 2 }, p_bd: false,
          },
          ft_mt: 10.5, ft_mb: 10.5, ft_ml: align === 'right' ? 12 : 0, ft_mr: align === 'right' ? 0 : 12,
        },
      });
      append('\u0010', baseText());
      setStyle('row', spacers.length, { row_mh: 0, row_th: false, row_cs: false });
      append('\u0012', baseText());
      setStyle('cell', spacers.length, { cell_cs: 1, cell_rs: 1, cell_pt: 0, cell_pb: 0, cell_pl: 0, cell_pr: 0, cell_va: 2 });
      append('\u001c', baseText());
      (inline[spacers.length] ??= []).push(entityId);
    } else ((layout === 'inline' ? inline : positioned)[spacers.length] ??= []).push(entityId);
    entities[entityId] = {
      ee_eo: {
        eo_type: 0, i_wth: width * 0.75, i_ht: height * 0.75,
        eo_lco: { lc_ct: 0, lc_sci: '', lc_srk: '', lc_oi: '', lc_cs: '' },
        eo_ml: wrapMargins.left,
        eo_mr: wrapMargins.right,
        eo_mt: wrapMargins.top, eo_mb: wrapMargins.bottom, eo_hb: false,
        eo_bo: { ln_c2: color('#000000'), ln_w: 0, ln_s: 0 },
        eo_at: img.getAttribute('title'), eo_ad: img.getAttribute('alt') ?? '',
        eo_rtd: '', eo_rtdf: { rdf_ft: 0 }, i_bri: 0, i_cont: 0, i_opa: 1,
        i_clst: { cv: { op: 'set', opValue: [] } }, i_cid: placeholder,
        i_crop: { crop_oxr: 0, crop_oyr: 0, crop_wr: 1, crop_hr: 1, crop_rot: 0 },
        i_rot: 0, i_src: '', i_iw: false, i_iwc: { iwc_w: false }, i_msct: 0, i_pid: null,
      },
      // Docs positions the outside of the wrapping margins; editor attributes
      // position the image itself. Translate the origin as well as the units.
      ...(!caption && layout === 'wrap' ? { pe_l: 0, pe_lo: (EDITOR_CONTENT_WIDTH_PX - width) * position / 100 * 0.75 - wrapMargins.left, pe_to: normalizeImageOffsetY(container.getAttribute('data-offset-y')) * 0.75 - wrapMargins.top } : {}),
    };
    entityTypes[entityId] = caption || layout === 'inline' ? 'inline' : 'positioned';
    if (caption) {
      append('*\n', baseText());
      setStyle('paragraph', spacers.length - 1, { ...baseParagraph(), ps_ls: 1, ps_sa: 0, ps_sb: 0 });
      append(caption, { ...baseText(), ts_fs: DOCUMENT_FORMATTING.caption.fontSizePt, ts_fgc2: color('#374151') });
      append('\n', baseText());
      setStyle('paragraph', spacers.length - 1, { ...baseParagraph(), ps_al: 1, ps_ls: DOCUMENT_FORMATTING.caption.lineHeight, ps_sb: DOCUMENT_FORMATTING.caption.beforePt, ps_sa: 0 });
      append('\u0011', baseText());
      return;
    }
    if (layout === 'inline') append('*', baseText());
  };
  type ListContext = { id: string; depth: number; item?: { hasMarker: boolean } };
  const walk = (node: Node, inherited: Style, quote = 0, list?: ListContext, link: string | null = null) => {
    if (node.nodeType === Node.TEXT_NODE) { append(node.textContent ?? '', inherited, link); return; }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName.toLowerCase();
    if (['script', 'style'].includes(tag)) return;
    const current = textStyle(node, inherited);
    const equation = equations.get(node);
    if (equation) {
      const start = spacers.length;
      setStyle('equation', start, { eqs_p: '$' });
      equation.functions.forEach(fn => setStyle('equation_function', start + fn.at, { eqfs_c: fn.command }));
      append(equation.text, current, link);
      // Delimiters define the equation's scope. Null equation properties are
      // rejected by Docs even though its local canvas initially renders them.
      if (node.hasAttribute('data-math-block')) {
        append('\n', current);
        setParagraph(spacers.length - 1, node, { ...paragraphStyle(node, quote), ps_al: 1 });
      }
      return;
    }
    if (node.hasAttribute('data-editor-image')) {
      const img = node.querySelector('img');
      if (img) image(img, node);
      return;
    }
    if (tag === 'br') { append('\u000b', current, link); return; }
    if (tag === 'blockquote') {
      node.childNodes.forEach(child => walk(child, current, quote + 1, list, link));
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const listId = id();
      const depth = list ? list.depth + 1 : 0;
      const glyph = ({ decimal: 3, 'upper-alpha': 4, 'lower-alpha': 5, 'upper-roman': 6, 'lower-roman': 7 } as Record<string, number>)[orderedListStyle(node)];
      const levels: Style = {};
      // The hidden first item still occupies a number in saved HTML. Docs
      // counts only copied markers, so the surviving sequence starts later.
      const firstItem = node.firstElementChild as HTMLElement | null;
      const start = Number(node.getAttribute('start') ?? 1) + (firstItem?.style.listStyleType === 'none' ? 1 : 0);
      for (let level = 0; level < 9; level++) levels[`nl_${level}`] = {
        b_a: 0, b_ifl: 18 + level * 36, b_il: 36 + level * 36,
        b_gt: tag === 'ol' ? glyph : level % 3,
        b_sn: start, b_ts: baseText(), b_gf: '', b_gs: '',
      };
      entities[listId] = { le_nb: levels };
      entityTypes[listId] = 'list';
      node.childNodes.forEach(child => walk(child, current, quote, { id: listId, depth }, link));
      return;
    }
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node);
      // Docs stores a slot for every grid position, including the positions
      // covered by a rowspan/colspan. Omitting them changes table topology.
      const grid: Array<Array<HTMLTableCellElement | null | undefined>> = rows.map(() => []);
      rows.forEach((row, rowIndex) => {
        let column = 0;
        for (const cell of Array.from(row.cells)) {
          while (grid[rowIndex][column] !== undefined) column++;
          grid[rowIndex][column] = cell;
          for (let r = rowIndex; r < Math.min(rows.length, rowIndex + cell.rowSpan); r++) {
            for (let c = column; c < column + cell.colSpan; c++) {
              if (r !== rowIndex || c !== column) grid[r][c] = null;
            }
          }
          column += cell.colSpan;
        }
      });
      const columns = Math.max(1, ...grid.map(row => row.length));
      const widths: Array<number | null> = Array.from({ length: columns }, () => null);
      Array.from(node.querySelectorAll('col')).filter(col => col.closest('table') === node).forEach((col, column) => {
        const width = Number.parseFloat((col as HTMLElement).style.width);
        if (column < columns && Number.isFinite(width) && width > 0) widths[column] = width * 0.75;
      });
      for (const row of grid) {
        row.forEach((cell, column) => {
          if (!cell) return;
          const declared = (cell.getAttribute('colwidth') ?? '').split(',').map(Number);
          declared.forEach((width, offset) => {
            if (column + offset < columns && width > 0) widths[column + offset] = width * 0.75;
          });
        });
      }
      const fixedWidth = widths.reduce<number>((sum, width) => sum + (width ?? 0), 0);
      const flexibleColumns = widths.filter(width => width === null).length;
      const remainingWidth = Math.max(0, EDITOR_CONTENT_WIDTH_PX * 0.75 - fixedWidth);
      separateAdjacentTables();
      setStyle('tbl', spacers.length, {
        tbls_bc2: color('#000000'), tbls_bw: 0.75, tbls_al: 0, tbls_in: 0, tbls_ltr: true,
        tbls_cols: { cv: { op: 'set', opValue: widths.map(width => ({ col_wt: 0, col_wv: width ?? remainingWidth / flexibleColumns })) } },
      });
      append('\u0010', current);
      for (const row of grid) {
        setStyle('row', spacers.length, { row_mh: 0, row_th: false, row_cs: false });
        append('\u0012', current);
        for (let column = 0; column < columns; column++) {
          const cell = row[column];
          if (!cell) {
            setStyle('cell', spacers.length, { cell_cs: 0, cell_rs: 0 });
            append('\u001c\n', current);
            setStyle('paragraph', spacers.length - 1, baseParagraph());
            continue;
          }
          setStyle('cell', spacers.length, {
            cell_bgc2: color(cell.style.backgroundColor ? normalizeColor(cell.style.backgroundColor) : ''),
            cell_pt: DOCUMENT_FORMATTING.table.paddingVerticalPt, cell_pb: DOCUMENT_FORMATTING.table.paddingVerticalPt,
            cell_pl: DOCUMENT_FORMATTING.table.paddingHorizontalPt, cell_pr: DOCUMENT_FORMATTING.table.paddingHorizontalPt, cell_va: 2,
            cell_cs: cell.colSpan, cell_rs: cell.rowSpan,
          });
          append('\u001c', current);
          const start = spacers.length;
          cell.childNodes.forEach(child => walk(child, textStyle(cell, current), quote, undefined));
          if (start === spacers.length || !spacers.endsWith('\n')) {
            append('\n', textStyle(cell, current));
            setParagraph(spacers.length - 1, cell, paragraphStyle(cell, quote));
          }
        }
      }
      append('\u0011', current);
      return;
    }
    const isParagraph = /^(p|h[1-6]|pre)$/.test(tag);
    const isListItem = tag === 'li';
    // Each item owns one marker. Subsequent block paragraphs are continuations;
    // an inner list has its own item state and must not consume the parent one.
    if (isListItem && list) list = { ...list, item: { hasMarker: node.style.listStyleType === 'none' } };
    const start = spacers.length;
    let itemClosed = false;
    const closeParagraph = () => {
      append('\n', current, link);
      const paragraph = paragraphStyle(node, quote);
      if (list) {
        // Docs suppresses paragraph spacing between list items in automatic
        // mode. Its own "Add space after list item" action selects mode 1.
        paragraph.ps_sm = 1;
        const continuation = list.item?.hasMarker ?? false;
        const indent = pointSize(node.style.marginLeft, 0);
        paragraph.ps_ifl = (continuation ? 36 : 18) + list.depth * 36 + indent;
        paragraph.ps_il = 36 + list.depth * 36 + indent;
        setStyle('list', spacers.length - 1, { ls_nest: list.depth, ls_id: continuation ? null : list.id, ls_c: null, ls_ts: current });
        if (list.item) list.item.hasMarker = true;
      }
      setParagraph(spacers.length - 1, node, paragraph);
    };
    for (const child of node.childNodes) {
      // Nested lists start after their parent's paragraph, never in its text.
      if (isListItem && child instanceof HTMLElement && ['UL', 'OL'].includes(child.tagName) && !itemClosed) {
        // A retained unmarked shell can contain only its child list after a
        // Backspace join. It owns depth/numbering, but no copied paragraph.
        const shell = node.style.listStyleType === 'none' && child === node.firstChild;
        if (!shell && (!spacers.endsWith('\n') || spacers.length === start)) closeParagraph();
        itemClosed = true;
      }
      walk(child, current, quote, list, tag === 'a' ? node.getAttribute('href') : link);
    }
    if (isParagraph || (isListItem && !itemClosed && (!spacers.endsWith('\n') || spacers.length === start))) closeParagraph();
  };
  body.childNodes.forEach(node => walk(node, baseText()));
  if (!inlineSelection && (!spacers.endsWith('\n') || positioned[spacers.length])) {
    append('\n', baseText());
    setStyle('paragraph', spacers.length - 1, baseParagraph());
  }
  const resolved = {
    dsl_spacers: spacers,
    dsl_styleslices: Array.from(styles, ([type, values]) => ({ stsl_type: type, stsl_styles: Array.from({ length: spacers.length }, (_, i) => values[i] ?? null) })),
    dsl_metastyleslices: [], dsl_suggestedinsertions: { sgsl_sugg: [] }, dsl_suggesteddeletions: { sgsl_sugg: [] },
    dsl_entitypositionmap: {
      positioned: Array.from({ length: positioned.length }, (_, i) => positioned[i] ?? null),
      inline: Array.from({ length: inline.length }, (_, i) => inline[i] ?? null),
    },
    dsl_entitymap: entities, dsl_entitytypemap: entityTypes,
    dsl_drawingrevisionaccesstokenmap: {}, dsl_relateddocslices: {}, dsl_nestedmodelmap: {},
  };
  const wrap = (data: unknown) => JSON.stringify({ data: JSON.stringify(data), dct: 'kix', ds: false, cses: false, sm: 'other', si: '' });
  return {
    'text/html': body.innerHTML,
    'text/plain': clipboardPlainText(body),
    [NATIVE_SLICE_MIME]: wrap({ resolved, autotext_content: {} }),
    // Empty blob maps make Docs upload local image data instead of looking up
    // an identifier that only exists in a previously copied Google document.
    [NATIVE_IMAGES_MIME]: wrap({ image_urls: imageUrls, placeholder_ids: {}, cosmo_ids: {} }),
  };
}

export function setClipboardFormats(event: ClipboardEvent, formats: ClipboardFormats): boolean {
  if (!event.clipboardData) return false;
  for (const [type, text] of Object.entries(formats)) event.clipboardData.setData(type, text);
  event.preventDefault();
  return true;
}

/** Button/context-menu copies use the same ClipboardEvent formats as Ctrl+C. */
export async function writeEditorClipboard(html: string, plainText: string, sourceRoot?: HTMLElement): Promise<void> {
  const formats = createNativeClipboardFormats(html, sourceRoot);
  if (!formats) {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plainText], { type: 'text/plain' }),
    })]);
    return;
  }
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.value = plainText || ' ';
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;';
  let transferred = false;
  const copy = (event: ClipboardEvent) => {
    transferred = setClipboardFormats(event, formats);
    if (transferred) event.stopImmediatePropagation();
  };
  document.addEventListener('copy', copy, true);
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand('copy') || !transferred) throw new Error('Impossibile copiare la disposizione delle immagini negli appunti.');
  } finally {
    document.removeEventListener('copy', copy, true);
    field.remove();
    focused?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}
