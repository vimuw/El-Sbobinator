import React, { useState } from 'react';
import { Eye, EyeOff, Key, ShieldCheck, AlertCircle, AlertTriangle, ChevronRight, Plus, X, Lightbulb, ExternalLink } from 'lucide-react';
import { GEMINI_KEY_PATTERN } from '../../../utils';

interface ApiKeySectionProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  hasProtectedKey: boolean;
  apiKeyInsecure: boolean;
  apiKeyInsecureReason: string;
  fallbackKeys: string[];
  setFallbackKeys: (keys: string[]) => void;
}

export const ApiKeySection: React.FC<ApiKeySectionProps> = React.memo(({
  apiKey,
  setApiKey,
  hasProtectedKey,
  apiKeyInsecure,
  apiKeyInsecureReason,
  fallbackKeys,
  setFallbackKeys,
}) => {
  const [showPrimaryKey, setShowPrimaryKey] = useState(false);
  const [showFallbackKeys, setShowFallbackKeys] = useState(false);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [fallbackNotice, setFallbackNotice] = useState<{ type: 'error' | 'warning'; message: string } | null>(null);

  const isInvalidFormat = apiKey.trim() !== '' && !GEMINI_KEY_PATTERN.test(apiKey.trim());

  const cleanedFallbackKeys = fallbackKeys.map(k => k.trim()).filter(Boolean);

  const processKeys = (candidates: string[]) => {
    if (candidates.length === 0) return;

    const primaryKeyTrimmed = (apiKey || '').trim();

    if (candidates.length === 1) {
      const cand = candidates[0];
      if (!GEMINI_KEY_PATTERN.test(cand)) {
        setFallbackNotice({
          type: 'error',
          message: 'Formato API key non valido (deve iniziare con "AIzaSy" o "AQ.")',
        });
        return;
      }
      if (primaryKeyTrimmed && cand === primaryKeyTrimmed) {
        setFallbackNotice({
          type: 'error',
          message: 'Questa chiave è già impostata come chiave principale.',
        });
        return;
      }
      if (cleanedFallbackKeys.includes(cand)) {
        setFallbackNotice({
          type: 'error',
          message: 'Questa chiave è già presente tra le riserve.',
        });
        return;
      }
      setFallbackKeys([...cleanedFallbackKeys, cand]);
      setNewKeyInput('');
      setFallbackNotice(null);
      return;
    }

    const newValidKeys: string[] = [];
    let skippedCount = 0;

    for (const cand of candidates) {
      if (!GEMINI_KEY_PATTERN.test(cand)) {
        skippedCount++;
        continue;
      }
      if (primaryKeyTrimmed && cand === primaryKeyTrimmed) {
        skippedCount++;
        continue;
      }
      if (cleanedFallbackKeys.includes(cand) || newValidKeys.includes(cand)) {
        skippedCount++;
        continue;
      }
      newValidKeys.push(cand);
    }

    if (newValidKeys.length > 0) {
      setFallbackKeys([...cleanedFallbackKeys, ...newValidKeys]);
      setNewKeyInput('');
      if (skippedCount > 0) {
        setFallbackNotice({
          type: 'warning',
          message: `${newValidKeys.length} ${newValidKeys.length === 1 ? 'chiave aggiunta' : 'chiavi aggiunte'}. ${skippedCount} ${skippedCount === 1 ? 'ignorata' : 'ignorate'} (non valida o già presente).`,
        });
      } else {
        setFallbackNotice(null);
      }
    } else {
      setFallbackNotice({
        type: 'error',
        message: 'Nessuna chiave valida aggiunta: le chiavi inserite sono già presenti o non valide.',
      });
    }
  };

  const handleAddFallbackKey = () => {
    const raw = newKeyInput.trim();
    if (!raw) return;

    const candidates = raw
      .split(/[\r\n,;\s]+/)
      .map(k => k.trim())
      .filter(Boolean);

    processKeys(candidates);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData?.getData('text');
    if (!text) return;

    const candidates = text
      .split(/[\r\n,;\s]+/)
      .map(k => k.trim())
      .filter(Boolean);

    if (candidates.length > 1) {
      e.preventDefault();
      processKeys(candidates);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddFallbackKey();
    }
  };

  const handleRemoveFallbackKey = (indexToRemove: number) => {
    const updated = cleanedFallbackKeys.filter((_, idx) => idx !== indexToRemove);
    setFallbackKeys(updated);
    setFallbackNotice(null);
  };

  return (
    <div className="space-y-3">
      {/* Primary API Key Field */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Key className="w-4 h-4 text-[var(--accent-text)]" />
            <span>Google Gemini API Key (Principale)</span>
          </label>
          <button
            type="button"
            onClick={() => setShowPrimaryKey(prev => !prev)}
            className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            title={showPrimaryKey ? 'Nascondi chiave' : 'Mostra chiave'}
          >
            {showPrimaryKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <div className="relative">
          <input
            type={showPrimaryKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="AIzaSy... oppure AQ..."
            className={`w-full app-input !py-2 !px-3.5 text-sm font-mono border border-[var(--border-strong)] rounded-lg min-h-[40px] ${
              isInvalidFormat ? 'border-[var(--error-ring)]' : ''
            }`}
          />
        </div>

        {hasProtectedKey && (
          <p className="text-xs flex items-center gap-1.5 text-[var(--success-text)] font-medium">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Salvata in sicurezza (Windows DPAPI / Keychain)</span>
          </p>
        )}

        {isInvalidFormat && (
          <div className="alert-card is-error text-xs flex-row items-center gap-2 py-2 px-3 animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-medium leading-snug">
              Formato API key non valido (deve iniziare con &quot;AIzaSy&quot; o &quot;AQ.&quot;)
            </span>
          </div>
        )}

        {apiKeyInsecure && (
          <div className="alert-card is-warning text-xs space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Memorizzazione in chiaro
            </div>
            <p className="text-[var(--text-secondary)]">
              {apiKeyInsecureReason || 'Impossibile cifrare l\'API key sul sistema corrente. Verrà salvata in modo sicuro ma non cifrato.'}
            </p>
          </div>
        )}

        {/* Onboarding info card */}
        <div className="mt-1 p-2.5 px-3 rounded-xl bg-[var(--accent-subtle)] border border-[var(--accent-ring)] flex items-start gap-2.5 text-xs text-[var(--accent-text)]">
          <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent-text)]" />
          <p className="flex-1 min-w-0 text-xs text-[var(--accent-text)] leading-relaxed">
            <span className="font-semibold">Non hai una chiave?</span>{' '}
            <span>È gratuita al 100%:{' '}</span>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => {
                e.preventDefault();
                window.pywebview?.api?.open_url?.('https://aistudio.google.com/apikey');
              }}
              className="font-bold underline hover:opacity-80 inline-flex items-center gap-1 ml-0.5 cursor-pointer"
            >
              <span>Ottieni gratis su aistudio.google.com</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
          </p>
        </div>
      </div>

      {/* Fallback API Keys - Collapsible disclosure toggle, collapsed by default */}
      <details className="group/fallback pt-0.5 text-sm">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors min-h-[28px] py-1 select-none">
          <span className="font-semibold flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <ChevronRight className="w-4 h-4 transition-transform duration-200 group-open/fallback:rotate-90 text-[var(--text-secondary)]" />
            <span>Opzioni avanzate: Chiavi di riserva (Fallback)</span>
            {cleanedFallbackKeys.length > 0 && (
              <span className="ml-1.5 px-1.5 h-5 inline-flex items-center justify-center rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[11px] font-mono font-bold text-[var(--text-secondary)] leading-none">
                {cleanedFallbackKeys.length}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={e => {
              e.preventDefault();
              setShowFallbackKeys(prev => !prev);
            }}
            className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            title={showFallbackKeys ? 'Nascondi chiavi' : 'Mostra chiavi'}
            aria-label={showFallbackKeys ? 'Nascondi chiavi' : 'Mostra chiavi'}
          >
            {showFallbackKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </summary>
        <div className="mt-2 pl-5 space-y-3">
          {/* Add Key Box */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <input
                type={showFallbackKeys ? 'text' : 'password'}
                value={newKeyInput}
                onChange={e => {
                  setNewKeyInput(e.target.value);
                  if (fallbackNotice) setFallbackNotice(null);
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Aggiungi chiave di riserva (AIzaSy...)"
                aria-label="Nuova chiave di riserva"
                className={`w-full app-input !py-1.5 !px-3 text-xs font-mono border border-[var(--border-strong)] rounded-lg min-h-[36px] ${
                  fallbackNotice?.type === 'error' ? 'border-[var(--error-ring)]' : ''
                }`}
              />
            </div>
            <button
              type="button"
              onClick={handleAddFallbackKey}
              disabled={!newKeyInput.trim()}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 cursor-pointer min-h-[36px]"
              aria-label="Aggiungi chiave di riserva"
            >
              <Plus className="w-3.5 h-3.5 text-[var(--accent-text)]" />
              <span>Aggiungi</span>
            </button>
          </div>

          {/* Validation Notice / Error */}
          {fallbackNotice && (
            <div
              className={`alert-card ${
                fallbackNotice.type === 'warning' ? 'is-warning' : 'is-error'
              } text-xs flex-row items-center gap-2 py-2 px-3 animate-fade-in`}
            >
              {fallbackNotice.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span className="font-medium leading-snug">{fallbackNotice.message}</span>
            </div>
          )}

          {/* Masked Key Chips (Option A) */}
          {cleanedFallbackKeys.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {cleanedFallbackKeys.map((key, idx) => {
                const masked = key.length > 8 ? `...${key.slice(-4)}` : key;
                return (
                  <div
                    key={`${key}-${idx}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--border-strong)] text-xs font-mono text-[var(--text-primary)] transition-colors group/chip"
                  >
                    <Key className="w-3 h-3 text-[var(--accent-text)] shrink-0" />
                    <span
                      className="select-all"
                      title={showFallbackKeys ? key : `Termina con ${key.slice(-4)}`}
                    >
                      {showFallbackKeys ? key : masked}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFallbackKey(idx)}
                      className="p-0.5 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--error-text)] transition-colors cursor-pointer"
                      title="Rimuovi chiave di riserva"
                      aria-label={`Rimuovi chiave che termina con ${key.slice(-4)}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-secondary)] italic">
              Nessuna chiave di riserva aggiunta.
            </p>
          )}

          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Usate automaticamente se la chiave principale esaurisce la quota giornaliera.
          </p>
        </div>
      </details>
    </div>
  );
});

ApiKeySection.displayName = 'ApiKeySection';
