import React from 'react';
import { createPortal } from 'react-dom';
import { type Editor as TiptapEditor } from '@tiptap/core';
import { Copy, ExternalLink, Link2Off, Pencil, Play, X } from 'lucide-react';
import { openDocumentLink, youtubePreviewSrc, youtubeVideoId } from '../editorLinks';

type CardState = { href: string; top: number; left: number };

/** The Docs link card: shown while the caret is inside a link. */
export function EditorLinkCard({ editor, onEdit }: { editor: TiptapEditor; onEdit: () => void }) {
  const [card, setCard] = React.useState<CardState | null>(null);
  const [preview, setPreview] = React.useState<{ id: string; href: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      const { selection } = editor.state;
      const href = editor.getAttributes('link').href as string | undefined;
      if (!editor.isFocused || !selection.empty || !href) { setCard(null); return; }
      const anchor = editor.view.domAtPos(selection.from).node;
      const link = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest('a');
      const rect = (link ?? editor.view.dom).getBoundingClientRect();
      setCopied(false);
      setCard({ href, top: rect.bottom + 6, left: Math.max(12, Math.min(rect.left, window.innerWidth - 372)) });
    };
    const hide = () => {
      // Card buttons keep the editor focused; a real blur closes the card.
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => { if (!cardRef.current?.contains(document.activeElement)) setCard(null); }, 150);
    };
    const close = () => setCard(null);
    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('blur', hide);
    window.addEventListener('scroll', close, true);
    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      editor.off('selectionUpdate', update);
      editor.off('focus', update);
      editor.off('blur', hide);
      window.removeEventListener('scroll', close, true);
    };
  }, [editor]);

  const videoId = card ? youtubeVideoId(card.href) : null;
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  return <>
    {card && createPortal(
      <div ref={cardRef} className="editor-link-card" role="dialog" aria-label="Link" style={{ top: card.top, left: card.left }} onMouseDown={keepFocus}>
        <button type="button" className="editor-link-card-url" title="Apri il link" onClick={() => openDocumentLink(card.href)}>
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span>{card.href}</span>
        </button>
        <span className="editor-link-card-actions">
          {videoId && <button type="button" className="editor-bubble-btn" title="Anteprima video" aria-label="Anteprima video"
            onClick={() => setPreview({ id: videoId, href: card.href })}><Play className="h-4 w-4" /></button>}
          <button type="button" className="editor-bubble-btn" title={copied ? 'Link copiato' : 'Copia link'} aria-label="Copia link"
            onClick={() => { void navigator.clipboard?.writeText(card.href).then(() => setCopied(true)).catch(() => {}); }}>
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" className="editor-bubble-btn" title="Modifica link (Ctrl+K)" aria-label="Modifica link" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" className="editor-bubble-btn" title="Rimuovi link" aria-label="Rimuovi link"
            onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setCard(null); }}>
            <Link2Off className="h-4 w-4" />
          </button>
        </span>
      </div>,
      document.body,
    )}
    {preview && createPortal(
      // Docs plays a YouTube link in a floating window, leaving the text in place.
      <div className="editor-video-preview" role="dialog" aria-label="Anteprima video">
        <div className="editor-video-preview-header">
          <button type="button" className="editor-video-preview-open" onClick={() => openDocumentLink(preview.href)}>
            <ExternalLink className="h-3.5 w-3.5" /> Apri su YouTube
          </button>
          <button type="button" className="icon-button" aria-label="Chiudi anteprima" title="Chiudi anteprima" onClick={() => setPreview(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <iframe src={youtubePreviewSrc(preview.id)} title="Anteprima video YouTube" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      </div>,
      document.body,
    )}
  </>;
}
