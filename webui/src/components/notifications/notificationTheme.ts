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

export function getItemBackground(
  type: NotificationMessage['type'],
  category: NotificationMessage['category']
) {
  if (category === 'update' || type === 'info') {
    return 'var(--accent-subtle)';
  }

  switch (type) {
    case 'success':
      return 'var(--success-subtle)';
    case 'warning':
      return 'var(--warning-subtle)';
    case 'error':
      return 'var(--error-subtle)';
    default:
      return 'transparent';
  }
}

export function getCategoryBadgeStyle(
  category: NotificationMessage['category'],
  type: NotificationMessage['type']
) {
  if (category === 'update' || type === 'info') {
    return {
      background: 'var(--accent-subtle)',
      color: 'var(--accent-text)',
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
