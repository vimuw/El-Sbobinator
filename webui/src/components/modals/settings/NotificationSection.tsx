import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import { STORAGE_KEYS } from '../../../storageKeys';

export const NotificationSection: React.FC = React.memo(() => {
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED) !== 'false',
  );

  const handleToggle = () => {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED, String(next));
  };

  return (
    <div className="p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Bell className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
            Notifiche di sistema
          </h3>

          <button
            type="button"
            role="switch"
            aria-checked={notificationsEnabled}
            onClick={handleToggle}
            aria-label="Attiva o disattiva notifiche di sistema"
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] ${
              notificationsEnabled ? 'bg-[var(--accent-bg)]' : 'bg-[var(--bg-input)] ring-1 ring-[var(--border-default)]'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          Ricevi una notifica di sistema al completamento dell&apos;elaborazione di ciascuna sbobina.
        </p>
      </div>
    </div>
  );
});

NotificationSection.displayName = 'NotificationSection';
