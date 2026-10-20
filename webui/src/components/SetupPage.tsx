import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, CheckCircle2, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import type { CredentialStorage, ValidationCheck } from '../bridge';
import { GEMINI_KEY_PATTERN } from '../utils';
import { BrandLogo } from './BrandLogo';
import { SetupErrorNotice } from './SetupErrorNotice';

interface SetupPageProps {
  hasProtectedKey: boolean;
  onSaved: (key: string, model?: string, storage?: CredentialStorage, legacyPlaintext?: boolean) => void;
  preferredModel: string;
  fallbackKeys: string[];

}

export function SetupPage({
  hasProtectedKey,
  onSaved,
  preferredModel,
  fallbackKeys,

}: SetupPageProps) {
  const [setupKeyInput, setSetupKeyInput] = useState('');
  const [setupKeyShowRaw, setSetupKeyShowRaw] = useState(false);
  const [setupKeySaving, setSetupKeySaving] = useState(false);
  const [setupKeyError, setSetupKeyError] = useState<ValidationCheck | null>(null);
  const setLocalError = (message: string) => setSetupKeyError({ id: 'setup', label: 'Configurazione', status: 'error', message });

  const trimmedKey = setupKeyInput.trim();
  const isValidFormat = GEMINI_KEY_PATTERN.test(trimmedKey);
  const canSave = trimmedKey.length > 0 && isValidFormat && !setupKeySaving;

  const handleSetupSave = async () => {
    if (setupKeySaving) return;
    setSetupKeySaving(true);
    setSetupKeyError(null);
    try {
      if (!window.pywebview?.api?.save_settings) {
        setLocalError('Bridge Python non disponibile — impostazioni non salvate.');
        return;
      }

      let result;
      try {
        result = await window.pywebview.api.save_settings(
          trimmedKey,
          fallbackKeys,
          preferredModel,

        );
      } catch (e: unknown) {
        setLocalError(`Errore salvataggio: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!result?.ok) {
        setLocalError(`Errore salvataggio: ${result?.error || 'errore sconosciuto'}`);
        return;
      }
      if (result.api_key_insecure !== undefined) {
        onSaved(trimmedKey, preferredModel, result.credential_storage, result.api_key_insecure);
      } else if (result.credential_storage) {
        onSaved(trimmedKey, preferredModel, result.credential_storage);
      } else {
        onSaved(trimmedKey, preferredModel);
      }
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
        <BrandLogo size={52} welcome={!hasProtectedKey} />
        <div className="space-y-1.5">
          <h1 className="page-title">
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
          <label htmlFor="gemini-setup-api-key" className="dashboard-section-title block select-none">
            Chiave API Gemini
          </label>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1">
              <input
                id="gemini-setup-api-key"
                type="text"
                data-masked={!setupKeyShowRaw ? 'true' : 'false'}
                value={setupKeyInput}
                disabled={setupKeySaving}
                onChange={e => {
                  setSetupKeyInput(e.target.value);
                  setSetupKeyError(null);
                }}
                onKeyDown={async e => {
                  if (e.key !== 'Enter') return;
                  if (!GEMINI_KEY_PATTERN.test(setupKeyInput.trim())) return;
                  if (setupKeySaving) return;
                  await handleSetupSave();
                }}
                placeholder="Incolla qui la tua API Key (AIzaSy... o AQ...)"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className={`app-input is-settings-input setup-key-input ${
                  !setupKeyShowRaw ? 'obscured-text' : ''
                } ${trimmedKey ? (isValidFormat ? 'is-valid' : 'is-warning') : ''}`}
              />
              <button
                type="button"
                onClick={() => setSetupKeyShowRaw(v => !v)}
                tabIndex={-1}
                className="absolute inset-y-0 right-3.5 z-10 flex items-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                aria-label={setupKeyShowRaw ? 'Nascondi chiave' : 'Mostra chiave'}
              >
                {setupKeyShowRaw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            <button
              type="button"
              disabled={!canSave}
              onClick={handleSetupSave}
              className="settings-pill-button setup-save-button"
            >
              {setupKeySaving ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <ArrowRight className="w-4 h-4 shrink-0" />
              )}
              <span>{setupKeySaving ? 'Salvataggio…' : 'Salva e inizia'}</span>
            </button>
          </div>
        </div>

        {trimmedKey && !setupKeyError ? (
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
          <SetupErrorNotice check={setupKeyError} apiKey={trimmedKey} />
        )}
      </div>

      {/* Callout Guide */}
      <section className="setup-guide mt-4" aria-labelledby="setup-guide-title">
        <h2 id="setup-guide-title" className="dashboard-section-title">
          Come ottenere la chiave in 1 minuto
        </h2>
        <ol className="flex flex-col gap-2.5 text-xs text-[var(--text-secondary)]">
          <li className="flex items-start gap-3">
            <span className="setup-guide-step" aria-hidden="true">
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
            <span className="setup-guide-step" aria-hidden="true">
              2
            </span>
            <span className="leading-snug pt-0.5">
              Clicca <strong className="font-semibold text-[var(--text-primary)]">&quot;Create API key&quot;</strong> e copia la chiave
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="setup-guide-step" aria-hidden="true">
              3
            </span>
            <span className="leading-snug pt-0.5">
              Incollala nel campo qui sopra e premi <strong className="font-semibold text-[var(--text-primary)]">Salva e inizia</strong>
            </span>
          </li>
        </ol>
      </section>
    </motion.div>
  );
}
