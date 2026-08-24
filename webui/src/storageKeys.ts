/**
 * Centralized registry of all localStorage keys used across the webui application.
 */
export const STORAGE_KEYS = {
  SHOW_CONSOLE: 'show_console',
  AUTO_CONTINUE: 'auto_continue',
  NOTIFICATIONS_ENABLED: 'notifications_enabled',
  PEAK_BANNER_DISMISSED_UNTIL: 'peakBannerDismissedUntil',
  EDITOR_ZOOM: 'editor_zoom',
  COLLAB_USERNAME: 'collab_username',
  COLLAB_USERCOLOR: 'collab_usercolor',
  HAS_SESSIONS_V1: 'el-sbobinator.has_sessions.v1',
  EDITOR_SESSIONS_V1: 'el-sbobinator.editor-sessions.v1',
  QUEUE_V1: 'el-sbobinator.queue.v1',
  NOTIFICATIONS_V1: 'el-sbobinator.notifications.v1',
  THEME_V1: 'el-sbobinator.theme.v1',
  CONFIG_RECOVERY_PREFIX: 'el-sbobinator.config-recovery-dismissed.v1:',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
