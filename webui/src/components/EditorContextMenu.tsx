import React from 'react';
import { createPortal } from 'react-dom';
import type { Editor as TiptapEditor } from '@tiptap/core';
import {
  Bold,
  Calculator,
  Clipboard,
  Copy,
  Highlighter,
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

interface EditorContextMenuProps {
  contextMenu: { x: number; y: number } | null;
  onClose: () => void;
  editor: TiptapEditor | null;
  onOpenImagePicker: () => void;
  onOpenFind: () => void;
}

export function EditorContextMenu({
  contextMenu,
  onClose,
  editor,
  onOpenImagePicker,
  onOpenFind,
}: EditorContextMenuProps) {
  if (!contextMenu || !editor) return null;

  return createPortal(
    <div
      className="gdocs-context-menu fixed z-50 py-1 text-xs select-none"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={e => {
        e.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        className="gdocs-menu-item"
        onClick={async () => {
          try {
            const { from, to } = editor.state.selection;
            const text = editor.state.doc.textBetween(from, to, '\n');
            await navigator.clipboard.writeText(text);
            editor.chain().focus().deleteSelection().run();
          } catch (_) {
            console.error('Clipboard error');
          }
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Scissors className="h-4 w-4 shrink-0" />
          <span>Taglia</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+X</kbd>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={async () => {
          try {
            const { from, to } = editor.state.selection;
            const text = editor.state.doc.textBetween(from, to, '\n');
            await navigator.clipboard.writeText(text);
          } catch (_) {
            console.error('Clipboard error');
          }
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Copy className="h-4 w-4 shrink-0" />
          <span>Copia</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+C</kbd>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={async () => {
          try {
            const text = await navigator.clipboard.readText();
            editor.commands.insertContent(text);
          } catch (_) {
            console.error('Clipboard error');
          }
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Clipboard className="h-4 w-4 shrink-0" />
          <span>Incolla</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+V</kbd>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={async () => {
          try {
            const text = await navigator.clipboard.readText();
            const plain = text.replace(/<[^>]*>?/gm, '');
            editor.commands.insertContent(plain);
          } catch (_) {
            console.error('Clipboard error');
          }
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Clipboard className="h-4 w-4 shrink-0" />
          <span>Incolla senza formattazione</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+Shift+V</kbd>
      </button>

      {!editor.state.selection.empty && (
        <button
          type="button"
          className="gdocs-menu-item"
          style={{ color: 'var(--error-text)' }}
          onClick={() => {
            editor.chain().focus().deleteSelection().run();
          }}
        >
          <span className="flex items-center gap-2.5 font-medium" style={{ color: 'var(--error-text)' }}>
            <Trash2 className="h-4 w-4 shrink-0" style={{ color: 'var(--error-text)' }} />
            <span>Elimina selezione</span>
          </span>
          <kbd className="gdocs-kbd font-mono" style={{ color: 'var(--error-text)' }}>
            Canc
          </kbd>
        </button>
      )}

      <div className="my-1 border-t border-[var(--border-subtle)]" />

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Bold className="h-4 w-4 shrink-0" />
          <span>Grassetto</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+B</kbd>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Italic className="h-4 w-4 shrink-0" />
          <span>Corsivo</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+I</kbd>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <UnderlineIcon className="h-4 w-4 shrink-0" />
          <span>Sottolineato</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+U</kbd>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={() => editor.chain().focus().toggleHighlight({ color: getLastHighlightColor() }).run()}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Highlighter className="h-4 w-4 shrink-0" style={{ color: getLastHighlightColor() }} />
          <span>Evidenzia</span>
        </span>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={() => {
          if (!editor.state.selection.empty) {
            editor.chain().focus().unsetAllMarks().clearNodes().run();
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
        className="gdocs-menu-item"
        onClick={() => {
          const url = window.prompt('Inserisci URL del link:');
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Link2 className="h-4 w-4 shrink-0" />
          <span>Inserisci link</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+K</kbd>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={onOpenImagePicker}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <ImagePlus className="h-4 w-4 shrink-0" />
          <span>Inserisci immagine</span>
        </span>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={() => {
          editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: 'E=mc^2' } }).run();
        }}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Calculator className="h-4 w-4 shrink-0" />
          <span>Inserisci formula LaTeX</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+M</kbd>
      </button>

      <button
        type="button"
        className="gdocs-menu-item"
        onClick={onOpenFind}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <Search className="h-4 w-4 shrink-0" />
          <span>Trova e sostituisci</span>
        </span>
        <kbd className="gdocs-kbd">Ctrl+F</kbd>
      </button>
    </div>,
    document.body,
  );
}
