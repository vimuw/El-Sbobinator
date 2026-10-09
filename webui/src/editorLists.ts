import { ListItem, OrderedList } from '@tiptap/extension-list';
import { Extension, getNodeType, mergeAttributes } from '@tiptap/core';
import { sinkListItem } from '@tiptap/pm/schema-list';
import { closeHistory } from '@tiptap/pm/history';
import { liftTarget } from '@tiptap/pm/transform';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import { pointSize } from './documentFormatting';
import { savedEmptyTextMarks } from './emptyTextMarks';

// Keep a tab entered within an item when saved HTML is parsed again. The
// editor already preserves whitespace visually; exported HTML must say so.
export const EditorListItem = ListItem.extend({
  // After a parent paragraph joins the preceding ancestor, its unmarked
  // shell still anchors the child list's depth and following numbering.
  content: 'paragraph block* | (orderedList | bulletList)',
  addAttributes() {
    return {
      ...this.parent?.(),
      markerHidden: {
        default: false,
        parseHTML: element => element.style.listStyleType === 'none',
        renderHTML: attributes => attributes.markerHidden ? { style: 'list-style-type:none' } : {},
      },
    };
  },
  parseHTML() {
    return [
      { tag: 'li[style]', getAttrs: element => element.style.whiteSpace === 'pre-wrap' ? null : false, preserveWhitespace: true },
      ...(this.parent?.() ?? []),
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['li', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, node.textContent.includes('\t') ? { style: 'white-space:pre-wrap' } : {}), 0];
  },
});

// Typography overrides the browser's ol[type] rules. Inline CSS also survives
// standalone HTML and avoids case-insensitive HTML attribute selectors (a/A).
export const EditorOrderedList = OrderedList.extend({
  addExtensions() {
    const itemName = this.options.itemTypeName;
    return [Extension.create({
      name: 'editorListKeyboard',
      priority: 110,
      addKeyboardShortcuts() {
        return {
          Enter: () => {
            const { selection } = this.editor.state;
            const { $from } = selection;
            const itemDepth = $from.depth - 1;
            if (!selection.empty || $from.parent.type.name !== 'paragraph'
              || itemDepth < 2 || $from.node(itemDepth).type.name !== itemName || $from.index(itemDepth) !== 0) return false;
            const item = $from.node(itemDepth);
            const children = item.childCount === 2 ? item.child(1) : null;
            const textParagraph = (block: typeof item) => block.type.name === 'paragraph'
              && Array.from({ length: block.childCount }, (_, i) => block.child(i)).every(node => node.isText);
            if (!$from.parent.content.size) {
              const list = $from.node(itemDepth - 1);
              const index = $from.index(itemDepth - 1);
              const isList = (node: typeof item) => ['orderedList', 'bulletList'].includes(node.type.name);
              const textItem = (node: typeof item) => Array.from({ length: node.childCount }, (_, i) => node.child(i)).every(textParagraph);
              const simpleBranch = (node: typeof item) => node.childCount === 2 && textParagraph(node.firstChild!)
                && isList(node.child(1)) && Array.from({ length: node.child(1).childCount }, (_, i) => node.child(1).child(i)).every(textItem);
              const previous = index > 0 ? list.child(index - 1) : null;
              const next = index + 1 < list.childCount ? list.child(index + 1) : null;
              // Follow-up to a split at the start/end of a paragraph with one
              // child list. Other empty-item topologies keep the usual keymap.
              if (item.attrs.markerHidden || !isList(list) || !next
                || !(children ? simpleBranch(item) && previous && textItem(previous) : item.childCount === 1 && index === 0 && simpleBranch(next))
                || !Array.from({ length: list.childCount }, (_, i) => list.child(i)).every(node => !node.attrs.markerHidden && (textItem(node) || simpleBranch(node)))
                || ![2, 4].includes(itemDepth)) return false;
              const { state } = this.editor;
              const tr = closeHistory(state.tr);
              if (itemDepth === 2 && children && previous) {
                // At root Docs removes the empty marker and resets its indent.
                // Keep its children in the preceding item's original depth.
                const style = { ...$from.parent.attrs.documentStyle, 'margin-left': '-36pt' };
                const empty = $from.parent.type.create({ ...$from.parent.attrs, documentStyle: style });
                const start = $from.before(itemDepth) - previous.nodeSize;
                const caret = start + previous.content.size + 2;
                tr.replaceWith(start, $from.after(itemDepth), previous.copy(previous.content.append(Fragment.from([empty, children]))));
                tr.setSelection(TextSelection.create(tr.doc, caret));
              } else if (itemDepth === 2) {
                const split = this.editor.chain().command(({ tr }) => { closeHistory(tr); return true; }).splitListItem(itemName).run();
                if (split) this.editor.view.dispatch(closeHistory(this.editor.state.tr));
                return split;
              } else {
                const parentDepth = itemDepth - 2;
                const parent = $from.node(parentDepth);
                const outer = $from.node(parentDepth - 1);
                if (parent.type !== item.type || parent.attrs.markerHidden || !isList(outer)
                  || parent.childCount !== 2 || !textParagraph(parent.firstChild!) || $from.index(parentDepth) !== 1) return false;
                const before = list.content.cut(0, $from.before(itemDepth) - $from.start(itemDepth - 1));
                const after = list.content.cut($from.after(itemDepth) - $from.start(itemDepth - 1));
                const retained = parent.copy(Fragment.from([parent.firstChild!, ...(before.size ? [list.copy(before)] : [])]));
                // A list-only hidden item anchors the descendants at their old
                // depth while the empty paragraph becomes an outer-level item.
                const tail = children ? Fragment.from(item.type.create({ ...item.attrs, markerHidden: true }, children)).append(after) : after;
                const promoted = item.copy(Fragment.from([$from.parent, list.copy(tail)]));
                const start = $from.before(parentDepth);
                tr.replaceWith(start, $from.after(parentDepth), Fragment.from([retained, promoted]));
                tr.setSelection(TextSelection.create(tr.doc, start + retained.nodeSize + 2));
              }
              if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
              this.editor.view.dispatch(tr.scrollIntoView());
              this.editor.view.dispatch(closeHistory(this.editor.state.tr));
              return true;
            }
            if (item.attrs.markerHidden || !children || !['orderedList', 'bulletList'].includes(children.type.name)
              || !textParagraph($from.parent)
              || !Array.from({ length: children.childCount }, (_, i) => children.child(i)).every(child =>
                Array.from({ length: child.childCount }, (_, i) => child.child(i)).every(textParagraph))) return false;
            // The standard split keeps the subtree with the new item. Docs
            // gives the split and immediately following typing separate undo.
            const marks = this.editor.state.storedMarks ?? $from.marks();
            const split = this.editor.chain().command(({ tr }) => { closeHistory(tr); return true; }).splitListItem(itemName)
              .command(({ tr }) => {
                if ($from.parentOffset === 0 || $from.parentOffset === $from.parent.content.size) {
                  const pos = $from.parentOffset ? tr.selection.$from.before() : tr.mapping.map($from.before(), -1);
                  const empty = tr.doc.nodeAt(pos);
                  if (empty && !empty.content.size && 'emptyTextMarks' in empty.attrs) {
                    tr.setNodeAttribute(pos, 'emptyTextMarks', savedEmptyTextMarks(marks));
                    tr.setStoredMarks(marks);
                  }
                }
                return true;
              }).run();
            if (split) this.editor.view.dispatch(closeHistory(this.editor.state.tr));
            return split;
          },
          Delete: () => {
            const { state } = this.editor;
            const { selection } = state;
            const { $from } = selection;
            const itemDepth = $from.depth - 1;
            if (!selection.empty || !$from.parent.isTextblock || $from.parentOffset !== $from.parent.content.size
              || itemDepth < 2 || $from.node(itemDepth).type.name !== itemName) return false;
            const item = $from.node(itemDepth);
            const list = $from.node(itemDepth - 1);
            const index = $from.index(itemDepth - 1);
            const isList = (node: typeof item) => ['orderedList', 'bulletList'].includes(node.type.name);
            const onlyParagraphs = (node: typeof item) => Array.from({ length: node.childCount }, (_, i) => node.child(i)).every(child => child.type.name === 'paragraph');
            const dispatchJoin = (tr: typeof state.tr) => {
              tr.setSelection(TextSelection.create(tr.doc, $from.pos));
              this.editor.view.dispatch(tr.scrollIntoView());
              this.editor.view.dispatch(closeHistory(this.editor.state.tr));
              return true;
            };
            if (!isList(list) || $from.parent.type.name !== 'paragraph') return false;
            const blockIndex = $from.index(itemDepth);
            const childList = blockIndex + 1 < item.childCount ? item.child(blockIndex + 1) : null;
            // Docs removes the next paragraph's marker and joins its text.
            // Lifting a first child with the standard keymap leaves two lines.
            if (childList && isList(childList) && onlyParagraphs(childList.firstChild!)) {
              const first = childList.firstChild!;
              const blocks = Array.from({ length: item.childCount }, (_, i) => item.child(i));
              const merged = $from.parent.copy($from.parent.content.append(first.firstChild!.content));
              const continuations = Array.from({ length: first.childCount - 1 }, (_, i) => {
                const block = first.child(i + 1);
                const style = block.attrs.documentStyle ?? {};
                return block.type.create({ ...block.attrs, documentStyle: { ...style, 'margin-left': `${pointSize(style['margin-left'] ?? '', 0) + 36}pt` } }, block.content, block.marks);
              });
              const remainder = childList.content.cut(first.nodeSize);
              blocks.splice(blockIndex, 2, merged, ...continuations, ...(remainder.size ? [childList.copy(remainder)] : []));
              return dispatchJoin(closeHistory(state.tr).replaceWith($from.before(itemDepth), $from.after(itemDepth), item.copy(Fragment.from(blocks))));
            }
            if (blockIndex !== item.childCount - 1) return false;
            // Last child -> following parent: retain the child's marker, then
            // continue the following parent's child list at this same depth.
            const parentDepth = itemDepth - 2;
            if (index + 1 === list.childCount && parentDepth >= 2 && onlyParagraphs(item)) {
              const parent = $from.node(parentDepth);
              const outer = $from.node(parentDepth - 1);
              const parentIndex = $from.index(parentDepth - 1);
              if (parent.type === item.type && isList(outer) && $from.index(parentDepth) === parent.childCount - 1 && parentIndex + 1 < outer.childCount) {
                const nextParent = outer.child(parentIndex + 1);
                const following = nextParent.childCount === 2 ? nextParent.child(1) : null;
                const compatible = !following || (following.type === list.type
                  && JSON.stringify(following.attrs) === JSON.stringify(list.attrs)
                  && Array.from({ length: following.childCount }, (_, i) => following.child(i)).every(onlyParagraphs));
                if (nextParent.firstChild?.type.name === 'paragraph' && nextParent.childCount <= 2 && (nextParent.childCount === 1 || following && isList(following)) && compatible) {
                  const blocks = Array.from({ length: item.childCount }, (_, i) => item.child(i));
                  blocks[blockIndex] = $from.parent.copy($from.parent.content.append(nextParent.firstChild.content));
                  const children = list.content.cut(0, list.content.size - item.nodeSize).append(Fragment.from(item.copy(Fragment.from(blocks)))).append(following?.content ?? Fragment.empty);
                  const parentBlocks = Array.from({ length: parent.childCount }, (_, i) => parent.child(i));
                  parentBlocks[parentBlocks.length - 1] = list.copy(children);
                  const nextPosition = $from.after(parentDepth);
                  const tr = closeHistory(state.tr).delete(nextPosition, nextPosition + nextParent.nodeSize)
                    .replaceWith($from.before(parentDepth), $from.after(parentDepth), parent.copy(Fragment.from(parentBlocks)));
                  return dispatchJoin(tr);
                }
              }
            }
            if (index + 1 >= list.childCount) return false;
            const next = list.child(index + 1);
            if (next.type !== item.type) return false;
            // Keep the usual same-level text join, with an undo boundary on
            // both sides. Unsupported objects retain their standard keymap.
            if (!onlyParagraphs(item) || next.firstChild?.type.name !== 'paragraph') return false;
            for (let i = 1; i < next.childCount; i++) {
              const block = next.child(i);
              if (block.type.name !== 'paragraph' && !(isList(block) && Array.from({ length: block.childCount }, (_, j) => block.child(j)).every(onlyParagraphs))) return false;
            }
            const tr = closeHistory(state.tr).join($from.after(itemDepth), 2);
            this.editor.view.dispatch(tr.scrollIntoView());
            this.editor.view.dispatch(closeHistory(this.editor.state.tr));
            return true;
          },
          Backspace: () => {
            const { state } = this.editor;
            const { selection } = state;
            const { $from } = selection;
            if (!selection.empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false;
            const itemDepth = $from.depth - 1;
            const parentIsItem = itemDepth >= 2 && $from.node(itemDepth).type.name === itemName;
            const markerParagraph = parentIsItem && $from.index(itemDepth) === 0 && !$from.node(itemDepth).attrs.markerHidden;
            // The next Backspace on an unnumbered paragraph resets its entire
            // indent, without merging its text. A continuation stays in its
            // parent item so surrounding nested lists retain their numbering.
            if (!markerParagraph && ['paragraph', 'heading'].includes($from.parent.type.name)
              && (parentIsItem || $from.depth === 1)) {
              let listIndent = 0;
              for (let depth = 1; depth < $from.depth; depth++) {
                if (['orderedList', 'bulletList'].includes($from.node(depth).type.name)) listIndent += 36;
              }
              const style = $from.parent.attrs.documentStyle ?? {};
              if (listIndent + pointSize(style['margin-left'] ?? '', 0) > 0) {
                const nextStyle = { ...style };
                if (listIndent) nextStyle['margin-left'] = `${-listIndent}pt`;
                else delete nextStyle['margin-left'];
                const tr = closeHistory(state.tr).setNodeMarkup($from.before(), undefined, {
                  ...$from.parent.attrs,
                  documentStyle: Object.keys(nextStyle).length ? nextStyle : null,
                });
                if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
                this.editor.view.dispatch(tr.scrollIntoView());
                this.editor.view.dispatch(closeHistory(this.editor.state.tr));
                return true;
              }
              // At zero indent, join the preceding text, including the last
              // textblock of a child list. ProseMirror otherwise lifts a nested
              // continuation and groups a root join with the indent reset.
              const retained = parentIsItem ? $from.node(itemDepth) : null;
              const children = retained?.childCount === 2 ? retained.child(1) : null;
              if (retained?.attrs.markerHidden && $from.index(itemDepth) === 0
                && $from.parent.type.name === 'paragraph' && children
                && ['orderedList', 'bulletList'].includes(children.type.name)
                && Array.from({ length: children.childCount }, (_, i) => children.child(i))
                  .every(child => Array.from({ length: child.childCount }, (_, i) => child.child(i)).every(block => block.type.name === 'paragraph'))
                && $from.index(itemDepth - 1) === 0
                && listIndent + pointSize(style['margin-left'] ?? '', 0) === 0) {
                if (itemDepth === 2 && $from.before(itemDepth - 1) === 0) return true;
                const parentDepth = itemDepth - 2;
                const listIndex = $from.index(parentDepth);
                const ancestor = parentDepth >= 2 && $from.node(parentDepth).type.name === itemName
                  && listIndex > 0 ? $from.node(parentDepth).child(listIndex - 1) : null;
                if (ancestor?.type.name === 'paragraph') {
                  const join = $from.before(itemDepth - 1) - 1;
                  const tr = closeHistory(state.tr).delete($from.before(), $from.after()).insert(join, $from.parent.content);
                  tr.setSelection(TextSelection.create(tr.doc, join));
                  this.editor.view.dispatch(tr.scrollIntoView());
                  this.editor.view.dispatch(closeHistory(this.editor.state.tr));
                  return true;
                }
              }
              const index = $from.index(itemDepth);
              let previous = index > 0 ? $from.node(itemDepth).child(index - 1) : null;
              if (previous && (parentIsItem || ['orderedList', 'bulletList'].includes(previous.type.name)
                || $from.parent.type.name === 'paragraph' && previous.type.name === 'paragraph')
                && listIndent + pointSize(style['margin-left'] ?? '', 0) === 0) {
                let position = $from.before() - previous.nodeSize;
                while (previous && ['orderedList', 'bulletList', itemName].includes(previous.type.name)) {
                  const last = previous.lastChild;
                  position += 1 + previous.content.size - (last?.nodeSize ?? 0);
                  previous = last;
                }
                if (previous && ['paragraph', 'heading'].includes(previous.type.name)) {
                  const join = position + 1 + previous.content.size;
                  const tr = closeHistory(state.tr).delete($from.before(), $from.after()).insert(join, $from.parent.content);
                  tr.setSelection(TextSelection.create(tr.doc, join));
                  this.editor.view.dispatch(tr.scrollIntoView());
                  // The next typed character is a separate undo gesture too.
                  this.editor.view.dispatch(closeHistory(this.editor.state.tr));
                  return true;
                }
              }
            }
            if (itemDepth < 2 || $from.node(itemDepth).type.name !== itemName || $from.index(itemDepth) !== 0) return false;
            // Leave input-rule undo ahead of the structural command, as in the
            // standard keymap (e.g. Backspace immediately after typing "1. ").
            if (this.editor.commands.undoInputRule()) return true;
            const item = $from.node(itemDepth);
            if (item.attrs.markerHidden) return false;
            const listDepth = itemDepth - 1;
            const list = $from.node(listDepth);
            if (!['orderedList', 'bulletList'].includes(list.type.name)) return false;
            const itemIndex = $from.index(listDepth);
            const previous = itemIndex > 0 ? list.child(itemIndex - 1) : null;
            // A continuation in the preceding item keeps child lists at their
            // original depth while removing only this paragraph's marker.
            const isText = (node: typeof item) => ['paragraph', 'heading'].includes(node.type.name);
            const hasChildren = Array.from({ length: item.childCount }, (_, i) => item.child(i)).some(block => ['orderedList', 'bulletList'].includes(block.type.name));
            const supportedBranch = (node: typeof item): boolean => {
              if (isText(node)) return true;
              if (![itemName, 'orderedList', 'bulletList'].includes(node.type.name)) return false;
              return Array.from({ length: node.childCount }, (_, i) => node.child(i)).every(supportedBranch);
            };
            const textOnly = (node: typeof item) => Array.from({ length: node.childCount }, (_, i) => node.child(i)).every(isText);
            // A first marker has no preceding item to hold a continuation.
            // Keep its list shell so children retain depth and later siblings
            // retain their numbers, as in Docs (2 / b after the first removal).
            if (itemIndex === 0 && item.childCount === 2 && isText(item.firstChild!)
              && ['orderedList', 'bulletList'].includes(item.child(1).type.name)
              && Array.from({ length: item.child(1).childCount }, (_, i) => item.child(1).child(i)).every(textOnly)) {
              const tr = closeHistory(state.tr).setNodeMarkup($from.before(itemDepth), undefined, { ...item.attrs, markerHidden: true });
              if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
              this.editor.view.dispatch(tr.scrollIntoView());
              this.editor.view.dispatch(closeHistory(this.editor.state.tr));
              return true;
            }
            const oldChildren = previous?.lastChild;
            const newChildren = item.childCount === 2 ? item.child(1) : null;
            // Two matching child lists become one numbering sequence, even
            // though the unmarked parent paragraph separates their wrappers.
            const continuesChildren = previous?.childCount === 2 && isText(previous.firstChild!)
              && oldChildren && newChildren && ['orderedList', 'bulletList'].includes(oldChildren.type.name)
              && oldChildren.sameMarkup(newChildren)
              && Array.from({ length: oldChildren.childCount }, (_, i) => oldChildren.child(i)).every(textOnly)
              && Array.from({ length: newChildren.childCount }, (_, i) => newChildren.child(i)).every(textOnly);
            if (hasChildren && previous?.type === item.type && supportedBranch(item)
              && (textOnly(previous) || continuesChildren)) {
              const start = $from.before(itemDepth) - previous.nodeSize;
              const caret = start + previous.content.size + 2;
              const content = continuesChildren && newChildren.type.name === 'orderedList'
                ? item.content.replaceChild(1, newChildren.type.create({ ...newChildren.attrs, start: oldChildren.attrs.start + oldChildren.childCount }, newChildren.content, newChildren.marks))
                : item.content;
              const tr = closeHistory(state.tr).replaceWith(start, $from.after(itemDepth), previous.copy(previous.content.append(content)));
              tr.setSelection(TextSelection.create(tr.doc, caret));
              if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
              this.editor.view.dispatch(tr.scrollIntoView());
              this.editor.view.dispatch(closeHistory(this.editor.state.tr));
              return true;
            }
            // A child list/other block needs its own split-and-anchor contract.
            // This command only removes markers from textblock-only items.
            for (let i = 0; i < item.childCount; i++) if (!['paragraph', 'heading'].includes(item.child(i).type.name)) return false;
            // Removing the last child also releases a first unmarked shell.
            // Once it owns no sublist, Docs no longer counts that hidden item
            // in the following sequence. Keep the lifted text's full indent.
            const shellDepth = itemDepth - 2;
            const shell = shellDepth >= 2 ? $from.node(shellDepth) : null;
            const shellList = shell ? $from.node(shellDepth - 1) : null;
            if (itemIndex === 0 && list.childCount === 1 && item.childCount === 1
              && item.firstChild!.type.name === 'paragraph' && shell?.type.name === itemName
              && shell.attrs.markerHidden && shellList
              && ['orderedList', 'bulletList'].includes(shellList.type.name)
              && $from.index(shellDepth - 1) === 0 && $from.index(shellDepth) === shell.childCount - 1
              && shell.childCount <= 2 && (shell.childCount === 1 || shell.firstChild!.type.name === 'paragraph')) {
              const lifted = (block: typeof item, indent: number) => {
                const style = { ...block.attrs.documentStyle };
                const left = pointSize(style['margin-left'] ?? '', 0) + indent;
                if (left) style['margin-left'] = `${left}pt`;
                else delete style['margin-left'];
                return block.type.create({ ...block.attrs, documentStyle: Object.keys(style).length ? style : null }, block.content, block.marks);
              };
              const blocks = shell.childCount === 2 ? [lifted(shell.firstChild!, 36)] : [];
              const start = $from.before(shellDepth - 1);
              const caret = start + blocks.reduce((size, block) => size + block.nodeSize, 0) + 1;
              blocks.push(lifted(item.firstChild!, 72));
              const remaining = shellList.content.cut(shell.nodeSize);
              if (remaining.size) blocks.push(shellList.copy(remaining));
              const tr = closeHistory(state.tr).replaceWith(start, $from.after(shellDepth - 1), Fragment.from(blocks));
              tr.setSelection(TextSelection.create(tr.doc, caret));
              if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
              this.editor.view.dispatch(tr.scrollIntoView());
              this.editor.view.dispatch(closeHistory(this.editor.state.tr));
              return true;
            }
            const range = $from.blockRange(state.doc.resolve($from.end(itemDepth)), node => node === item);
            if (!range || liftTarget(range) !== listDepth - 1) return false;
            const tr = closeHistory(state.tr).lift(range, listDepth - 1);
            // Lifting the contents rather than the item keeps a nested removal
            // unnumbered. Keep the lost list padding as direct paragraph indent.
            const first = tr.mapping.map($from.start(itemDepth));
            let position = first;
            item.forEach(block => {
              const style = block.attrs.documentStyle ?? {};
              tr.setNodeMarkup(position, undefined, { ...block.attrs, documentStyle: { ...style, 'margin-left': `${pointSize(style['margin-left'] ?? '', 0) + 36}pt` } });
              position += block.nodeSize;
            });
            // Splitting an ordered list must count only its surviving markers.
            const remaining = tr.doc.nodeAt(position);
            if (remaining?.type === list.type && list.type.name === 'orderedList') tr.setNodeMarkup(position, undefined, { ...remaining.attrs, start: list.attrs.start + itemIndex });
            this.editor.view.dispatch(tr.scrollIntoView());
            this.editor.view.dispatch(closeHistory(this.editor.state.tr));
            return true;
          },
          Tab: () => {
            const { selection } = this.editor.state;
            if (!this.editor.isActive(itemName)) return false;
            // Docs inserts a literal tab inside the text; indentation belongs
            // to the start of the paragraph or a selection of list items.
            if (selection.empty && selection.$from.parentOffset > 0) return this.editor.commands.command(({ tr, dispatch }) => {
              if (dispatch) closeHistory(tr).insertText('\t').scrollIntoView();
              return true;
            });
            this.editor.commands.sinkListItem(itemName);
            return true;
          },
          'Shift-Tab': () => {
            if (!this.editor.isActive(itemName)) return false;
            this.editor.commands.liftListItem(itemName);
            return true;
          },
        };
      },
    })];
  },
  addCommands() {
    return {
      ...this.parent?.(),
      sinkListItem: typeOrName => ({ state, dispatch }) => {
        const itemType = getNodeType(typeOrName, state.schema);
        const { $from, $to } = state.selection;
        const range = $from.blockRange($to, node => node.childCount > 0 && node.firstChild?.type === itemType);
        const previous = range && range.startIndex > 0 ? range.parent.child(range.startIndex - 1) : null;
        // Joining an existing child list keeps its imported marker and start.
        // Only the child created by this gesture receives the default cycle.
        const createsOrderedList = range?.parent.type === this.type && previous?.lastChild?.type !== this.type;
        let depth = 0;
        if (range) for (let level = 0; level <= range.depth; level++) {
          if (['orderedList', 'bulletList'].includes($from.node(level).type.name)) depth++;
        }
        return sinkListItem(itemType)(state, dispatch ? transaction => {
          if (createsOrderedList) {
            const cursor = transaction.selection.$from;
            for (let level = cursor.depth; level > 0; level--) {
              if (cursor.node(level).type !== this.type) continue;
              transaction.setNodeMarkup(cursor.before(level), undefined, { ...cursor.node(level).attrs, start: 1, type: ['1', 'a', 'i'][depth % 3] });
              break;
            }
          }
          dispatch(transaction);
        } : undefined);
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const { start, type, ...attributes } = HTMLAttributes;
    const marker = ['a', 'A', 'i', 'I'].includes(type)
      ? ({ a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' } as Record<string, string>)[type]
      : 'decimal';
    return ['ol', mergeAttributes(this.options.HTMLAttributes, attributes, {
      ...(start !== 1 ? { start } : {}),
      ...(type && type !== '1' ? { type } : {}),
      ...(marker !== 'decimal' ? { style: `list-style-type:${marker}` } : {}),
    }), 0];
  },
});
