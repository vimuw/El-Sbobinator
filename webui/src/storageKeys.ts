/**
 * Centralized registry of all localStorage keys used across the webui application.
 */
export const STORAGE_KEYS = {
  SHOW_CONSOLE: 'show_console',
  AUTO_CONTINUE: 'auto_continue',
  NOTIFICATIONS_ENABLED: 'notifications_enabled',
  EDITOR_ZOOM: 'editor_zoom',
  HAS_SESSIONS_V1: 'el-sbobinator.has_sessions.v1',
  EDITOR_SESSIONS_V1: 'el-sbobinator.editor-sessions.v1',
  QUEUE_V1: 'el-sbobinator.queue.v1',
  NOTIFICATIONS_V1: 'el-sbobinator.notifications.v1',
  BROWSER_INSTANCE_V1: 'el-sbobinator.browser-instance.v1',
  THEME_V1: 'el-sbobinator.theme.v1',
  CONFIG_RECOVERY_PREFIX: 'el-sbobinator.config-recovery-dismissed.v1:',
  LAST_SEEN_APP_VERSION_V1: 'el-sbobinator.last-seen-app-version.v1',
  // Web build only: Gemini keys (one per line) and model, kept in this browser.
  WEB_GEMINI_KEYS_V1: 'el-sbobinator.web.gemini-keys.v1',
  WEB_MODEL_V1: 'el-sbobinator.web.model.v1',
  // M0 placeholder archive; IndexedDB replaces it in M2.
  WEB_M0_SESSIONS_V1: 'el-sbobinator.web.m0-sessions.v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
