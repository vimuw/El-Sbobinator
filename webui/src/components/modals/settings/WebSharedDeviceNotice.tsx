import React, { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { InlineConfirm } from './SettingsLayout';

// Distinct from the per-key "Rimuovi chiave" in each row's menu: this one empties the browser.
const removeAllKeysLabel = (keyCount: number) => (keyCount > 1 ? 'Rimuovi tutte le chiavi' : 'Rimuovi la chiave');

interface WebSharedDeviceNoticeProps {
  keyCount: number;
  onRemoveKeys: () => void;
  disabled?: boolean;
}

// Web build only: the keys live in this browser's localStorage, so on a shared device they are
// removed in one go when the user is done. The button sits beside the explanation, not in the header.
// Removing is immediate (not on "Salva"), so it asks first, like the other deletions in the settings;
// the question and its button say it all, so the confirmation has no text underneath.
export const WebSharedDeviceNotice: React.FC<WebSharedDeviceNoticeProps> = ({ keyCount, onRemoveKeys, disabled = false }) => {
  const [confirming, setConfirming] = useState(false);
  const label = removeAllKeysLabel(keyCount);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--border-subtle)] p-3 text-xs text-[var(--text-secondary)]" data-testid="shared-device-warning">
        <div className="flex items-start gap-2 flex-1 min-w-[220px]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--warning-text)]" aria-hidden="true" />
          <p>
            Le chiavi restano solo in questo browser e vengono inviate solo a Google. Se il dispositivo è condiviso,
            rimuovile quando hai finito.
          </p>
        </div>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={disabled || keyCount === 0}
            className="app-button-secondary is-settings-action is-icon is-danger shrink-0"
            aria-label={label}
            title={label}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {confirming && keyCount > 0 && (
        <InlineConfirm
          tone="danger"
          label={label}
          title={keyCount > 1 ? 'Rimuovere tutte le chiavi da questo browser?' : 'Rimuovere la chiave da questo browser?'}
          actions={(
            <>
              <button type="button" onClick={() => setConfirming(false)} disabled={disabled} className="app-button-secondary is-settings-action">Annulla</button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onRemoveKeys();
                }}
                disabled={disabled}
                className="app-button-secondary is-settings-action is-danger"
              >
                Rimuovi
              </button>
            </>
          )}
        />
      )}
    </div>
  );
};
