import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConfirmActionModal } from './ConfirmActionModal';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, AlertCircle, AlertTriangle, ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, Bell, Check, CheckCircle, ChevronDown, Cpu, Eye, EyeOff, FlaskConical, FolderOpen, HardDrive, Loader2, RefreshCw, Settings, SlidersHorizontal, Tag, Trash2, X } from 'lucide-react';
import type { ModelOption, UpdateDownloadProgressPayload, ValidationResult } from '../../bridge';
import { formatSize, GEMINI_KEY_PATTERN } from '../../utils';
import { APP_VERSION, GITHUB_RELEASES_URL } from '../../branding';

const SESSION_CLEANUP_DAYS = 30;

interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
}

function CustomSelect({ value, onChange, options, placeholder }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 });
    }
  }, []);

  const toggleDropdown = () => setOpen(prev => !prev);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const selectedLabel = options.find(o => o.value === value)?.label;
  const displayLabel = selectedLabel ?? placeholder ?? '';

  const dropdown = open ? createPortal(
    <div
      ref={dropdownRef}
      onMouseDown={e => e.stopPropagation()}
      style={{
        ...dropdownStyle,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        boxShadow: 'var(--shadow-strong)',
        borderRadius: '14px',
        overflow: 'auto',
        maxHeight: '220px',
      }}
    >
      {placeholder && (
        <button
          type="button"
          onClick={() => { onChange(''); setOpen(false); }}
          className="w-full text-left px-4 py-1.5 text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          {placeholder}
        </button>
      )}
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => { onChange(opt.value); setOpen(false); }}
          className={`w-full text-left px-4 transition-colors ${opt.description ? 'py-2' : 'py-1.5'}`}
          style={{
            color: opt.value === value ? 'var(--text-primary)' : 'var(--text-secondary)',
            background: opt.value === value ? 'var(--accent-subtle)' : undefined,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-subtle)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = opt.value === value ? 'var(--accent-subtle)' : ''; }}
        >
          <span className="block text-sm">{opt.label}</span>
          {opt.description && (
            <span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{opt.description}</span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleDropdown}
        className="app-input text-sm flex items-center justify-between gap-2 cursor-pointer"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          color: selectedLabel ? 'var(--text-primary)' : 'var(--text-muted)',
          textAlign: 'left',
          padding: '0.35rem 0.75rem',
        }}
      >
        <span className="truncate flex-1">{displayLabel}</span>
        <ChevronDown
          className="w-4 h-4 shrink-0 transition-transform"
          style={{
            color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : undefined,
          }}
        />
      </button>
      {dropdown}
    </>
  );
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  hasProtectedKey: boolean;
  fallbackKeys: string[];
  setFallbackKeys: (keys: string[]) => void;
  preferredModel: string;
  setPreferredModel: (model: string) => void;
  fallbackModels: string[];
  setFallbackModels: (models: string[]) => void;
  availableModels: ModelOption[];
  appendConsole: (msg: string) => void;
  latestVersion: string | null;
  checkForUpdates: (force?: boolean) => void;
  isCheckingUpdate: boolean;
  hasChecked: boolean;
  checkFailed: boolean;
  updateInstallState?: SettingsUpdateInstallState;
  onInstallUpdate?: (version: string) => Promise<void>;
  onSettingsSaved?: () => Promise<unknown> | unknown;
}

type SettingsUpdateInstallState = {
  version: string | null;
  status: UpdateDownloadProgressPayload['status'] | 'idle';
  bytesDone: number;
  bytesTotal: number;
  error: string | null;
};

type CleanupSummary = {
  removed: number;
  freed_bytes: number;
  candidates?: number;
  preserved_completed?: number;
  missing_completed_html?: number;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSettingsUpdateStatus(state?: SettingsUpdateInstallState): string | null {
  if (!state) return null;
  if (state.status === 'downloading') {
    const percent = state.bytesTotal > 0 ? ` ${Math.round((state.bytesDone / state.bytesTotal) * 100)}%` : '';
    return `Download aggiornamento${percent}…`;
  }
  if (state.status === 'verifying') return 'Verifica integrità aggiornamento…';
  if (state.status === 'installing') return 'Installazione aggiornamento…';
  if (state.status === 'done') return 'Installer avviato. Segui le istruzioni a schermo.';
  if (state.status === 'error') return state.error ?? 'Aggiornamento non riuscito.';
  return null;
}

function VersionUpdateRow({
  latestVersion,
  updateInstallState,
  onInstallUpdate,
}: {
  latestVersion: string;
  updateInstallState?: SettingsUpdateInstallState;
  onInstallUpdate?: (version: string) => Promise<void>;
}) {
  const isInstalling = updateInstallState?.version === latestVersion
    && ['downloading', 'verifying', 'installing'].includes(updateInstallState.status);
  const isDone = updateInstallState?.version === latestVersion && updateInstallState.status === 'done';
  const isError = updateInstallState?.version === latestVersion && updateInstallState.status === 'error';

  const progressPercent = updateInstallState?.status === 'downloading' && updateInstallState.bytesTotal > 0
    ? Math.round((updateInstallState.bytesDone / updateInstallState.bytesTotal) * 100)
    : 0;

  const statusMessage = updateInstallState?.version === latestVersion
    ? formatSettingsUpdateStatus(updateInstallState)
    : null;

  const handleInstall = async () => {
    if (isInstalling || !onInstallUpdate) return;
    try {
      await onInstallUpdate(latestVersion);
    } catch (_) {}
  };

  return (
    <div className="space-y-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div
        className="rounded-lg p-3 space-y-3"
        style={{
          background: 'var(--warning-subtle, rgba(217, 119, 6, 0.05))',
          border: '1px solid var(--warning-ring, rgba(217, 119, 6, 0.2))'
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span
                className="text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(217, 119, 6, 0.15)', color: 'var(--warning-text)' }}
              >
                Nuovo
              </span>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                Versione disponibile: <span style={{ color: 'var(--warning-text)' }}>v{latestVersion}</span>
              </span>
            </div>
          </div>

          {!isInstalling && !isDone && (
            <button
              onClick={() => void handleInstall()}
              aria-label="Installa aggiornamento"
              className="flex items-center gap-1.5 shrink-0"
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                borderRadius: '6px',
                background: 'var(--warning-text)',
                color: 'var(--bg-surface)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                boxShadow: '0 2px 6px rgba(217, 119, 6, 0.2)'
              }}
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              Aggiorna ora
            </button>
          )}
        </div>

        {isInstalling && (
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between items-center text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1.5 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--warning-text)' }} />
                {statusMessage}
              </span>
              {progressPercent > 0 && <span className="font-semibold">{progressPercent}%</span>}
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'var(--warning-text)' }}
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent || 10}%` }}
                transition={{ ease: 'easeOut', duration: 0.3 }}
              />
            </div>
          </div>
        )}

        {(isDone || isError) && statusMessage && (
          <div
            className="rounded-md p-2 flex items-start gap-1.5 text-xs mt-1"
            style={{
              background: isError ? 'var(--error-subtle)' : 'var(--success-subtle)',
              border: `1px solid ${isError ? 'var(--error-ring)' : 'var(--success-ring)'}`,
              color: isError ? 'var(--error-text)' : 'var(--success-text)'
            }}
          >
            {isError ? <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{statusMessage}</p>
              {isError && (
                <button
                  onClick={() => void window.pywebview?.api?.open_url?.(GITHUB_RELEASES_URL)}
                  className="underline mt-1 block hover:opacity-85"
                  style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}
                >
                  Apri GitHub
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsModal({
  isOpen,
  onClose,
  apiKey,
  setApiKey,
  hasProtectedKey,
  fallbackKeys,
  setFallbackKeys,
  preferredModel,
  setPreferredModel,
  fallbackModels,
  setFallbackModels,
  availableModels,
  appendConsole,
  latestVersion,
  checkForUpdates,
  isCheckingUpdate,
  hasChecked,
  checkFailed,
  updateInstallState,
  onInstallUpdate,
  onSettingsSaved,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'advanced'>('general');
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('notifications_enabled') !== 'false');
  const [showPrimaryKey, setShowPrimaryKey] = useState(false);
  const [showFallbackKeys, setShowFallbackKeys] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ total_bytes: number; total_sessions: number; session_root?: string } | null>(null);
  const [isLoadingSessionInfo, setIsLoadingSessionInfo] = useState(false);
  const [isCleaningSession, setIsCleaningSession] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<CleanupSummary | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupSummary | null>(null);
  const [isCleaningCompletedSessions, setIsCleaningCompletedSessions] = useState(false);
  const [completedCleanupPreview, setCompletedCleanupPreview] = useState<CleanupSummary | null>(null);
  const [completedCleanupResult, setCompletedCleanupResult] = useState<CleanupSummary | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidatingEnvironment, setIsValidatingEnvironment] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [showCompletedCleanupConfirm, setShowCompletedCleanupConfirm] = useState(false);

  const [isMoveInProgress, setIsMoveInProgress] = useState(false);
  const [moveProgress, setMoveProgress] = useState<{ moved: number; total: number } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [showMoveConfirm, setShowMoveConfirm] = useState(false);
  const [pendingMovePath, setPendingMovePath] = useState<string | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpenRef = useRef(isOpen);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isSavingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const handleClose = () => { if (isSavingRef.current) return; onClose(); };

  useEffect(() => {
    if (isOpen) checkForUpdates(false);
  }, [isOpen, checkForUpdates]);

  useEffect(() => {
    if (!isOpen) {
      setActiveTab('general');
      setIsSaving(false);
      isSavingRef.current = false;
      setIsMoveInProgress(false);
      setMoveProgress(null);
      setMoveError(null);
      setShowCleanupConfirm(false);
      setCleanupPreview(null);
      setShowCompletedCleanupConfirm(false);
      setCompletedCleanupPreview(null);
      setCleanupResult(null);
      setCompletedCleanupResult(null);
      if (moveTimerRef.current) {
        clearTimeout(moveTimerRef.current);
        moveTimerRef.current = null;
      }
      return;
    }

    setNotificationsEnabled(localStorage.getItem('notifications_enabled') !== 'false');
    setSaveError(null);
    setCleanupResult(null);
    setCompletedCleanupResult(null);

    if (!window.pywebview?.api?.get_session_storage_info) return;
    let aborted = false;
    setIsLoadingSessionInfo(true);
    setSessionInfo(null);
    window.pywebview.api.get_session_storage_info()
      .then(res => { if (!aborted && res?.ok) setSessionInfo({ total_bytes: res.total_bytes ?? 0, total_sessions: res.total_sessions ?? 0, session_root: res.session_root ?? '' }); })
      .catch(() => {})
      .finally(() => { if (!aborted) setIsLoadingSessionInfo(false); });

    if (window.pywebview?.api?.get_session_move_status) {
      window.pywebview.api.get_session_move_status()
        .then(res => {
          if (!aborted && res && res.status === 'moving') {
            setIsMoveInProgress(true);
            setMoveProgress({ moved: res.moved ?? 0, total: res.total ?? 0 });
            void pollMoveStatus();
          }
        })
        .catch(() => {});
    }

    return () => {
      aborted = true;
      if (moveTimerRef.current) {
        clearTimeout(moveTimerRef.current);
        moveTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleOpenSessionFolder = () => {
    window.pywebview?.api?.open_session_folder?.();
  };

  async function pollMoveStatus() {
    try {
      const res = await window.pywebview?.api?.get_session_move_status?.();
      if (!res || !isOpenRef.current || !isMountedRef.current) return;
      if (res.status === 'moving') {
        if (!isMountedRef.current) return;
        setMoveProgress({ moved: res.moved ?? 0, total: res.total ?? 0 });
        moveTimerRef.current = setTimeout(() => void pollMoveStatus(), 500);
      } else if (res.status === 'done') {
        if (!isMountedRef.current) return;
        setIsMoveInProgress(false);
        setMoveProgress(null);
        try {
          const info = await window.pywebview?.api?.get_session_storage_info?.();
          if (info?.ok && isOpenRef.current && isMountedRef.current) setSessionInfo({ total_bytes: info.total_bytes ?? 0, total_sessions: info.total_sessions ?? 0, session_root: info.session_root ?? '' });
        } catch { /* non-critical refresh */ }
      } else if (res.status === 'error') {
        if (!isMountedRef.current) return;
        setIsMoveInProgress(false);
        setMoveProgress(null);
        setMoveError(res.error ?? 'Errore sconosciuto');
      } else {
        if (!isMountedRef.current) return;
        setIsMoveInProgress(false);
        setMoveProgress(null);
        setMoveError(`Stato imprevisto: ${String(res.status)}`);
      }
    } catch {
      if (!isMountedRef.current) return;
      setIsMoveInProgress(false);
      setMoveProgress(null);
      setMoveError('Errore di connessione API');
    }
  }

  const handleAskMoveFolder = async () => {
    if (isMoveInProgress) return;
    const res = await window.pywebview?.api?.ask_session_folder?.();
    if (!res?.ok || !res.path) return;
    setPendingMovePath(res.path);
    setMoveError(null);
    setShowMoveConfirm(true);
  };

  const handleConfirmMove = async () => {
    if (!pendingMovePath) return;
    setShowMoveConfirm(false);
    setMoveError(null);
    const res = await window.pywebview?.api?.move_session_root?.(pendingMovePath);
    setPendingMovePath(null);
    if (!res?.ok) {
      setMoveError(res?.error ?? 'Errore sconosciuto');
      return;
    }
    setIsMoveInProgress(true);
    setMoveProgress({ moved: 0, total: 0 });
    void pollMoveStatus();
  };

  const handleAskCleanup = async () => {
    if (!window.pywebview?.api?.cleanup_old_sessions || isCleaningSession) return;
    setIsCleaningSession(true);
    setCleanupPreview(null);
    try {
      const res = await window.pywebview.api.cleanup_old_sessions(SESSION_CLEANUP_DAYS, true);
      if (!isMountedRef.current) return;
      if (res?.ok) {
        setCleanupPreview({
          removed: res.removed ?? 0,
          freed_bytes: res.freed_bytes ?? 0,
          candidates: res.candidates ?? 0,
          preserved_completed: res.preserved_completed ?? 0,
          missing_completed_html: res.missing_completed_html ?? 0,
        });
        setShowCleanupConfirm(true);
      } else {
        appendConsole(`❌ Conteggio sbobine incomplete fallito: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      if (!isMountedRef.current) return;
      appendConsole(`❌ Conteggio sbobine incomplete fallito: ${getErrorMessage(e)}`);
    } finally {
      if (isMountedRef.current) setIsCleaningSession(false);
    }
  };

  const handleCleanupSessions = async () => {
    if (!window.pywebview?.api?.cleanup_old_sessions) return;
    setShowCleanupConfirm(false);
    setIsCleaningSession(true);
    setCleanupResult(null);
    try {
      const res = await window.pywebview.api.cleanup_old_sessions(SESSION_CLEANUP_DAYS, false);
      if (!isMountedRef.current) return;
      if (res?.ok) {
        setCleanupResult({
          removed: res.removed ?? 0,
          freed_bytes: res.freed_bytes ?? 0,
          candidates: res.candidates ?? res.removed ?? 0,
          preserved_completed: res.preserved_completed ?? 0,
          missing_completed_html: res.missing_completed_html ?? 0,
        });
        if (window.pywebview?.api?.get_session_storage_info) {
          try {
            const info = await window.pywebview.api.get_session_storage_info();
            if (info?.ok && isMountedRef.current) setSessionInfo({ total_bytes: info.total_bytes ?? 0, total_sessions: info.total_sessions ?? 0, session_root: info.session_root ?? '' });
          } catch {}
        }
      } else {
        appendConsole(`❌ Pulizia sessioni fallita: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      if (!isMountedRef.current) return;
      appendConsole(`❌ Pulizia sessioni fallita: ${getErrorMessage(e)}`);
    } finally {
      if (isMountedRef.current) setIsCleaningSession(false);
    }
  };

  const handleAskCompletedCleanup = async () => {
    if (!window.pywebview?.api?.cleanup_completed_sessions || isCleaningCompletedSessions) return;
    setIsCleaningCompletedSessions(true);
    setCompletedCleanupPreview(null);
    try {
      const res = await window.pywebview.api.cleanup_completed_sessions(SESSION_CLEANUP_DAYS, true);
      if (!isMountedRef.current) return;
      if (res?.ok) {
        setCompletedCleanupPreview({
          removed: res.removed ?? 0,
          freed_bytes: res.freed_bytes ?? 0,
          candidates: res.candidates ?? 0,
          preserved_completed: res.preserved_completed ?? 0,
          missing_completed_html: res.missing_completed_html ?? 0,
        });
        setShowCompletedCleanupConfirm(true);
      } else {
        appendConsole(`❌ Conteggio sbobine completate fallito: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      if (!isMountedRef.current) return;
      appendConsole(`❌ Conteggio sbobine completate fallito: ${getErrorMessage(e)}`);
    } finally {
      if (isMountedRef.current) setIsCleaningCompletedSessions(false);
    }
  };

  const handleCleanupCompletedSessions = async () => {
    if (!window.pywebview?.api?.cleanup_completed_sessions) return;
    setShowCompletedCleanupConfirm(false);
    setIsCleaningCompletedSessions(true);
    setCompletedCleanupResult(null);
    try {
      const res = await window.pywebview.api.cleanup_completed_sessions(SESSION_CLEANUP_DAYS, false);
      if (!isMountedRef.current) return;
      if (res?.ok) {
        setCompletedCleanupResult({
          removed: res.removed ?? 0,
          freed_bytes: res.freed_bytes ?? 0,
          candidates: res.candidates ?? res.removed ?? 0,
          preserved_completed: res.preserved_completed ?? 0,
          missing_completed_html: res.missing_completed_html ?? 0,
        });
        if (window.pywebview?.api?.get_session_storage_info) {
          try {
            const info = await window.pywebview.api.get_session_storage_info();
            if (info?.ok && isMountedRef.current) setSessionInfo({ total_bytes: info.total_bytes ?? 0, total_sessions: info.total_sessions ?? 0, session_root: info.session_root ?? '' });
          } catch {}
        }
      } else {
        appendConsole(`❌ Eliminazione sbobine completate fallita: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      if (!isMountedRef.current) return;
      appendConsole(`❌ Eliminazione sbobine completate fallita: ${getErrorMessage(e)}`);
    } finally {
      if (isMountedRef.current) setIsCleaningCompletedSessions(false);
    }
  };

  const runEnvironmentValidation = async () => {
    if (!window.pywebview?.api?.validate_environment) return;
    setIsValidatingEnvironment(true);
    try {
      const response = await window.pywebview.api.validate_environment(
        apiKey.trim(),
        Boolean(apiKey.trim()),
        preferredModel,
        fallbackModels,
      );
      if (!isMountedRef.current) return;
      if (!response?.ok || !response.result) {
        appendConsole(`❌ Validazione ambiente fallita: ${response?.error || 'errore sconosciuto'}`);
        setValidationResult(null);
        return;
      }
      setValidationResult(response.result);
      appendConsole(response.result.summary);
    } catch (error: unknown) {
      if (!isMountedRef.current) return;
      appendConsole(`❌ Validazione ambiente fallita: ${getErrorMessage(error)}`);
      setValidationResult(null);
    } finally {
      if (isMountedRef.current) setIsValidatingEnvironment(false);
    }
  };

  const saveSettings = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      if (!window.pywebview?.api?.save_settings) {
        const err = 'Bridge Python non disponibile — impostazioni non salvate.';
        if (isMountedRef.current) setSaveError(err);
        appendConsole(`❌ ${err}`);
        return;
      }
      const keys = fallbackKeys.map(k => k.trim()).filter(Boolean);
      let result;
      try {
        const apiKeyPayload = hasProtectedKey && !apiKey.trim() ? null : apiKey.trim();
        result = await window.pywebview.api.save_settings(apiKeyPayload, keys, preferredModel, fallbackModels);
      } catch (e: unknown) {
        const err = `Errore salvataggio impostazioni: ${getErrorMessage(e)}`;
        if (isMountedRef.current) setSaveError(err);
        appendConsole(`❌ ${err}`);
        return;
      }
      if (!isMountedRef.current) return;
      if (!result?.ok) {
        const err = `Errore salvataggio impostazioni: ${result?.error || 'errore sconosciuto'}`;
        setSaveError(err);
        appendConsole(`❌ ${err}`);
        return;
      }
      try {
        await onSettingsSaved?.();
      } catch (e: unknown) {
        appendConsole(`Avviso: impostazioni salvate, ma il refresh dello stato non e riuscito: ${getErrorMessage(e)}`);
      }
      onClose();
    } finally {
      isSavingRef.current = false;
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  const availableFallbackOptions = availableModels.filter(model => model.id !== preferredModel);
  const primaryModel = availableModels.find(m => m.id === preferredModel);
  const primaryModelSummary = primaryModel?.summary;
  const defaultChunkMinutes = primaryModel?.default_chunk_minutes ?? '—';
  const defaultTemperature = primaryModel?.phase1_temperature ?? '—';

  const handlePrimaryModelChange = (nextPrimary: string) => {
    setPreferredModel(nextPrimary);
    setFallbackModels(fallbackModels.filter(modelId => modelId !== nextPrimary));
  };

  const handleAddFallbackModel = (nextFallback: string) => {
    if (!nextFallback || nextFallback === preferredModel || fallbackModels.includes(nextFallback)) return;
    setFallbackModels([...fallbackModels, nextFallback]);
  };

  const moveFallbackModel = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= fallbackModels.length) return;
    const nextModels = [...fallbackModels];
    const [moved] = nextModels.splice(index, 1);
    nextModels.splice(nextIndex, 0, moved);
    setFallbackModels(nextModels);
  };

  const removeFallbackModel = (modelId: string) => {
    setFallbackModels(fallbackModels.filter(item => item !== modelId));
  };

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0"
            style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(10px)' }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14, ease: 'easeIn' } }}
            className="modal-card relative w-full max-w-md md:max-w-4xl h-[85vh] md:h-[80vh] overflow-hidden flex flex-col md:flex-row"
          >
            {/* Sidebar Navigation */}
            <div
              className="w-full md:w-60 md:shrink-0 flex flex-row md:flex-col border-b md:border-b-0 md:border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-x-auto md:overflow-x-visible md:overflow-y-auto shrink-0 py-4 px-3 gap-1"
            >
              {/* Sidebar Header - visible only on desktop */}
              <div className="hidden md:flex items-center gap-2 px-3 py-2.5 mb-3 border-b border-[var(--border-subtle)]">
                <Settings className="w-5 h-5 text-[var(--accent-text)] shrink-0" />
                <span role="heading" aria-level={2} className="font-bold text-base tracking-wide uppercase text-[var(--text-primary)]">
                  Impostazioni
                </span>
              </div>

              {/* Tab: Generale */}
              <button
                type="button"
                onClick={() => setActiveTab('general')}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-all ${
                  activeTab === 'general'
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent-text)] border-l-4 md:border-l-4 border-b-2 md:border-b-0 border-[var(--accent-bg)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--sidebar-active-bg)] hover:text-[var(--text-primary)] border-l-4 border-transparent'
                }`}
                style={{ textAlign: 'left' }}
              >
                <Settings className="w-4 h-4 shrink-0" />
                <span>Generale</span>
              </button>

              {/* Tab: Avanzati */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('advanced');
                }}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-all ${
                  activeTab === 'advanced'
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent-text)] border-l-4 md:border-l-4 border-b-2 md:border-b-0 border-[var(--accent-bg)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--sidebar-active-bg)] hover:text-[var(--text-primary)] border-l-4 border-transparent'
                }`}
                style={{ textAlign: 'left' }}
              >
                <SlidersHorizontal className="w-4 h-4 shrink-0" />
                <span>Avanzati</span>
              </button>
            </div>

            {/* Right Content Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-surface)] h-full relative">
              {/* Close Button - top right of modal content column */}
              <div className="absolute top-4 right-4 z-10">
                <button
                  onClick={handleClose}
                  disabled={isSaving}
                  className="icon-button modal-icon-button disabled:opacity-40 hover:bg-[var(--sidebar-active-bg)] rounded-full p-1.5 transition-colors"
                  aria-label="Chiudi impostazioni"
                >
                  <X className="w-5 h-5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
                </button>
              </div>

              {/* Scrollable Panel Content */}
              <div className="app-scroll flex-1 overflow-y-auto overflow-x-hidden p-6 md:p-8 space-y-6">

                {activeTab === 'general' && (
                  <div className="space-y-8 animate-fade-in">
                    <div>
                      <h2 className="text-xl font-bold text-[var(--text-primary)]">Generale</h2>
                      <p className="text-sm text-[var(--text-muted)] mt-1">
                        Gestisci le tue chiavi API di Google Gemini, le notifiche di sistema e controlla gli aggiornamenti dell'applicazione.
                      </p>
                    </div>

                    {/* Section 1: API Keys */}
                    <div className="space-y-5">
                      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2">
                        <Cpu className="w-4 h-4 text-[var(--accent-text)]" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                          Chiavi API Google Gemini
                        </h3>
                      </div>

                      {/* API Key Principal */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-semibold text-[var(--text-primary)]">
                            Google Gemini API Key (Principale)
                          </label>
                          <button
                            onClick={() => setShowPrimaryKey(!showPrimaryKey)}
                            className="opacity-50 hover:opacity-100 transition-opacity"
                            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
                            title={showPrimaryKey ? 'Nascondi chiave' : 'Mostra chiave'}
                          >
                            {showPrimaryKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <input
                          type={showPrimaryKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={e => setApiKey(e.target.value)}
                          placeholder="AIzaSy... oppure AQ..."
                          className="app-input font-mono text-sm w-full p-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-ring)]"
                        />
                        {apiKey.trim() && (
                          <p className="text-sm" style={{ color: GEMINI_KEY_PATTERN.test(apiKey.trim()) ? 'var(--success-text)' : 'var(--warning-text)' }}>
                            {GEMINI_KEY_PATTERN.test(apiKey.trim()) ? '✓ Formato valido' : '⚠ Formato non valido — le chiavi iniziano con AIzaSy... o AQ.'}
                          </p>
                        )}
                        <div className="flex flex-col gap-1 mt-1 text-xs text-[var(--text-muted)]">
                          <p className="flex items-start gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>Salvata in modo sicuro tramite DPAPI (Windows) o Keyring (Mac/Linux).</span>
                          </p>
                          <a
                            href="#"
                            onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.('https://aistudio.google.com/apikey'); }}
                            className="inline-flex items-center gap-1 hover:opacity-100 opacity-70 w-fit"
                            style={{ color: 'var(--accent-text, var(--text-secondary))' }}
                          >
                            → Ottieni gratis su aistudio.google.com
                          </a>
                        </div>
                      </div>

                      {/* Fallback Keys */}
                      <div className="pt-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-sm font-semibold text-[var(--text-primary)]">
                            API Keys di Riserva (Fallback)
                          </label>
                          <button
                            onClick={() => setShowFallbackKeys(!showFallbackKeys)}
                            className="opacity-50 hover:opacity-100 transition-opacity"
                            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
                            title={showFallbackKeys ? 'Nascondi chiavi' : 'Mostra chiavi'}
                          >
                            {showFallbackKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <textarea
                          value={fallbackKeys.join('\n')}
                          onChange={e => setFallbackKeys(e.target.value.split('\n'))}
                          placeholder="Inserisci una API Key per riga..."
                          rows={3}
                          className={`app-textarea font-mono text-sm w-full p-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-ring)] resize-none ${!showFallbackKeys ? 'obscured-text' : ''}`}
                        />
                        <p className="text-xs mt-1 text-[var(--text-muted)]">
                          Usate automaticamente in caso di esaurimento quota (errore 429).
                        </p>
                      </div>
                    </div>

                    {/* Section 2: Notifications */}
                    <div className="border-t border-[var(--border-subtle)] pt-6">
                      <div className="flex items-center justify-between gap-4 py-1">
                        <div className="flex items-start gap-3">
                          <Bell className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                              Notifiche di sistema
                            </h3>
                            <p className="text-xs text-[var(--text-muted)]">
                              Ricevi un avviso di Windows al completamento dell'elaborazione di ciascuna sbobina.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={notificationsEnabled}
                          onClick={() => {
                            const next = !notificationsEnabled;
                            setNotificationsEnabled(next);
                            localStorage.setItem('notifications_enabled', String(next));
                          }}
                          style={{
                            position: 'relative',
                            display: 'inline-flex',
                            alignItems: 'center',
                            width: '38px',
                            height: '22px',
                            borderRadius: '11px',
                            background: notificationsEnabled ? 'var(--success-bg)' : 'var(--border-strong)',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                            flexShrink: 0,
                            padding: 0,
                          }}
                        >
                          <span
                            style={{
                              position: 'absolute',
                              top: '3px',
                              width: '16px',
                              height: '16px',
                              borderRadius: '50%',
                              background: 'white',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                              transition: 'transform 0.2s',
                              transform: notificationsEnabled ? 'translateX(19px)' : 'translateX(3px)',
                            }}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Section 3: Version Info */}
                    <div className="border-t border-[var(--border-subtle)] pt-6 space-y-4">
                      <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border-subtle)]">
                        <div className="flex items-center gap-2">
                          <Tag className="w-4 h-4 text-[var(--accent-text)]" />
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                            Versione e Aggiornamenti
                          </h3>
                        </div>
                        <button
                          onClick={() => checkForUpdates(true)}
                          disabled={isCheckingUpdate}
                          className="icon-button modal-icon-button disabled:opacity-40 hover:bg-[var(--sidebar-active-bg)] rounded-lg p-1 transition-all"
                          style={{ width: 26, height: 26 }}
                          title="Controlla aggiornamenti"
                          aria-label="Controlla aggiornamenti"
                        >
                          {isCheckingUpdate
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-primary)]" />
                            : <RefreshCw className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                        </button>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between py-1">
                          <div className="space-y-0.5">
                            <span className="text-sm font-semibold text-[var(--text-primary)]">
                              Versione installata
                            </span>
                            <p className="text-xs text-[var(--text-muted)]">
                              L'attuale versione in esecuzione dell'applicazione.
                            </p>
                          </div>
                          <a
                            href="#"
                            onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(GITHUB_RELEASES_URL); }}
                            className="text-sm font-semibold px-2 py-0.5 rounded-md hover:opacity-85 transition-opacity"
                            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', textDecoration: 'none' }}
                            title="Note di rilascio su GitHub"
                          >
                            {APP_VERSION}
                          </a>
                        </div>
                        {latestVersion ? (
                          <VersionUpdateRow
                            latestVersion={latestVersion}
                            updateInstallState={updateInstallState}
                            onInstallUpdate={onInstallUpdate}
                          />
                        ) : hasChecked && !isCheckingUpdate && checkFailed ? (
                          <div className="flex items-center gap-1.5 text-xs pt-2 text-[var(--warning-text)]">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>Verifica aggiornamenti non riuscita. Controlla la connessione.</span>
                          </div>
                        ) : (
                          hasChecked && !isCheckingUpdate && (
                            <div className="flex items-center gap-1.5 text-xs pt-2 text-[var(--success-text)]">
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>✓ Sei aggiornato</span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'advanced' && (
                  <div className="space-y-8 animate-fade-in">
                    <div>
                      <h2 className="text-xl font-bold text-[var(--text-primary)]">Opzioni Avanzate</h2>
                      <p className="text-sm text-[var(--text-muted)] mt-1">
                        Configura modelli Gemini di riserva, gestisci la memoria e le sessioni di sbobinatura ed esegui la diagnostica.
                      </p>
                    </div>

                    {/* Section 1: Gemini Models */}
                    <div className="space-y-5">
                      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2">
                        <Cpu className="w-4 h-4 text-[var(--accent-text)]" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                          Configurazione Modelli AI
                        </h3>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-sm font-semibold text-[var(--text-primary)]">
                            Modello Primario
                          </label>
                          <CustomSelect
                            value={preferredModel}
                            onChange={handlePrimaryModelChange}
                            options={availableModels.map(m => ({ value: m.id, label: m.label, description: m.summary }))}
                          />
                          {primaryModelSummary && (
                            <p className="text-xs text-[var(--text-muted)] mt-1">{primaryModelSummary}</p>
                          )}
                        </div>

                        <div className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
                          <label className="text-sm font-semibold text-[var(--text-primary)]">
                            Fallback Modelli (in ordine di utilizzo)
                          </label>
                          <CustomSelect
                            value=""
                            onChange={val => { if (val) handleAddFallbackModel(val); }}
                            options={availableFallbackOptions
                              .filter(model => !fallbackModels.includes(model.id))
                              .map(m => ({ value: m.id, label: m.label, description: m.summary }))}
                            placeholder="Aggiungi un fallback..."
                          />
                          {fallbackModels.length > 0 ? (
                            <div className="divide-y divide-[var(--border-subtle)] mt-2">
                              {fallbackModels.map((modelId, index) => {
                                const model = availableModels.find(option => option.id === modelId);
                                if (!model) return null;
                                return (
                                  <div
                                    key={modelId}
                                    className="py-2.5 flex items-center justify-between gap-3 hover:bg-[var(--sidebar-active-bg)] transition-colors px-1"
                                  >
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-[var(--text-primary)]">{model.label}</p>
                                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{model.summary}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => moveFallbackModel(index, -1)}
                                        disabled={index === 0}
                                        className="icon-button modal-icon-button disabled:opacity-40 p-1 hover:bg-[var(--sidebar-active-bg)] rounded"
                                        style={{ width: 26, height: 26 }}
                                        title="Sposta su"
                                      >
                                        <ArrowUp className="w-4 h-4 text-[var(--text-secondary)] animate-none" />
                                      </button>
                                      <button
                                        onClick={() => moveFallbackModel(index, 1)}
                                        disabled={index === fallbackModels.length - 1}
                                        className="icon-button modal-icon-button disabled:opacity-40 p-1 hover:bg-[var(--sidebar-active-bg)] rounded"
                                        style={{ width: 26, height: 26 }}
                                        title="Sposta giù"
                                      >
                                        <ArrowDown className="w-4 h-4 text-[var(--text-secondary)] animate-none" />
                                      </button>
                                      <button
                                        onClick={() => removeFallbackModel(modelId)}
                                        className="icon-button modal-icon-button p-1 hover:bg-[var(--error-subtle)] rounded animate-none"
                                        style={{ width: 26, height: 26 }}
                                        title="Rimuovi fallback"
                                      >
                                        <X className="w-4 h-4 text-[var(--error-text)]" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-[var(--text-muted)] mt-1.5">
                              Nessun fallback aggiuntivo configurato oltre al primario.
                            </p>
                          )}
                        </div>

                        <div className="rounded-lg p-3 flex items-start gap-2.5 bg-[var(--warning-subtle)] border border-[var(--warning-ring)] mt-3">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--warning-text)]" />
                          <p className="text-xs text-[var(--warning-text)] leading-relaxed">
                            Tutti i modelli Gemini Flash possono subire rallentamenti o errori 503 nella fascia <strong>15:00–20:00</strong> per traffico elevato sui server Google, con Gemini 3 Flash generalmente più colpito. <strong>Gemini 2.5 Flash</strong> è il più stabile, ma non è immune da problemi.
                          </p>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed italic">
                          L'app cambia modello solo se il modello corrente risponde 503/UNAVAILABLE. Se passa a un fallback, resta su quello fino alla fine del job.
                        </p>
                      </div>
                    </div>

                    {/* Section 2: Session Folder & Storage */}
                    <div className="border-t border-[var(--border-subtle)] pt-6 space-y-5">
                      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2">
                        <HardDrive className="w-4 h-4 text-[var(--accent-text)]" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                          Sessioni Salvate & Archiviazione
                        </h3>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                          <FolderOpen className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                          {sessionInfo !== null ? (
                            <span className="text-sm font-semibold text-[var(--text-primary)]">
                              {sessionInfo.total_sessions} {sessionInfo.total_sessions === 1 ? 'sessione' : 'sessioni'} rilevate
                            </span>
                          ) : (
                            <span className="text-sm text-[var(--text-muted)]">
                              {isLoadingSessionInfo ? 'Caricamento info...' : 'Nessuna sessione'}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-3 py-1">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <span className="text-sm font-semibold text-[var(--text-primary)]">
                              Cartella dati sessioni
                            </span>
                            <p
                              onClick={handleOpenSessionFolder}
                              title="Apri cartella sessioni"
                              className="text-xs font-mono truncate cursor-pointer hover:underline text-[var(--text-muted)] mt-0.5 block"
                              onMouseEnter={e => { (e.currentTarget as HTMLParagraphElement).style.color = 'var(--text-primary)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLParagraphElement).style.color = 'var(--text-muted)'; }}
                            >
                              {sessionInfo?.session_root || (isLoadingSessionInfo ? '…' : '—')}
                            </p>
                          </div>
                          <div className="shrink-0 pl-2">
                            {isMoveInProgress ? (
                              <span className="text-sm flex items-center gap-1.5 text-[var(--text-muted)]">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                {moveProgress && moveProgress.total > 0
                                  ? `${moveProgress.moved}/${moveProgress.total}`
                                  : 'Spostamento…'}
                              </span>
                            ) : (
                              <button
                                onClick={() => void handleAskMoveFolder()}
                                disabled={isCleaningSession || isCleaningCompletedSessions || isLoadingSessionInfo || isMoveInProgress}
                                className="icon-button compact-icon-button disabled:opacity-50 flex items-center gap-1 hover:bg-[var(--sidebar-active-bg)] border border-[var(--border-default)]"
                                style={{ fontSize: '12px', padding: '4px 8px', height: 26, borderRadius: 6, width: 'auto' }}
                                title="Sposta cartella sessioni"
                              >
                                <ArrowRight className="w-3.5 h-3.5" />
                                Sposta…
                              </button>
                            )}
                          </div>
                        </div>
                        {moveError && (
                          <p className="text-sm text-[var(--error-text)] font-medium">{moveError}</p>
                        )}

                        <div className="flex items-center justify-between py-1 border-t border-[var(--border-subtle)] pt-4">
                          <div className="space-y-0.5">
                            <span className="text-sm font-semibold text-[var(--text-primary)]">Spazio occupato su disco</span>
                            <p className="text-xs text-[var(--text-muted)]">Spazio totale utilizzato da tutte le sessioni rilevate.</p>
                          </div>
                          <span className="text-sm font-bold text-[var(--text-primary)]">
                            {isLoadingSessionInfo ? 'Calcolo…' : sessionInfo !== null ? formatSize(sessionInfo.total_bytes) : '—'}
                          </span>
                        </div>
                      </div>

                      {/* Cleaning Tools */}
                      <div className="border-t border-[var(--border-subtle)] pt-5 space-y-4">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Strumenti di pulizia (più vecchie di {SESSION_CLEANUP_DAYS} giorni)
                        </h4>

                        <div className="space-y-1">
                          {/* Incomplete Cleanup */}
                          <div className="flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 transition-colors">
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <p className="text-sm font-semibold text-[var(--text-primary)]">
                                Pulizia elaborazioni incomplete
                              </p>
                              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                                Rimuove solo le sessioni temporanee/non terminate per liberare spazio. Le sbobine completate restano intatte.
                              </p>
                            </div>
                            <button
                              onClick={() => void handleAskCleanup()}
                              disabled={isCleaningSession || isCleaningCompletedSessions || isLoadingSessionInfo}
                              className="icon-button compact-icon-button disabled:opacity-50 shrink-0 hover:bg-[var(--sidebar-active-bg)] border border-[var(--border-default)]"
                              style={{ width: 32, height: 32, borderRadius: 6 }}
                              title={`Conta ed elimina elaborazioni incomplete più vecchie di ${SESSION_CLEANUP_DAYS} giorni`}
                              aria-label={`Conta ed elimina elaborazioni incomplete più vecchie di ${SESSION_CLEANUP_DAYS} giorni`}
                            >
                              {isCleaningSession ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                            </button>
                          </div>

                          {/* Completed Cleanup (Irreversible) */}
                          <div className="flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 bg-[var(--error-subtle)] border border-[var(--error-ring)] transition-colors">
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <p className="text-sm font-semibold text-[var(--error-text)]">
                                Elimina sbobine completate vecchie
                              </p>
                              <p className="text-xs text-[var(--error-text)] opacity-80 leading-relaxed">
                                Azione separata e irreversibile: elimina anche le sbobine completate con i relativi HTML finali.
                              </p>
                            </div>
                            <button
                              onClick={() => void handleAskCompletedCleanup()}
                              disabled={isCleaningSession || isCleaningCompletedSessions || isLoadingSessionInfo}
                              className="icon-button compact-icon-button is-danger disabled:opacity-50 shrink-0 hover:bg-[var(--error-ring)]"
                              style={{ width: 32, height: 32, borderRadius: 6, borderColor: 'transparent', background: 'transparent' }}
                              title={`Conta ed elimina sbobine completate più vecchie di ${SESSION_CLEANUP_DAYS} giorni`}
                              aria-label={`Conta ed elimina sbobine completate più vecchie di ${SESSION_CLEANUP_DAYS} giorni`}
                            >
                              {isCleaningCompletedSessions ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 text-[var(--error-text)]" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Cleanup Feedback Messages */}
                      {(cleanupResult !== null || completedCleanupResult !== null) && (
                        <div className="space-y-1.5 bg-[var(--bg-panel)] rounded-lg p-3 border border-[var(--border-subtle)] mt-2">
                          {cleanupResult !== null && (
                            <>
                              <p className="text-sm font-medium" style={{ color: cleanupResult.removed > 0 ? 'var(--success-text)' : 'var(--text-muted)' }}>
                                {cleanupResult.removed > 0
                                  ? `Rimossa ${cleanupResult.removed} elaborazione incompleta, liberati ${formatSize(cleanupResult.freed_bytes)}.`
                                  : 'Nessuna elaborazione incompleta da eliminare.'}
                              </p>
                              {(cleanupResult?.preserved_completed ?? 0) > 0 && (
                                <p className="text-xs text-[var(--text-muted)]">
                                  {cleanupResult?.preserved_completed} sbobine completate preservate.
                                </p>
                              )}
                              {(cleanupResult?.missing_completed_html ?? 0) > 0 && (
                                <p className="text-xs text-[var(--warning-text)]">
                                  {cleanupResult?.missing_completed_html} sessioni completate senza HTML finale trattate come incomplete.
                                </p>
                              )}
                            </>
                          )}
                          {completedCleanupResult !== null && (
                            <p className="text-sm font-medium" style={{ color: completedCleanupResult.removed > 0 ? 'var(--success-text)' : 'var(--text-muted)' }}>
                              {completedCleanupResult.removed > 0
                                ? `Eliminate ${completedCleanupResult.removed} sbobine completate, liberati ${formatSize(completedCleanupResult.freed_bytes)}.`
                                : 'Nessuna sbobina completata vecchia da eliminare.'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Section 3: Diagnostics */}
                    <div className="border-t border-[var(--border-subtle)] pt-6 space-y-5">
                      <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border-subtle)]">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                            Diagnostica e Stato Sistema
                          </h3>
                        </div>
                        <button
                          onClick={runEnvironmentValidation}
                          disabled={isValidatingEnvironment}
                          className="icon-button compact-icon-button disabled:opacity-50 hover:bg-[var(--sidebar-active-bg)] border border-[var(--border-default)]"
                          style={{ width: 26, height: 26, borderRadius: 6 }}
                          title="Verifica ambiente"
                          aria-label="Verifica ambiente"
                        >
                          {isValidatingEnvironment
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-primary)]" />
                            : <FlaskConical className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                        </button>
                      </div>

                      <div className="space-y-4">
                        <ul className="space-y-2.5 py-1">
                          <li className="flex justify-between text-sm text-[var(--text-secondary)] py-1 border-b border-[var(--border-subtle)] last:border-0">
                            <span className="font-medium">Modello primario</span>
                            <span className="font-semibold text-[var(--text-primary)]">{preferredModel}</span>
                          </li>
                          <li className="flex justify-between text-sm text-[var(--text-secondary)] py-1 border-b border-[var(--border-subtle)] last:border-0">
                            <span className="font-medium">Fallback configurati</span>
                            <span className="font-semibold text-[var(--text-primary)]">{fallbackModels.join(' → ') || 'nessuno'}</span>
                          </li>
                          <li className="flex justify-between text-sm text-[var(--text-secondary)] py-1 border-b border-[var(--border-subtle)] last:border-0">
                            <span className="font-medium">Dimensione chunk audio</span>
                            <span className="font-semibold text-[var(--text-primary)]">{defaultChunkMinutes} min</span>
                          </li>
                          <li className="flex justify-between text-sm text-[var(--text-secondary)] py-1 border-b border-[var(--border-subtle)] last:border-0">
                            <span className="font-medium">Temperatura (Fase 1)</span>
                            <span className="font-semibold text-[var(--text-primary)]">{defaultTemperature}</span>
                          </li>
                        </ul>

                        {validationResult && (
                          <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]">
                            <p className="text-sm font-bold" style={{ color: validationResult.ok ? 'var(--success-text)' : 'var(--error-text)' }}>
                              {validationResult.summary}
                            </p>
                            {validationResult.checks.map(check => (
                              <div
                                key={check.id}
                                className="rounded-lg p-3 bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-sm font-semibold text-[var(--text-primary)]">{check.label}</span>
                                  <span
                                    className="text-xs font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
                                    style={{
                                      color: check.status === 'ok' ? 'var(--success-text)' : check.status === 'warning' ? 'var(--warning-text)' : 'var(--error-text)',
                                      background: check.status === 'ok' ? 'var(--success-subtle)' : check.status === 'warning' ? 'var(--warning-subtle)' : 'var(--error-subtle)',
                                    }}
                                  >
                                    {check.status}
                                  </span>
                                </div>
                                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{check.message}</p>
                                {check.details && (
                                  <p className="text-xs font-mono break-all whitespace-pre-wrap text-[var(--text-muted)] bg-[var(--bg-input)] p-1.5 rounded mt-1 border border-[var(--border-subtle)]">
                                    {check.details}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Shared Sticky Modal Footer inside content panel */}
              <div className="px-6 py-4 md:px-8 bg-[var(--bg-surface)] shrink-0 border-t border-[var(--border-subtle)] flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {saveError && (
                    <p className="text-sm text-[var(--error-text)] font-semibold truncate">
                      {saveError}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={handleClose}
                    disabled={isSaving}
                    className="modal-action-button text-sm px-4 py-2 hover:bg-[var(--sidebar-active-bg)] rounded-lg text-[var(--text-secondary)] font-semibold transition-all disabled:opacity-40"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={saveSettings}
                    disabled={isSaving}
                    className="modal-action-button is-primary text-sm px-5 py-2.5 bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-white font-bold rounded-lg shadow-md transition-all disabled:opacity-40"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : 'Salva e Chiudi'}
                  </button>
                </div>
              </div>

            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
    <ConfirmActionModal
      isOpen={showCleanupConfirm}
      title="Eliminare le elaborazioni incomplete vecchie?"
      description={`Questa operazione elimina le elaborazioni incomplete più vecchie di ${SESSION_CLEANUP_DAYS} giorni. Sbobine interessate: ${cleanupPreview?.candidates ?? 0}. Spazio stimato: ${formatSize(cleanupPreview?.freed_bytes ?? 0)}. L'operazione è irreversibile.`}
      confirmLabel="Elimina incomplete"
      cancelLabel="Annulla"
      onClose={() => setShowCleanupConfirm(false)}
      onConfirm={() => { setShowCleanupConfirm(false); void handleCleanupSessions(); }}
    />
    <ConfirmActionModal
      isOpen={showCompletedCleanupConfirm}
      title="Eliminare le sbobine completate vecchie?"
      description={`Questa operazione elimina le sbobine completate più vecchie di ${SESSION_CLEANUP_DAYS} giorni. Sbobine interessate: ${completedCleanupPreview?.candidates ?? 0}. Spazio stimato: ${formatSize(completedCleanupPreview?.freed_bytes ?? 0)}. L'operazione è irreversibile.`}
      confirmLabel="Elimina sbobine completate"
      cancelLabel="Annulla"
      onClose={() => setShowCompletedCleanupConfirm(false)}
      onConfirm={() => { setShowCompletedCleanupConfirm(false); void handleCleanupCompletedSessions(); }}
    />
    <ConfirmActionModal
      isOpen={showMoveConfirm}
      title="Spostare la cartella sessioni?"
      description={`Tutte le sessioni verranno spostate in:
${pendingMovePath ?? ''}

L'operazione è rapida se la destinazione è sullo stesso disco.`}
      confirmLabel="Sposta"
      cancelLabel="Annulla"
      onClose={() => { setShowMoveConfirm(false); setPendingMovePath(null); }}
      onConfirm={() => { void handleConfirmMove(); }}
    />
    </>
  );
}
