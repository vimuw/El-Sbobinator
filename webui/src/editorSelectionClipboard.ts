import { DOMSerializer, Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { clipboardPlainText, DOCUMENT_FORMATTING, isDefaultBlockStyle, pointSize } from './documentFormatting';
import { createNativeClipboardFormats, setClipboardFormats } from './editorClipboard';
import { prepareHtmlForClipboardSync } from './utils';
import { reportClientError } from './diagnostics';
import { prepareHtmlLineSpacing } from './editorLineSpacing';

const SOURCE_HEADING_ATTRIBUTE = 'data-editor-selection-heading';
const DEFAULT_HEADING_COLOR_ATTRIBUTE = 'data-editor-default-heading-color';

function inlineClipboardBlock(block: Element): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute('style', block.getAttribute('style') ?? '');
  const defaultColor = block.getAttribute(DEFAULT_HEADING_COLOR_ATTRIBUTE);
  if (defaultColor) span.setAttribute(DEFAULT_HEADING_COLOR_ATTRIBUTE, defaultColor);
  // Character selections carry typography, never paragraph layout.
  ['margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'text-align', 'line-height'].forEach(property => span.style.removeProperty(property));
  while (block.firstChild) span.appendChild(block.firstChild);
  block.replaceWith(span);
  return span;
}

// Chromium copies a web page's white background onto the selected spans. It
// is the page, not a highlight: as a mark it shows as white bars in dark theme.
const NO_HIGHLIGHT_BACKGROUNDS = new Set(['transparent', 'rgba(0, 0, 0, 0)', 'white', 'rgb(255, 255, 255)']);

/** Interpret our clipboard hints without persisting them in the document. */
export function preparePastedEditorHtml(html: string, view?: EditorView): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  // Docs exports character highlighting as span background-color, whereas
  // TipTap's Highlight parser recognizes mark elements. Keep the original
  // foreground/font on the span and represent its highlight semantically.
  body.querySelectorAll<HTMLSpanElement>('span[style]').forEach(span => {
    const background = span.style.backgroundColor;
    if (!background || NO_HIGHLIGHT_BACKGROUNDS.has(background)
      || span.closest('[data-editor-image],[data-math],.katex')) return;
    const mark = document.createElement('mark');
    mark.style.backgroundColor = background;
    span.style.removeProperty('background-color');
    span.replaceWith(mark);
    mark.appendChild(span);
  });
  const selection = view?.state.selection;
  const cursor = selection?.$from;
  const canReplaceParagraph = selection && cursor && cursor.sameParent(selection.$to)
    && cursor.parent.type.name === 'paragraph'
    && ['doc', 'tableCell', 'tableHeader'].includes(cursor.node(-1).type.name)
    && (cursor.parent.content.size === 0 || (!selection.empty && cursor.parentOffset === 0 && selection.$to.parentOffset === cursor.parent.content.size));
  body.querySelectorAll(`h1[${SOURCE_HEADING_ATTRIBUTE}],h2[${SOURCE_HEADING_ATTRIBUTE}],h3[${SOURCE_HEADING_ATTRIBUTE}],h4[${SOURCE_HEADING_ATTRIBUTE}],h5[${SOURCE_HEADING_ATTRIBUTE}],h6[${SOURCE_HEADING_ATTRIBUTE}]`).forEach(block => {
    if (block.getAttribute(SOURCE_HEADING_ATTRIBUTE) === '1' && block.closest('[data-document-format="1"]') && !canReplaceParagraph) inlineClipboardBlock(block);
    else block.removeAttribute(SOURCE_HEADING_ATTRIBUTE);
  });
  // A heading's profile weight is not bold text: as a mark it would stay
  // bold after the block becomes a paragraph, and reach the Docs copy.
  body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach(heading => {
    if (isDefaultBlockStyle('font-weight', heading.style.fontWeight, Number(heading.tagName[1]), false)) heading.style.removeProperty('font-weight');
  });
  body.querySelectorAll<HTMLSpanElement>(`span[${DEFAULT_HEADING_COLOR_ATTRIBUTE}]`).forEach(span => {
    if (span.closest('[data-document-format="1"]') && span.getAttribute(DEFAULT_HEADING_COLOR_ATTRIBUTE) === span.style.color) span.style.removeProperty('color');
    span.removeAttribute(DEFAULT_HEADING_COLOR_ATTRIBUTE);
  });
  return body.innerHTML;
}

export function prepareSelectionClipboard(view: EditorView) {
  if (view.state.selection.empty) return null;
  const { selection, doc } = view.state;
  const { $from, $to, from, to } = selection;
  let content = selection.content().content;
  const textOnlySelection = $from.sameParent($to) && $from.parent.isTextblock && content.size > 0 && !selection.content().content.textBetween(0, content.size, '', '').includes('\n');
  const wholeHeading = textOnlySelection && $from.parent.type.name === 'heading' && $from.parentOffset === 0 && $to.parentOffset === $from.parent.content.size;
  const inlineSelection = textOnlySelection && !wholeHeading;
  // Selecting text without a paragraph boundary does not select its marker.
  // Retain the paragraph's direct styles, but omit the enclosing list shells.
  if (textOnlySelection) {
    content = Fragment.from($from.parent.copy($from.parent.content.cut($from.parentOffset, $to.parentOffset)));
  } else {
    const starts: number[] = [];
    doc.descendants((node, pos) => {
      if (pos + node.nodeSize - 1 <= from || pos + 1 >= to) return false;
      if (node.type.name !== 'orderedList') return;
      let first = 0;
      node.forEach((item, offset, index) => { if (pos + 1 + offset + item.nodeSize <= from) first = index + 1; });
      starts.push(node.attrs.start + first);
    });
    let listIndex = 0;
    const adjust = (node: ProseMirrorNode): ProseMirrorNode => {
      if (node.isLeaf) return node;
      const start = node.type.name === 'orderedList' ? starts[listIndex++] : undefined;
      const children: ProseMirrorNode[] = [];
      node.content.forEach(child => children.push(adjust(child)));
      return node.type.create(start === undefined ? node.attrs : { ...node.attrs, start }, Fragment.from(children), node.marks);
    };
    const nodes: ProseMirrorNode[] = [];
    content.forEach(node => nodes.push(adjust(node)));
    content = Fragment.from(nodes);
  }
  const fragment = document.createElement('div');
  fragment.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(content));
  // A slice can omit the table shell, including for a word inside a cell.
  // Materialize the selected blocks' actual sizes before portable defaults.
  const blocks = Array.from(fragment.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,pre'));
  const sourceFigures: HTMLElement[] = [];
  let blockIndex = 0;
  doc.descendants((node, pos) => {
    if (node.type.name === 'floatingImage' && selection.ranges.some(range => pos < range.$to.pos && pos + node.nodeSize > range.$from.pos)) {
      const source = view.nodeDOM(pos);
      if (source instanceof HTMLElement) {
        const figure = source.matches('.editor-image-node') ? source : source.querySelector<HTMLElement>('.editor-image-node');
        if (figure) sourceFigures.push(figure);
      }
    }
    if (!selection.ranges.some(range => pos + node.nodeSize - 1 > range.$from.pos && pos + 1 < range.$to.pos)) return false;
    if (!node.isTextblock) return;
    const block = blocks[blockIndex++];
    const source = view.nodeDOM(pos);
    if (block && !block.closest('table') && source instanceof HTMLElement && source.closest('td,th')) {
      const size = pointSize(getComputedStyle(source).fontSize, 0);
      // Computed px values round to four decimals; avoid baking that noise
      // into line-height and paragraph sizes after an internal paste.
      if (size > 0) block.style.fontSize = `${Number(size.toFixed(4))}pt`;
      // Paragraphs inherit the table profile; headings and explicit leading
      // already carry their own value. Keep unitless CSS for relative spans.
      if (node.type.name === 'paragraph') block.style.lineHeight ||= String(DOCUMENT_FORMATTING.table.lineHeight);
    }
  });
  let html = prepareHtmlForClipboardSync(fragment.innerHTML, view.dom);
  fragment.innerHTML = html;
  if (wholeHeading) {
    fragment.querySelector('h1,h2,h3,h4,h5,h6')?.setAttribute(SOURCE_HEADING_ATTRIBUTE, '1');
    html = fragment.innerHTML;
  }
  if (inlineSelection && !fragment.querySelector('[data-editor-image],[data-math-block],iframe,video')) {
    // Materialize inherited heading/paragraph typography before dropping the
    // block wrapper. Rich inline paste must not split the target paragraph.
    fragment.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre').forEach(block => {
      inlineClipboardBlock(block);
    });
    html = fragment.innerHTML;
  }
  const plainText = clipboardPlainText(fragment);
  const nativeFormats = createNativeClipboardFormats(html, view.dom, inlineSelection, sourceFigures);
  if (!nativeFormats) html = prepareHtmlLineSpacing(html);
  const formats = nativeFormats ?? { 'text/html': html, 'text/plain': plainText };
  return { html, plainText, formats };
}

/** Copy and cut must finish inside the trusted event, before any document deletion. */
export function handleEditorClipboardEvent(view: EditorView, event: ClipboardEvent, cut = false): boolean {
  if (view.state.selection.empty) return false;
  try {
    const prepared = prepareSelectionClipboard(view);
    if (prepared && setClipboardFormats(event, prepared.formats)) {
      if (cut) view.dispatch(closeHistory(view.state.tr).deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
      return true;
    }
  } catch (error) {
    reportClientError('Clipboard error', error);
  }
  // Let the engine attempt its normal copy, but never let a failed cut delete text.
  if (cut) { event.preventDefault(); return true; }
  return false;
}

export async function pasteEditorClipboard(view: EditorView, plain = false): Promise<boolean> {
  const { doc, selection } = view.state;
  let html = '';
  let text = '';
  if (!plain && typeof navigator.clipboard.read === 'function') {
    const items = await navigator.clipboard.read();
    const htmlItem = items.find(item => item.types.includes('text/html'));
    if (htmlItem) html = await (await htmlItem.getType('text/html')).text();
    else {
      const textItem = items.find(item => item.types.includes('text/plain'));
      if (textItem) text = await (await textItem.getType('text/plain')).text();
    }
  } else text = await navigator.clipboard.readText();
  // An asynchronous read must not paste into a selection changed in the meantime.
  if (view.isDestroyed || view.state.doc !== doc || !view.state.selection.eq(selection)) return false;
  view.focus();
  const event = new Event('paste') as ClipboardEvent;
  return html ? view.pasteHTML(html, event) : text ? view.pasteText(text, event) : false;
}
