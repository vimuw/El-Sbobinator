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
  // How many runs have shown the "open the console" hint, or "done" once it is retired.
  CONSOLE_HINT_V1: 'el-sbobinator.console-hint.v1',
  // Web build only: Gemini keys (one per line) and model, kept in this browser.
  WEB_GEMINI_KEYS_V1: 'el-sbobinator.web.gemini-keys.v1',
  // v1 saved 3.6 Flash for everyone who set up while it was the default: read once by
  // loadWebModel (webSettings.ts), moved to v2 with 3.6 Flash turned into 2.5 Flash, then removed.
  WEB_MODEL_V1: 'el-sbobinator.web.model.v1',
  WEB_MODEL_V2: 'el-sbobinator.web.model.v2',
  // Models the main Gemini key turned out not to have (webSettings.ts): the key's hash, never the key.
  WEB_UNAVAILABLE_MODELS_V1: 'el-sbobinator.web.unavailable-models.v1',
  // When this browser last downloaded a backup of its sbobine (ISO date).
  WEB_LAST_BACKUP_V1: 'el-sbobinator.web.last-backup.v1',
  // Set once the "data stay in this browser" notice has been shown after the first sbobina.
  WEB_STORAGE_NOTICE_V1: 'el-sbobinator.web.storage-notice.v1',
  // What each Gemini key can still do today (apiUsage.ts): hashes and masked keys only.
  WEB_API_USAGE_V1: 'el-sbobinator.web.api-usage.v1',
  // M0 archive: copied once into IndexedDB by the M2 upgrade, then removed.
  WEB_M0_SESSIONS_V1: 'el-sbobinator.web.m0-sessions.v1',
  // Drive sync (drive/auth.ts): the Google access token in sessionStorage only, with its expiry,
  // and the connected account's email in localStorage for a silent reconnect.
  WEB_DRIVE_TOKEN_V1: 'el-sbobinator.web.drive-token.v1',
  WEB_DRIVE_ACCOUNT_V1: 'el-sbobinator.web.drive-account.v1',
  WEB_STORAGE_CHOICE_V1: 'el-sbobinator.web.storage-choice.v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
