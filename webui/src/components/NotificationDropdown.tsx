import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BellOff,
  Check,
  CheckCheck,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { formatRelativeTime } from '../utils';

export interface NotificationAction {
  label: string;
  type: 'retry_failed_revision_blocks' | 'install_update' | 'open_github' | 'open_settings';
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
  onClearAll?: () => void;
  onNotificationClick?: (notification: NotificationMessage) => void;
  align?: 'left' | 'right';
  leftOffset?: number;
  valign?: 'top' | 'bottom';
  bottomOffset?: number;
}

interface NotificationItemProps {
  notification: NotificationMessage;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  onNotificationClick?: (notification: NotificationMessage) => void;
}

function getCategoryLabel(category: NotificationMessage['category']) {
  switch (category) {
    case 'processing':
      return 'Elaborazione';
    case 'update':
      return 'Aggiornamento';
    case 'system':
    default:
      return 'Sistema';
  }
}

function getItemBackground(
  type: NotificationMessage['type'],
  category: NotificationMessage['category']
) {
  if (category === 'update' || type === 'info') {
    return 'linear-gradient(135deg, rgba(59, 130, 246, 0.13) 0%, rgba(59, 130, 246, 0.035) 100%)';
  }

  switch (type) {
    case 'success':
      return 'linear-gradient(135deg, rgba(34, 197, 94, 0.13) 0%, rgba(34, 197, 94, 0.035) 100%)';
    case 'warning':
      return 'linear-gradient(135deg, rgba(245, 158, 11, 0.14) 0%, rgba(245, 158, 11, 0.035) 100%)';
    case 'error':
      return 'linear-gradient(135deg, rgba(239, 68, 68, 0.14) 0%, rgba(239, 68, 68, 0.035) 100%)';
    default:
      return 'linear-gradient(135deg, rgba(59, 130, 246, 0.13) 0%, rgba(59, 130, 246, 0.035) 100%)';
  }
}

function getCategoryBadgeStyle(
  category: NotificationMessage['category'],
  type: NotificationMessage['type']
) {
  if (category === 'update' || type === 'info') {
    return {
      background: 'rgba(59, 130, 246, 0.12)',
      color: '#2563eb',
    };
  }
  switch (type) {
    case 'success':
      return {
        background: 'var(--success-subtle)',
        color: 'var(--success-text)',
      };
    case 'warning':
      return {
        background: 'var(--warning-subtle)',
        color: 'var(--warning-text)',
      };
    case 'error':
      return {
        background: 'var(--error-subtle)',
        color: 'var(--error-text)',
      };
    default:
      return {
        background: 'var(--border-subtle)',
        color: 'var(--text-muted)',
      };
  }
}

function getActionColor(
  category: NotificationMessage['category'],
  type: NotificationMessage['type']
) {
  if (category === 'update' || type === 'info') {
    return '#2563eb';
  }
  switch (type) {
    case 'warning':
      return 'var(--warning-text, #b45309)';
    case 'error':
      return 'var(--error-text, #dc2626)';
    case 'success':
    default:
      return 'var(--accent-text)';
  }
}

function NotificationItem({
  notification,
  onMarkAsRead,
  onDelete,
  onNotificationClick,
}: NotificationItemProps) {
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

  const getIconBadge = () => {
    if (notification.category === 'update' || notification.type === 'info') {
      return (
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: 'rgba(59, 130, 246, 0.12)',
            color: '#2563eb',
          }}
        >
          <Info className="w-4 h-4" />
        </div>
      );
    }

    switch (notification.type) {
      case 'success':
        return (
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: 'var(--success-subtle)',
              color: 'var(--success-text)',
            }}
          >
            <CheckCircle2 className="w-4 h-4" />
          </div>
        );
      case 'warning':
        return (
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: 'var(--warning-subtle)',
              color: 'var(--warning-text)',
            }}
          >
            <AlertTriangle className="w-4 h-4" />
          </div>
        );
      case 'error':
        return (
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: 'var(--error-subtle)',
              color: 'var(--error-text)',
            }}
          >
            <AlertCircle className="w-4 h-4" />
          </div>
        );
      default:
        return (
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: 'rgba(59, 130, 246, 0.12)',
              color: '#2563eb',
            }}
          >
            <Info className="w-4 h-4" />
          </div>
        );
    }
  };

  const actionColor = getActionColor(notification.category, notification.type);

  return (
    <div
      data-notification-id={notification.id}
      onClick={() => {
        if (!notification.read) onMarkAsRead(notification.id);
        onNotificationClick?.(notification);
      }}
      className="group relative flex items-start gap-3 px-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0 cursor-pointer transition-all duration-150 hover:brightness-[0.98] dark:hover:brightness-[1.08]"
      style={{
        background: getItemBackground(notification.type, notification.category),
      }}
    >
      {/* Type icon in soft squircle badge */}
      {getIconBadge()}

      {/* Main content body */}
      <div className="flex flex-1 flex-col gap-1 min-w-0 pr-6">
        {/* Top line: unread dot + title + category */}
        <div className="flex items-center gap-1.5 min-w-0">
          {!notification.read && (
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
              style={{
                background:
                  notification.category === 'update' || notification.type === 'info'
                    ? '#2563eb'
                    : notification.type === 'warning'
                    ? 'var(--warning-text, #b45309)'
                    : notification.type === 'error'
                    ? 'var(--error-text, #dc2626)'
                    : 'var(--accent-text)',
              }}
              title="Non letta"
            />
          )}
          <h4 className="text-xs leading-snug truncate font-semibold text-[var(--text-primary)]">
            {notification.title}
          </h4>
          <span
            className="text-[9px] font-medium px-1.5 py-0.2 rounded shrink-0"
            style={getCategoryBadgeStyle(notification.category, notification.type)}
          >
            {getCategoryLabel(notification.category)}
          </span>
        </div>

        {/* Message body */}
        <p className="text-xs leading-relaxed break-words" style={{ color: 'var(--text-secondary)' }}>
          {notification.message}
        </p>

        {/* Inline error feedback if action failed */}
        {errorText && (
          <div className="flex items-center gap-1 text-[10px] mt-0.5" style={{ color: 'var(--error-text)' }}>
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>
              {errorText}
              {notification.action?.errorSuffix ? ` — ${notification.action.errorSuffix}` : ''}
            </span>
          </div>
        )}

        {/* Bottom line: Action link on Left, Timestamp aligned on Right */}
        <div className="flex items-center justify-between mt-1 text-[11px] gap-2">
          {notification.action ? (
            <button
              type="button"
              onClick={handleAction}
              disabled={isLoading}
              className="text-[11px] font-medium inline-flex items-center gap-1 hover:underline transition-all"
              style={{
                color: actionColor,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: isLoading ? 'default' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>{notification.action.loadingLabel ?? 'Caricamento…'}</span>
                </>
              ) : (
                <>
                  <span>{notification.action.label}</span>
                  <ArrowRight className="w-2.5 h-2.5 opacity-70" />
                </>
              )}
            </button>
          ) : (
            <div />
          )}

          {/* Timestamp aligned on the right */}
          <span className="text-[11px] shrink-0 ml-auto" style={{ color: 'var(--text-faint)' }}>
            {formatRelativeTime(notification.timestamp)}
          </span>
        </div>
      </div>

      {/* Quick Dismiss / Archive Button (hover) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          notification.onDismiss?.();
          onDelete(notification.id);
        }}
        disabled={isLoading}
        className="absolute top-3 right-3 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-neutral-500/15 transition-all text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        title="Archivia"
        aria-label="Archivia notifica"
        style={{ cursor: isLoading ? 'default' : 'pointer' }}
      >
        <Check className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface CaretStyle {
  fill: string;
  stroke: string;
}

function getCaretStyle(
  type?: NotificationMessage['type'],
  category?: NotificationMessage['category']
): CaretStyle {
  if (category === 'update' || type === 'info') {
    return {
      fill: 'url(#caret-grad-info)',
      stroke: 'color-mix(in srgb, #3b82f6 13%, var(--bg-elevated, #ffffff))',
    };
  }
  switch (type) {
    case 'success':
      return {
        fill: 'url(#caret-grad-success)',
        stroke: 'color-mix(in srgb, #22c55e 13%, var(--bg-elevated, #ffffff))',
      };
    case 'warning':
      return {
        fill: 'url(#caret-grad-warning)',
        stroke: 'color-mix(in srgb, #f59e0b 14%, var(--bg-elevated, #ffffff))',
      };
    case 'error':
      return {
        fill: 'url(#caret-grad-error)',
        stroke: 'color-mix(in srgb, #ef4444 14%, var(--bg-elevated, #ffffff))',
      };
    default:
      return {
        fill: 'var(--bg-elevated, #ffffff)',
        stroke: 'var(--bg-elevated, #ffffff)',
      };
  }
}

export function NotificationDropdown({
  isOpen,
  onClose,
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
  onClearAll,
  onNotificationClick,
  align = 'right',
  leftOffset = 72,
  valign = 'top',
  bottomOffset = 16,
}: NotificationDropdownProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  const [caretNotification, setCaretNotification] = useState<NotificationMessage | null>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredNotifications = [...notifications]
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((n) => {
      if (activeTab === 'unread') return !n.read;
      return true;
    });

  const dynamicHeightStyle =
    valign === 'bottom'
      ? `clamp(320px, 52vh, min(480px, calc(100vh - ${bottomOffset + 16}px)))`
      : 'clamp(320px, 52vh, min(480px, calc(100vh - 88px)))';

  const updateCaretNotification = useCallback(() => {
    if (!isOpen || align !== 'left' || valign !== 'bottom') {
      setCaretNotification(null);
      return;
    }

    const caretEl = caretRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!caretEl || !scrollEl) {
      setCaretNotification(null);
      return;
    }

    const caretRect = caretEl.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();

    // Guard against unmounted/0-size elements in headless/test environments
    if (caretRect.height === 0 || scrollRect.height === 0) {
      setCaretNotification(null);
      return;
    }

    const caretCenterY = caretRect.top + caretRect.height / 2;

    // If caret vertical position is outside the scroll container viewport
    if (caretCenterY < scrollRect.top || caretCenterY > scrollRect.bottom) {
      setCaretNotification(null);
      return;
    }

    const itemEls = scrollEl.querySelectorAll<HTMLElement>('[data-notification-id]');
    let found: NotificationMessage | null = null;
    for (let i = 0; i < itemEls.length; i++) {
      const itemEl = itemEls[i];
      const rect = itemEl.getBoundingClientRect();
      // Check if caret center Y falls within this notification item's visible bounds
      if (caretCenterY >= rect.top && caretCenterY <= rect.bottom) {
        const notifId = itemEl.getAttribute('data-notification-id');
        found = filteredNotifications.find((n) => n.id === notifId) ?? null;
        break;
      }
    }

    setCaretNotification(found);
  }, [isOpen, align, valign, filteredNotifications]);

  useEffect(() => {
    if (!isOpen) {
      setCaretNotification(null);
      return;
    }
    updateCaretNotification();
    const frame = requestAnimationFrame(updateCaretNotification);
    window.addEventListener('resize', updateCaretNotification);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateCaretNotification);
    };
  }, [isOpen, activeTab, filteredNotifications, updateCaretNotification]);

  const caretStyle = getCaretStyle(caretNotification?.type, caretNotification?.category);

  return (
    <>
      {/* Backdrop to close on click outside */}
      <motion.div
        key="notification-backdrop"
        initial={false}
        animate={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        transition={{ duration: 0.12 }}
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: 'transparent' }}
      />

      {/* Popover Dropdown Container with sleek, subtle ease-out animation */}
      <motion.div
        key="notification-popover"
        role="dialog"
        aria-label="Notifiche"
        initial={false}
        animate={{
          opacity: isOpen ? 1 : 0,
          scale: isOpen ? 1 : 0.98,
          y: isOpen ? 0 : (valign === 'bottom' ? 4 : -4),
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        transition={{
          duration: isOpen ? 0.14 : 0.1,
          ease: isOpen ? [0.16, 1, 0.3, 1] : 'easeIn',
        }}
        className={`fixed z-50 flex flex-col origin-bottom-left ${
          isOpen ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{
          transformOrigin: `${valign === 'bottom' ? 'bottom' : 'top'} ${align === 'left' ? 'left' : 'right'}`,
          width: 380,
          height: dynamicHeightStyle,
          maxHeight: `calc(100vh - ${valign === 'bottom' ? bottomOffset + 16 : 88}px)`,
          top: valign === 'bottom' ? undefined : 64,
          bottom: valign === 'bottom' ? bottomOffset : undefined,
          left: align === 'left' ? leftOffset : undefined,
          right: align === 'right' ? 72 : undefined,
        }}
      >
        {/* Left pointer triangle pointing towards the sidebar trigger */}
        {align === 'left' && valign === 'bottom' && (
          <div
            ref={caretRef}
            className="absolute -left-[8px] pointer-events-none z-30 flex items-center"
            style={{ bottom: 48 }}
          >
            <svg
              width="9"
              height="18"
              viewBox="0 0 9 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="caret-grad-info" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="color-mix(in srgb, #3b82f6 13%, var(--bg-elevated, #ffffff))" />
                  <stop offset="100%" stopColor="color-mix(in srgb, #3b82f6 10%, var(--bg-elevated, #ffffff))" />
                </linearGradient>
                <linearGradient id="caret-grad-success" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="color-mix(in srgb, #22c55e 13%, var(--bg-elevated, #ffffff))" />
                  <stop offset="100%" stopColor="color-mix(in srgb, #22c55e 10%, var(--bg-elevated, #ffffff))" />
                </linearGradient>
                <linearGradient id="caret-grad-warning" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="color-mix(in srgb, #f59e0b 14%, var(--bg-elevated, #ffffff))" />
                  <stop offset="100%" stopColor="color-mix(in srgb, #f59e0b 10%, var(--bg-elevated, #ffffff))" />
                </linearGradient>
                <linearGradient id="caret-grad-error" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="color-mix(in srgb, #ef4444 14%, var(--bg-elevated, #ffffff))" />
                  <stop offset="100%" stopColor="color-mix(in srgb, #ef4444 10%, var(--bg-elevated, #ffffff))" />
                </linearGradient>
              </defs>
              <polygon
                points="8.5,0.5 0.5,9 8.5,17.5"
                fill={caretStyle.fill}
              />
              <path
                d="M 8.5 0.5 L 0.5 9 L 8.5 17.5"
                stroke="var(--card-queued-border, var(--border-default))"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <line
                x1="8.5"
                y1="1"
                x2="8.5"
                y2="17"
                stroke={caretStyle.stroke}
                strokeWidth="2"
              />
            </svg>
          </div>
        )}

        {/* Inner bordered panel matching queue-card styling, zero shadow */}
        <div
          className="relative flex flex-col flex-1 overflow-hidden rounded-[10px] border bg-[var(--bg-elevated)]"
          style={{
            borderColor: 'var(--card-queued-border, var(--border-default))',
            background: 'var(--bg-elevated, #ffffff)',
            boxShadow: 'none',
          }}
        >
          {/* Header Row: Title & Action Buttons */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                Notifiche
              </h3>
              {unreadCount > 0 && (
                <span
                  className="px-1.5 py-0.2 text-[10px] rounded-full font-bold leading-tight"
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
                  type="button"
                  onClick={onMarkAllAsRead}
                  className="p-1 rounded-md transition-colors hover:bg-neutral-500/15 flex items-center justify-center text-[var(--accent-text)] hover:text-[var(--text-primary)]"
                  style={{
                    cursor: 'pointer',
                  }}
                  title="Segna tutte come lette"
                  aria-label="Segna come già lette"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
              )}
              {notifications.length > 0 && onClearAll && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="p-1 rounded-md transition-colors hover:bg-neutral-500/15 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--error-text)]"
                  style={{
                    cursor: 'pointer',
                  }}
                  title="Cancella tutte le notifiche"
                  aria-label="Cancella tutte le notifiche"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Minimalist Sub-tabs: Tutte & Non lette with smooth layoutId indicator */}
          <div className="flex items-center gap-4 px-4 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`py-2 text-xs transition-colors relative flex items-center gap-1.5 ${
                activeTab === 'all'
                  ? 'font-medium text-[var(--text-primary)]'
                  : 'font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              <span>Tutte</span>
              {activeTab === 'all' && (
                <motion.span
                  layoutId="activeNotificationTab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                  style={{ background: 'var(--accent-text)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('unread')}
              className={`py-2 text-xs transition-colors relative flex items-center gap-1.5 ${
                activeTab === 'unread'
                  ? 'font-medium text-[var(--text-primary)]'
                  : 'font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              <span>Non lette</span>
              {unreadCount > 0 && (
                <span
                  className="px-1.5 py-0.2 text-[10px] rounded-md font-bold leading-tight"
                  style={{
                    background: 'var(--accent-subtle)',
                    color: 'var(--accent-text)',
                  }}
                >
                  {unreadCount}
                </span>
              )}
              {activeTab === 'unread' && (
                <motion.span
                  layoutId="activeNotificationTab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                  style={{ background: 'var(--accent-text)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          </div>

          {/* Notification items list */}
          <div
            ref={scrollContainerRef}
            onScroll={updateCaretNotification}
            className="flex-1 overflow-y-auto flex flex-col scrollbar-thin"
          >
            {filteredNotifications.length === 0 ? (
              <div
                key={`empty-${activeTab}`}
                className="flex flex-col items-center justify-center gap-2.5 py-12 px-6 text-center h-full"
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'var(--accent-subtle)',
                    color: 'var(--accent-text)',
                  }}
                >
                  {activeTab === 'unread' ? (
                    <Sparkles className="w-4 h-4" />
                  ) : (
                    <BellOff className="w-4 h-4 opacity-70" />
                  )}
                </div>
                <h4 className="text-xs font-semibold text-[var(--text-primary)]">
                  {activeTab === 'unread' ? 'Nessuna notifica non letta' : 'Nessuna notifica'}
                </h4>
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)] max-w-[240px]">
                  {activeTab === 'unread'
                    ? 'Tutte le notifiche sono state lette.'
                    : 'Qui troverai gli avvisi su elaborazioni, aggiornamenti e stato del sistema.'}
                </p>
              </div>
            ) : (
              filteredNotifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkAsRead={onMarkAsRead}
                  onDelete={onDelete}
                  onNotificationClick={onNotificationClick}
                />
              ))
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}
