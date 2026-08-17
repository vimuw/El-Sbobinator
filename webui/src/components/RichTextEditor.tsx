import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Editor as TiptapEditor } from '@tiptap/core';
import type { Node as ProsemirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import FontFamily from '@tiptap/extension-font-family';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {
  Bold, Clipboard, Copy, ImagePlus, Italic,
  Menu, RemoveFormatting, Scissors, Underline as UnderlineIcon, X,
  Link2, Search, Calculator, Highlighter, Trash2
} from 'lucide-react';
import { FloatingImage } from './FloatingImage';
import { type Heading, SearchHighlight, FontSize, MathInline, MathBlock, SmartArrows, extractHeadings } from '../editorExtensions';
import Youtube from '@tiptap/extension-youtube';
import Typography from '@tiptap/extension-typography';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WebrtcProvider } from 'y-webrtc';
import { MenuBar } from './EditorToolbar';
import { getLastHighlightColor, getWordRangeAtPos } from '../editorUtils';
import { EditorBubbleMenu } from './EditorBubbleMenu';
import { FindReplacePanel } from './EditorFindReplace';
import { WordCount } from './EditorWordCount';
import { readFileAsDataUrl } from '../utils';
import { registerCollabSignalListener } from '../bridge';

export type { Heading };

interface RichTextEditorProps {
  initialContent?: string;
  onChange?: (content: string) => void;
  onEditorReady?: (getHtml: () => string) => void;
  initialScrollTop?: number;
  initialSearchTerm?: string;
  onScrollTopChange?: (scrollTop: number) => void;
  onHeadingsChange?: (headings: Heading[]) => void;
  isTocOpen?: boolean;
  onTocToggle?: () => void;
  tocHeadings?: Heading[];
  onScrollToHeading?: (heading: Heading) => void;
  zoomLevel?: number;
  onZoomChange?: (zoomLevel: number) => void;
  collaborationRoom?: string;
  collaborationUser?: { name: string; color: string };
}

function bytesToBase64(bytes: Uint8Array): string {
  const bin: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize))));
  }
  return btoa(bin.join(''));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function RichTextEditor({ initialContent, onChange, onEditorReady, initialScrollTop, initialSearchTerm, onScrollTopChange, onHeadingsChange, isTocOpen = false, onTocToggle, tocHeadings = [], onScrollToHeading, zoomLevel, onZoomChange, collaborationRoom, collaborationUser }: RichTextEditorProps) {
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [findMode, setFindMode] = useState<null | 'find' | 'replace'>(initialSearchTerm ? 'find' : null);
  const [findFocusTrigger, setFindFocusTrigger] = useState(0);
  const findModeRef = useRef<null | 'find' | 'replace'>(null);
  useEffect(() => { findModeRef.current = findMode; }, [findMode]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasRestoredScrollRef = useRef(false);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  useEffect(() => { onScrollTopChangeRef.current = onScrollTopChange; }, [onScrollTopChange]);
  const onHeadingsChangeRef = useRef(onHeadingsChange);
  useEffect(() => { onHeadingsChangeRef.current = onHeadingsChange; }, [onHeadingsChange]);
  const headingsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const tocHeadingsRef = useRef(tocHeadings);
  useEffect(() => { tocHeadingsRef.current = tocHeadings; }, [tocHeadings]);
  const tocNavRef = useRef<HTMLElement>(null);
  const tocStickyRef = useRef<HTMLDivElement>(null);
  const headingElsCacheRef = useRef<HTMLElement[] | null>(null);
  useEffect(() => { headingElsCacheRef.current = null; }, [tocHeadings]);
  const tocScrollRafRef = useRef<number | null>(null);

  const collabState = useMemo(() => {
    if (!collaborationRoom) {
      return { ydoc: null, provider: null };
    }
    const doc = new Y.Doc();
    let webrtc: WebrtcProvider | null = null;
    try {
      webrtc = new WebrtcProvider(collaborationRoom, doc, {
        signaling: [
          'wss://y-webrtc.fly.dev',
          'wss://y-webrtc-signaling.onrender.com',
        ],
        filterBcConns: false,
        peerOpts: {
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' },
            ],
          },
        },
      });
    } catch (err) {
      console.error('Errore inizializzazione WebRTC provider:', err);
    }
    return { ydoc: doc, provider: webrtc };
  }, [collaborationRoom]);

  useEffect(() => {
    if (!collaborationRoom || !collabState.ydoc) return;
    const roomClean = collaborationRoom.trim().toLowerCase();
    const doc = collabState.ydoc;
    const awareness = collabState.provider?.awareness;
    if (awareness) {
      awareness.setLocalStateField('user', collaborationUser || { name: 'Studente', color: '#3b82f6' });
    }

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(`el-collab-${roomClean}`);
        bc.onmessage = (event) => {
          if (event.data?.type === 'yjs-update' && event.data?.update) {
            try {
              const update = base64ToBytes(event.data.update);
              Y.applyUpdate(doc, update, 'local-bc');
            } catch (e) {
              console.error('Error applying BC update:', e);
            }
          } else if (event.data?.type === 'yjs-awareness' && event.data?.update && awareness) {
            try {
              const update = base64ToBytes(event.data.update);
              awarenessProtocol.applyAwarenessUpdate(awareness, update, 'local-bc');
            } catch (e) {
              console.error('Error applying BC awareness:', e);
            }
          } else if (event.data?.type === 'yjs-request-state') {
            const state = Y.encodeStateAsUpdate(doc);
            bc?.postMessage({ type: 'yjs-update', update: bytesToBase64(state) });
            if (awareness) {
              const awState = awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys()));
              bc?.postMessage({ type: 'yjs-awareness', update: bytesToBase64(awState) });
            }
          }
        };
      }
    } catch (_) {}

    const receiveSignalHandler = (room: string, payloadStr: string) => {
      if (room !== roomClean) return;
      try {
        const data = JSON.parse(payloadStr);
        if (data.type === 'yjs-update' && data.update) {
          const update = base64ToBytes(data.update);
          Y.applyUpdate(doc, update, 'pywebview-bridge');
        } else if (data.type === 'yjs-awareness' && data.update && awareness) {
          const update = base64ToBytes(data.update);
          awarenessProtocol.applyAwarenessUpdate(awareness, update, 'pywebview-bridge');
        } else if (data.type === 'yjs-request-state') {
          const state = Y.encodeStateAsUpdate(doc);
          const payload = JSON.stringify({ type: 'yjs-update', update: bytesToBase64(state) });
          window.pywebview?.api?.send_collaboration_signal?.(roomClean, payload);
          if (awareness) {
            const awState = awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys()));
            const awPayload = JSON.stringify({ type: 'yjs-awareness', update: bytesToBase64(awState) });
            window.pywebview?.api?.send_collaboration_signal?.(roomClean, awPayload);
          }
        }
      } catch (e) {
        console.error('Error parsing collab signal:', e);
      }
    };
    const unregisterSignal = registerCollabSignalListener(receiveSignalHandler);

    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'pywebview-bridge' || origin === 'local-bc') return;
      const b64 = bytesToBase64(update);
      const payload = JSON.stringify({ type: 'yjs-update', update: b64 });
      window.pywebview?.api?.send_collaboration_signal?.(roomClean, payload);
      bc?.postMessage({ type: 'yjs-update', update: b64 });
    };
    doc.on('update', handleDocUpdate);

    const handleAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === 'pywebview-bridge' || origin === 'local-bc' || !awareness) return;
      let changedClients = added.concat(updated).concat(removed);
      if (changedClients.length === 0) changedClients = [awareness.clientID];
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
      const b64 = bytesToBase64(awarenessUpdate);
      const payload = JSON.stringify({ type: 'yjs-awareness', update: b64 });
      window.pywebview?.api?.send_collaboration_signal?.(roomClean, payload);
      bc?.postMessage({ type: 'yjs-awareness', update: b64 });
    };
    awareness?.on('update', handleAwarenessUpdate);

    const reqPayload = JSON.stringify({ type: 'yjs-request-state' });
    window.pywebview?.api?.send_collaboration_signal?.(roomClean, reqPayload);
    bc?.postMessage({ type: 'yjs-request-state' });

    return () => {
      unregisterSignal();
      doc.off('update', handleDocUpdate);
      awareness?.off('update', handleAwarenessUpdate);
      bc?.close();
      collabState.provider?.destroy();
      collabState.ydoc?.destroy();
    };
  }, [collaborationRoom, collabState, collaborationUser]);

  const { ydoc, provider } = collabState;

  const draggedImageRef = useRef<{ pos: number; size: number; node: ProsemirrorNode } | null>(null);

  const isPlaceholderContent = typeof initialContent === 'string' && initialContent.includes('Connessione in corso alla stanza');
  const effectiveInitialContent = collaborationRoom ? undefined : initialContent;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
        ...(collaborationRoom ? { undoRedo: false } : {}),
      }),
      FloatingImage,
      TextStyle,
      Color,
      FontFamily.configure({ types: ['textStyle'] }),
      FontSize,
      Underline,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, markdownLinks: true }),
      Subscript,
      Superscript,
      SearchHighlight,
      Youtube.configure({
        controls: true,
        nocookie: true,
        width: 640,
        height: 360,
      }),
      Typography,
      MathInline,
      MathBlock,
      SmartArrows,
      ...(collaborationRoom && ydoc && provider ? [
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({
          provider,
          user: collaborationUser || { name: 'Studente', color: '#3b82f6' },
        }),
      ] : []),
    ],
    content: effectiveInitialContent,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      if (editor.utils?.getUpdatedPosition) {
        const origGetUpdatedPosition = editor.utils.getUpdatedPosition;
        editor.utils.getUpdatedPosition = (
          pos: Parameters<typeof origGetUpdatedPosition>[0],
          tr: Parameters<typeof origGetUpdatedPosition>[1],
        ) => {
          try {
            return origGetUpdatedPosition(pos, tr);
          } catch (_) {
            return { position: pos, mapResult: null };
          }
        };
      }
      onEditorReady?.(() => editorRef.current!.getHTML());
      onHeadingsChangeRef.current?.(extractHeadings(editor));
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
      if (headingsDebounceRef.current) clearTimeout(headingsDebounceRef.current);
      headingsDebounceRef.current = setTimeout(() => {
        onHeadingsChangeRef.current?.(extractHeadings(editor));
      }, 400);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose-base max-w-none focus:outline-none tiptap-editor',
        spellcheck: 'false',
      },
      handleDoubleClick: (view, pos) => {
        const range = getWordRangeAtPos(view, pos);
        if (range) {
          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.tr.doc, range.from, range.to),
          );
          view.dispatch(tr);
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        dragstart: (view, event) => {
          const target = event.target as HTMLElement | null;
          const imageNodeView = target?.closest('.editor-image-node') as HTMLElement | null;
          if (imageNodeView) {
            try {
              const pos = view.posAtDOM(imageNodeView, 0);
              if (pos !== null && pos !== undefined) {
                const node = view.state.doc.nodeAt(pos);
                if (node && node.type.name === 'floatingImage') {
                  draggedImageRef.current = { pos, size: node.nodeSize, node };
                }
              }
            } catch (_) {
              draggedImageRef.current = null;
            }
          }
          return false;
        },
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void insertImageFiles(files);
        return true;
      },
      handleDrop: (view, event) => {
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

        if (dragged && dragged.node) {
          event.preventDefault();
          const dropCoords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!dropCoords) return true;

          const dragFrom = dragged.pos;
          const dragSize = dragged.size;
          const dragTo = dragFrom + dragSize;

          let insertPos = dropCoords.pos;
          let isTargetEmptyParagraph = false;
          let targetPStart = 0;
          let targetPEnd = 0;

          try {
            const $target = view.state.doc.resolve(dropCoords.pos);
            if ($target.depth >= 1) {
              targetPStart = $target.before(1);
              targetPEnd = $target.after(1);

              const targetParent = $target.parent;
              if (targetParent && targetParent.type.name === 'paragraph' && targetParent.content.size === 0) {
                isTargetEmptyParagraph = true;
              }

              const targetDOM = view.nodeDOM(targetPStart) as HTMLElement | null;
              if (targetDOM && typeof targetDOM.getBoundingClientRect === 'function') {
                const rect = targetDOM.getBoundingClientRect();
                if (event.clientY > rect.top + rect.height / 2) {
                  insertPos = targetPEnd;
                } else {
                  insertPos = targetPStart;
                }
              } else {
                insertPos = targetPStart;
              }
            }
          } catch (_) {
            insertPos = dropCoords.pos;
          }

          if (insertPos >= dragFrom && insertPos <= dragTo) {
            return true;
          }

          const tr = view.state.tr;
          let selPos = 0;
          if (isTargetEmptyParagraph && targetPStart !== undefined && targetPEnd !== undefined) {
            if (dragFrom < targetPStart) {
              tr.replaceWith(targetPStart, targetPEnd, dragged.node);
              tr.delete(dragFrom, dragFrom + dragSize);
              selPos = Math.max(0, targetPStart - dragSize);
            } else {
              tr.delete(dragFrom, dragTo);
              tr.replaceWith(targetPStart, targetPEnd, dragged.node);
              selPos = targetPStart;
            }
          } else {
            tr.delete(dragFrom, dragTo);
            let finalInsertPos = insertPos;
            if (insertPos > dragFrom) {
              finalInsertPos = Math.max(0, insertPos - dragSize);
            }
            tr.insert(finalInsertPos, dragged.node);
            selPos = finalInsertPos;
          }

          if (typeof selPos === 'number' && selPos >= 0 && selPos < tr.doc.content.size) {
            try {
              tr.setSelection(NodeSelection.create(tr.doc, selPos));
            } catch (_) {}
          }

          view.dispatch(tr);
          view.focus();
          return true;
        }

        return false;
      },
      transformPastedHTML(html: string): string {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.body.querySelectorAll('[style]').forEach(el => {
          const s = (el as HTMLElement).style;
          s.removeProperty('color');
          s.removeProperty('background-color');
        });
        return doc.body.innerHTML;
      },
    },
  });

  useEffect(() => {
    if (editor && collaborationUser) {
      const commands = editor.commands as unknown as { updateUser?: (user: { name: string; color: string }) => boolean };
      commands.updateUser?.(collaborationUser);
    }
  }, [editor, collaborationUser]);

  useEffect(() => {
    if (!collaborationRoom || !editor || !initialContent || isPlaceholderContent) return;
    const xml = collabState.ydoc?.getXmlFragment('default');
    if (xml && xml.length === 0) {
      const timer = setTimeout(() => {
        if (xml && xml.length === 0) {
          editor.commands.setContent(initialContent);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [collaborationRoom, editor, initialContent, isPlaceholderContent, collabState.ydoc]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const sticky = tocStickyRef.current;
    if (!container || !sticky) return;
    const update = () => { sticky.style.height = `${Math.max(100, container.clientHeight - 60)}px`; };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!activeHeadingId || !tocNavRef.current) return;
    const nav = tocNavRef.current;
    const activeBtn = nav.querySelector<HTMLElement>('.toc-item-active');
    if (!activeBtn) return;
    const navRect = nav.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    if (btnRect.top < navRect.top) {
      nav.scrollTop += btnRect.top - navRect.top;
    } else if (btnRect.bottom > navRect.bottom) {
      nav.scrollTop += btnRect.bottom - navRect.bottom;
    }
  }, [activeHeadingId]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (tocScrollRafRef.current !== null) return;
      tocScrollRafRef.current = requestAnimationFrame(() => {
        tocScrollRafRef.current = null;
        if (!headingElsCacheRef.current) {
          headingElsCacheRef.current = Array.from(
            container.querySelectorAll<HTMLElement>(
              '.tiptap-editor h1,.tiptap-editor h2,.tiptap-editor h3,.tiptap-editor h4,.tiptap-editor h5'
            )
          );
        }
        const containerTop = container.getBoundingClientRect().top;
        let activeEl: HTMLElement | null = null;
        for (const el of headingElsCacheRef.current) {
          if (el.getBoundingClientRect().top - containerTop <= 64) {
            activeEl = el;
          } else {
            break;
          }
        }
        if (activeEl) {
          const text = activeEl.textContent?.trim() ?? '';
          const level = parseInt(activeEl.tagName[1]);
          const match = tocHeadingsRef.current.find(
            h => h.level === level && h.text.trim() === text
          );
          setActiveHeadingId(match?.id ?? null);
        } else {
          setActiveHeadingId(null);
        }
      });
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (tocScrollRafRef.current !== null) cancelAnimationFrame(tocScrollRafRef.current);
    };
  }, []);

  const insertImageFiles = useCallback(async (inputFiles: FileList | File[]) => {
    const activeEditor = editorRef.current;
    if (!activeEditor) return;
    const files = Array.from(inputFiles).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    for (const file of files) {
      try {
        const src = await readFileAsDataUrl(file);
        activeEditor.chain().focus().insertContent([
          { type: 'floatingImage', attrs: { src, alt: file.name, title: file.name, width: 56 } },
        ]).run();
      } catch (err) {
        console.error(`Errore durante la lettura dell'immagine ${file.name}:`, err);
      }
    }
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('.gdocs-context-menu')) return;
      setContextMenu(null);
    };
    const handleScroll = () => {
      setContextMenu(null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (findModeRef.current) {
          setFindFocusTrigger(prev => prev + 1);
        } else {
          setFindMode('find');
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        if (findModeRef.current === 'replace') {
          setFindFocusTrigger(prev => prev + 1);
        } else {
          setFindMode('replace');
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        onTocToggle?.();
      }
      if (e.key === 'Escape' && findModeRef.current) { e.stopPropagation(); setFindMode(null); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onTocToggle]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const menuWidth = 280, menuHeight = 360, padding = 12;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - padding);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - padding);
    setContextMenu({ x: Math.max(padding, x), y: Math.max(padding, y) });
  };

  useEffect(() => {
    if (editor && initialContent !== editor.getHTML() && !editor.isFocused && editor.isEmpty) {
      editor.commands.setContent(initialContent);
    }
  }, [initialContent, editor]);

  useEffect(() => {
    if (hasRestoredScrollRef.current || !scrollContainerRef.current || !editor || !initialScrollTop) return;
    hasRestoredScrollRef.current = true;
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = initialScrollTop;
    });
  }, [editor, initialScrollTop]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const adjustScroll = (behavior: ScrollBehavior = 'auto') => {
      const outer = container.querySelector('.editor-page-outer') as HTMLElement;
      const tocCol = container.querySelector('.editor-toc-col') as HTMLElement;
      if (!outer || !tocCol) return;

      const viewportWidth = container.clientWidth;
      const contentWidth = outer.scrollWidth;
      if (contentWidth <= viewportWidth) {
        container.scrollTo({ left: 0, behavior });
        return;
      }

      const paperWidth = 816;
      const targetLeft = Math.max(0, (paperWidth / 2) - (viewportWidth / 2));
      container.scrollTo({ left: targetLeft, behavior });
    };

    let transitionActive = true;
    const startTime = performance.now();
    const duration = 250;

    const poll = () => {
      adjustScroll('auto');
      if (transitionActive && performance.now() - startTime < duration) {
        requestAnimationFrame(poll);
      }
    };
    requestAnimationFrame(poll);

    const resizeObserver = new ResizeObserver(() => {
      adjustScroll('auto');
    });
    resizeObserver.observe(container);

    return () => {
      transitionActive = false;
      resizeObserver.disconnect();
    };
  }, [isTocOpen, zoomLevel]);

  return (
    <div className={`editor-shell flex flex-1 min-h-0 w-full flex-col relative ${isTocOpen ? 'editor-toc-open' : ''}`} onContextMenu={handleContextMenu}>
      {editor && <EditorBubbleMenu editor={editor} isContextMenuOpen={Boolean(contextMenu)} />}
      <MenuBar
        editor={editor}
        onOpenImagePicker={() => imageInputRef.current?.click()}
        showFindReplace={findMode !== null}
        onToggleFindReplace={() => setFindMode(p => p ? null : 'find')}
        zoomLevel={zoomLevel}
        onZoomChange={onZoomChange}
      />
      {findMode && editor && (
        <FindReplacePanel editor={editor} onClose={() => setFindMode(null)} initialMode={findMode} focusTrigger={findFocusTrigger} initialFindText={initialSearchTerm} />
      )}
      <div
        ref={scrollContainerRef}
        className="editor-page-container flex-1 overflow-y-auto"
        style={{ overflowX: 'auto' }}
        onScroll={() => {
          setContextMenu(null);
          if (scrollContainerRef.current) {
            onScrollTopChangeRef.current?.(scrollContainerRef.current.scrollTop);
          }
        }}
      >
        <div className="editor-page-outer">
          <div className="editor-toc-col" style={{ width: isTocOpen ? 260 : 44 }}>
            <div className="editor-toc-sticky" ref={tocStickyRef}>
              {!isTocOpen ? (
                <button className="editor-toc-btn" onClick={onTocToggle} title="Apri indice">
                  <Menu className="w-4 h-4" />
                </button>
              ) : (
                <>
                  <div className="editor-toc-header">
                    <span>Indice</span>
                    <button className="toc-left-close" onClick={onTocToggle} title="Chiudi">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <nav className="editor-toc-nav" ref={tocNavRef}>
                    {tocHeadings.length === 0 ? (
                      <p className="toc-empty">Nessun titolo</p>
                    ) : (
                      tocHeadings.map(h => (
                        <button
                          key={h.id}
                          className={`toc-item toc-item-h${h.level}${activeHeadingId === h.id ? ' toc-item-active' : ''}`}
                          style={{ paddingLeft: `${(h.level - 1) * 12 + 14}px` }}
                          onClick={() => onScrollToHeading?.(h)}
                          title={h.text}
                        >
                          {h.text}
                        </button>
                      ))
                    )}
                  </nav>
                </>
              )}
            </div>
          </div>
          <div className="editor-page-center">
            <div className="editor-page" style={zoomLevel !== undefined ? { zoom: zoomLevel / 100 } : undefined}>
              <EditorContent editor={editor} />
            </div>
          </div>
          <div className="editor-toc-spacer" style={{ width: isTocOpen ? 260 : 44 }} />
        </div>
      </div>
      {editor && <WordCount editor={editor} />}

      {contextMenu && createPortal(
        <div
          className="gdocs-context-menu fixed z-50 py-1 text-xs select-none"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => { e.stopPropagation(); setContextMenu(null); }}
        >
          <button className="gdocs-menu-item" onClick={async () => {
            try {
              const { from, to } = editor!.state.selection;
              const text = editor!.state.doc.textBetween(from, to, '\n');
              await navigator.clipboard.writeText(text);
              editor!.chain().focus().deleteSelection().run();
            } catch (_) { console.error('Clipboard error'); }
          }}>
            <span className="flex items-center gap-2.5 font-medium">
              <Scissors className="h-4 w-4 shrink-0" />
              <span>Taglia</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+X</kbd>
          </button>

          <button className="gdocs-menu-item" onClick={async () => {
            try {
              const { from, to } = editor!.state.selection;
              const text = editor!.state.doc.textBetween(from, to, '\n');
              await navigator.clipboard.writeText(text);
            } catch (_) { console.error('Clipboard error'); }
          }}>
            <span className="flex items-center gap-2.5 font-medium">
              <Copy className="h-4 w-4 shrink-0" />
              <span>Copia</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+C</kbd>
          </button>

          <button className="gdocs-menu-item" onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              editor?.commands.insertContent(text);
            } catch (_) { console.error('Clipboard error'); }
          }}>
            <span className="flex items-center gap-2.5 font-medium">
              <Clipboard className="h-4 w-4 shrink-0" />
              <span>Incolla</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+V</kbd>
          </button>

          <button className="gdocs-menu-item" onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              const plain = text.replace(/<[^>]*>?/gm, '');
              editor?.commands.insertContent(plain);
            } catch (_) { console.error('Clipboard error'); }
          }}>
            <span className="flex items-center gap-2.5 font-medium">
              <Clipboard className="h-4 w-4 shrink-0" />
              <span>Incolla senza formattazione</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+Shift+V</kbd>
          </button>

          {!editor?.state.selection.empty && (
            <button className="gdocs-menu-item text-red-600 dark:text-red-400" onClick={() => {
              editor?.chain().focus().deleteSelection().run();
            }}>
              <span className="flex items-center gap-2.5 font-medium text-red-600 dark:text-red-400">
                <Trash2 className="h-4 w-4 shrink-0 text-red-500" />
                <span>Elimina selezione</span>
              </span>
              <kbd className="gdocs-kbd text-red-400 font-mono">Canc</kbd>
            </button>
          )}

          <div className="my-1 border-t border-[var(--border-subtle)]" />

          <button className="gdocs-menu-item" onClick={() => editor?.chain().focus().toggleBold().run()}>
            <span className="flex items-center gap-2.5 font-medium">
              <Bold className="h-4 w-4 shrink-0" />
              <span>Grassetto</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+B</kbd>
          </button>

          <button className="gdocs-menu-item" onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <span className="flex items-center gap-2.5 font-medium">
              <Italic className="h-4 w-4 shrink-0" />
              <span>Corsivo</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+I</kbd>
          </button>

          <button className="gdocs-menu-item" onClick={() => editor?.chain().focus().toggleUnderline().run()}>
            <span className="flex items-center gap-2.5 font-medium">
              <UnderlineIcon className="h-4 w-4 shrink-0" />
              <span>Sottolineato</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+U</kbd>
          </button>

          <button className="gdocs-menu-item" onClick={() => editor?.chain().focus().toggleHighlight({ color: getLastHighlightColor() }).run()}>
            <span className="flex items-center gap-2.5 font-medium">
              <Highlighter className="h-4 w-4 shrink-0" style={{ color: getLastHighlightColor() }} />
              <span>Evidenzia</span>
            </span>
          </button>

          <button className="gdocs-menu-item" onClick={() => {
            if (editor && !editor.state.selection.empty) {
              editor.chain().focus().unsetAllMarks().clearNodes().run();
            }
          }}>
            <span className="flex items-center gap-2.5 font-medium">
              <RemoveFormatting className="h-4 w-4 shrink-0" />
              <span>Rimuovi formattazione</span>
            </span>
          </button>

          <div className="my-1 border-t border-[var(--border-subtle)]" />

          <button className="gdocs-menu-item" onClick={() => {
            const url = window.prompt('Inserisci URL del link:');
            if (url) editor?.chain().focus().setLink({ href: url }).run();
          }}>
            <span className="flex items-center gap-2.5 font-medium">
              <Link2 className="h-4 w-4 shrink-0" />
              <span>Inserisci link</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+K</kbd>
          </button>

          <button className="gdocs-menu-item" onClick={() => imageInputRef.current?.click()}>
            <span className="flex items-center gap-2.5 font-medium">
              <ImagePlus className="h-4 w-4 shrink-0" />
              <span>Inserisci immagine</span>
            </span>
          </button>

          <button className="gdocs-menu-item" onClick={() => {
            editor?.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: 'E=mc^2' } }).run();
          }}>
            <span className="flex items-center gap-2.5 font-medium">
              <Calculator className="h-4 w-4 shrink-0" />
              <span>Inserisci formula LaTeX</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+M</kbd>
          </button>

          <button className="gdocs-menu-item" onClick={() => setFindMode('find')}>
            <span className="flex items-center gap-2.5 font-medium">
              <Search className="h-4 w-4 shrink-0" />
              <span>Trova e sostituisci</span>
            </span>
            <kbd className="gdocs-kbd">Ctrl+F</kbd>
          </button>
        </div>
      , document.body)}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={event => {
          if (event.target.files?.length) void insertImageFiles(event.target.files);
          event.currentTarget.value = '';
          setContextMenu(null);
        }}
      />
    </div>
  );
}
