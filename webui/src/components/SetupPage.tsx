import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, CheckCircle2, ExternalLink, Eye, EyeOff, Key, Lightbulb, Loader2 } from 'lucide-react';
import { GEMINI_KEY_PATTERN } from '../utils';

interface SetupPageProps {
  hasProtectedKey: boolean;
  onSaved: (key: string) => void;
  preferredModel: string;
  fallbackKeys: string[];
  fallbackModels: string[];
}

export function SetupPage({
  hasProtectedKey,
  onSaved,
  preferredModel,
  fallbackKeys,
  fallbackModels,
}: SetupPageProps) {
  const [setupKeyInput, setSetupKeyInput] = useState('');
  const [setupKeyShowRaw, setSetupKeyShowRaw] = useState(false);
  const [setupKeySaving, setSetupKeySaving] = useState(false);
  const [setupKeyError, setSetupKeyError] = useState<string | null>(null);

  const trimmedKey = setupKeyInput.trim();
  const isValidFormat = GEMINI_KEY_PATTERN.test(trimmedKey);
  const canSave = trimmedKey.length > 0 && isValidFormat && !setupKeySaving;

  const handleSetupSave = async () => {
    setSetupKeySaving(true);
    setSetupKeyError(null);
    try {
      if (!window.pywebview?.api?.save_settings) {
        setSetupKeyError('Bridge Python non disponibile — impostazioni non salvate.');
        return;
      }
      let result;
      try {
        result = await window.pywebview.api.save_settings(
          trimmedKey,
          fallbackKeys,
          preferredModel,
          fallbackModels,
        );
      } catch (e: unknown) {
        setSetupKeyError(`Errore salvataggio: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!result?.ok) {
        setSetupKeyError(`Errore salvataggio: ${result?.error || 'errore sconosciuto'}`);
        return;
      }
      onSaved(trimmedKey);
    } finally {
      setSetupKeySaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="w-full max-w-2xl mx-auto"
    >
      {/* Document Header */}
      <div className="space-y-3 text-left">
        <img
          src="/icon.png"
          alt="El Sbobinator"
          className="w-11 h-11 object-contain select-none pointer-events-none"
          draggable={false}
        />
        <div className="space-y-1.5">
          <h1 className="text-[1.75rem] font-semibold tracking-tight leading-tight text-[var(--text-primary)] font-display">
            {hasProtectedKey ? 'Chiave API non accessibile' : 'Configura la tua API Key'}
          </h1>
          <p className="text-base leading-relaxed text-[var(--text-muted)]">
            {hasProtectedKey
              ? 'La tua chiave era salvata ma non è accessibile (errore di sistema). Reinseriscila per continuare.'
              : 'El Sbobinator usa Google Gemini per trascrivere audio e video. Inserisci una chiave API gratuita per iniziare.'}
          </p>
        </div>
      </div>

      {/* Main Setup Section */}
      <div className="mt-5 space-y-1.5">
        <div className="space-y-1.5">
          <label
            htmlFor="gemini-setup-api-key"
            className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5 select-none"
          >
            <Key className="w-3.5 h-3.5 text-[var(--accent-text)]" />
            <span>Chiave API Gemini</span>
          </label>

          <div className="flex items-center gap-2.5">
            <div className="relative flex-1">
              <input
                id="gemini-setup-api-key"
                type={setupKeyShowRaw ? 'text' : 'password'}
                value={setupKeyInput}
                onChange={e => setSetupKeyInput(e.target.value)}
                onKeyDown={async e => {
                  if (e.key !== 'Enter') return;
                  if (!GEMINI_KEY_PATTERN.test(setupKeyInput.trim())) return;
                  if (setupKeySaving) return;
                  await handleSetupSave();
                }}
                placeholder="Incolla qui la tua API Key (AIzaSy... o AQ...)"
                className={`app-input w-full h-[42px] font-mono text-sm pl-3.5 pr-10 py-2.5 rounded-lg border outline-none bg-[var(--bg-input)] text-[var(--text-primary)] transition-all duration-150 ${
                  trimmedKey && isValidFormat
                    ? 'border-[var(--success-ring)] focus:border-[var(--success-text)] focus:ring-2 focus:ring-[var(--success-ring)]'
                    : trimmedKey
                      ? 'border-[var(--warning-ring)] focus:border-[var(--warning-text)] focus:ring-2 focus:ring-[var(--warning-ring)]'
                      : 'border-[var(--border-default)] hover:border-[var(--border-strong)] focus:border-[var(--accent-bg)] focus:ring-2 focus:ring-[var(--accent-ring)]'
                }`}
              />
              <button
                type="button"
                onClick={() => setSetupKeyShowRaw(v => !v)}
                tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                aria-label={setupKeyShowRaw ? 'Nascondi chiave' : 'Mostra chiave'}
              >
                {setupKeyShowRaw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              type="button"
              disabled={!canSave}
              onClick={handleSetupSave}
              className={`shrink-0 h-[42px] px-4 rounded-lg font-semibold text-sm inline-flex items-center justify-center gap-2 transition-all duration-150 select-none whitespace-nowrap border ${
                canSave
                  ? 'border-transparent bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] active:scale-[0.98] cursor-pointer'
                  : 'border-[var(--border-default)] bg-[var(--bg-panel)] text-[var(--text-muted)] cursor-not-allowed opacity-80'
              }`}
            >
              {setupKeySaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className={`w-4 h-4 transition-transform ${canSave ? 'translate-x-0.5' : ''}`} />
              )}
              <span>{setupKeySaving ? 'Salvataggio…' : 'Salva e inizia'}</span>
            </button>
          </div>
        </div>

        {trimmedKey ? (
          <div
            className={`flex items-center gap-1.5 text-xs font-medium transition-opacity ${
              isValidFormat ? 'text-[var(--success-text)]' : 'text-[var(--warning-text)]'
            }`}
          >
            {isValidFormat ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">
              {isValidFormat
                ? 'Formato valido — premi Salva per continuare'
                : 'Formato non valido — le chiavi iniziano con AIzaSy... o AQ.'}
            </span>
          </div>
        ) : null}

        {setupKeyError && (
          <div className="alert-card is-error text-xs flex items-center gap-2 py-2 px-3 mt-1.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-[var(--error-text)]" />
            <span className="text-[var(--error-text)] leading-snug">{setupKeyError}</span>
          </div>
        )}
      </div>

      {/* Callout Guide */}
      <div className="mt-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-default)] p-4 sm:p-5 text-left space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
          <Lightbulb className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
          <span>Come ottenere la chiave in 1 minuto</span>
        </div>
        <ol className="flex flex-col gap-2.5 text-xs text-[var(--text-secondary)]">
          <li className="flex items-start gap-3">
            <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-muted)] mt-0.5">
              1
            </span>
            <span className="leading-snug pt-0.5">
              Vai su{' '}
              <a
                href="https://aistudio.google.com/apikey"
                onClick={e => {
                  e.preventDefault();
                  window.pywebview?.api?.open_url?.('https://aistudio.google.com/apikey');
                }}
                className="font-medium text-[var(--accent-text)] hover:underline inline-flex items-center gap-0.5"
              >
                <span>aistudio.google.com/apikey</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-muted)] mt-0.5">
              2
            </span>
            <span className="leading-snug pt-0.5">
              Clicca <strong className="font-semibold text-[var(--text-primary)]">&quot;Create API key&quot;</strong> e copia la chiave
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-muted)] mt-0.5">
              3
            </span>
            <span className="leading-snug pt-0.5">
              Incollala nel campo qui sopra e premi <strong className="font-semibold text-[var(--text-primary)]">Salva e inizia</strong>
            </span>
          </li>
        </ol>
      </div>
    </motion.div>
  );
}
