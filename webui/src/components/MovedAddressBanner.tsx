import { useState } from 'react';
import { X } from 'lucide-react';
import { CANONICAL_WEB_HOST, CANONICAL_WEB_URL } from '../movedAddress';

/**
 * Web build on an old address that still holds sbobine: they cannot move by themselves, so the
 * page asks for a backup to import on the official address. Hiding it lasts until the next load.
 */
export function MovedAddressBanner({ onOpenBackup }: { onOpenBackup: () => void }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <section
      role="region"
      aria-labelledby="moved-address-title"
      data-testid="moved-address-banner"
      className="relative mx-4 mt-3 rounded-xl border border-[var(--warning-ring)] bg-[var(--warning-subtle)] px-4 py-3 pr-11 text-sm text-[var(--text-primary)]"
    >
      <h2 id="moved-address-title" className="font-semibold text-[var(--warning-text)]">
        El Sbobinator ora è su {CANONICAL_WEB_HOST}
      </h2>
      <p className="mt-1 leading-relaxed">
        Le tue sbobine sono in questo indirizzo: fai il backup (Impostazioni → Archiviazione) e importalo su {CANONICAL_WEB_HOST}.
        Le chiavi Gemini non sono nel backup: dovrai inserirle di nuovo.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="app-button-secondary is-settings-action" onClick={onOpenBackup}>
          Apri il backup
        </button>
        <a href={CANONICAL_WEB_URL} target="_blank" rel="noopener noreferrer" className="footer-link">
          Vai a {CANONICAL_WEB_HOST}
        </a>
      </div>
      <button
        type="button"
        aria-label="Nascondi fino alla prossima apertura"
        title="Nascondi fino alla prossima apertura"
        className="icon-button compact-icon-button absolute right-2 top-2"
        onClick={() => setHidden(true)}
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </section>
  );
}
