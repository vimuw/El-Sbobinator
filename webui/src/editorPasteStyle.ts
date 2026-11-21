import { Extension } from '@tiptap/core';
import { Fragment, Mark, Slice, type Node as ProseMirrorNode, type Schema, type TagParseRule } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { handlePaste as pasteIntoTable } from '@tiptap/pm/tables';
import { Mapping } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { DOCUMENT_FORMATTING, pointSize } from './documentFormatting';
import { blockIsBold } from './editorBold';

type BlockText = { fontSizePt: number; fontFamily: string; bold: boolean };

const isTableCell = (node: ProseMirrorNode) => ['cell', 'header_cell'].includes(node.type.spec.tableRole);
const styledBlock = (node: ProseMirrorNode) => ['paragraph', 'heading'].includes(node.type.name);
const familyKey = (value: string) => value.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
const empty = (value: unknown) => value === null || value === undefined || value === '';
// Text and soft breaks carry a character style (as in Docs); images and math keep their marks.
const styledInline = (node: ProseMirrorNode) => node.isText || node.type === node.type.schema.linebreakReplacement;

/** The typography a paragraph or heading gives text without marks. */
function blockText(block: ProseMirrorNode, inTable: boolean): BlockText {
  const heading = block.type.name === 'heading' ? DOCUMENT_FORMATTING.headings[Number(block.attrs.level) - 1] : null;
  const direct = (block.attrs.documentStyle ?? {}) as Record<string, string>;
  const profilePt = heading?.fontSizePt ?? DOCUMENT_FORMATTING.fontSizePt * (inTable ? DOCUMENT_FORMATTING.table.fontSizeEm : 1);
  return {
    fontSizePt: direct['font-size'] ? pointSize(direct['font-size'], profilePt, profilePt) : profilePt,
    fontFamily: direct['font-family'] ?? DOCUMENT_FORMATTING.fontFamily,
    bold: blockIsBold(block),
  };
}

const bareAttrsBySchema = new WeakMap<Schema, Record<string, unknown>>();

/** The text-style attributes the schema parses from a span that sets none of them. */
function bareTextStyleAttrs(schema: Schema): Record<string, unknown> {
  let attrs = bareAttrsBySchema.get(schema);
  if (!attrs) {
    const span = document.createElement('span');
    span.style.textTransform = 'none';
    const rule = schema.marks.textStyle.spec.parseDOM?.find(candidate => 'tag' in candidate && candidate.tag?.startsWith('span')) as TagParseRule | undefined;
    const parsed = rule?.getAttrs ? rule.getAttrs(span) : null;
    attrs = parsed && typeof parsed === 'object' ? parsed : {};
    bareAttrsBySchema.set(schema, attrs);
  }
  return attrs;
}

/**
 * Size, font and weight of a text run in `source`, written relative to
 * `target`: a property equal to the target block is inherited, a different one
 * stays explicit. With source === target this only drops redundant marks.
 * Portable HTML also writes `color: inherit`, which is never an authored ink.
 */
function retargetMarks(marks: readonly Mark[], source: BlockText, target: BlockText, schema: Schema): readonly Mark[] {
  const { textStyle, bold, unbold } = schema.marks;
  if (!textStyle || !bold || !unbold) return marks;
  let result: readonly Mark[] = marks.filter(mark => mark.type !== textStyle && mark.type !== bold && mark.type !== unbold);
  const attrs: Record<string, unknown> = { ...textStyle.create().attrs, ...marks.find(mark => mark.type === textStyle)?.attrs };
  const sizePt = attrs.fontSize ? pointSize(String(attrs.fontSize), source.fontSizePt, source.fontSizePt) : source.fontSizePt;
  attrs.fontSize = Math.abs(sizePt - target.fontSizePt) < 0.01 ? null : attrs.fontSize || `${Number(sizePt.toFixed(4))}pt`;
  const family = attrs.fontFamily ? String(attrs.fontFamily) : source.fontFamily;
  attrs.fontFamily = familyKey(family) === familyKey(target.fontFamily) ? null : family;
  if (attrs.color === 'inherit') attrs.color = null;
  if (Object.values(attrs).some(value => !empty(value))) {
    // Unset attributes take the value a reopened span parses to (`''` or null).
    const bare = bareTextStyleAttrs(schema);
    Object.keys(attrs).forEach(key => { if (empty(attrs[key])) attrs[key] = bare[key] ?? null; });
    result = textStyle.create(attrs).addToSet(result);
  }
  const sourceBold = marks.some(mark => mark.type === bold) || (!marks.some(mark => mark.type === unbold) && source.bold);
  if (sourceBold !== target.bold) result = (sourceBold ? bold : unbold).create().addToSet(result);
  return result;
}

/** Every run spells out its source look before ProseMirror picks the final block. */
const NEUTRAL: BlockText = { fontSizePt: Number.NaN, fontFamily: '\u0000', bold: false };

function materialize(fragment: Fragment, inTable: boolean): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach(node => {
    if (styledBlock(node)) {
      const source = blockText(node, inTable);
      const children: ProseMirrorNode[] = [];
      node.content.forEach(child => {
        if (!styledInline(child)) { children.push(child); return; }
        const { bold, unbold } = node.type.schema.marks;
        // Against a neutral target everything is explicit; normal weight as unbold.
        let marks = retargetMarks(child.marks, source, NEUTRAL, node.type.schema);
        if (bold && unbold && !marks.some(mark => mark.type === bold)) marks = unbold.create().addToSet(marks);
        children.push(child.mark(marks));
      });
      nodes.push(node.copy(Fragment.from(children)));
    } else nodes.push(node.isLeaf || node.isTextblock ? node : node.copy(materialize(node.content, inTable || isTableCell(node))));
  });
  return Fragment.from(nodes);
}

/**
 * Drop what each pasted run shares with the block it finally landed in.
 * Each block gets one replace step over its changed runs: per-run mark steps
 * made large pastes, and their undo, grow quadratically. Text length never
 * changes, so every position stays valid.
 */
function canonicalizeRange(tr: Transaction, from: number, to: number): void {
  const doc = tr.doc;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (!styledBlock(node)) return false;
    const $pos = doc.resolve(pos);
    const inTable = Array.from({ length: $pos.depth }, (_, i) => $pos.node(i + 1)).some(isTableCell);
    const block = blockText(node, inTable);
    const contentStart = pos + 1;
    const children: ProseMirrorNode[] = [];
    let changedFrom = Infinity;
    let changedTo = -Infinity;
    node.forEach((child, offset) => {
      const start = contentStart + offset;
      const end = start + child.nodeSize;
      if (!styledInline(child) || end <= from || start >= to) { children.push(child); return; }
      const retargeted = retargetMarks(child.marks, block, block, node.type.schema);
      // A mark the block does not allow is skipped, as addMark would.
      const marks = retargeted.filter(mark => node.type.allowsMarkType(mark.type) || mark.isInSet(child.marks));
      if (Mark.sameSet(marks, child.marks)) { children.push(child); return; }
      // A soft break is one position: it lies wholly inside the range.
      const runFrom = Math.max(from, start) - start;
      const runTo = Math.min(to, end) - start;
      if (runFrom > 0) children.push(child.cut(0, runFrom));
      children.push((child.isText ? child.cut(runFrom, runTo) : child).mark(marks));
      if (runTo < child.nodeSize) children.push(child.cut(runTo));
      changedFrom = Math.min(changedFrom, start + runFrom);
      changedTo = Math.max(changedTo, start + runTo);
    });
    if (changedTo > changedFrom) {
      // Only the changed span is replaced; positions on its edges keep their side.
      tr.replaceWith(changedFrom, changedTo, Fragment.from(children).cut(changedFrom - contentStart, changedTo - contentStart));
    }
    return false;
  });
}

const pasteStyleKey = new PluginKey('editorPasteStyle');

/**
 * Rich paste and drop follow Google Docs: text keeps how it looked where it
 * was copied, but only properties that differ from its new block stay explicit.
 * The rest is inherited again and follows later changes to that block.
 * Plain-text paste looks like the formatting at the cursor; the same cleanup
 * drops explicit size, font or weight that only repeat its block.
 */
export const EditorPasteStyle = Extension.create({
  name: 'editorPasteStyle',
  // Ahead of Table, so its cell pastes run through the handler below.
  priority: 101,
  addProseMirrorPlugins() {
    return [new Plugin({
      key: pasteStyleKey,
      props: {
        transformPasted: (slice, _view, plain) => (plain ? slice : new Slice(materialize(slice.content, false), slice.openStart, slice.openEnd)),
        // The table plugin inserts pasted cells without the paste meta; tag them for the cleanup.
        handlePaste: (view, event, slice) => pasteIntoTable({
          get state() { return view.state; },
          dispatch: (tr: Transaction) => view.dispatch(tr.setMeta(pasteStyleKey, true)),
        } as EditorView, event, slice),
      },
      appendTransaction: (transactions, _oldState, newState) => {
        const ranges: Array<[number, number]> = [];
        transactions.forEach(transaction => {
          ranges.forEach((range, i) => { ranges[i] = [transaction.mapping.map(range[0], -1), transaction.mapping.map(range[1])]; });
          if (!transaction.getMeta(pasteStyleKey) && !['paste', 'drop'].includes(transaction.getMeta('uiEvent'))) return;
          transaction.mapping.maps.forEach((map, index) => {
            const later = transaction.mapping.slice(index + 1);
            map.forEach((_oldStart, _oldEnd, newStart, newEnd) => { ranges.push([later.map(newStart, -1), later.map(newEnd)]); });
          });
        });
        if (!ranges.length) return null;
        const tr = newState.tr;
        ranges.forEach(([from, to]) => { if (to > from) canonicalizeRange(tr, from, to); });
        if (!tr.docChanged) return null;
        // A replace collapses positions inside it; the paste's selection keeps its exact place.
        const selection = newState.selection.map(tr.doc, new Mapping());
        if (!selection.eq(tr.selection)) tr.setSelection(selection);
        return tr;
      },
    })];
  },
});
