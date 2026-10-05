import { DOMSerializer, Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { clipboardPlainText } from './documentFormatting';
import { createNativeClipboardFormats, setClipboardFormats } from './editorClipboard';
import { prepareHtmlForClipboardSync } from './utils';
import { reportClientError } from './diagnostics';

export function prepareSelectionClipboard(view: EditorView) {
  if (view.state.selection.empty) return null;
  const { selection, doc } = view.state;
  const { $from, $to, from, to } = selection;
  let content = selection.content().content;
  const inlineSelection = $from.sameParent($to) && $from.parent.isTextblock && content.size > 0 && !selection.content().content.textBetween(0, content.size, '', '').includes('\n');
  // Selecting text without a paragraph boundary does not select its marker.
  // Retain the paragraph's direct styles, but omit the enclosing list shells.
  if (inlineSelection) {
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
  let html = prepareHtmlForClipboardSync(fragment.innerHTML, view.dom);
  fragment.innerHTML = html;
  if (inlineSelection && !fragment.querySelector('[data-editor-image],[data-math-block],iframe,video')) {
    // Materialize inherited heading/paragraph typography before dropping the
    // block wrapper. Rich inline paste must not split the target paragraph.
    fragment.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre').forEach(block => {
      const span = document.createElement('span');
      span.setAttribute('style', block.getAttribute('style') ?? '');
      // A word carries its typography, not the source paragraph's indent.
      // Inline HTML margins would add an extra gap at the paste destination.
      span.style.removeProperty('margin-left');
      while (block.firstChild) span.appendChild(block.firstChild);
      block.replaceWith(span);
    });
    html = fragment.innerHTML;
  }
  const plainText = clipboardPlainText(fragment);
  const formats = createNativeClipboardFormats(html, view.dom, inlineSelection) ?? { 'text/html': html, 'text/plain': plainText };
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
