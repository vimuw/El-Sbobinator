import { reportClientError } from '../diagnostics';
import React from 'react';
import { createPortal } from 'react-dom';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import {
  Bold,
  Calculator,
  Clipboard,
  Copy,
  ImagePlus,
  Italic,
  Link2,
  RemoveFormatting,
  Scissors,
  Search,
  Trash2,
  Underline as UnderlineIcon,
} from 'lucide-react';
import { getLastHighlightColor } from '../editorUtils';
import { HighlightIcon } from './HighlightIcon';
import { writeEditorClipboard } from '../editorClipboard';
import { pasteEditorClipboard, prepareSelectionClipboard } from '../editorSelectionClipboard';

interface EditorContextMenuProps {
  contextMenu: { x: number; y: number } | null;
  onClose: () => void;
  editor: TiptapEditor | null;
  onOpenImagePicker: () => void;
  onOpenFind: () => void;
}

async function copySelectionToClipboard(editor: TiptapEditor, cut = false) {
  try {
    const { doc, selection } = editor.state;
    const prepared = prepareSelectionClipboard(editor.view);
    if (!prepared) return false;
    await writeEditorClipboard(prepared.html, prepared.plainText, editor.view.dom, prepared.formats);
    if (cut && !editor.isDestroyed && editor.state.doc === doc && editor.state.selection.eq(selection)) {
      editor.view.dispatch(closeHistory(editor.state.tr).deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
      editor.view.focus();
    }
    return true;
  } catch (err) {
    reportClientError('Clipboard error', err);
    return false;
  }
}

export function EditorContextMenu({
  contextMenu,
  onClose,
  editor,
  onOpenImagePicker,
  onOpenFind,
}: EditorContextMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !contextMenu) return;
    const place = () => {
      const { width, height } = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(12, Math.min(contextMenu.x, window.innerWidth - width - 12))}px`;
      menu.style.top = `${Math.max(12, Math.min(contextMenu.y, window.innerHeight - height - 12))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [contextMenu, editor]);
  if (!contextMenu || !editor || editor.isDestroyed) return null;

  return createPortal(
    <div
      className="editor-context-menu fixed z-50 py-1 text-xs select-none"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      ref={menuRef}
      onClick={e => {
        e.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        className="editor-context-menu-item"
        onClick={async () => {
          await copySelectionToClipboard(editor, true);
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Scissors className="h-4 w-4 shrink-0" />
          <span>Taglia</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+X</kbd>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={async () => {
          await copySelectionToClipboard(editor);
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Copy className="h-4 w-4 shrink-0" />
          <span>Copia</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+C</kbd>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={async () => {
          try {
            await pasteEditorClipboard(editor.view);
          } catch (_) {
            reportClientError('Clipboard error');
          }
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Clipboard className="h-4 w-4 shrink-0" />
          <span>Incolla</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+V</kbd>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={async () => {
          try {
            await pasteEditorClipboard(editor.view, true);
          } catch (_) {
            reportClientError('Clipboard error');
          }
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Clipboard className="h-4 w-4 shrink-0" />
          <span>Incolla senza formattazione</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+Shift+V</kbd>
      </button>

      {!editor.state.selection.empty && (
        <button
          type="button"
          className="editor-context-menu-item"
          style={{ color: 'var(--error-text)' }}
          onClick={() => {
            editor.chain().focus().deleteSelection().run();
          }}
        >
          <span className="flex items-center gap-2.5 font-medium" style={{ color: 'var(--error-text)' }}>
            <Trash2 className="h-4 w-4 shrink-0" style={{ color: 'var(--error-text)' }} />
            <span>Elimina selezione</span>
          </span>
          <kbd className="editor-context-menu-shortcut font-mono" style={{ color: 'var(--error-text)' }}>
            Canc
          </kbd>
        </button>
      )}

      <div className="my-1 border-t border-[var(--border-subtle)]" />

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Bold className="h-4 w-4 shrink-0" />
          <span>Grassetto</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+B</kbd>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Italic className="h-4 w-4 shrink-0" />
          <span>Corsivo</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+I</kbd>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <UnderlineIcon className="h-4 w-4 shrink-0" />
          <span>Sottolineato</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+U</kbd>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={() => editor.chain().focus().toggleHighlight({ color: getLastHighlightColor() }).run()}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <HighlightIcon color={getLastHighlightColor()} className="h-4 w-4" />
          <span>Evidenzia</span>
        </span>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={() => {
          if (!editor.state.selection.empty) {
            editor.chain().focus().clearDocumentFormatting().run();
          }
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <RemoveFormatting className="h-4 w-4 shrink-0" />
          <span>Rimuovi formattazione</span>
        </span>
      </button>

      <div className="my-1 border-t border-[var(--border-subtle)]" />

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={() => {
          const url = window.prompt('Inserisci URL del link:');
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Link2 className="h-4 w-4 shrink-0" />
          <span>Inserisci link</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+K</kbd>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={onOpenImagePicker}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <ImagePlus className="h-4 w-4 shrink-0" />
          <span>Inserisci immagine</span>
        </span>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={() => {
          editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: 'E=mc^2' } }).run();
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Calculator className="h-4 w-4 shrink-0" />
          <span>Inserisci formula LaTeX</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+M</kbd>
      </button>

      <button
        type="button"
        className="editor-context-menu-item"
        onClick={onOpenFind}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Search className="h-4 w-4 shrink-0" />
          <span>Trova e sostituisci</span>
        </span>
        <kbd className="editor-context-menu-shortcut">Ctrl+F</kbd>
      </button>
    </div>,
    document.body,
  );
}
