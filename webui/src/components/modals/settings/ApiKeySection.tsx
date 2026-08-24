import React, { useState } from 'react';
import { Eye, EyeOff, Key, ShieldCheck, AlertCircle, AlertTriangle, Bell } from 'lucide-react';
import { GEMINI_KEY_PATTERN } from '../../../utils';
import { STORAGE_KEYS } from '../../../storageKeys';

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
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED) !== 'false');

  const isInvalidFormat = apiKey.trim() !== '' && !GEMINI_KEY_PATTERN.test(apiKey.trim());

  return (
    <div className="space-y-6">
      {/* Primary API Key */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Key className="w-4 h-4 text-[var(--accent-text)]" />
            Google Gemini API Key (Principale)
          </label>
          <button
            type="button"
            onClick={() => setShowPrimaryKey(prev => !prev)}
            className="p-1.5 rounded-lg hover:bg-[var(--sidebar-active-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
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
            className={`w-full app-input pr-10 text-sm font-mono ${
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
          <div className="p-3 rounded-lg bg-[var(--warning-subtle)] border border-[var(--warning-ring)] text-xs text-[var(--warning-text)] space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Memorizzazione in chiaro
            </div>
            <p className="text-[var(--text-muted)]">
              {apiKeyInsecureReason || 'Impossibile cifrare l\'API key sul sistema corrente. Verrà salvata in modo sicuro ma non cifrato.'}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1 mt-1 text-xs text-[var(--text-muted)]">
          <a
            href="#"
            onClick={e => {
              e.preventDefault();
              const win = window as unknown as { pywebview?: { api?: { open_url?: (url: string) => void } } };
              win.pywebview?.api?.open_url?.('https://aistudio.google.com/apikey');
            }}
            className="inline-flex items-center gap-1 hover:opacity-100 opacity-70 w-fit text-[var(--accent-text)]"
          >
            → Ottieni gratis su aistudio.google.com
          </a>
        </div>
      </div>

      {/* Fallback API Keys */}
      <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <label className="text-sm font-bold text-[var(--text-primary)] block">
            API Keys di Riserva (Fallback)
          </label>
          <button
            type="button"
            onClick={() => setShowFallbackKeys(prev => !prev)}
            className="p-1.5 rounded-lg hover:bg-[var(--sidebar-active-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={showFallbackKeys ? 'Nascondi chiavi' : 'Mostra chiavi'}
          >
            {showFallbackKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <textarea
          value={fallbackKeys.join('\n')}
          onChange={e => setFallbackKeys(e.target.value.split('\n'))}
          placeholder="Inserisci una API Key per riga..."
          rows={3}
          className={`app-textarea font-mono text-sm w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-ring)] resize-none ${!showFallbackKeys ? 'obscured-text' : ''}`}
          style={{ padding: '0.5rem 0.75rem', minHeight: '80px' }}
        />
        <p className="text-xs text-[var(--text-muted)]">
          Usate automaticamente in caso di esaurimento quota (errore 429).
        </p>
      </div>

      {/* System Notifications */}
      <div className="border-t border-[var(--border-subtle)] pt-4">
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="flex items-start gap-3">
            <Bell className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                Notifiche di sistema
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Ricevi un avviso di Windows al completamento dell&apos;elaborazione di ciascuna sbobina.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notificationsEnabled}
            onClick={() => {
              const next = !notificationsEnabled;
              setNotificationsEnabled(next);
              localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED, String(next));
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
              notificationsEnabled ? 'bg-[var(--accent-bg)]' : 'bg-[var(--bg-input)]'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
});

ApiKeySection.displayName = 'ApiKeySection';
