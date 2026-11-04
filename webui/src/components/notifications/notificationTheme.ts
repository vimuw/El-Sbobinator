import type { CSSProperties } from 'react';
import type { NotificationMessage } from '../NotificationDropdown';

export function getCategoryLabel(category: NotificationMessage['category']) {
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

export type NotificationTone = 'accent' | 'success' | 'warning' | 'error';

/** The colour family of a row's unread gradient, matching its icon badge. */
export function getItemTone(
  category: NotificationMessage['category'],
  type: NotificationMessage['type']
): NotificationTone {
  if (category === 'update' || type === 'info') return 'accent';
  switch (type) {
    case 'success':
    case 'warning':
    case 'error':
      return type;
    default:
      return 'accent';
  }
}

/** A category badge's colours; .notification-category-badge lays --badge-bg (see index.css). */
export type CategoryBadgeStyle = CSSProperties & { '--badge-bg': string };

/** Returns the badge colours for a notification's category and type. */
export function getCategoryBadgeStyle(
  category: NotificationMessage['category'],
  type: NotificationMessage['type']
): CategoryBadgeStyle {
  if (category === 'update' || type === 'info') {
    return {
      '--badge-bg': 'var(--accent-subtle)',
      color: 'var(--accent-text)',
    };
  }
  switch (type) {
    case 'success':
      return {
        '--badge-bg': 'var(--success-subtle)',
        color: 'var(--success-text)',
      };
    case 'warning':
      return {
        '--badge-bg': 'var(--warning-subtle)',
        color: 'var(--warning-text)',
      };
    case 'error':
      return {
        '--badge-bg': 'var(--error-subtle)',
        color: 'var(--error-text)',
      };
    default:
      return {
        '--badge-bg': 'var(--border-subtle)',
        color: 'var(--text-muted)',
      };
  }
}

export function getActionColor(
  category: NotificationMessage['category'],
  type: NotificationMessage['type']
) {
  if (category === 'update' || type === 'info') {
    return 'var(--accent-text)';
  }
  switch (type) {
    case 'warning':
      return 'var(--warning-text)';
    case 'error':
      return 'var(--error-text)';
    case 'success':
    default:
      return 'var(--accent-text)';
  }
}
