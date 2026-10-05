import { reportClientError } from '../diagnostics';
import { useCallback, useEffect, useRef } from 'react';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProsemirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { readAndOptimizeImageAsDataUrl } from '../utils';
import { normalizeImageLayout } from '../imageLayout';
import { setInlineImageDragPreview } from '../imageDrag';
import { startInlineImageAutoScroll } from '../imageAutoScroll';

interface UseEditorImageDropOptions {
  editorRef: React.MutableRefObject<TiptapEditor | null>;
}

export function useEditorImageDrop({ editorRef }: UseEditorImageDropOptions) {
  const draggedImageRef = useRef<{ pos: number; size: number; node: ProsemirrorNode } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const insertImageFiles = useCallback(async (inputFiles: FileList | File[]) => {
    const activeEditor = editorRef.current;
    if (!activeEditor) return;
    const files = Array.from(inputFiles).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    for (const file of files) {
      try {
        const src = await readAndOptimizeImageAsDataUrl(file);
        activeEditor.chain().focus().insertContent([
          { type: 'floatingImage', attrs: { src, alt: file.name, title: file.name, width: 56 } },
        ]).run();
      } catch (err) {
        reportClientError(`Errore durante la lettura dell'immagine ${file.name}:`, err);
      }
    }
  }, [editorRef]);

  const handleDragStart = useCallback((view: EditorView, event: DragEvent): boolean => {
    dragCleanupRef.current?.();
    draggedImageRef.current = null;
    const target = event.target as HTMLElement | null;
    const imageNodeView = target?.closest('.editor-image-node') as HTMLElement | null;
    if (imageNodeView) {
      try {
        const pos = view.posAtDOM(imageNodeView, 0);
        if (pos !== null && pos !== undefined) {
          const node = view.state.doc.nodeAt(pos);
          if (node && node.type.name === 'floatingImage') {
            if (normalizeImageLayout(node.attrs.layout) === 'wrap') { event.preventDefault(); return true; }
            draggedImageRef.current = { pos, size: node.nodeSize, node };
            setInlineImageDragPreview(imageNodeView, event);
            dragCleanupRef.current = startInlineImageAutoScroll(view.dom, event);
          }
        }
      } catch (_) {
        draggedImageRef.current = null;
      }
    }
    return false;
  }, []);

  const handlePaste = useCallback((_view: EditorView, event: ClipboardEvent): boolean => {
    const files = Array.from(event.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return false;
    // Rich clipboard content can expose the same image as a file as well as HTML.
    // Let the schema parse the HTML so the surrounding text and structure survive.
    if (event.clipboardData?.getData?.('text/html').trim()) return false;
    event.preventDefault();
    void insertImageFiles(files);
    return true;
  }, [insertImageFiles]);

  const handleDrop = useCallback((view: EditorView, event: DragEvent): boolean => {
    dragCleanupRef.current?.();
    const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void insertImageFiles(files);
      return true;
    }

    let dragged = draggedImageRef.current;
    draggedImageRef.current = null;

    if (!dragged) {
      const sel = view.state.selection;
      if (sel instanceof NodeSelection && sel.node.type.name === 'floatingImage') {
        dragged = { pos: sel.from, size: sel.node.nodeSize, node: sel.node };
      } else if (sel) {
        const nodeAtFrom = view.state.doc.nodeAt(sel.from);
        if (nodeAtFrom?.type.name === 'floatingImage') {
          dragged = { pos: sel.from, size: nodeAtFrom.nodeSize, node: nodeAtFrom };
        }
      }
    }

    // Wrapping images use a pointer gesture. A native drop while one is
    // selected may be unrelated text from another application.
    if (dragged && normalizeImageLayout(dragged.node.attrs.layout) === 'wrap') return false;

    if (dragged && dragged.node) {
      event.preventDefault();
      const dropCoords = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!dropCoords) return true;

      const dragFrom = dragged.pos;
      const dragSize = dragged.size;
      const dragTo = dragFrom + dragSize;
      const insertPos = dropCoords.pos;
      if (insertPos >= dragFrom && insertPos <= dragTo) return true;
      const tr = closeHistory(view.state.tr).delete(dragFrom, dragTo);
      const mapped = tr.mapping.map(insertPos);
      const target = tr.doc.resolve(mapped);
      const inline = target.parent.inlineContent;
      tr.insert(mapped, inline ? dragged.node : view.state.schema.nodes.paragraph.create(null, dragged.node));
      tr.setSelection(NodeSelection.create(tr.doc, mapped + (inline ? 0 : 1)));

      view.dispatch(tr);
      view.focus();
      return true;
    }

    return false;
  }, [insertImageFiles]);

  const transformPastedHTML = useCallback((html: string): string => {
    // The schema validates supported styles and discards unsupported markup.
    // Formatted paste must retain explicit colors, highlights and heading sizes.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.innerHTML;
  }, []);

  return {
    insertImageFiles,
    handleDragStart,
    handlePaste,
    handleDrop,
    transformPastedHTML,
  };
}
