import React from 'react';
import katex from 'katex';
import { Extension, Node, mergeAttributes, textInputRule, type Editor as TiptapEditor, type JSONContent } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EMPTY_PARAGRAPH_ATTRIBUTE } from './editorLineSpacing';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { MathEditorField } from './components/MathEditorField';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import HeadingExtension from '@tiptap/extension-heading';
import ParagraphExtension from '@tiptap/extension-paragraph';
import HardBreakExtension from '@tiptap/extension-hard-break';

// A soft break owns a character style in Docs. StarterKit keeps the typing
// marks after the break but inserts the break itself without any marks.
export const CustomHardBreak = HardBreakExtension.extend({
  addCommands() {
    return {
      setHardBreak: () => ({ commands, chain, state, editor }) => commands.first([
        () => commands.exitCode(),
        () => commands.command(() => {
          const { selection, storedMarks } = state;
          if (selection.$from.parent.type.spec.isolating) return false;
          // At the start of a text block, a caret inherits the first character's
          // marks. Explicit stored marks (including an empty set) still win.
          // A range within one block inherits its first selected character,
          // rather than the preceding character at a formatting boundary.
          const selectedMarks = !selection.empty && selection.$from.sameParent(selection.$to)
            ? selection.$from.nodeAfter?.marks
            : undefined;
          const marks = storedMarks ?? selectedMarks ?? (selection.empty || selection.$to.parentOffset ? selection.$from.marks() : []);
          const kept = this.options.keepMarks ? marks.filter(mark => editor.extensionManager.splittableMarks.includes(mark.type.name)) : [];
          return chain()
            .insertContent({ type: this.name, marks: kept.map(mark => mark.toJSON()) })
            .command(({ tr }) => { if (this.options.keepMarks) tr.ensureMarks(kept); return true; })
            .scrollIntoView()
            .run();
        }),
      ]),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      setSearchTerm: (term: string, currentIndex?: number, matchCase?: boolean) => ReturnType;
    };
    blockTypography: {
      clearBlockFontSize: () => ReturnType;
    };
  }
}

export interface Heading {
  id: string;
  level: number;
  text: string;
}

export const extractHeadings = (editor: TiptapEditor): Heading[] => {
  const json = editor.getJSON() as JSONContent;
  const result: Heading[] = [];
  json.content?.forEach((node: JSONContent, idx: number) => {
    if (node.type === 'heading') {
      const text = node.content?.map((n: JSONContent) => n.text ?? '').join('') ?? '';
      if (text.trim()) result.push({ id: `h-${idx}`, level: node.attrs?.level ?? 2, text });
    }
  });
  return result;
};

export interface SearchMatch {
  from: number;
  to: number;
}

interface SearchHighlightPluginState {
  searchTerm: string;
  currentIndex: number;
  matchCase: boolean;
  matches: SearchMatch[];
  decorations: DecorationSet;
}

const searchHighlightKey = new PluginKey<SearchHighlightPluginState>('searchHighlight');

export const getSearchMatches = (editor: TiptapEditor): SearchMatch[] => {
  return searchHighlightKey.getState(editor.state)?.matches ?? [];
};

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addCommands() {
    return {
      setSearchTerm:
        (term: string, currentIndex = -1, matchCase = false) =>
        ({ view }: { view: EditorView }) => {
          view.dispatch(
            view.state.tr.setMeta(searchHighlightKey, { term, currentIndex, matchCase }),
          );
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchHighlightPluginState>({
        key: searchHighlightKey,
        state: {
          init(): SearchHighlightPluginState {
            return { searchTerm: '', currentIndex: -1, matchCase: false, matches: [], decorations: DecorationSet.empty };
          },
          apply(tr, value, _old, newState): SearchHighlightPluginState {
            const meta = tr.getMeta(searchHighlightKey) as
              | { term: string; currentIndex: number; matchCase?: boolean }
              | undefined;
            const searchTerm = meta !== undefined ? meta.term : value.searchTerm;
            const currentIndex = meta !== undefined ? meta.currentIndex : value.currentIndex;
            const matchCase = meta !== undefined ? (meta.matchCase ?? false) : value.matchCase;

            if (!searchTerm) {
              return { searchTerm: '', currentIndex: -1, matchCase: false, matches: [], decorations: DecorationSet.empty };
            }

            if (meta === undefined && !tr.docChanged) {
              return { searchTerm, currentIndex, matchCase, matches: value.matches, decorations: value.decorations.map(tr.mapping, tr.doc) };
            }

            const decorations: Decoration[] = [];
            const matches: SearchMatch[] = [];
            const searchStr = matchCase ? searchTerm : searchTerm.toLowerCase();
            let matchIdx = 0;

            const searchRun = (text: string, pos: number) => {
              const nodeText = matchCase ? text : text.toLowerCase();
              let idx = 0;
              while ((idx = nodeText.indexOf(searchStr, idx)) !== -1) {
                const from = pos + idx;
                const to = from + searchTerm.length;
                matches.push({ from, to });
                decorations.push(
                  Decoration.inline(from, to, {
                    class:
                      matchIdx === currentIndex
                        ? 'search-highlight-active'
                        : 'search-highlight',
                  }),
                );
                idx += searchStr.length;
                matchIdx++;
              }
            };
            newState.doc.descendants((node: ProseMirrorNode, pos: number) => {
              if (!node.isTextblock) return;
              let text = '';
              let start = pos + 1;
              node.forEach((child, offset) => {
                if (child.isText) {
                  if (!text) start = pos + 1 + offset;
                  text += child.text;
                } else {
                  searchRun(text, start);
                  text = '';
                }
              });
              searchRun(text, start);
              return false;
            });

            return {
              searchTerm,
              currentIndex,
              matchCase,
              matches,
              decorations: DecorationSet.create(newState.doc, decorations),
            };
          },
        },
        props: {
          decorations(state) {
            return searchHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: el => (el as HTMLElement).style.fontSize || null,
          renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (fontSize: string) => ({ chain }) => {
        return chain()
          .setMark('textStyle', { fontSize })
          .run();
      },
      unsetFontSize: () => ({ chain }) => {
        return chain()
          .setMark('textStyle', { fontSize: null })
          .removeEmptyTextStyle()
          .run();
      },
      clearBlockFontSize: () => ({ tr, state }) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isTextblock) {
            const start = pos + 1;
            const end = pos + node.nodeSize - 1;
            if (start < end) {
              node.nodesBetween(0, node.content.size, (child, childOffset) => {
                if (child.isText && child.marks) {
                  const textStyleMark = child.marks.find(m => m.type.name === 'textStyle' && m.attrs?.fontSize);
                  if (textStyleMark) {
                    const childFrom = start + childOffset;
                    const childTo = childFrom + child.nodeSize;
                    const remainingAttrs = { ...textStyleMark.attrs };
                    delete remainingAttrs.fontSize;
                    tr.removeMark(childFrom, childTo, state.schema.marks.textStyle);
                    if (Object.values(remainingAttrs).some(v => v !== null && v !== undefined && v !== '')) {
                      tr.addMark(childFrom, childTo, state.schema.marks.textStyle.create(remainingAttrs));
                    }
                  }
                }
              });
            }
          }
        });
        if (state.storedMarks) {
          const storedTextStyle = state.storedMarks.find(m => m.type.name === 'textStyle' && m.attrs?.fontSize);
          if (storedTextStyle) {
            const remainingAttrs = { ...storedTextStyle.attrs };
            delete remainingAttrs.fontSize;
            const newStoredMarks = state.storedMarks.filter(m => m.type.name !== 'textStyle');
            if (Object.values(remainingAttrs).some(v => v !== null && v !== undefined && v !== '')) {
              newStoredMarks.push(state.schema.marks.textStyle.create(remainingAttrs));
            }
            tr.setStoredMarks(newStoredMarks);
          }
        }
        return true;
      },
    };
  },
});

// HTML's default whitespace rules would collapse authored spaces and tabs on
// reopen. Mark only blocks that need preservation; ordinary imported HTML
// continues to use the normal parser rules.
function authoredWhitespaceAttributes(node: ProseMirrorNode) {
  return /^\s|\s$|[ \t]{2}|\t|\n/.test(node.textContent) ? { style: 'white-space:pre-wrap' } : {};
}

export const CustomHeading = HeadingExtension.extend({
  parseHTML() {
    return [
      ...this.options.levels.map(level => ({
        tag: `h${level}[style]`,
        getAttrs: (element: HTMLElement) => element.style.whiteSpace === 'pre-wrap' ? { level } : false,
        preserveWhitespace: 'full' as const,
      })),
      ...(this.parent?.() ?? []),
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return this.parent!({ node, HTMLAttributes: mergeAttributes(HTMLAttributes, authoredWhitespaceAttributes(node)) });
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setHeading: attributes => ({ chain }) => {
        return chain()
          .clearBlockFontSize()
          .setNode(this.name, attributes)
          .run();
      },
      toggleHeading: attributes => ({ chain }) => {
        return chain()
          .clearBlockFontSize()
          .toggleNode(this.name, 'paragraph', attributes)
          .run();
      },
    };
  },
});

export const CustomParagraph = ParagraphExtension.extend({
  parseHTML() {
    return [{
      tag: `div[${EMPTY_PARAGRAPH_ATTRIBUTE}="true"]`,
      // Only our exact empty transport shell is a paragraph. Never discard
      // text or objects pasted inside a malformed/foreign marked container.
      getAttrs: element => element.childNodes.length === 1 && element.firstElementChild?.tagName === 'BR' ? {} : false,
      getContent: () => Fragment.empty,
    }, {
      tag: 'p[style]',
      getAttrs: element => element.style.whiteSpace === 'pre-wrap' ? null : false,
      preserveWhitespace: 'full',
    }, ...this.parent?.() ?? []];
  },
  renderHTML({ node, HTMLAttributes }) {
    return this.parent!({ node, HTMLAttributes: mergeAttributes(HTMLAttributes, authoredWhitespaceAttributes(node)) });
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setParagraph: () => ({ chain }) => {
        return chain()
          .clearBlockFontSize()
          .setNode(this.name)
          .run();
      },
    };
  },
});

export const escapeHtml = (text: string): string =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function renderedMathContent(latex: string, displayMode: boolean): HTMLElement {
  const rendered = document.createElement(displayMode ? 'div' : 'span');
  rendered.className = 'math-rendered-html';
  try {
    // KaTeX generates the markup with trust disabled. A DOM node prevents the
    // serializer from escaping that markup into visible HTML source on paste.
    rendered.innerHTML = katex.renderToString(latex, { displayMode, throwOnError: false, trust: false });
  } catch { rendered.textContent = latex; }
  return rendered;
}

function MathNodeView({ node, selected, editor, getPos }: NodeViewProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const displayMode = node.type.name === 'mathBlock';
  const html = React.useMemo(() => {
    const raw = node.attrs.latex || '';
    try {
      return katex.renderToString(raw, { displayMode, throwOnError: false, trust: false });
    } catch {
      return `<span class="katex-error">${escapeHtml(raw)}</span>`;
    }
  }, [node.attrs.latex, displayMode]);

  const finish = (returnFocus: boolean, latex?: string) => {
    if (editor.isDestroyed) return;
    const pos = getPos();
    // A node view can disappear while an external transaction is applied.
    if (typeof pos !== 'number' || editor.state.doc.nodeAt(pos)?.type !== node.type) return;
    let tr = editor.state.tr;
    if (latex !== undefined && latex !== node.attrs.latex) {
      tr = closeHistory(tr).setNodeMarkup(pos, undefined, { ...node.attrs, latex });
    }
    if (returnFocus) tr.setSelection(TextSelection.near(tr.doc.resolve(pos + node.nodeSize))).scrollIntoView();
    editor.view.dispatch(tr);
    if (latex !== undefined) editor.view.dispatch(closeHistory(editor.state.tr));
    setIsEditing(false);
    if (returnFocus) editor.view.focus();
  };

  return React.createElement(
    NodeViewWrapper,
    { as: displayMode ? 'div' : 'span', className: `${displayMode ? 'math-block-wrapper' : 'math-node-wrapper'}${selected ? ' is-selected' : ''}` },
    isEditing ? React.createElement(MathEditorField, {
      key: node.attrs.latex, initialLatex: node.attrs.latex || '', displayMode,
      onCommit: (latex: string, returnFocus: boolean) => finish(returnFocus, latex),
      onCancel: (returnFocus: boolean) => finish(returnFocus),
    }) : React.createElement('span', {
      className: 'math-rendered',
      onClick: () => setIsEditing(true),
      title: 'Clicca per modificare la formula LaTeX',
      dangerouslySetInnerHTML: { __html: html },
    })
  );
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: { default: 'E=mc^2' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-math]',
        getAttrs: element => ({ latex: (element as HTMLElement).getAttribute('data-math') || '' }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({
        'data-math': HTMLAttributes.latex || '',
        class: 'math-node-inline',
        title: HTMLAttributes.latex || '',
      }),
      renderedMathContent(HTMLAttributes.latex || '', false),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },
});

export const SmartArrows = Extension.create({
  name: 'smartArrows',
  addInputRules() {
    return [
      textInputRule({ find: /->$/, replace: '→ ' }),
      textInputRule({ find: /<-$/, replace: '← ' }),
      textInputRule({ find: /==>$/, replace: '⇒ ' }),
      textInputRule({ find: /<=>$/, replace: '↔ ' }),
    ];
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      latex: { default: 'E=mc^2' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-math-block]',
        getAttrs: element => ({ latex: (element as HTMLElement).getAttribute('data-math-block') || '' }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({
        'data-math-block': HTMLAttributes.latex || '',
        class: 'math-node-block',
        title: HTMLAttributes.latex || '',
      }),
      renderedMathContent(HTMLAttributes.latex || '', true),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },
});
