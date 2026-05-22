import type { Dispatch } from 'react';
import type {
  FileDescriptor,
  FileDonePayload,
  FileFailedPayload,
  ProcessDonePayload,
  ProcessingAction,
  SetCurrentFilePayload,
  WorkDonePayload,
  WorkTotalsPayload,
} from './appState';

export interface ValidationCheck {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: string;
}

export interface ValidationResult {
  ok: boolean;
  summary: string;
  checks: ValidationCheck[];
}

export interface ModelOption {
  id: string;
  label: string;
  summary: string;
  default_chunk_minutes: number;
  phase1_temperature?: number;
}

export interface SettingsPayload {
  api_key?: string;
  fallback_keys?: string[];
  preferred_model?: string;
  fallback_models?: string[];
  available_models?: ModelOption[];
  has_protected_key?: boolean;
  api_key_insecure?: boolean;
  api_key_insecure_reason?: string;
  config_recovered_from?: string;
}

export interface ArchiveSession {
  name: string;
  completed_at_iso: string;
  html_path: string;
  effective_model: string;
  input_path: string;
  input_size?: number;
  session_dir: string;
  duration_sec?: number;
  completion_status?: 'completed' | 'completed_with_warnings';
  revision_failed_blocks?: number[];
}

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchSessionResult {
  session_dir: string;
  name: string;
  html_path: string;
  completed_at_iso: string;
  snippets: SearchSnippet[];
  match_count: number;
}

export interface ArchiveFolder {
  id: string;
  name: string;
  color: string;
  session_dirs: string[];
}

export interface LowDiskWarning {
  needed_bytes: number;
  free_bytes: number;
  location: string;
  kind: string;
  file_name?: string;
}

export interface StartProcessingResult {
  ok: boolean;
  error?: string;
  low_disk_warning?: LowDiskWarning;
}

export interface SaveHtmlResult {
  ok: boolean;
  saved?: boolean;
  error?: string;
}

export type ElSbobinatorBridge = BridgeCallbacks | null;

export interface UpdateDownloadProgressPayload {
  status: 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
  bytes_done: number;
  bytes_total: number;
  error?: string;
}

export interface BridgeCallbacks {
  appendConsole: (msg: string) => void;
  updateProgress: (value: number) => void;
  updatePhase: (text: string) => void;
  updateModel: (model: string) => void;
  processDone: (data: ProcessDonePayload) => void;
  setWorkTotals: (data: WorkTotalsPayload) => void;
  updateWorkDone: (data: WorkDonePayload) => void;
  registerStepTime: (...args: any[]) => void;
  setCurrentFile: (data: SetCurrentFilePayload) => void;
  fileDone: (data: FileDonePayload) => void;
  fileFailed: (data: FileFailedPayload) => void;
  askRegenerate: (data: { filename: string; mode?: 'completed' | 'resume'; sessionDir?: string }) => void;
  askNewKey: () => void;
  dismissNewKey: () => void;
  filesDropped: (files: FileDescriptor[]) => void;
  updateDownloadProgress: (data: UpdateDownloadProgressPayload) => void;
}

export interface PywebviewApi {
  load_settings?: () => Promise<SettingsPayload>;
  save_settings?: (
    apiKey: string | null,
    fallbackKeys: string[],
    preferredModel: string,
    fallbackModels: string[],
  ) => Promise<{ ok: boolean; error?: string }>;
  ask_files?: () => Promise<FileDescriptor[]>;
  ask_media_file?: () => Promise<FileDescriptor | null>;
  check_path_exists?: (path: string) => Promise<{ ok: boolean; exists: boolean }>;
  collect_dropped_files?: (names: string[]) => Promise<{ ok: boolean }>;
  start_processing?: (files: FileDescriptor[], apiKey: string, resumeSession: boolean, preferredModel: string, fallbackModels: string[], overrideLowDisk?: boolean) => Promise<StartProcessingResult>;
  stop_processing?: () => Promise<{ ok: boolean }>;
  answer_regenerate?: (regenerate: boolean | null) => Promise<{ ok: boolean }>;
  answer_new_key?: (key: string) => Promise<{ ok: boolean }>;
  open_file?: (path: string) => Promise<{ ok: boolean; error?: string }>;
  open_url?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  read_html_content?: (path: string) => Promise<{ ok: boolean; content?: string; error?: string }>;
  save_html_content?: (path: string, content: string, generation?: number) => Promise<SaveHtmlResult>;
  stream_media_file?: (path: string, sessionDir?: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  show_notification?: (title: string, message: string) => Promise<void>;
  validate_environment?: (
    apiKey?: string,
    checkApiKey?: boolean,
    preferredModel?: string,
    fallbackModels?: string[],
  ) => Promise<{ ok: boolean; result?: ValidationResult; error?: string }>;
  get_session_storage_info?: () => Promise<{ ok: boolean; total_bytes?: number; total_sessions?: number; session_root?: string; error?: string }>;
  cleanup_old_sessions?: (maxAgeDays?: number) => Promise<{ ok: boolean; removed?: number; freed_bytes?: number; errors?: number; candidates?: number; preserved_completed?: number; missing_completed_html?: number; error?: string }>;
  cleanup_completed_sessions?: (maxAgeDays?: number, dryRun?: boolean) => Promise<{ ok: boolean; removed?: number; freed_bytes?: number; errors?: number; candidates?: number; preserved_completed?: number; missing_completed_html?: number; error?: string }>;
  get_completed_sessions?: (limit?: number) => Promise<{ ok: boolean; sessions?: ArchiveSession[]; total?: number; error?: string }>;
  delete_session?: (sessionDir: string) => Promise<{ ok: boolean; error?: string }>;
  update_session_input_path?: (sessionDir: string, newPath: string) => Promise<{ ok: boolean; error?: string }>;
  open_session_folder?: () => Promise<{ ok: boolean; error?: string }>;
  ask_session_folder?: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;
  move_session_root?: (newPath: string) => Promise<{ ok: boolean; started?: boolean; error?: string }>;
  get_session_move_status?: () => Promise<{ status: string; moved?: number; total?: number; error?: string | null }>;
  download_and_install_update?: (version: string) => Promise<{ ok: boolean; status?: string; error?: string }>;
  save_theme_preference?: (theme: 'light' | 'dark') => Promise<void>;
  get_archive_folders?: () => Promise<{ ok: boolean; folders: ArchiveFolder[]; error?: string }>;
  save_archive_folders?: (folders: ArchiveFolder[]) => Promise<{ ok: boolean; error?: string }>;
  search_sessions?: (query: string, limit?: number) => Promise<{ ok: boolean; results?: SearchSessionResult[]; error?: string }>;
  retry_failed_revision_blocks?: (sessionDir: string) => Promise<{
    ok: boolean;
    error?: string;
    retried_blocks?: number[];
    remaining_failed_blocks?: number[];
    html_path?: string;
    session_dir?: string;
    effective_model?: string;
    completion_status?: 'completed' | 'completed_with_warnings';
    cancelled?: boolean;
    quota_exhausted?: boolean;
    conflict?: boolean;
  }>;
}

export function createBridge(options: {
  dispatch: Dispatch<ProcessingAction>;
  appendConsole: (msg: string) => void;
  onRegenerate: (data: { filename: string; mode?: 'completed' | 'resume'; sessionDir?: string }) => void;
  onAskNewKey: () => void;
  onDismissNewKey: () => void;
  onBatchDone: (data: ProcessDonePayload) => void;
  onFileDone: (data: FileDonePayload) => void;
  onFilesDropped: (files: FileDescriptor[]) => void;
  onBatchStart: () => void;
  onDownloadProgress?: (data: UpdateDownloadProgressPayload) => void;
}): BridgeCallbacks {
  const { dispatch, appendConsole, onRegenerate, onAskNewKey, onDismissNewKey, onBatchDone, onFileDone, onFilesDropped, onBatchStart, onDownloadProgress } = options;

  return {
    appendConsole,
    updateProgress: value => dispatch({ type: 'bridge/update_progress', value }),
    updatePhase: text => { onBatchStart(); dispatch({ type: 'bridge/update_phase', text }); },
    updateModel: model => dispatch({ type: 'bridge/update_model', model }),
    processDone: data => {
      dispatch({ type: 'bridge/process_done', data });
      onBatchDone(data);
    },
    setWorkTotals: data => dispatch({ type: 'bridge/set_work_totals', data }),
    updateWorkDone: data => dispatch({ type: 'bridge/update_work_done', data }),
    registerStepTime: () => {},
    setCurrentFile: data => { onBatchStart(); dispatch({ type: 'bridge/set_current_file', data }); },
    fileDone: data => {
      dispatch({ type: 'bridge/file_done', data });
      onFileDone(data);
    },
    fileFailed: data => dispatch({ type: 'bridge/file_failed', data }),
    askRegenerate: onRegenerate,
    askNewKey: onAskNewKey,
    dismissNewKey: onDismissNewKey,
    filesDropped: onFilesDropped,
    updateDownloadProgress: data => { onDownloadProgress?.(data); },
  };
}
