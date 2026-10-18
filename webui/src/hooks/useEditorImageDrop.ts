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
import { preparePastedEditorHtml } from '../editorSelectionClipboard';

interface UseEditorImageDropOptions {
  editorRef: React.MutableRefObject<TiptapEditor | null>;
}

function isSingleImageClipboardHtml(html: string): boolean {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const images = body.querySelectorAll('img');
  if (images.length !== 1 || body.textContent?.trim() || body.querySelector('[data-editor-image]')) return false;
  const image = images[0];
  // Browser Copy image may wrap its IMG in a link or an otherwise empty block.
  // Extra blocks, lists, tables and editor layout metadata belong to rich paste.
  return Array.from(body.querySelectorAll('*')).every(element =>
    element === image || (/^(A|DIV|P|SPAN)$/.test(element.tagName) && element.contains(image))
  );
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
            const stopAutoScroll = startInlineImageAutoScroll(view.dom, event);
            // A drag cancelled by Esc or dropped outside the editor never reaches
            // handleDrop, so dragend must forget the stale source position too.
            const forget = () => {
              stopAutoScroll();
              draggedImageRef.current = null;
              window.removeEventListener('dragend', forget, true);
            };
            window.addEventListener('dragend', forget, true);
            dragCleanupRef.current = forget;
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
    const html = event.clipboardData?.getData?.('text/html').trim();
    // Copy image exposes pixels AND an HTML reference, which can be inaccessible
    // in the desktop WebView. Embed the pixels for this single-image case while
    // keeping rich documents and our own image layout on the HTML parser route.
    if (html && (files.length !== 1 || !isSingleImageClipboardHtml(html))) return false;
    event.preventDefault();
    void insertImageFiles(files);
    return true;
  }, [insertImageFiles]);

  const handleDrop = useCallback((view: EditorView, event: DragEvent): boolean => {
    let dragged = draggedImageRef.current;
    dragCleanupRef.current?.();
    draggedImageRef.current = null;
    const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void insertImageFiles(files);
      return true;
    }

    // Only ProseMirror's own drag of exactly one selected image is a move.
    // External drops and text drags that begin at an image stay native.
    if (!dragged) {
      const sel = view.state.selection;
      const slice = view.dragging?.slice;
      const single = slice?.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1 ? slice.content.firstChild : null;
      if (sel instanceof NodeSelection && sel.node.type.name === 'floatingImage' && single === sel.node) {
        dragged = { pos: sel.from, size: sel.node.nodeSize, node: sel.node };
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
      // Code blocks accept only text; refuse the drop instead of throwing.
      if (inline && !target.parent.canReplaceWith(target.index(), target.index(), dragged.node.type, dragged.node.marks)) return true;
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
    // Docs and internal paste retain explicit colors, highlights and sizes.
    return preparePastedEditorHtml(html, editorRef.current?.view);
  }, [editorRef]);

  return {
    insertImageFiles,
    handleDragStart,
    handlePaste,
    handleDrop,
    transformPastedHTML,
  };
}
