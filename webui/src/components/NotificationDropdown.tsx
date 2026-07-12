import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, BellOff, CheckCheck, CheckCircle2, Info, Loader2, X } from 'lucide-react';

export interface NotificationAction {
  label: string;
  type: 'retry_failed_revision_blocks' | 'install_update' | 'open_github';
  data?: unknown;
  loadingLabel?: string;
  errorSuffix?: string;
}

export interface NotificationMessage {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  category: 'processing' | 'update' | 'system';
  timestamp: number;
  read: boolean;
  persistent?: boolean;
  dedupeKey?: string;
  action?: NotificationAction & {
    onAction: () => Promise<void>;
  };
  onDismiss?: () => void;
}

interface NotificationDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationMessage[];
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  align?: 'left' | 'right';
  leftOffset?: number;
  valign?: 'top' | 'bottom';
  bottomOffset?: number;
}

interface NotificationItemProps {
  notification: NotificationMessage;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'Adesso';
  if (diffMins < 60) return `${diffMins} min fa`;
  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function NotificationItem({ notification, onMarkAsRead, onDelete }: NotificationItemProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleAction = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLoading || !notification.action) return;
    setIsLoading(true);
    setErrorText(null);
    try {
      await notification.action.onAction();
      notification.onDismiss?.();
      onDelete(notification.id);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
      setIsLoading(false);
    }
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--success-text)' }} />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--warning-text)' }} />;
      case 'error':
        return <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--error-text, #ef4444)' }} />;
      default:
        return <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />;
    }
  };

  return (
    <div
      onClick={() => !notification.read && onMarkAsRead(notification.id)}
      className="group relative flex flex-col gap-1 p-3.5 rounded-xl transition-all duration-150 border cursor-pointer"
      style={{
        background: !notification.read
          ? 'var(--bg-elevated)'
          : 'transparent',
        borderColor: !notification.read
          ? 'var(--border-strong)'
          : 'var(--border-subtle)',
      }}
    >
      {/* Unread indicator circle (fades out on hover) */}
      {!notification.read && (
        <span
          className="absolute top-[18px] right-[18px] w-2 h-2 rounded-full transition-opacity duration-150 group-hover:opacity-0 group-hover:animate-none animate-pulse"
          style={{ background: 'var(--accent-text, #3d6b3a)' }}
        />
      )}

      {/* Delete/Dismiss button (fades in on hover in the exact same spot) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          notification.onDismiss?.();
          onDelete(notification.id);
        }}
        disabled={isLoading}
        className="absolute top-2.5 right-2.5 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-neutral-800/10 dark:hover:bg-neutral-200/10 transition-all duration-150"
        aria-label="Chiudi notifica"
        style={{ cursor: isLoading ? 'default' : 'pointer', color: 'var(--text-muted)' }}
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-start gap-2.5">
        {getIcon()}
        <div className="flex flex-1 flex-col gap-0.5 pr-6">
          <span className="text-[9px] font-bold uppercase tracking-wider opacity-60" style={{ color: 'var(--text-muted)' }}>
            {notification.category === 'processing'
              ? 'Elaborazione'
              : notification.category === 'update'
              ? 'Aggiornamento'
              : 'Sistema'}
          </span>
          <h4 className="text-xs font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
            {notification.title}
          </h4>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {notification.message}
          </p>

          {notification.action && (
            <button
              onClick={handleAction}
              disabled={isLoading}
              className="self-start mt-2 text-xs font-medium flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-150"
              style={{
                background: 'var(--accent-subtle, rgba(61, 107, 58, 0.08))',
                borderColor: 'var(--accent-ring, rgba(61, 107, 58, 0.18))',
                color: 'var(--accent-text, #3d6b3a)',
                cursor: isLoading ? 'default' : 'pointer',
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3 animate-spin" />
                  {notification.action.loadingLabel ?? 'Caricamento…'}
                </>
              ) : (
                notification.action.label
              )}
            </button>
          )}

          {errorText && (
            <div className="flex items-center gap-1 text-[10px] mt-1" style={{ color: 'var(--error-text, #b91c1c)' }}>
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>
                {errorText}
                {notification.action?.errorSuffix ? ` — ${notification.action.errorSuffix}` : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      <span className="text-[9px] self-end opacity-50" style={{ color: 'var(--text-muted)' }}>
        {formatTime(notification.timestamp)}
      </span>
    </div>
  );
}

export function NotificationDropdown({
  isOpen,
  onClose,
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
  onClearAll: _,
  align = 'right',
  leftOffset = 224,
  valign = 'top',
  bottomOffset = 48,
}: NotificationDropdownProps) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      {/* Invisible Backdrop to close on click outside */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          zIndex: 40,
          display: isOpen ? 'block' : 'none',
        }}
      />

      {/* Dropdown Container */}
      <div
        className="fixed z-50 w-96 max-h-[480px] rounded-2xl border flex flex-col overflow-hidden shadow-strong backdrop-blur-md"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border-subtle)',
          top: valign === 'top' ? '72px' : 'auto',
          bottom: valign === 'bottom' ? `${bottomOffset}px` : 'auto',
          right: align === 'right' ? '24px' : 'auto',
          left: align === 'left' ? `${leftOffset}px` : 'auto',
          pointerEvents: isOpen ? 'auto' : 'none',
          opacity: isOpen ? 1 : 0,
          transform: isOpen
            ? 'scale(1) translateY(0)'
            : `scale(0.96) translateY(${valign === 'bottom' ? '10px' : '-10px'})`,
          transition: 'opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          transformOrigin: align === 'right'
            ? (valign === 'bottom' ? 'bottom right' : 'top right')
            : (valign === 'bottom' ? 'bottom left' : 'top left'),
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4.5 py-3.5 border-b"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              Notifiche
            </h3>
            {unreadCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                style={{
                  background: 'var(--accent-subtle)',
                  color: 'var(--accent-text)',
                }}
              >
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllAsRead}
                className="flex items-center gap-1.5 transition-all duration-150 hover:opacity-80"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 6px',
                  borderRadius: '6px',
                  color: 'var(--accent-text, #3d6b3a)',
                  fontSize: '11px',
                  fontWeight: 500,
                }}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Segna come già lette
              </button>
            )}
          </div>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 scrollbar-thin">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center h-full">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(0, 0, 0, 0.02)', border: '1px dashed var(--border-subtle)' }}
              >
                <BellOff className="w-4 h-4 opacity-40" style={{ color: 'var(--text-muted)' }} />
              </div>
              <h4 className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                Nessuna notifica
              </h4>
              <p className="text-[11px] max-w-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Qui troverai le notifiche relative ad aggiornamenti, completamenti ed errori di elaborazione.
              </p>
            </div>
          ) : (
            [...notifications]
              .sort((a, b) => b.timestamp - a.timestamp)
              .map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkAsRead={onMarkAsRead}
                  onDelete={onDelete}
                />
              ))
          )}
        </div>
      </div>
    </>
  );
}
