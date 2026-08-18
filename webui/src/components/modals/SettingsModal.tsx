import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, SlidersHorizontal, Loader2 } from 'lucide-react';
import type { ModelOption, ValidationResult } from '../../bridge';
import { ConfirmActionModal } from './ConfirmActionModal';
import { ApiKeySection } from './settings/ApiKeySection';
import { ModelSection } from './settings/ModelSection';
import { StorageSection } from './settings/StorageSection';
import { DiagnosticsSection, type DisplayCheck } from './settings/DiagnosticsSection';
import { UpdaterSection, type SettingsUpdateInstallState } from './settings/UpdaterSection';

export type { SettingsUpdateInstallState };

const SESSION_CLEANUP_DAYS = 30;

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  hasProtectedKey: boolean;
  fallbackKeys: string[];
  setFallbackKeys: React.Dispatch<React.SetStateAction<string[]>>;
  preferredModel: string;
  setPreferredModel: (model: string) => void;
  fallbackModels: string[];
  setFallbackModels: React.Dispatch<React.SetStateAction<string[]>>;
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
  onSessionRootMoved?: (payload?: { oldRoot?: string; newRoot?: string }) => void;
}

type TabType = 'general' | 'advanced';

export const SettingsModal: React.FC<SettingsModalProps> = ({
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
  onSessionRootMoved,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [apiKeyInsecure, setApiKeyInsecure] = useState(false);
  const [apiKeyInsecureReason, setApiKeyInsecureReason] = useState('');

  const [sessionInfo, setSessionInfo] = useState<{ total_bytes: number; total_sessions: number; session_root: string } | null>(null);
  const [isLoadingSessionInfo, setIsLoadingSessionInfo] = useState(false);
  const [isMoveInProgress, setIsMoveInProgress] = useState(false);
  const [moveProgress, setMoveProgress] = useState<{ moved: number; total: number } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [pendingMovePath, setPendingMovePath] = useState<string | null>(null);
  const [showMoveConfirm, setShowMoveConfirm] = useState(false);

  const [isCleaningSession, setIsCleaningSession] = useState(false);
  const [isCleaningCompletedSessions, setIsCleaningCompletedSessions] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [showCompletedCleanupConfirm, setShowCompletedCleanupConfirm] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<{ removed: number; freed_bytes: number; candidates?: number } | null>(null);
  const [completedCleanupPreview, setCompletedCleanupPreview] = useState<{ removed: number; freed_bytes: number; candidates?: number } | null>(null);
  const [cleanupResult, setCleanupResult] = useState<{ removed: number; freed_bytes: number; candidates?: number; preserved_completed?: number; missing_completed_html?: number } | null>(null);
  const [completedCleanupResult, setCompletedCleanupResult] = useState<{ removed: number; freed_bytes: number; candidates?: number } | null>(null);

  const [isValidatingEnvironment, setIsValidatingEnvironment] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const isMountedRef = useRef(true);
  const isOpenRef = useRef(isOpen);
  const isSavingRef = useRef(false);
  const sessionInfoReqIdRef = useRef(0);
  const moveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevSettingsKeyRef = useRef<string>('');

  useEffect(() => {
    const key = `${apiKey}|${preferredModel}|${fallbackModels.join(',')}`;
    if (prevSettingsKeyRef.current && prevSettingsKeyRef.current !== key) {
      setValidationResult(null);
    }
    prevSettingsKeyRef.current = key;
  }, [apiKey, preferredModel, fallbackModels]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchSessionStorageInfo = useCallback(() => {
    if (!window.pywebview?.api?.get_session_storage_info) return;
    const reqId = ++sessionInfoReqIdRef.current;
    setIsLoadingSessionInfo(true);
    setSessionInfo(null);
    window.pywebview.api.get_session_storage_info()
      .then(res => {
        if (!isOpenRef.current || !isMountedRef.current || reqId !== sessionInfoReqIdRef.current) return;
        if (res?.ok) {
          setSessionInfo({
            total_bytes: res.total_bytes ?? 0,
            total_sessions: res.total_sessions ?? 0,
            session_root: res.session_root ?? '',
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isOpenRef.current && isMountedRef.current && reqId === sessionInfoReqIdRef.current) {
          setIsLoadingSessionInfo(false);
        }
      });
  }, []);

  async function pollMoveStatus() {
    try {
      const res = await window.pywebview?.api?.get_session_move_status?.();
      if (!res || !isOpenRef.current || !isMountedRef.current) return;
      if (res.status === 'moving') {
        setMoveProgress({ moved: res.moved ?? 0, total: res.total ?? 0 });
        moveTimerRef.current = setTimeout(() => void pollMoveStatus(), 500);
      } else if (res.status === 'done') {
        setIsMoveInProgress(false);
        setMoveProgress(null);
        if (window.pywebview?.api?.get_session_storage_info) {
          const info = await window.pywebview.api.get_session_storage_info();
          if (info?.ok && isOpenRef.current && isMountedRef.current) {
            setSessionInfo({
              total_bytes: info.total_bytes ?? 0,
              total_sessions: info.total_sessions ?? 0,
              session_root: info.session_root ?? '',
            });
          }
        }
        onSessionRootMoved?.({
          oldRoot: res.old_root,
          newRoot: res.new_root,
        });
      } else if (res.status === 'error') {
        setIsMoveInProgress(false);
        setMoveProgress(null);
        setMoveError(res.error ?? 'Errore sconosciuto');
      }
    } catch {
      if (isMountedRef.current) {
        setIsMoveInProgress(false);
        setMoveProgress(null);
        setMoveError('Errore di connessione API');
      }
    }
  }

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) {
      ++sessionInfoReqIdRef.current;
      return;
    }

    let aborted = false;
    setSaveError(null);

    if (window.pywebview?.api?.load_settings) {
      window.pywebview.api.load_settings()
        .then(res => {
          if (aborted || !isMountedRef.current) return;
          if (res) {
            setApiKeyInsecure(!!res.api_key_insecure);
            setApiKeyInsecureReason(res.api_key_insecure_reason || '');
          }
        })
        .catch(() => {});
    }

    if (activeTab === 'advanced') {
      fetchSessionStorageInfo();
    }

    if (window.pywebview?.api?.get_session_move_status) {
      window.pywebview.api.get_session_move_status()
        .then(res => {
          if (aborted || !isMountedRef.current) return;
          if (res?.status === 'moving') {
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

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'advanced' && !sessionInfo && !isLoadingSessionInfo) {
      fetchSessionStorageInfo();
    }
  }, [sessionInfo, isLoadingSessionInfo, fetchSessionStorageInfo]);

  const handleOpenSessionFolder = () => {
    window.pywebview?.api?.open_session_folder?.();
  };

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
      const res = await window.pywebview.api.cleanup_old_sessions(0, true);
      if (!isMountedRef.current) return;
      if (res?.ok) {
        setCleanupPreview({
          removed: res.removed ?? 0,
          freed_bytes: res.freed_bytes ?? 0,
          candidates: res.candidates ?? 0,
        });
        setShowCleanupConfirm(true);
      } else {
        appendConsole(`❌ Conteggio sbobine incomplete fallito: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      if (isMountedRef.current) appendConsole(`❌ Conteggio sbobine incomplete fallito: ${getErrorMessage(e)}`);
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
      const res = await window.pywebview.api.cleanup_old_sessions(0, false);
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
          const info = await window.pywebview.api.get_session_storage_info();
          if (info?.ok && isMountedRef.current) {
            setSessionInfo({
              total_bytes: info.total_bytes ?? 0,
              total_sessions: info.total_sessions ?? 0,
              session_root: info.session_root ?? '',
            });
          }
        }
      } else {
        appendConsole(`❌ Pulizia sessioni fallita: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      if (isMountedRef.current) appendConsole(`❌ Pulizia sessioni fallita: ${getErrorMessage(e)}`);
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
        });
        setShowCompletedCleanupConfirm(true);
      } else {
        appendConsole(`❌ Conteggio sbobine completate fallito: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      if (isMountedRef.current) appendConsole(`❌ Conteggio sbobine completate fallito: ${getErrorMessage(e)}`);
    } finally {
      if (isMountedRef.current) setIsCleaningCompletedSessions(false);
    }
  };

  const handleCleanupCompletedSessions = async () => {
    if (!window.pywebview?.api?.cleanup_completed_sessions) return;
    setShowCompletedCleanupConfirm(false);
    setIsCleaningCompletedSessions(true);
    try {
      const res = await window.pywebview.api.cleanup_completed_sessions(SESSION_CLEANUP_DAYS, false);
      if (!isMountedRef.current) return;
      if (res?.ok) {
        setCompletedCleanupResult({
          removed: res.removed ?? 0,
          freed_bytes: res.freed_bytes ?? 0,
          candidates: res.candidates ?? res.removed ?? 0,
        });
        if (window.pywebview?.api?.get_session_storage_info) {
          const info = await window.pywebview.api.get_session_storage_info();
          if (info?.ok && isMountedRef.current) {
            setSessionInfo({
              total_bytes: info.total_bytes ?? 0,
              total_sessions: info.total_sessions ?? 0,
              session_root: info.session_root ?? '',
            });
          }
        }
      } else {
        appendConsole(`❌ Pulizia sbobine completate fallita: ${res?.error || 'errore sconosciuto'}`);
      }
    } catch (e: unknown) {
      if (isMountedRef.current) appendConsole(`❌ Pulizia sbobine completate fallita: ${getErrorMessage(e)}`);
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
        true,
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
      if (isMountedRef.current) {
        appendConsole(`❌ Validazione ambiente fallita: ${getErrorMessage(error)}`);
        setValidationResult(null);
      }
    } finally {
      if (isMountedRef.current) setIsValidatingEnvironment(false);
    }
  };

  const getPendingChecks = useCallback((): DisplayCheck[] => {
    const isWindows = typeof window !== 'undefined' && /windows|win32/i.test(navigator.userAgent || '');
    const checks: DisplayCheck[] = [
      {
        id: 'api_key',
        label: 'API Key Gemini',
        status: 'pending',
        message: apiKey.trim()
          ? 'Chiave inserita. Verrà verificato l\'accesso a internet e la validità della chiave.'
          : 'Chiave assente: il controllo dell\'API Gemini verrà saltato.',
        details: `Modello primario: ${preferredModel}${fallbackModels.length > 0 ? ` • Fallback: ${fallbackModels.join(', ')}` : ''}`,
      },
      {
        id: 'ffmpeg',
        label: 'FFmpeg',
        status: 'pending',
        message: 'Verifica se FFmpeg è installato e disponibile per la conversione audio.',
        details: '',
      },
      {
        id: 'config',
        label: 'Config locale',
        status: 'pending',
        message: 'Verifica la possibilità di scrivere le impostazioni sul disco locale.',
        details: '',
      },
      {
        id: 'output',
        label: 'Cartella sessioni/output',
        status: 'pending',
        message: 'Verifica i permessi di scrittura nella cartella delle sessioni.',
        details: sessionInfo?.session_root || '',
      },
    ];

    if (!isWindows) {
      checks.push({
        id: 'keyring',
        label: 'Keyring',
        status: 'pending',
        message: 'Verifica la disponibilità del portachiavi di sistema per salvare la chiave API in modo sicuro.',
        details: '',
      });
    }

    return checks;
  }, [apiKey, preferredModel, fallbackModels, sessionInfo?.session_root]);

  const getDisplayChecks = useCallback((): DisplayCheck[] => {
    const pending = getPendingChecks();
    if (!validationResult) return pending;

    const resultChecks = validationResult.checks;
    const list: DisplayCheck[] = [];
    for (const p of pending) {
      const match = resultChecks.find(r => r.id === p.id);
      if (match) {
        list.push({
          id: p.id,
          label: p.label,
          status: match.status,
          message: match.message,
          details: match.details,
        });
      } else {
        list.push(p);
      }
    }
    return list;
  }, [getPendingChecks, validationResult]);

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

  const handleClose = () => {
    if (isSaving) return;
    onClose();
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.15, ease: 'easeOut' } }}
            exit={{ opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              onClick={handleClose}
              className="modal-overlay absolute inset-0"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] } }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: 'easeIn' } }}
              className="modal-card relative w-full max-w-md md:max-w-4xl h-[85vh] md:h-[80vh] overflow-hidden flex flex-col md:flex-row"
            >
              {/* Sidebar Navigation */}
              <div className="w-full md:w-60 md:shrink-0 flex flex-row md:flex-col border-b md:border-b-0 md:border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-x-auto md:overflow-x-visible md:overflow-y-auto shrink-0 py-4 px-3 gap-1">
                <div className="hidden md:flex items-center gap-2 px-3 py-2.5 mb-3 border-b border-[var(--border-subtle)]">
                  <Settings className="w-5 h-5 text-[var(--accent-text)] shrink-0" />
                  <span role="heading" aria-level={2} className="font-bold text-base tracking-wide uppercase text-[var(--text-primary)]">
                    Impostazioni
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleTabChange('general')}
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

                <button
                  type="button"
                  onClick={() => handleTabChange('advanced')}
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

              {/* Main Content Column */}
              <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-surface)] h-full relative">
                <div className="app-scroll flex-1 overflow-y-auto overflow-x-hidden p-6 md:p-8 space-y-6">
                  {activeTab === 'general' && (
                    <div className="space-y-8 animate-fade-in">
                      <div>
                        <h2 className="text-xl font-bold text-[var(--text-primary)]">Generale</h2>
                        <p className="text-sm text-[var(--text-muted)] mt-1">
                          Gestisci le tue chiavi API di Google Gemini, le notifiche di sistema e controlla gli aggiornamenti dell&apos;applicazione.
                        </p>
                      </div>

                      <ApiKeySection
                        apiKey={apiKey}
                        setApiKey={setApiKey}
                        hasProtectedKey={hasProtectedKey}
                        apiKeyInsecure={apiKeyInsecure}
                        apiKeyInsecureReason={apiKeyInsecureReason}
                        fallbackKeys={fallbackKeys}
                        setFallbackKeys={setFallbackKeys}
                      />

                      <UpdaterSection
                        latestVersion={latestVersion}
                        checkForUpdates={checkForUpdates}
                        isCheckingUpdate={isCheckingUpdate}
                        hasChecked={hasChecked}
                        checkFailed={checkFailed}
                        updateInstallState={updateInstallState}
                        onInstallUpdate={onInstallUpdate}
                      />
                    </div>
                  )}

                  {activeTab === 'advanced' && (
                    <div className="space-y-8 animate-fade-in">
                      <div>
                        <h2 className="text-xl font-bold text-[var(--text-primary)]">Opzioni Avanzate</h2>
                        <p className="text-sm text-[var(--text-muted)] mt-1">
                          Configura i modelli Gemini di riserva, controlla lo spazio sul disco locale ed esegui i test di diagnosi dell&apos;ambiente.
                        </p>
                      </div>

                      <ModelSection
                        preferredModel={preferredModel}
                        setPreferredModel={setPreferredModel}
                        fallbackModels={fallbackModels}
                        setFallbackModels={setFallbackModels}
                        availableModels={availableModels}
                      />

                      <StorageSection
                        sessionInfo={sessionInfo}
                        isLoadingSessionInfo={isLoadingSessionInfo}
                        onOpenSessionFolder={handleOpenSessionFolder}
                        onAskMoveFolder={handleAskMoveFolder}
                        isMoveInProgress={isMoveInProgress}
                        moveProgress={moveProgress}
                        moveError={moveError}
                        isCleaningSession={isCleaningSession}
                        isCleaningCompletedSessions={isCleaningCompletedSessions}
                        cleanupPreview={cleanupPreview}
                        completedCleanupPreview={completedCleanupPreview}
                        onAskCleanup={handleAskCleanup}
                        onAskCompletedCleanup={handleAskCompletedCleanup}
                        cleanupResult={cleanupResult}
                        completedCleanupResult={completedCleanupResult}
                      />

                      <DiagnosticsSection
                        isValidatingEnvironment={isValidatingEnvironment}
                        onRunValidation={runEnvironmentValidation}
                        validationResult={validationResult}
                        displayChecks={getDisplayChecks()}
                      />
                    </div>
                  )}
                </div>

                {/* Shared Modal Footer */}
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Dialog Modals */}
      <ConfirmActionModal
        isOpen={showCleanupConfirm}
        title="Eliminare tutte le elaborazioni incomplete?"
        description={`Questa operazione elimina tutte le elaborazioni incomplete per liberare spazio. Sbobine interessate: ${cleanupPreview?.candidates ?? 0}. Spazio stimato: ${formatSize(cleanupPreview?.freed_bytes ?? 0)}. L'operazione è irreversibile.`}
        confirmLabel="Elimina incomplete"
        cancelLabel="Annulla"
        onClose={() => setShowCleanupConfirm(false)}
        onConfirm={() => {
          setShowCleanupConfirm(false);
          void handleCleanupSessions();
        }}
      />
      <ConfirmActionModal
        isOpen={showCompletedCleanupConfirm}
        title="Eliminare le sbobine completate vecchie?"
        description={`Questa operazione elimina le sbobine completate più vecchie di ${SESSION_CLEANUP_DAYS} giorni. Sbobine interessate: ${completedCleanupPreview?.candidates ?? 0}. Spazio stimato: ${formatSize(completedCleanupPreview?.freed_bytes ?? 0)}. L'operazione è irreversibile.`}
        confirmLabel="Elimina sbobine completate"
        cancelLabel="Annulla"
        onClose={() => setShowCompletedCleanupConfirm(false)}
        onConfirm={() => {
          setShowCompletedCleanupConfirm(false);
          void handleCleanupCompletedSessions();
        }}
      />
      <ConfirmActionModal
        isOpen={showMoveConfirm}
        title="Spostare la cartella sessioni?"
        description={`Tutte le sessioni verranno spostate in:\n${pendingMovePath ?? ''}\n\nL'operazione è rapida se la destinazione è sullo stesso disco.`}
        confirmLabel="Sposta"
        cancelLabel="Annulla"
        onClose={() => {
          setShowMoveConfirm(false);
          setPendingMovePath(null);
        }}
        onConfirm={() => {
          void handleConfirmMove();
        }}
      />
    </>
  );
};
