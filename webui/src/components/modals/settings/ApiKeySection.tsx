import React, { useState } from 'react';
import { Eye, EyeOff, Key, ShieldCheck, AlertCircle, AlertTriangle } from 'lucide-react';
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

  const isInvalidFormat = apiKey.trim() !== '' && !GEMINI_KEY_PATTERN.test(apiKey.trim());

  return (
    <div className="p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-4">
      {/* Header */}
      <div className="space-y-1.5">
        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Key className="w-4 h-4 text-[var(--accent-text)]" />
          Chiavi API Google Gemini
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          Configura la chiave API principale e le chiavi di riserva per l&apos;elaborazione delle sbobinature.
        </p>
      </div>

      {/* Primary API Key */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-[var(--text-primary)] block">
            Google Gemini API Key (Principale)
          </label>
          <button
            type="button"
            onClick={() => setShowPrimaryKey(prev => !prev)}
            className="p-1 rounded-lg hover:bg-[var(--sidebar-active-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={showPrimaryKey ? 'Nascondi chiave' : 'Mostra chiave'}
          >
            {showPrimaryKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="relative">
          <input
            type={showPrimaryKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="AIzaSy... oppure AQ..."
            className={`w-full app-input pr-10 text-xs font-mono ${
              isInvalidFormat ? 'border-[var(--error-ring)]' : ''
            }`}
          />
        </div>

        {hasProtectedKey && (
          <p className="text-xs flex items-center gap-1 text-[var(--success-text)] font-normal">
            <ShieldCheck className="w-3.5 h-3.5" />
            Protetto da Windows DPAPI / Keychain
          </p>
        )}

        {isInvalidFormat && (
          <p className="text-xs text-[var(--error-text)] flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Formato API key non valido (deve iniziare con &quot;AIzaSy&quot;)
          </p>
        )}

        {apiKeyInsecure && (
          <div className="alert-card is-warning text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Memorizzazione in chiaro
            </div>
            <p className="text-[var(--text-muted)]">
              {apiKeyInsecureReason || 'Impossibile cifrare l\'API key sul sistema corrente. Verrà salvata in modo sicuro ma non cifrato.'}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          <a
            href="#"
            onClick={e => {
              e.preventDefault();
              const win = window as unknown as { pywebview?: { api?: { open_url?: (url: string) => void } } };
              win.pywebview?.api?.open_url?.('https://aistudio.google.com/apikey');
            }}
            className="inline-flex items-center gap-1 hover:opacity-100 opacity-75 w-fit text-[var(--accent-text)] font-medium transition-opacity"
          >
            → Ottieni gratis su aistudio.google.com
          </a>
        </div>
      </div>

      {/* Fallback API Keys */}
      <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-[var(--text-primary)] block">
            API Keys di Riserva (Fallback)
          </label>
          <button
            type="button"
            onClick={() => setShowFallbackKeys(prev => !prev)}
            className="p-1 rounded-lg hover:bg-[var(--sidebar-active-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={showFallbackKeys ? 'Nascondi chiavi' : 'Mostra chiavi'}
          >
            {showFallbackKeys ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <textarea
          value={fallbackKeys.join('\n')}
          onChange={e => setFallbackKeys(e.target.value.split('\n'))}
          placeholder="Inserisci una API Key per riga..."
          rows={3}
          className={`app-textarea font-mono text-xs w-full px-3 py-2 min-h-[80px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-ring)] resize-none ${!showFallbackKeys ? 'obscured-text' : ''}`}
        />
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Le chiavi di riserva vengono usate automaticamente in caso di errori temporanei o esaurimento della quota sulla chiave principale.
        </p>
      </div>
    </div>
  );
});

ApiKeySection.displayName = 'ApiKeySection';
