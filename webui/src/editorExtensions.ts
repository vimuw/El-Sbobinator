import React from 'react';
import katex from 'katex';
import { Extension, Node, mergeAttributes, textInputRule, type Editor as TiptapEditor, type JSONContent } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      setSearchTerm: (term: string, currentIndex?: number, matchCase?: boolean) => ReturnType;
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

            newState.doc.descendants((node: ProseMirrorNode, pos: number) => {
              if (!node.isText || !node.text) return;
              const nodeText = matchCase ? node.text : node.text.toLowerCase();
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
});

function MathNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [latex, setLatex] = React.useState(node.attrs.latex || '');

  React.useEffect(() => {
    setLatex(node.attrs.latex || '');
  }, [node.attrs.latex]);

  const html = React.useMemo(() => {
    const raw = node.attrs.latex || 'E=mc^2';
    try {
      return katex.renderToString(raw, { displayMode: false, throwOnError: false });
    } catch {
      return raw;
    }
  }, [node.attrs.latex]);

  if (isEditing) {
    return React.createElement(
      NodeViewWrapper,
      { as: 'span', className: `math-node-wrapper ${selected ? 'is-selected' : ''}` },
      React.createElement(
        'span',
        { className: 'math-inline-edit inline-flex items-center gap-1.5 bg-[var(--bg-elevated)] p-1 rounded-lg border border-blue-500' },
        React.createElement('span', { className: 'text-xs font-mono font-semibold text-blue-500' }, 'TeX:'),
        React.createElement('input', {
          type: 'text',
          value: latex,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setLatex(e.target.value),
          onBlur: () => { updateAttributes({ latex }); setIsEditing(false); },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') { updateAttributes({ latex }); setIsEditing(false); }
          },
          autoFocus: true,
          className: 'app-input font-mono text-xs px-2 py-0.5 min-w-[120px]',
        })
      )
    );
  }

  return React.createElement(
    NodeViewWrapper,
    { as: 'span', className: `math-node-wrapper ${selected ? 'is-selected' : ''}` },
    React.createElement('span', {
      className: 'math-rendered cursor-pointer inline-block px-1.5 py-0.5 rounded transition-all hover:bg-blue-500/10 hover:ring-1 hover:ring-blue-500/30',
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
    let katexHtml = '';
    try {
      katexHtml = katex.renderToString(HTMLAttributes.latex || '', { displayMode: false, throwOnError: false });
    } catch {
      katexHtml = HTMLAttributes.latex || '';
    }
    return [
      'span',
      mergeAttributes({
        'data-math': HTMLAttributes.latex || '',
        class: 'math-node-inline',
        title: HTMLAttributes.latex || '',
      }),
      ['span', { class: 'math-rendered-html' }, katexHtml],
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

function MathBlockNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [latex, setLatex] = React.useState(node.attrs.latex || '');

  React.useEffect(() => {
    setLatex(node.attrs.latex || '');
  }, [node.attrs.latex]);

  const html = React.useMemo(() => {
    const raw = node.attrs.latex || 'E=mc^2';
    try {
      return katex.renderToString(raw, { displayMode: true, throwOnError: false });
    } catch {
      return raw;
    }
  }, [node.attrs.latex]);

  if (isEditing) {
    return React.createElement(
      NodeViewWrapper,
      { as: 'div', className: `math-block-wrapper my-2 p-2 rounded border border-blue-500 bg-[var(--bg-elevated)] ${selected ? 'is-selected' : ''}` },
      React.createElement(
        'div',
        { className: 'flex flex-col gap-2' },
        React.createElement('span', { className: 'text-xs font-mono font-semibold text-blue-500' }, 'Formula LaTeX (Block):'),
        React.createElement('textarea', {
          value: latex,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setLatex(e.target.value),
          onBlur: () => { updateAttributes({ latex }); setIsEditing(false); },
          onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { updateAttributes({ latex }); setIsEditing(false); }
          },
          autoFocus: true,
          className: 'app-input font-mono text-xs p-2 w-full min-h-[60px]',
          placeholder: 'Inserisci formula LaTeX...'
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => { updateAttributes({ latex }); setIsEditing(false); },
            className: 'self-end px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded'
          },
          'Salva (Ctrl+Enter)'
        )
      )
    );
  }

  return React.createElement(
    NodeViewWrapper,
    { as: 'div', className: `math-block-wrapper my-2 text-center ${selected ? 'is-selected' : ''}` },
    React.createElement('div', {
      className: 'math-rendered cursor-pointer inline-block p-2 rounded transition-all hover:bg-blue-500/10 hover:ring-1 hover:ring-blue-500/30',
      onClick: () => setIsEditing(true),
      title: 'Clicca per modificare la formula LaTeX',
      dangerouslySetInnerHTML: { __html: html },
    })
  );
}

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
    let katexHtml = '';
    try {
      katexHtml = katex.renderToString(HTMLAttributes.latex || '', { displayMode: true, throwOnError: false });
    } catch {
      katexHtml = HTMLAttributes.latex || '';
    }
    return [
      'div',
      mergeAttributes({
        'data-math-block': HTMLAttributes.latex || '',
        class: 'math-node-block',
        title: HTMLAttributes.latex || '',
      }),
      ['div', { class: 'math-rendered-html' }, katexHtml],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockNodeView);
  },
});

import { defaultSelectionBuilder, yCursorPlugin } from '@tiptap/y-tiptap';
import type { DecorationAttrs } from '@tiptap/pm/view';
import type { Awareness } from 'y-protocols/awareness';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    collaborationCursor: {
      updateUser: (attributes: { name: string; color: string }) => ReturnType;
    };
  }
}

export interface CollaborationCursorOptions {
  provider: { awareness?: Awareness } | null;
  user: { name: string; color: string };
  render?: (user: { name: string; color: string }) => HTMLElement;
  selectionRender?: (user: { name: string; color: string }) => DecorationAttrs;
}

export const MAX_COLLAB_USERNAME_LENGTH = 32;
export const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

export const CollaborationCursor = Extension.create<CollaborationCursorOptions>({
  name: 'collaborationCursor',

  addOptions() {
    return {
      provider: null,
      user: {
        name: 'Studente',
        color: '#3b82f6',
      },
      render: user => {
        const cursor = document.createElement('span');
        cursor.classList.add('collaboration-cursor__caret', 'ProseMirror-yjs-cursor');
        const safeColor = typeof user.color === 'string' && HEX_COLOR_REGEX.test(user.color)
          ? user.color
          : '#3b82f6';
        cursor.style.borderLeftColor = safeColor;
        cursor.style.borderLeftStyle = 'solid';
        cursor.style.borderLeftWidth = '2px';

        const label = document.createElement('div');
        label.classList.add('collaboration-cursor__label');
        label.style.backgroundColor = safeColor;
        label.style.color = '#ffffff';
        label.style.whiteSpace = 'nowrap';
        label.style.width = 'max-content';
        const rawName = (user.name || 'Studente').trim();
        label.textContent = (rawName.length > MAX_COLLAB_USERNAME_LENGTH
          ? rawName.slice(0, MAX_COLLAB_USERNAME_LENGTH)
          : rawName) || 'Studente';

        const zeroWidth1 = document.createTextNode('\u2060');
        const zeroWidth2 = document.createTextNode('\u2060');

        cursor.appendChild(zeroWidth1);
        cursor.appendChild(label);
        cursor.appendChild(zeroWidth2);
        return cursor;
      },
      selectionRender: defaultSelectionBuilder,
    };
  },

  addCommands() {
    return {
      updateUser: (attributes: { name: string; color: string }) => () => {
        this.options.user = attributes;
        this.options.provider?.awareness?.setLocalStateField('user', attributes);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.provider?.awareness) {
      return [];
    }
    return [
      yCursorPlugin(
        (() => {
          this.options.provider.awareness.setLocalStateField('user', this.options.user);
          return this.options.provider.awareness;
        })(),
        {
          cursorBuilder: this.options.render,
          selectionBuilder: this.options.selectionRender,
        },
      ),
    ];
  },
});
