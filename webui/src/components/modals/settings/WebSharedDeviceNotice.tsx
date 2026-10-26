import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

// Distinct from the per-key "Rimuovi chiave" in each row's menu: this one empties the browser.
const removeAllKeysLabel = (keyCount: number) => (keyCount > 1 ? 'Rimuovi tutte le chiavi' : 'Rimuovi la chiave');

interface WebRemoveKeysButtonProps {
  keyCount: number;
  onRemoveKeys: () => void;
  disabled?: boolean;
}

// Web build only, beside "Verifica connessione": the keys live in this browser's localStorage,
// so on a shared device they are removed in one go when the user is done.
export const WebRemoveKeysButton: React.FC<WebRemoveKeysButtonProps> = ({ keyCount, onRemoveKeys, disabled = false }) => (
  <button
    type="button"
    onClick={onRemoveKeys}
    disabled={disabled || keyCount === 0}
    className="app-button-secondary is-settings-action"
  >
    <Trash2 className="w-4 h-4" />
    <span>{removeAllKeysLabel(keyCount)}</span>
  </button>
);

export const WebSharedDeviceNotice: React.FC<{ keyCount: number }> = ({ keyCount }) => (
  <div className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] p-3 text-xs text-[var(--text-secondary)]" data-testid="shared-device-warning">
    <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--warning-text)]" aria-hidden="true" />
    <p>
      Le chiavi restano solo in questo browser e vengono inviate solo a Google. Se il dispositivo è condiviso,
      premi <strong>{removeAllKeysLabel(keyCount)}</strong> in alto quando hai finito.
    </p>
  </div>
);
