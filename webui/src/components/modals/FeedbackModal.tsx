import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, CheckCircle2, Copy, ImagePlus, MessageSquareWarning, X } from 'lucide-react';
import { APP_VERSION, BUG_REPORT_URL, SUPPORT_EMAIL } from '../../branding';
import { DURATION, fade, fadeUp, modalCard } from '../../motion';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { FeedbackImageError, MAX_FEEDBACK_IMAGES, encodeFeedbackImage, type FeedbackImage } from '../../feedback/images';
import { rememberReport } from '../../feedback/history';
import { openReportEmail } from '../../feedback/reportEmail';
import type { FeedbackInput, FeedbackKind, FeedbackResult } from '../../monitoring/sentry';
import { scrubText } from '../../monitoring/scrub';
import { CustomSelect } from './settings/CustomSelect';
import { UnsavedChangesHint } from './UnsavedChangesHint';

// "Segnala un problema" in web builds with a Sentry DSN (piano-feedback.md): the user writes what
// happened, may add screenshots and sees the tech info before it goes. Everything leaves through
// monitoring/sentry.ts and the site's /api/report; when that fails, an email is one tap away.

export const MIN_MESSAGE_LENGTH = 10;
export const MAX_MESSAGE_LENGTH = 5000;
const TECH_REPORT_LIMIT = 8000;
// Just above the closed form's natural height (about 45.5rem): kept whole as a literal for Tailwind.
export const FORM_HEIGHT_CLASS = 'h-[min(46rem,calc(100dvh-2rem))]';
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

const KIND_OPTIONS: Array<{ value: FeedbackKind; label: string }> = [
  { value: 'bug', label: 'Bug: qualcosa non funziona' },
  { value: 'idea', label: 'Suggerimento: un miglioramento' },
  { value: 'altro', label: 'Altro' },
];

/** The diagnostic report of Impostazioni → Assistenza (the window masks it before showing it). */
async function loadTechReport(): Promise<string | null> {
  const result = await window.pywebview?.api?.get_diagnostic_report?.(undefined, undefined, undefined, undefined, APP_VERSION);
  return result?.ok && result.report ? result.report : null;
}

async function sendThroughSentry(input: FeedbackInput): Promise<FeedbackResult> {
  // Only the web build reports: Vite drops the SDK from the desktop bundle.
  if (import.meta.env.MODE !== 'web') return { ok: false, reason: 'unavailable' };
  const { sendFeedback } = await import('../../monitoring/sentry');
  return sendFeedback(input);
}

interface FeedbackModalProps {
  onClose: () => void;
  send?: (input: FeedbackInput) => Promise<FeedbackResult>;
  encodeImage?: typeof encodeFeedbackImage;
  loadReport?: () => Promise<string | null>;
}

type Failure = { reason: 'rate_limited' | 'unavailable' } | null;

// Module-level, so its identity never changes: React 19 calls an inline callback ref again on every
// render, which moved the focus back to "Chiudi" whenever the thanks re-rendered (copying the code).
function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

export function FeedbackModal({ onClose, send = sendThroughSentry, encodeImage = encodeFeedbackImage, loadReport = loadTechReport }: FeedbackModalProps) {
  const [kind, setKind] = useState<FeedbackKind | ''>('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [images, setImages] = useState<FeedbackImage[]>([]);
  const [imageError, setImageError] = useState('');
  const [addingImages, setAddingImages] = useState(false);
  const [includeTech, setIncludeTech] = useState(true);
  const [techReport, setTechReport] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [code, setCode] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const kindId = useId();
  const messageId = useId();
  const messageHintId = useId();
  const emailId = useId();
  const emailErrorId = useId();

  const trimmed = message.trim();
  const emailValid = !email.trim() || EMAIL_PATTERN.test(email.trim());
  const canSend = Boolean(kind) && trimmed.length >= MIN_MESSAGE_LENGTH && trimmed.length <= MAX_MESSAGE_LENGTH && emailValid && !addingImages;
  const dirty = !code && (Boolean(trimmed) || images.length > 0);
  const busy = sending || addingImages;

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  // The thumbnails' object URLs go with the window.
  useEffect(() => () => imagesRef.current.forEach(image => URL.revokeObjectURL(image.previewUrl)), []);

  useEffect(() => {
    let active = true;
    // Masked here, whatever the source: what the user sees is exactly what goes.
    void loadReport().then(report => { if (active) setTechReport(report === null ? null : scrubText(report, TECH_REPORT_LIMIT)); }, () => {});
    return () => { active = false; };
  }, [loadReport]);

  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/') event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        // An open menu ("Tipo di segnalazione") takes Esc first: stopped here, its own Esc handlers never
        // run, so its trigger closes it, wherever the focus is. The window's Esc comes with the next press.
        const openMenu = dialogRef.current?.querySelector<HTMLElement>('[aria-haspopup][aria-expanded="true"]');
        if (openMenu) { openMenu.click(); return; }
        // With words written, only "Annulla" drops them, as a click outside does not.
        if (!busyRef.current && !dirtyRef.current) onCloseRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="file"]), textarea:not(:disabled), summary') ?? []);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const backdrop = useBackdropDismiss({ dirty, onClose, blocked: busy });

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const handleImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    const room = MAX_FEEDBACK_IMAGES - images.length;
    setImageError(files.length > room ? `Puoi allegare al massimo ${MAX_FEEDBACK_IMAGES} immagini.` : '');
    setAddingImages(true);
    try {
      const added: FeedbackImage[] = [];
      for (const [offset, file] of files.slice(0, Math.max(0, room)).entries()) {
        try {
          added.push(await encodeImage(file, images.length + offset));
        } catch (error) {
          setImageError(error instanceof FeedbackImageError ? error.message : `Non riesco a leggere "${file.name}".`);
        }
      }
      setImages(current => [...current, ...added]);
    } finally {
      setAddingImages(false);
    }
  };

  const removeImage = (index: number) => {
    setImages(current => {
      URL.revokeObjectURL(current[index].previewUrl);
      // Renumbered, so the names keep following the order the user sees.
      return current.filter((_, at) => at !== index).map((image, at) => ({ ...image, filename: `immagine-${at + 1}.jpg` }));
    });
    setImageError('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSend || !kind || busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    setFailure(null);
    try {
      const result = await send({
        kind,
        message: trimmed,
        email: email.trim() || undefined,
        images: images.map(({ data, filename }) => ({ data, filename })),
        techReport: includeTech ? (techReport ?? `- Versione: ${APP_VERSION} (web)`) : undefined,
      });
      if (result.ok === false) setFailure({ reason: result.reason });
      else {
        setCode(result.code);
        // Kept in this browser, so the code can be quoted later from Impostazioni → Assistenza.
        rememberReport({ code: result.code, sentAt: new Date().toISOString(), kind });
      }
    } catch {
      setFailure({ reason: 'unavailable' });
    } finally {
      busyRef.current = false;
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
      {/* The dimmed page fades in and out like Impostazioni's, not at once. */}
      <motion.div className="modal-overlay absolute inset-0" onClick={backdrop.onBackdropClick} data-testid="feedback-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: DURATION.fast }} />
      {/* The form keeps one height (what it needs closed, within the screen): opening the tech
          preview, adding images or an error scroll its body instead of resizing the window. */}
      <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="feedback-dialog"
        className={`modal-card${backdrop.shaking ? ' is-shaking' : ''} relative flex w-full max-w-lg max-h-[calc(100dvh-2rem)] flex-col overflow-hidden${code ? '' : ` ${FORM_HEIGHT_CLASS}`}`} {...modalCard}>
        <div className="modal-header">
          <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquareWarning className="w-5 h-5 text-[var(--accent-text)]" aria-hidden="true" />
            Segnala un problema
          </h2>
          <button type="button" className="icon-button modal-icon-button" aria-label="Chiudi finestra" disabled={busy} onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {/* Form and thanks cross-fade instead of swapping at once. */}
        <AnimatePresence mode="wait" initial={false}>
        {code ? (
          <motion.div key="sent" className="flex min-h-0 flex-1 flex-col" {...fadeUp}>
            <div className="modal-body space-y-3" role="status">
              <p className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
                <CheckCircle2 className="w-5 h-5 text-[var(--success-text)]" aria-hidden="true" />
                Grazie! Messaggio ricevuto.
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p>Codice segnalazione: <strong className="font-mono text-[var(--text-primary)] select-all">{code}</strong></p>
                <button type="button" className="app-button-secondary is-settings-action shrink-0" onClick={copyCode}>
                  {copyState === 'copied' ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                  <span>{copyState === 'copied' ? 'Copiato' : 'Copia codice'}</span>
                </button>
              </div>
              {copyState === 'failed' && <p className="text-xs text-[var(--error-text)]">Non riesco a copiarlo: selezionalo e copialo a mano.</p>}
              <p>Se mi scrivi di nuovo per questo problema, indica il codice: così lo ritrovo subito. Lo trovi anche in Impostazioni → Assistenza.</p>
            </div>
            <div className="modal-footer">
              {/* Takes the focus from "Invia", which is gone, once: a stable callback ref runs only when
                  the button mounts, after the form's exit (an effect on `code` would run before it). */}
              <button type="button" ref={focusOnMount} onClick={onClose} className="modal-action-button is-primary flex-1">Chiudi</button>
            </div>
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={handleSubmit} aria-busy={sending} className="flex min-h-0 flex-1 flex-col" {...fade}>
            <div className="modal-body space-y-4">
              <p>Scrivi cosa è successo o cosa vorresti migliorare.</p>

              <div className="space-y-2">
                <label htmlFor={kindId} className="text-xs font-semibold block text-[var(--text-primary)]">Tipo di segnalazione</label>
                <CustomSelect id={kindId} value={kind} disabled={sending} placeholder="Scegli il tipo"
                  onChange={value => setKind(value as FeedbackKind)} options={KIND_OPTIONS} />
              </div>

              <div className="space-y-2">
                <label htmlFor={messageId} className="text-xs font-semibold block text-[var(--text-primary)]">Descrizione</label>
                <textarea id={messageId} data-autofocus className="app-input is-multiline w-full text-sm" rows={5}
                  maxLength={MAX_MESSAGE_LENGTH} readOnly={sending} value={message} aria-describedby={messageHintId}
                  placeholder="Cosa stavi facendo, cosa è successo e cosa ti aspettavi"
                  onChange={event => { setMessage(event.target.value); setFailure(null); }} />
                <p id={messageHintId} className="flex justify-between gap-3 text-xs text-[var(--text-muted)]">
                  <span>{trimmed.length > 0 && trimmed.length < MIN_MESSAGE_LENGTH ? `Almeno ${MIN_MESSAGE_LENGTH} caratteri.` : ''}</span>
                  <span aria-label={`${message.length} caratteri su ${MAX_MESSAGE_LENGTH}`}>{message.length}/{MAX_MESSAGE_LENGTH}</span>
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor={emailId} className="text-xs font-semibold block text-[var(--text-primary)]">Email (facoltativa)</label>
                <input id={emailId} type="email" className="app-input w-full text-sm" autoComplete="email" maxLength={254}
                  readOnly={sending} value={email} placeholder="Solo se vuoi una risposta"
                  aria-invalid={!emailValid} aria-describedby={!emailValid ? emailErrorId : undefined}
                  onChange={event => setEmail(event.target.value)} />
                {!emailValid && <p id={emailErrorId} className="text-xs text-[var(--error-text)]">Controlla l’indirizzo email.</p>}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">Immagini (facoltative)</span>
                  <button type="button" className="app-button-secondary is-settings-action shrink-0"
                    disabled={busy || images.length >= MAX_FEEDBACK_IMAGES} onClick={() => fileInputRef.current?.click()}>
                    <ImagePlus className="w-4 h-4" aria-hidden="true" />
                    <span>{addingImages ? 'Preparo…' : 'Aggiungi'}</span>
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" multiple hidden data-testid="feedback-image-input" onChange={handleImages} />
                </div>
                {images.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label="Immagini allegate">
                    {images.map((image, index) => (
                      <li key={image.previewUrl} className="relative">
                        <img src={image.previewUrl} alt={`Immagine ${index + 1}`} className="h-20 w-20 rounded-lg border border-[var(--border-default)] object-cover" />
                        <button type="button" className="icon-button modal-icon-button absolute -right-2 -top-2" disabled={sending}
                          aria-label={`Rimuovi immagine ${index + 1}`} onClick={() => removeImage(index)}><X className="w-3.5 h-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                )}
                {imageError && <p role="alert" className="text-xs text-[var(--error-text)]">{imageError}</p>}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">Allega informazioni tecniche</p>
                    <p className="text-xs text-[var(--text-muted)]">Versione, browser ed errori recenti. Mai audio, sbobine o chiavi API.</p>
                  </div>
                  <button type="button" role="switch" aria-checked={includeTech} aria-label="Allega informazioni tecniche" disabled={sending}
                    onClick={() => setIncludeTech(value => !value)}
                    className={`touch-hit relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed ${
                      includeTech ? 'bg-[var(--accent-bg)]' : 'bg-[var(--border-default)]'
                    }`}>
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-[var(--shadow-xs)] ring-0 transition duration-200 ease-in-out ${
                      includeTech ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
                {includeTech && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-[var(--accent-text)]">Mostra cosa viene inviato</summary>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 text-[var(--text-secondary)]" data-testid="feedback-tech-report">
                      {techReport ?? 'Versione e browser.'}
                      {'\n'}Più le ultime azioni nell’app (pagine aperte, pulsanti premuti), senza i testi.
                    </pre>
                  </details>
                )}
              </div>

              <p className="text-xs text-[var(--text-muted)]">
                Testo e immagini arrivano allo sviluppatore tramite Sentry (dati in UE, 30 giorni). Controlla che non mostrino dati personali o della lezione che non vuoi condividere.
              </p>

              {failure && (
                <div role="alert" className="space-y-1 text-sm text-[var(--error-text)]">
                  {failure.reason === 'rate_limited' ? (
                    <p>Hai già inviato diversi messaggi: riprova tra qualche minuto.</p>
                  ) : (
                    <>
                      <p>Non riesco a inviare ora. Riprova più tardi, oppure scrivimi un’email:</p>
                      <a
                        href={BUG_REPORT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-[var(--accent-text)] underline"
                        onClick={event => {
                          // Through the helper: the desktop app opens it with its bridge, a browser in a new tab.
                          event.preventDefault();
                          openReportEmail();
                        }}
                      >
                        {SUPPORT_EMAIL}
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>
            <UnsavedChangesHint show={backdrop.showHint} className="is-above-footer" />
            <div className="modal-footer">
              <button type="button" onClick={onClose} disabled={busy} className="modal-action-button flex-1">Annulla</button>
              <button type="submit" disabled={!canSend || busy} className={`modal-action-button is-primary flex-1${backdrop.shaking ? ' is-attention' : ''}`}>
                {sending ? 'Invio…' : 'Invia'}
              </button>
            </div>
          </motion.form>
        )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
