import type { NotificationMessage } from '../NotificationDropdown';

export interface CaretStyle {
  fill: string;
  stroke: string;
}

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

export function getCategoryBadgeStyle(
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

export function getActionColor(
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

export function getCaretStyle(
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
