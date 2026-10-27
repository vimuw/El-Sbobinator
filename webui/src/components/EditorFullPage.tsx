import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Check, Copy, FileText, Headphones, Loader2, Moon, Plus, Sun } from 'lucide-react';
import type { Heading } from './RichTextEditor';
import { prepareHtmlForClipboardSync } from '../utils';
import { createNativeClipboardFormats, writeEditorClipboard } from '../editorClipboard';
import { prepareHtmlLineSpacing } from '../editorLineSpacing';
import { clipboardPlainText } from '../documentFormatting';
import { reportClientError } from '../diagnostics';
import { ConfirmActionModal } from './modals/ConfirmActionModal';
import { useTheme } from '../hooks/useTheme';
import { useKeyboardInsets } from '../hooks/useKeyboardInsets';
import { usePhoneLayout } from '../hooks/usePhoneLayout';
import { useEditorAutosave, type EditorSaveController } from '../hooks/useEditorAutosave';
import { STORAGE_KEYS } from '../storageKeys';
import { getHostCapabilities } from '../hostCapabilities';
import { EditorShortcuts } from './EditorShortcuts';
// Bundled with the editor page: a lazy player flashed "Caricamento player..." on every first open.
import { AudioPlayer } from './AudioPlayer';
import { RichTextEditorChunk } from '../editorPreload';

// Shared with the idle warm-up, so a preloaded editor opens without the Suspense fallback.
const LazyRichTextEditor = RichTextEditorChunk.Component;

export interface EditorDocumentProps {
  content: string | null;
  title: string;
  htmlPath: string;
  initScrollTop?: number;
  initialSearchTerm?: string;
}

export interface EditorAudioProps {
  src: string | null;
  relinkNeeded: boolean;
  loading?: boolean;
  warning?: string;
  onRelink: () => Promise<boolean | undefined>;
  onRemoveAudio?: () => Promise<boolean | undefined> | void;
  /** Web: a copy of the playing file is kept in this browser (size in bytes). */
  kept?: boolean;
  size?: number;
  onKeepChange?: (keep: boolean) => Promise<boolean | undefined>;
  init: { time?: number; playbackRate?: number; volume?: number };
  onStateChange: (state: { currentTime: number; playbackRate: number; volume: number }) => void;
}

export interface EditorThemeProps {
  mode?: 'light' | 'dark';
  setMode?: React.Dispatch<React.SetStateAction<'light' | 'dark'>>;
}

export interface EditorFullPageProps {
  document?: EditorDocumentProps;
  audio?: EditorAudioProps;
  theme?: EditorThemeProps;
  onClose: () => void;
  onScrollTopChange?: (scrollTop: number) => void;
  saveControllerRef?: React.RefObject<EditorSaveController | null>;

  // Flat props for backwards compatibility
  previewContent?: string | null;
  previewTitle?: string;
  htmlPath?: string;
  audioSrc?: string | null;
  audioRelinkNeeded?: boolean;
  onRelink?: () => Promise<boolean | undefined>;
  onRemoveAudio?: () => Promise<boolean | undefined> | void;
  previewInitAudio?: { time?: number; playbackRate?: number; volume?: number };
  previewInitScrollTop?: number | undefined;
  initialSearchTerm?: string;
  themeMode?: 'light' | 'dark';
  setThemeMode?: React.Dispatch<React.SetStateAction<'light' | 'dark'>>;
  onAudioStateChange?: (state: { currentTime: number; playbackRate: number; volume: number }) => void;
}

export function EditorFullPage({
  document: docProp,
  audio: audioProp,
  theme: themeProp,
  onClose,
  onScrollTopChange: propOnScrollTopChange,
  saveControllerRef,
  previewContent: flatPreviewContent,
  previewTitle: flatPreviewTitle,
  htmlPath: flatHtmlPath,
  audioSrc: flatAudioSrc,
  audioRelinkNeeded: flatAudioRelinkNeeded,
  onRelink: flatOnRelink,
  onRemoveAudio: flatOnRemoveAudio,
  previewInitAudio: flatPreviewInitAudio,
  previewInitScrollTop: flatPreviewInitScrollTop,
  initialSearchTerm: flatInitialSearchTerm,
  themeMode: flatThemeMode,
  setThemeMode: flatSetThemeMode,
  onAudioStateChange: flatOnAudioStateChange,
}: EditorFullPageProps) {
  const previewContent = docProp?.content !== undefined ? docProp.content : (flatPreviewContent ?? null);
  const previewTitle = docProp?.title ?? flatPreviewTitle ?? '';
  const htmlPath = docProp?.htmlPath ?? flatHtmlPath ?? '';
  const previewInitScrollTop = docProp?.initScrollTop ?? flatPreviewInitScrollTop;
  const initialSearchTerm = docProp?.initialSearchTerm ?? flatInitialSearchTerm;

  const audioSrc = audioProp?.src !== undefined ? audioProp.src : (flatAudioSrc ?? null);
  const audioRelinkNeeded = audioProp?.relinkNeeded ?? flatAudioRelinkNeeded ?? false;
  const audioLoading = audioProp?.loading ?? false;
  const onRelink = audioProp?.onRelink ?? flatOnRelink ?? (() => Promise.resolve(undefined));
  const onRemoveAudio = audioProp?.onRemoveAudio ?? flatOnRemoveAudio;
  const onKeepChange = audioProp?.onKeepChange;
  const previewInitAudio = audioProp?.init ?? flatPreviewInitAudio ?? {};
  const onAudioStateChange = audioProp?.onStateChange ?? flatOnAudioStateChange ?? (() => {});

  const propThemeMode = themeProp?.mode ?? flatThemeMode;
  const propSetThemeMode = themeProp?.setMode ?? flatSetThemeMode;
  const onScrollTopChange = propOnScrollTopChange ?? (() => {});
  const fallbackTheme = useTheme();
  const themeMode = propThemeMode ?? fallbackTheme.themeMode;
  const setThemeMode = propSetThemeMode ?? fallbackTheme.setThemeMode;
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [isCopied, setIsCopied] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const isCopyingRef = useRef(false);
  const [relinkSuccess, setRelinkSuccess] = useState(false);
  const [isRelinking, setIsRelinking] = useState(false);
  const [isRemovingAudio, setIsRemovingAudio] = useState(false);
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);
  const relinkTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const getHtmlRef = useRef<(() => string) | null>(null);
  const showAudioDock = getHostCapabilities().editorAudio;
  // Web: the sbobina keeps no audio, so the dock asks for the lecture file instead of a relink.
  const audioPicked = !getHostCapabilities().sessionKeepsAudio;
  // On a tablet the editor shrinks to the area above the on-screen keyboard, player included.
  const keyboard = useKeyboardInsets(getHostCapabilities().kind === 'web');
  const isPhone = usePhoneLayout();
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);

  // The dock changes height with its state (player, relink prompt, warning), so measure it live.
  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const measure = () => setFooterHeight(Math.ceil(footer.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.EDITOR_ZOOM);
    if (stored) {
      const n = parseInt(stored, 10);
      if (!isNaN(n) && n >= 50 && n <= 200) return n;
    }
    return 100;
  });

  const handleZoomChange = useCallback((level: number) => {
    const clamped = Math.max(50, Math.min(200, level));
    setZoomLevel(clamped);
    try { localStorage.setItem(STORAGE_KEYS.EDITOR_ZOOM, String(clamped)); } catch (_) {}
  }, []);

  const zoomLevelRef = useRef(zoomLevel);
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
    // EDITOR_ZOOM_EVENT in imageDrag.ts, kept literal so the editor stays lazy.
    window.dispatchEvent(new Event('editor-zoom-change'));
  }, [zoomLevel]);

  useEffect(() => {
    if (copiedTimerRef.current) { window.clearTimeout(copiedTimerRef.current); copiedTimerRef.current = null; }
    setIsCopied(false);
    setRelinkSuccess(false);
    setIsTocOpen(false);
  }, [previewContent]);

  useEffect(() => {
    return () => {
      if (relinkTimerRef.current) window.clearTimeout(relinkTimerRef.current);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const {
    autosaveStatus,
    lastPersistedRef,
    scheduleAutosave,
    flushAndClose,
  } = useEditorAutosave({
    htmlPath,
    previewContent,
    getHtmlRef,
    onClose,
    saveControllerRef,
  });

  useEffect(() => {
    if (previewContent === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { void flushAndClose(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleZoomChange(zoomLevelRef.current + 10);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        handleZoomChange(zoomLevelRef.current - 10);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        handleZoomChange(100);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewContent, flushAndClose, handleZoomChange]);

  const handleCopy = async () => {
    if (isCopyingRef.current) return;
    isCopyingRef.current = true;
    setIsCopying(true);
    try {
      // The copy below blocks the page: let the button show it was pressed first.
      // execCommand('copy') still runs well within the click's user activation on Chromium;
      // WebKit (Safari, macOS WKWebView) only allows the copy while the click is handled.
      if (!/Apple/.test(navigator.vendor ?? '')) {
        await new Promise<void>(resolve => requestAnimationFrame(() => window.setTimeout(resolve)));
      }
      const rawHtml = getHtmlRef.current?.() ?? lastPersistedRef.current;
      const sourceRoot = document.querySelector<HTMLElement>('.tiptap-editor') ?? undefined;
      const clipboardHtml = prepareHtmlForClipboardSync(rawHtml, sourceRoot);
      // The native formats already carry the plain text; parse it separately only for the HTML fallback.
      let formats = createNativeClipboardFormats(clipboardHtml, sourceRoot, false, undefined, true);
      if (!formats) {
        const temp = document.createElement('div');
        temp.innerHTML = clipboardHtml;
        formats = { 'text/html': prepareHtmlLineSpacing(clipboardHtml), 'text/plain': clipboardPlainText(temp) };
      }
      await writeEditorClipboard(clipboardHtml, formats['text/plain'], sourceRoot, formats);
    } catch (error) {
      reportClientError('Clipboard error', error);
      return;
    } finally {
      isCopyingRef.current = false;
      setIsCopying(false);
    }
    setIsCopied(true);
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setIsCopied(false), 2000);
  };

  const scrollToHeading = (heading: Heading) => {
    const { text, level, id } = heading;
    const idx = headings.findIndex(h => h.id === id);
    if (idx === -1) return;
    const occurrencesBefore = headings
      .slice(0, idx)
      .filter(h => h.level === level && h.text.trim() === text.trim())
      .length;
    const els = Array.from(document.querySelectorAll(`.tiptap-editor h${level}`))
      .filter(el => el.textContent?.trim() === text.trim());
    els[occurrencesBefore]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <AnimatePresence>
      {previewContent !== null && (
        <motion.div
          className="editor-fullpage"
          style={keyboard.bottom ? { top: keyboard.top, bottom: keyboard.bottom } : undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
        >
          <div className="editor-fullpage-header">
            <button
              className="editor-fullpage-back"
              onClick={() => void flushAndClose()}
              title={autosaveStatus === 'error' ? 'Chiudi senza salvare' : 'Torna indietro'}
              aria-label={autosaveStatus === 'error' ? 'Chiudi senza salvare' : 'Torna indietro'}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="editor-fullpage-title">
              <FileText className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <span className="truncate">{previewTitle}</span>
              <span
                className="editor-autosave-badge shrink-0"
                data-status={autosaveStatus}
                style={{
                  color:
                    autosaveStatus === 'error' ? 'var(--error-text)'
                    : autosaveStatus === 'saved' ? 'var(--success-text)'
                    : 'var(--text-muted)',
                  borderColor:
                    autosaveStatus === 'error' ? 'var(--error-ring)'
                    : autosaveStatus === 'saved' ? 'var(--success-ring)'
                    : 'var(--border-subtle)',
                }}
              >
                {autosaveStatus === 'saving' ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                    <span className="editor-autosave-label">Autosave</span>
                  </>
                ) : autosaveStatus === 'saved' ? (
                  <>
                    <Check className="w-3 h-3 mr-1.5" />
                    <span className="editor-autosave-label">Salvato</span>
                  </>
                ) : autosaveStatus === 'error' ? (
                  <span>Errore salvataggio</span>
                ) : (
                  <span className="editor-autosave-label">Autosave</span>
                )}
              </span>
            </div>

            <div className="editor-fullpage-actions">
              <button
                onClick={() => void handleCopy()}
                className={`settings-pill-button editor-fullpage-copy${isCopied ? ' is-copied' : ''}`}
                title={isCopied ? 'Copiato!' : 'Copia tutto il documento mantenendo la formattazione, pronto da incollare in Google Docs o Word.'}
                aria-label="Copia documento"
                aria-busy={isCopying}
              >
                {isCopied ? <Check className="w-4 h-4" /> : isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                <span className="editor-fullpage-copy-label">{isCopied ? 'Copiato!' : 'Copia documento'}</span>
              </button>
              <div className="editor-fullpage-utilities">
                {/* Keyboard shortcuts mean nothing on a phone's touch keyboard. */}
                {!isPhone && <EditorShortcuts audioAvailable={showAudioDock && Boolean(audioSrc)} />}
                <button
                  onClick={() => setThemeMode(prev => prev === 'dark' ? 'light' : 'dark')}
                  className="icon-button theme-toggle-btn"
                  aria-label={themeMode === 'dark' ? 'Attiva tema chiaro' : 'Attiva tema scuro'}
                  title={themeMode === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
                >
                  {themeMode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="editor-fullpage-body">
            {/* The fallback fills the body so the footer player stays at the bottom while the editor chunk loads. */}
            <Suspense fallback={<div className="editor-fullpage-loading flex-1 min-h-0 p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Caricamento editor...</div>}>
              <LazyRichTextEditor
                key={htmlPath}
                initialContent={previewContent}
                onChange={scheduleAutosave}
                onEditorReady={getHtml => { getHtmlRef.current = getHtml; }}
                initialScrollTop={previewInitScrollTop}
                initialSearchTerm={initialSearchTerm}
                onScrollTopChange={onScrollTopChange}
                onHeadingsChange={setHeadings}
                isTocOpen={isTocOpen}
                onTocToggle={() => setIsTocOpen(p => !p)}
                tocHeadings={headings}
                onScrollToHeading={scrollToHeading}
                zoomLevel={zoomLevel}
                onZoomChange={handleZoomChange}
                bottomInset={footerHeight}
              />
            </Suspense>

            {/* The player floats over the page bottom; the editor reserves its height so text never hides under it.
                Hosts without session audio (the web build until M2b) have no dock at all. */}
            {showAudioDock && (
            <div ref={footerRef} className="editor-fullpage-footer">
              <div className="editor-player-dock">
                {audioProp?.warning && (
                  <p role="status" className="pt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{audioProp.warning}</p>
                )}
                {audioLoading ? (
                  <div role="status" className="flex items-center gap-2 py-3.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Preparazione audio della sbobina...
                  </div>
                ) : audioSrc ? (
                  <AudioPlayer
                    src={audioSrc}
                    initialTime={previewInitAudio.time}
                    initialPlaybackRate={previewInitAudio.playbackRate}
                    initialVolume={previewInitAudio.volume}
                    onStateChange={onAudioStateChange}
                    onRelink={onRelink}
                    // Web: nothing to unlink, the user decides whether this browser keeps a copy.
                    onRemoveAudio={audioPicked ? undefined : onRemoveAudio}
                    keep={audioPicked && onKeepChange ? { kept: Boolean(audioProp?.kept), size: audioProp?.size ?? 0, onChange: onKeepChange } : undefined}
                  />
                ) : audioRelinkNeeded ? (
                  <div className="flex items-center justify-between gap-3 py-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{audioPicked ? 'Audio della lezione' : 'Audio non trovato'}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {audioPicked
                          ? 'L’audio non resta salvato nel browser: scegli il file della lezione per ascoltarlo.'
                          : 'Seleziona di nuovo il file per conservarne una copia nella sbobina.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {onRemoveAudio && !audioPicked && (
                        <button
                          type="button"
                          onClick={() => setShowConfirmRemove(true)}
                          disabled={isRemovingAudio}
                          className="app-button-secondary is-settings-action"
                          title="Rimuovi audio dalla sbobina"
                          aria-label="Rimuovi audio dalla sbobina"
                        >
                          {isRemovingAudio ? 'Rimozione...' : 'Rimuovi audio'}
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          if (isRelinking) return;
                          setIsRelinking(true);
                          try {
                            const ok = await onRelink();
                            if (ok) {
                              if (relinkTimerRef.current) window.clearTimeout(relinkTimerRef.current);
                              setRelinkSuccess(true);
                              relinkTimerRef.current = window.setTimeout(() => setRelinkSuccess(false), 3000);
                            }
                          } finally { setIsRelinking(false); }
                        }}
                        disabled={isRelinking}
                        className="app-button-secondary is-settings-action"
                        style={relinkSuccess ? { borderColor: 'var(--success-ring)', color: 'var(--success-text)' } : {}}
                      >
                        {relinkSuccess
                          ? <><Check className="w-3.5 h-3.5" /> {audioPicked ? 'Audio pronto' : 'Ricollegato'}</>
                          : isRelinking ? 'Selezione...' : audioPicked ? 'Scegli il file audio' : 'Ricollega audio'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 py-3.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: 'var(--bg-panel)', color: 'var(--text-muted)' }}
                      >
                        <Headphones className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-none mb-1" style={{ color: 'var(--text-primary)' }}>Nessun audio collegato</p>
                        <p className="text-xs leading-none" style={{ color: 'var(--text-muted)' }}>
                          {audioPicked
                            ? 'Scegli il file della lezione per ascoltarlo mentre rileggi.'
                            : 'Aggiungi un file audio: una copia verrà conservata nella sbobina.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          if (isRelinking) return;
                          setIsRelinking(true);
                          try {
                            const ok = await onRelink();
                            if (ok) {
                              if (relinkTimerRef.current) window.clearTimeout(relinkTimerRef.current);
                              setRelinkSuccess(true);
                              relinkTimerRef.current = window.setTimeout(() => setRelinkSuccess(false), 3000);
                            }
                          } finally {
                            setIsRelinking(false);
                          }
                        }}
                        disabled={isRelinking}
                        className="settings-pill-button"
                      >
                        {isRelinking ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Selezione...</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>{audioPicked ? 'Scegli il file audio' : 'Aggiungi audio'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}
          </div>

          <ConfirmActionModal
            isOpen={showConfirmRemove}
            title="Rimuovere l'audio mancante?"
            description="La copia audio interna verrà eliminata dalla sbobina, liberando spazio. Il file originale sul tuo computer non verrà cancellato. Potrai aggiungere un nuovo audio in qualsiasi momento."
            confirmLabel={isRemovingAudio ? 'Rimozione...' : 'Rimuovi audio'}
            cancelLabel="Annulla"
            onClose={() => setShowConfirmRemove(false)}
            onConfirm={async () => {
              setShowConfirmRemove(false);
              if (isRemovingAudio) return;
              setIsRemovingAudio(true);
              try {
                await onRemoveAudio?.();
              } finally {
                setIsRemovingAudio(false);
              }
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
