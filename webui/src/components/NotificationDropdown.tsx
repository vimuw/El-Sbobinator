import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  BellOff,
  CheckCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { NotificationItem } from './notifications/NotificationItem';
import { DURATION, enterTransition, popoverItemVariants, popoverVariants } from '../motion';

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

export interface NotificationDropdownProps {
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

// The caret sits 48px above the panel's bottom and is 18px tall; the open animation scales from its tip.
const CARET_BOTTOM = 48;
const CARET_CENTER_FROM_BOTTOM = CARET_BOTTOM + 9;

// The content lands in three beats after the frame: header, filters, then rows.
const HEADER_VARIANTS = popoverItemVariants({ y: -4, blur: 4 });
const ROW_VARIANTS = popoverItemVariants({ x: -4, blur: 4 });

// The caret fades out of the panel edge once the frame has nearly settled.
const CARET_VARIANTS = {
  open: { opacity: 1, scale: 1, transition: enterTransition(DURATION.base, 0.08) },
  closed: { opacity: 0, scale: 0.6, transition: { delay: DURATION.fast, duration: 0 } },
};

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

  const hasCaret = align === 'left' && valign === 'bottom';

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

      {/* The panel materialises out of its caret, so it reads as coming from the bell it points
          at. It is the app's largest popover, so it opens from further back than a menu. */}
      <motion.div
        key="notification-popover"
        role="dialog"
        aria-label="Notifiche"
        initial={false}
        animate={isOpen ? 'open' : 'closed'}
        variants={popoverVariants({
          x: hasCaret ? -6 : 0,
          y: hasCaret ? 0 : valign === 'bottom' ? 4 : -4,
          scale: 0.9,
          blur: 8,
          duration: DURATION.slow,
        })}
        className={`fixed z-50 flex flex-col ${
          isOpen ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{
          transformOrigin: hasCaret
            ? `left calc(100% - ${CARET_CENTER_FROM_BOTTOM}px)`
            : `${valign === 'bottom' ? 'bottom' : 'top'} ${align === 'left' ? 'left' : 'right'}`,
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
        {hasCaret && (
          <motion.div
            variants={CARET_VARIANTS}
            className="absolute -left-[8px] pointer-events-none z-30 flex items-center"
            style={{ bottom: CARET_BOTTOM, transformOrigin: 'right center' }}
            aria-hidden="true"
          >
            <svg
              width="12"
              height="18"
              viewBox="0 0 12 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Extend the opaque fill into the neutral frame to cover its border. */}
              <polygon
                points="12,0.5 8.5,0.5 0.5,9 8.5,17.5 12,17.5"
                fill="var(--bg-elevated)"
              />
              <path
                d="M 8.5 0.5 L 0.5 9 L 8.5 17.5"
                stroke="var(--border-subtle)"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.div>
        )}

        {/* Inner bordered panel matching design system .notification-dropdown-panel */}
        <div
          className={`notification-dropdown-panel relative flex flex-col flex-1 min-h-0 overflow-hidden${hasCaret ? ' has-caret' : ''}`}
        >
          <div className="notification-dropdown-content flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Header Row: Title & Action Buttons */}
            <motion.div
              variants={HEADER_VARIANTS}
              custom={0}
              className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                  Notifiche
                </h3>
                {unreadCount > 0 && (
                  <span className="status-pill is-quiet is-count shrink-0">{unreadCount}</span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllAsRead}
                    className="p-1.5 rounded-full transition-colors hover:bg-[var(--accent-subtle)] flex items-center justify-center text-[var(--accent-text)] hover:text-[var(--text-primary)]"
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
                    className="p-1.5 rounded-full transition-colors hover:bg-[var(--error-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--error-text)]"
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
            </motion.div>

            {/* Filters: Tutte & Non lette as pills, like the toolbar chips */}
            <motion.div
              variants={HEADER_VARIANTS}
              custom={1}
              className="flex items-center gap-1.5 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
            >
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                aria-pressed={activeTab === 'all'}
                className={`notification-filter${activeTab === 'all' ? ' is-active' : ''}`}
              >
                Tutte
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('unread')}
                aria-pressed={activeTab === 'unread'}
                className={`notification-filter${activeTab === 'unread' ? ' is-active' : ''}`}
              >
                <span>Non lette</span>
                {unreadCount > 0 && <span className="notification-filter-count">{unreadCount}</span>}
              </button>
            </motion.div>

            {/* Notification items list */}
            <div
              className="flex-1 overflow-y-auto flex flex-col gap-0.5 p-1 scrollbar-thin"
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
                filteredNotifications.map((n, index) => (
                  <motion.div key={n.id} variants={ROW_VARIANTS} custom={index + 2}>
                    <NotificationItem
                      notification={n}
                      onMarkAsRead={onMarkAsRead}
                      onDelete={onDelete}
                      onNotificationClick={onNotificationClick}
                    />
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}
