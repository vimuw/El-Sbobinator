import React, { useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Trash2 } from 'lucide-react';
import { GEMINI_KEY_PATTERN } from '../../../utils';
import { parseKeyLines } from '../../../web/webSettings';
import { SettingsSectionHeading } from './SettingsLayout';

interface WebKeysSectionProps {
  apiKey: string;
  fallbackKeys: string[];
  setApiKey: (key: string) => void;
  setFallbackKeys: (keys: string[]) => void;
  onRemoveKeys: () => void;
  disabled?: boolean;
}

// Web build only: keys live in this browser's localStorage, one per line; the first is the main key
// and the others are tried in order when it runs out of quota.
export const WebKeysSection: React.FC<WebKeysSectionProps> = ({
  apiKey,
  fallbackKeys,
  setApiKey,
  setFallbackKeys,
  onRemoveKeys,
  disabled = false,
}) => {
  const currentKeys = [apiKey, ...fallbackKeys].map(key => key.trim()).filter(Boolean);
  const currentText = currentKeys.join('\n');
  const [text, setText] = useState(currentText);
  const [showKeys, setShowKeys] = useState(false);

  // Follow changes made outside the field (removal, closing without saving).
  useEffect(() => {
    setText(current => (parseKeyLines(current).join('\n') === currentText ? current : currentText));
  }, [currentText]);

  const keys = parseKeyLines(text);
  const invalidCount = keys.filter(key => !GEMINI_KEY_PATTERN.test(key)).length;

  return (
    <section aria-labelledby="web-keys-heading" className="space-y-3">
      <SettingsSectionHeading id="web-keys-heading">Chiavi API Gemini</SettingsSectionHeading>
      <p className="text-xs text-[var(--text-secondary)]">
        Una chiave per riga. La prima è quella principale; le altre vengono usate quando finisce la quota giornaliera.
      </p>
      <div className="relative">
        <textarea
          id="web-gemini-keys"
          aria-label="Chiavi API Gemini, una per riga"
          value={text}
          disabled={disabled}
          rows={Math.min(6, Math.max(3, keys.length + 1))}
          onChange={event => {
            setText(event.target.value);
            const parsed = parseKeyLines(event.target.value);
            setApiKey(parsed[0] ?? '');
            setFallbackKeys(parsed.slice(1));
          }}
          placeholder={'AIzaSy...\nAIzaSy... (facoltativa)'}
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          className={`app-input is-settings-input w-full resize-y pr-10 font-mono text-xs ${showKeys ? '' : 'obscured-text'}`}
        />
        <button
          type="button"
          onClick={() => setShowKeys(value => !value)}
          className="absolute top-2.5 right-3 flex items-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          aria-label={showKeys ? 'Nascondi chiavi' : 'Mostra chiavi'}
        >
          {showKeys ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      {invalidCount > 0 && (
        <p role="status" className="text-xs text-[var(--warning-text)]">
          {invalidCount === 1 ? 'Una riga non sembra una chiave valida' : `${invalidCount} righe non sembrano chiavi valide`}: le chiavi iniziano con AIzaSy... o AQ.
        </p>
      )}
      <div className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] p-3 text-xs text-[var(--text-secondary)]" data-testid="shared-device-warning">
        <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--warning-text)]" aria-hidden="true" />
        <p>
          Le chiavi restano solo in questo browser e vengono inviate solo a Google. Se il dispositivo è condiviso,
          premi <strong>Rimuovi {currentKeys.length > 1 ? 'chiavi' : 'chiave'}</strong> quando hai finito.
        </p>
      </div>
      <button
        type="button"
        onClick={onRemoveKeys}
        disabled={disabled || currentKeys.length === 0}
        className="app-button-secondary is-settings-action"
      >
        <Trash2 className="w-4 h-4" />
        <span>{currentKeys.length > 1 ? 'Rimuovi chiavi' : 'Rimuovi chiave'}</span>
      </button>
    </section>
  );
};
