import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConfirmActionModal } from './ConfirmActionModal';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, AlertCircle, AlertTriangle, ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, Bell, ChevronDown, Cpu, Eye, EyeOff, FlaskConical, FolderOpen, HardDrive, Loader2, RefreshCw, Settings, SlidersHorizontal, Tag, Trash2, X, Zap } from 'lucide-react';
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
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const selectedLabel = options.find(o => o.value === value)?.label;
  const displayLabel = selectedLabel ?? placeholder ?? '';

  const dropdown = open ? createPortal(
    <div
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
          className="w-full text-left px-4 py-1.5 text-xs"
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
          <span className="block text-xs">{opt.label}</span>
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
        className="app-input text-xs flex items-center justify-between gap-2 cursor-pointer"
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
    <div className="space-y-1.5 pt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm flex items-center gap-1.5 min-w-0" style={{ color: 'var(--warning-text)' }}>
          <Zap className="w-3.5 h-3.5 shrink-0" />
          Nuova versione disponibile: <strong>{latestVersion}</strong>
        </p>
        <button
          onClick={() => void handleInstall()}
          disabled={isInstalling}
          className="icon-button modal-icon-button shrink-0"
          title={isInstalling ? 'Installazione in corso…' : 'Installa aggiornamento'}
          aria-label={isInstalling ? 'Installazione in corso…' : 'Installa aggiornamento'}
        >
          {isInstalling
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <ArrowDownToLine className="w-4 h-4" />}
        </button>
      </div>
      {statusMessage && (
        <p
          className="text-xs flex items-center gap-1.5"
          style={{ color: isError ? 'var(--error-text)' : isDone ? 'var(--success-text)' : 'var(--text-muted)' }}
        >
          {isError ? <AlertCircle className="w-3.5 h-3.5 shrink-0" /> : null}
          <span>{statusMessage}</span>
          {isError && (
            <button
              type="button"
              onClick={() => { void window.pywebview?.api?.open_url?.(GITHUB_RELEASES_URL); }}
              className="underline"
              style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}
            >
              Apri GitHub
            </button>
          )}
        </p>
      )}
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('notifications_enabled') !== 'false');
  const [showApiKeys, setShowApiKeys] = useState(false);
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [showCompletedCleanupConfirm, setShowCompletedCleanupConfirm] = useState(false);

  const [isMoveInProgress, setIsMoveInProgress] = useState(false);
  const [moveProgress, setMoveProgress] = useState<{ moved: number; total: number } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [showMoveConfirm, setShowMoveConfirm] = useState(false);
  const [pendingMovePath, setPendingMovePath] = useState<string | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isSavingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const handleClose = () => { if (isSavingRef.current) return; onClose(); };

  useEffect(() => {
    if (isOpen) checkForUpdates(false);
  }, [isOpen, checkForUpdates]);

  useEffect(() => {
    if (!isOpen) {
      setIsAdvancedOpen(false);
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
    return () => { aborted = true; };
  }, [isOpen]);

  const handleOpenSessionFolder = () => {
    window.pywebview?.api?.open_session_folder?.();
  };

  async function pollMoveStatus() {
    try {
      const res = await window.pywebview?.api?.get_session_move_status?.();
      if (!res) return;
      if (res.status === 'moving') {
        setMoveProgress({ moved: res.moved ?? 0, total: res.total ?? 0 });
        moveTimerRef.current = setTimeout(() => void pollMoveStatus(), 500);
      } else if (res.status === 'done') {
        setIsMoveInProgress(false);
        setMoveProgress(null);
        try {
          const info = await window.pywebview?.api?.get_session_storage_info?.();
          if (info?.ok) setSessionInfo({ total_bytes: info.total_bytes ?? 0, total_sessions: info.total_sessions ?? 0, session_root: info.session_root ?? '' });
        } catch { /* non-critical refresh */ }
      } else if (res.status === 'error') {
        setIsMoveInProgress(false);
        setMoveProgress(null);
        setMoveError(res.error ?? 'Errore sconosciuto');
      } else {
        setIsMoveInProgress(false);
        setMoveProgress(null);
        setMoveError(`Stato imprevisto: ${String(res.status)}`);
      }
    } catch { /* ignore polling errors */ }
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
      appendConsole(`❌ Conteggio sbobine incomplete fallito: ${getErrorMessage(e)}`);
    }
    setIsCleaningSession(false);
  };

  const handleCleanupSessions = async () => {
    if (!window.pywebview?.api?.cleanup_old_sessions) return;
    setShowCleanupConfirm(false);
    setIsCleaningSession(true);
    setCleanupResult(null);
    try {
      const res = await window.pywebview.api.cleanup_old_sessions(SESSION_CLEANUP_DAYS, false);
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
            if (info?.ok) setSessionInfo({ total_bytes: info.total_bytes ?? 0, total_sessions: info.total_sessions ?? 0, session_root: info.session_root ?? '' });
          } catch {}
        }
      } else {
        appendConsole(`❌ Pulizia sessioni fallita: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      appendConsole(`❌ Pulizia sessioni fallita: ${getErrorMessage(e)}`);
    }
    setIsCleaningSession(false);
  };

  const handleAskCompletedCleanup = async () => {
    if (!window.pywebview?.api?.cleanup_completed_sessions || isCleaningCompletedSessions) return;
    setIsCleaningCompletedSessions(true);
    setCompletedCleanupPreview(null);
    try {
      const res = await window.pywebview.api.cleanup_completed_sessions(SESSION_CLEANUP_DAYS, true);
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
      appendConsole(`❌ Conteggio sbobine completate fallito: ${getErrorMessage(e)}`);
    }
    setIsCleaningCompletedSessions(false);
  };

  const handleCleanupCompletedSessions = async () => {
    if (!window.pywebview?.api?.cleanup_completed_sessions) return;
    setShowCompletedCleanupConfirm(false);
    setIsCleaningCompletedSessions(true);
    setCompletedCleanupResult(null);
    try {
      const res = await window.pywebview.api.cleanup_completed_sessions(SESSION_CLEANUP_DAYS, false);
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
            if (info?.ok) setSessionInfo({ total_bytes: info.total_bytes ?? 0, total_sessions: info.total_sessions ?? 0, session_root: info.session_root ?? '' });
          } catch {}
        }
      } else {
        appendConsole(`❌ Eliminazione sbobine completate fallita: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      appendConsole(`❌ Eliminazione sbobine completate fallita: ${getErrorMessage(e)}`);
    }
    setIsCleaningCompletedSessions(false);
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
      if (!response?.ok || !response.result) {
        appendConsole(`❌ Validazione ambiente fallita: ${response?.error || 'errore sconosciuto'}`);
        setValidationResult(null);
        return;
      }
      setValidationResult(response.result);
      appendConsole(response.result.summary);
    } catch (error: unknown) {
      appendConsole(`❌ Validazione ambiente fallita: ${getErrorMessage(error)}`);
      setValidationResult(null);
    } finally {
      setIsValidatingEnvironment(false);
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
        setSaveError(err);
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
        setSaveError(err);
        appendConsole(`❌ ${err}`);
        return;
      }
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
      setIsSaving(false);
    }
  };

  const availableFallbackOptions = availableModels.filter(model => model.id !== preferredModel);
  const primaryModelSummary = availableModels.find(m => m.id === preferredModel)?.summary;
  const defaultChunkMinutes = availableModels.find(m => m.id === preferredModel)?.default_chunk_minutes ?? 15;
  const defaultTemperature = availableModels.find(m => m.id === preferredModel)?.phase1_temperature ?? 0.35;

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
            className="modal-card relative w-full max-w-md max-h-[86vh] overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Settings className="w-5 h-5" style={{ color: 'var(--text-muted)' }} /> Impostazioni
              </h2>
              <button
                onClick={handleClose}
                disabled={isSaving}
                className="icon-button modal-icon-button disabled:opacity-40"
                aria-label="Chiudi impostazioni"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="app-scroll flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 space-y-6">
              {/* 1. API Key + inline validation */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Google Gemini API Key (Principale)</label>
                  <button
                    onClick={() => setShowApiKeys(!showApiKeys)}
                    className="opacity-50 hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px' }}
                    title={showApiKeys ? 'Nascondi chiave' : 'Mostra chiave'}
                  >
                    {showApiKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <input
                  type={showApiKeys ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="AIzaSy... oppure AQ..."
                  className="app-input font-mono text-sm"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                />
                {apiKey.trim() && (
                  <p className="text-xs mt-1.5" style={{ color: GEMINI_KEY_PATTERN.test(apiKey.trim()) ? 'var(--success-text)' : 'var(--warning-text)' }}>
                    {GEMINI_KEY_PATTERN.test(apiKey.trim()) ? '✓ Formato valido' : '⚠ Formato non valido — le chiavi iniziano con AIzaSy... o AQ.'}
                  </p>
                )}
                <p className="text-xs mt-2 flex items-start gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <AlertCircle className="w-4 h-4 shrink-0" /> Salvata in modo sicuro tramite DPAPI (Windows) o Keyring (Mac/Linux).
                </p>
                <a
                  href="#"
                  onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.('https://aistudio.google.com/apikey'); }}
                  className="text-xs mt-1 inline-flex items-center gap-1 hover:opacity-100 opacity-70"
                  style={{ color: 'var(--accent-text, var(--text-secondary))' }}
                >
                  → Ottieni gratis su aistudio.google.com
                </a>
              </div>

              {/* 2. Fallback Keys */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>API Keys di Riserva (Fallback)</label>
                  <button
                    onClick={() => setShowApiKeys(!showApiKeys)}
                    className="opacity-50 hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px' }}
                    title={showApiKeys ? 'Nascondi chiavi' : 'Mostra chiavi'}
                  >
                    {showApiKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <textarea
                  value={fallbackKeys.join('\n')}
                  onChange={e => setFallbackKeys(e.target.value.split('\n'))}
                  placeholder="Inserisci una API Key per riga..."
                  rows={3}
                  className={`app-textarea font-mono text-sm ${!showApiKeys ? 'obscured-text' : ''}`}
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                />
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Usate automaticamente in caso di esaurimento quota (429).</p>
              </div>

              {/* 3. Notifiche */}
              <div className="space-y-4" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <Bell className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    Notifiche di sistema
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Avviso Windows al completamento di ogni sbobina</p>
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
                    width: '40px',
                    height: '24px',
                    borderRadius: '12px',
                    background: notificationsEnabled ? 'var(--success-text)' : 'var(--border-default)',
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
                      top: '4px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      background: 'white',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      transition: 'transform 0.2s',
                      transform: notificationsEnabled ? 'translateX(20px)' : 'translateX(4px)',
                    }}
                  />
                </button>
              </div>

              </div>

              {/* 4. Versione */}
              <div className="space-y-3" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Tag className="w-3.5 h-3.5" />
                    Versione
                  </h3>
                  <button
                    onClick={() => checkForUpdates(true)}
                    disabled={isCheckingUpdate}
                    className="icon-button modal-icon-button disabled:opacity-40"
                    style={{ width: 26, height: 26, borderRadius: 8 }}
                    title="Controlla aggiornamenti"
                    aria-label="Controlla aggiornamenti"
                  >
                    {isCheckingUpdate
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="rounded-[10px] px-4 py-3 space-y-2" style={{ background: 'var(--card-queued-bg)', border: '1px solid var(--card-queued-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Versione corrente</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{APP_VERSION}</span>
                      <a
                        href="#"
                        onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(GITHUB_RELEASES_URL); }}
                        className="text-xs opacity-60 hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--accent-text, var(--text-secondary))', textDecoration: 'none' }}
                        title="Apri note di rilascio su GitHub"
                      >
                        Vedi novità →
                      </a>
                    </div>
                  </div>
                  {latestVersion ? (
                    <VersionUpdateRow
                      latestVersion={latestVersion}
                      updateInstallState={updateInstallState}
                      onInstallUpdate={onInstallUpdate}
                    />
                  ) : hasChecked && !isCheckingUpdate && checkFailed ? (
                    <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--warning-text)' }}>
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      Verifica aggiornamenti non riuscita
                    </p>
                  ) : (
                    hasChecked && !isCheckingUpdate && (
                      <p className="text-xs" style={{ color: 'var(--success-text)' }}>✓ Sei aggiornato</p>
                    )
                  )}
                </div>
              </div>

              {/* Avanzati */}
              <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => setIsAdvancedOpen(v => !v)}
                  className="w-full flex items-center justify-between"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    Avanzati
                  </h3>
                  <ChevronDown
                    className="w-4 h-4 shrink-0 transition-transform"
                    style={{ color: 'var(--text-muted)', transform: isAdvancedOpen ? 'rotate(180deg)' : undefined }}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isAdvancedOpen && (
                    <motion.div
                      key="advanced-panel"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div className="space-y-6 pt-4">
                        {/* Modello Gemini */}
                        <div>
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                              <Cpu className="w-3.5 h-3.5" />
                              Modello Gemini
                            </h3>
                          </div>
                          <div className="rounded-[10px] px-4 py-3 space-y-5" style={{ background: 'var(--card-queued-bg)', border: '1px solid var(--card-queued-border)' }}>
                            <div className="space-y-4">
                              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '10px' }}>Modello primario</label>
                              <CustomSelect
                                value={preferredModel}
                                onChange={handlePrimaryModelChange}
                                options={availableModels.map(m => ({ value: m.id, label: m.label, description: m.summary }))}
                              />
                              {primaryModelSummary && (
                                <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 4 }}>{primaryModelSummary}</p>
                              )}
                            </div>
                            <div className="space-y-4">
                              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '10px' }}>Fallback modelli</label>
                              <CustomSelect
                                value=""
                                onChange={val => { if (val) handleAddFallbackModel(val); }}
                                options={availableFallbackOptions
                                  .filter(model => !fallbackModels.includes(model.id))
                                  .map(m => ({ value: m.id, label: m.label, description: m.summary }))}
                                placeholder="Aggiungi un fallback..."
                              />
                              {fallbackModels.length > 0 ? (
                                <div className="space-y-2">
                                  {fallbackModels.map((modelId, index) => {
                                    const model = availableModels.find(option => option.id === modelId);
                                    if (!model) return null;
                                    return (
                                      <div
                                        key={modelId}
                                        className="rounded-[8px] px-3 py-2 flex items-start justify-between gap-3"
                                        style={{ background: 'var(--card-queued-bg)', border: '1px solid var(--card-queued-border)' }}
                                      >
                                        <div className="min-w-0">
                                          <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{model.label}</p>
                                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{model.summary}</p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                          <button
                                            onClick={() => moveFallbackModel(index, -1)}
                                            disabled={index === 0}
                                            className="icon-button modal-icon-button disabled:opacity-40"
                                            title="Sposta su"
                                          >
                                            <ArrowUp className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() => moveFallbackModel(index, 1)}
                                            disabled={index === fallbackModels.length - 1}
                                            className="icon-button modal-icon-button disabled:opacity-40"
                                            title="Sposta giù"
                                          >
                                            <ArrowDown className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() => removeFallbackModel(modelId)}
                                            className="icon-button modal-icon-button"
                                            title="Rimuovi fallback"
                                          >
                                            <X className="w-4 h-4" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  Nessun fallback aggiuntivo configurato oltre al primario.
                                </p>
                              )}
                            </div>
                            <div className="rounded-lg px-3 py-2.5 flex items-start gap-2" style={{ background: 'var(--warning-subtle)', border: '1px solid var(--warning-ring, var(--border-default))' }}>
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--warning-text)' }} />
                              <p className="text-xs" style={{ color: 'var(--warning-text)' }}>
                                Tutti i modelli Gemini Flash possono subire rallentamenti o errori 503 nella fascia <strong>15:00–20:00</strong> per traffico elevato sui server Google, con Gemini 3 Flash generalmente più colpito. <strong>Gemini 2.5 Flash</strong> è il più stabile, ma non è immune da problemi.
                              </p>
                            </div>
                            <p className="text-xs" style={{ color: 'var(--text-faint, var(--text-muted))' }}>
                              L'app cambia modello solo se il modello corrente risponde 503/UNAVAILABLE. Se passa a un fallback, resta su quello fino alla fine del job.
                            </p>
                          </div>
                        </div>

                        {/* Sessioni salvate */}
                        <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <div className="flex items-center gap-1.5 mb-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                              <HardDrive className="w-3.5 h-3.5" />
                              Sessioni salvate
                            </h3>
                          </div>
                          <div className="rounded-[10px] px-4 py-3 space-y-4" style={{ background: 'var(--card-queued-bg)', border: '1px solid var(--card-queued-border)' }}>
                            {/* Informazioni Cartella e Sessioni */}
                            {/* Informazioni Cartella e Sessioni */}
                            <div className="space-y-2">
                              <div className="flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                                <FolderOpen className="w-4 h-4 shrink-0" />
                                {sessionInfo !== null ? (
                                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {sessionInfo.total_sessions} {sessionInfo.total_sessions === 1 ? 'sessione' : 'sessioni'}
                                  </span>
                                ) : (
                                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {isLoadingSessionInfo ? 'Caricamento...' : 'Nessuna sessione'}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px]" style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Percorso cartella:</p>
                                  <p
                                    onClick={handleOpenSessionFolder}
                                    title="Apri cartella sessioni"
                                    className="text-xs font-mono truncate cursor-pointer hover:underline"
                                    style={{
                                      color: 'var(--text-faint, var(--text-muted))',
                                    }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLParagraphElement).style.color = 'var(--text-primary)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLParagraphElement).style.color = 'var(--text-faint, var(--text-muted))'; }}
                                  >
                                    {sessionInfo?.session_root || (isLoadingSessionInfo ? '…' : '—')}
                                  </p>
                                </div>
                                <div className="shrink-0 pt-3">
                                  {isMoveInProgress ? (
                                    <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      {moveProgress && moveProgress.total > 0
                                        ? `${moveProgress.moved}/${moveProgress.total}`
                                        : 'Spostamento…'}
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => void handleAskMoveFolder()}
                                      disabled={isCleaningSession || isCleaningCompletedSessions || isLoadingSessionInfo || isMoveInProgress}
                                      className="icon-button compact-icon-button disabled:opacity-50 flex items-center gap-1"
                                      style={{ fontSize: '11px', padding: '2px 7px', height: 22, borderRadius: 6, width: 'auto' }}
                                      title="Sposta cartella sessioni"
                                    >
                                      <ArrowRight className="w-3 h-3" />
                                      Sposta…
                                    </button>
                                  )}
                                </div>
                              </div>
                              {moveError && (
                                <p className="text-xs" style={{ color: 'var(--error-text)' }}>{moveError}</p>
                              )}

                              <div className="text-xs pt-1" style={{ color: 'var(--text-muted)' }}>
                                Spazio totale occupato:{" "}
                                <span className="font-semibold ml-1" style={{ color: 'var(--text-primary)' }}>
                                  {isLoadingSessionInfo ? 'Calcolo…' : sessionInfo !== null ? formatSize(sessionInfo.total_bytes) : '—'}
                                </span>
                              </div>
                            </div>

                            {/* Separatore */}
                            <div style={{ borderTop: '1px solid var(--border-subtle)', opacity: 0.6 }} />

                            {/* Strumenti di Pulizia */}
                            <div className="space-y-2.5">
                              <h4 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                Strumenti di pulizia (più vecchie di {SESSION_CLEANUP_DAYS} giorni)
                              </h4>

                              {/* Pulizia Incomplete */}
                              <div className="flex items-center justify-between gap-3 rounded-[8px] px-3 py-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Pulizia elaborazioni incomplete</p>
                                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)', lineHeight: '1.3' }}>
                                    Rimuove solo le sessioni non terminate per liberare spazio. Le note completate non vengono toccate.
                                  </p>
                                </div>
                                <button
                                  onClick={() => void handleAskCleanup()}
                                  disabled={isCleaningSession || isCleaningCompletedSessions || isLoadingSessionInfo}
                                  className="icon-button compact-icon-button disabled:opacity-50 shrink-0"
                                  title={`Conta ed elimina elaborazioni incomplete più vecchie di ${SESSION_CLEANUP_DAYS} giorni`}
                                  aria-label={`Conta ed elimina elaborazioni incomplete più vecchie di ${SESSION_CLEANUP_DAYS} giorni`}
                                >
                                  {isCleaningSession ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                </button>
                              </div>

                              {/* Pulizia Completate (Azione Irreversibile) */}
                              <div
                                className="flex items-center justify-between gap-3 rounded-[8px] px-3 py-2"
                                style={{
                                  background: 'var(--error-subtle)',
                                  border: '1px solid var(--error-ring)',
                                }}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium" style={{ color: 'var(--error-text)' }}>Elimina sbobine completate vecchie</p>
                                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)', lineHeight: '1.3' }}>
                                    Azione separata e irreversibile: elimina anche le note finite.
                                  </p>
                                </div>
                                <button
                                  onClick={() => void handleAskCompletedCleanup()}
                                  disabled={isCleaningSession || isCleaningCompletedSessions || isLoadingSessionInfo}
                                  className="icon-button compact-icon-button is-danger disabled:opacity-50 shrink-0"
                                  style={{
                                    borderColor: 'transparent',
                                    background: 'transparent',
                                  }}
                                  onMouseEnter={e => {
                                    const btn = e.currentTarget as HTMLButtonElement;
                                    btn.style.borderColor = 'var(--error-ring)';
                                    btn.style.background = 'var(--error-subtle)';
                                  }}
                                  onMouseLeave={e => {
                                    const btn = e.currentTarget as HTMLButtonElement;
                                    btn.style.borderColor = 'transparent';
                                    btn.style.background = 'transparent';
                                  }}
                                  title={`Conta ed elimina sbobine completate più vecchie di ${SESSION_CLEANUP_DAYS} giorni`}
                                  aria-label={`Conta ed elimina sbobine completate più vecchie di ${SESSION_CLEANUP_DAYS} giorni`}
                                >
                                  {isCleaningCompletedSessions ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>

                            {/* Messaggi di feedback */}
                            {(cleanupResult !== null || completedCleanupResult !== null) && (
                              <div className="space-y-1.5 pt-1">
                                {cleanupResult !== null && (
                                  <>
                                    <p className="text-xs" style={{ color: cleanupResult.removed > 0 ? 'var(--success-text)' : 'var(--text-muted)' }}>
                                      {cleanupResult.removed > 0
                                        ? `Rimoss${cleanupResult.removed === 1 ? 'a' : 'e'} ${cleanupResult.removed} ${cleanupResult.removed === 1 ? 'elaborazione incompleta' : 'elaborazioni incomplete'}, liberati ${formatSize(cleanupResult.freed_bytes)}.`
                                        : 'Nessuna elaborazione incompleta da eliminare.'}
                                    </p>
                                    {(cleanupResult?.preserved_completed ?? 0) > 0 && (
                                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                        {cleanupResult?.preserved_completed} {cleanupResult?.preserved_completed === 1 ? 'sbobina completata preservata' : 'sbobine completate preservate'}.
                                      </p>
                                    )}
                                    {(cleanupResult?.missing_completed_html ?? 0) > 0 && (
                                      <p className="text-xs" style={{ color: 'var(--warning-text)' }}>
                                        {cleanupResult?.missing_completed_html} {cleanupResult?.missing_completed_html === 1 ? 'sessione completata senza HTML finale è stata trattata come incompleta' : 'sessioni completate senza HTML finale sono state trattate come incomplete'}.
                                      </p>
                                    )}
                                  </>
                                )}
                                {completedCleanupResult !== null && (
                                  <p className="text-xs" style={{ color: completedCleanupResult.removed > 0 ? 'var(--success-text)' : 'var(--text-muted)' }}>
                                    {completedCleanupResult.removed > 0
                                      ? `Eliminat${completedCleanupResult.removed === 1 ? 'a' : 'e'} ${completedCleanupResult.removed} ${completedCleanupResult.removed === 1 ? 'sbobina completata' : 'sbobine completate'}, liberati ${formatSize(completedCleanupResult.freed_bytes)}.`
                                      : 'Nessuna sbobina completata vecchia da eliminare.'}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Diagnostica */}
                        <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                              <Activity className="w-3.5 h-3.5" />
                              Diagnostica
                            </h3>
                            <button
                              onClick={runEnvironmentValidation}
                              disabled={isValidatingEnvironment}
                              className="icon-button compact-icon-button disabled:opacity-50"
                              title="Verifica ambiente"
                              aria-label="Verifica ambiente"
                            >
                              {isValidatingEnvironment ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                            </button>
                          </div>
                          <div className="rounded-[10px] px-4 py-3 space-y-3" style={{ background: 'var(--card-queued-bg)', border: '1px solid var(--card-queued-border)' }}>
                            <ul className="space-y-1.5">
                              <li className="flex justify-between text-xs" style={{ color: 'var(--text-faint)' }}><span>Modello primario:</span> <span>{preferredModel}</span></li>
                              <li className="flex justify-between text-xs" style={{ color: 'var(--text-faint)' }}><span>Fallback:</span> <span>{fallbackModels.join(' -> ') || 'nessuno'}</span></li>
                              <li className="flex justify-between text-xs" style={{ color: 'var(--text-faint)' }}><span>Chunk:</span> <span>{defaultChunkMinutes} min</span></li>
                              <li className="flex justify-between text-xs" style={{ color: 'var(--text-faint)' }}><span>Temperatura (phase 1):</span> <span>{defaultTemperature}</span></li>
                            </ul>
                            {validationResult && (
                              <div className="space-y-2 text-sm pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                <p style={{ color: validationResult.ok ? 'var(--success-text)' : 'var(--error-text)' }}>{validationResult.summary}</p>
                                {validationResult.checks.map(check => (
                                  <div key={check.id} className="rounded-lg px-3 py-2 overflow-hidden" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                                    <div className="flex items-center justify-between gap-3">
                                      <span style={{ color: 'var(--text-primary)' }}>{check.label}</span>
                                      <span style={{ color: check.status === 'ok' ? 'var(--success-text)' : check.status === 'warning' ? 'var(--warning-text)' : 'var(--error-text)' }}>
                                        {check.status.toUpperCase()}
                                      </span>
                                    </div>
                                    <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>{check.message}</p>
                                    {check.details && (
                                      <p className="mt-1 text-xs font-mono break-all whitespace-pre-wrap" style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <div className="px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {saveError && (
                <p className="text-xs mb-3" style={{ color: 'var(--error-text)' }}>{saveError}</p>
              )}
              <button
                onClick={saveSettings}
                disabled={isSaving}
                className="modal-action-button is-primary w-full"
              >
                Salva e Chiudi
              </button>
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
