import { reportClientError } from '../../diagnostics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, HardDrive, SlidersHorizontal, Loader2, X, LifeBuoy } from 'lucide-react';
import type { ApiUsageResult, CredentialStorage, ModelOption, ValidationResult } from '../../bridge';
import { ConfirmActionModal } from './ConfirmActionModal';
import { ApiKeySection, type DeleteKeyTarget } from './settings/ApiKeySection';
import { ModelSection } from './settings/ModelSection';
import { NotificationSection } from './settings/NotificationSection';
import { StorageSection } from './settings/StorageSection';
import { WebBackupSection } from './settings/WebBackupSection';
import { WebDriveSection } from './settings/WebDriveSection';
import { WebTrashSection } from './settings/WebTrashSection';
import { DiagnosticsSection } from './settings/DiagnosticsSection';
import { ApiStatusSection } from './settings/ApiStatusSection';
import { WebRemoveKeysButton, WebSharedDeviceNotice } from './settings/WebSharedDeviceNotice';
import { UpdaterSection, UpdateNotice, type SettingsUpdateInstallState } from './settings/UpdaterSection';
import { SettingsDivider, SettingsPageHeader, SettingsSectionHeading } from './settings/SettingsLayout';

import { useSettingsStorage } from '../../hooks/useSettingsStorage';
import { formatSize } from '../../utils';
import { credentialStorageWarning } from '../../credentialStorage';
import { getHostCapabilities } from '../../hostCapabilities';
import { APP_VERSION, WEB_PREVIEW_BUILD, WEB_PRIVACY_PATH } from '../../branding';
import { STORAGE_KEYS } from '../../storageKeys';
import { modalCard } from '../../motion';

export type { SettingsUpdateInstallState };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SettingsAuthProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  hasProtectedKey: boolean;
  fallbackKeys: string[];
  setFallbackKeys: React.Dispatch<React.SetStateAction<string[]>>;
  configuredFallbackKeyCount?: number;
}

export interface SettingsModelsProps {
  preferredModel: string;
  setPreferredModel: (model: string) => void;

  availableModels: ModelOption[];
}

export interface SettingsUpdaterProps {
  latestVersion: string | null;
  checkForUpdates: (force?: boolean) => void;
  isCheckingUpdate: boolean;
  hasChecked: boolean;
  checkFailed: boolean;
  updateInstallState?: SettingsUpdateInstallState;
  onInstallUpdate?: (version: string) => Promise<void>;
}

export interface SettingsStorageProps {
  onSessionRootMoved?: (payload?: { oldRoot?: string; newRoot?: string }) => void;
  /** Web build: a backup was imported, the archive must be reloaded. */
  onArchiveImported?: () => void;
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appendConsole: (msg: string) => void;
  onSettingsSaved?: () => Promise<unknown> | unknown;
  auth: SettingsAuthProps;
  models: SettingsModelsProps;
  updater: SettingsUpdaterProps;
  storage?: SettingsStorageProps;
  /** Section shown when the modal opens, e.g. the backup from the moved-address notice. */
  initialTab?: SettingsTab;
}

export type SettingsTab = 'general' | 'storage' | 'diagnostics';
type TabType = SettingsTab;

const TAB_HEADERS: Record<TabType, { title: string; description: string }> = {
  general: {
    title: 'Generale',
    description: 'Chiave API Google Gemini, modello di trascrizione e preferenze di sistema.',
  },
  storage: {
    title: 'Archiviazione',
    description: 'Spazio su disco occupato dalle sbobine e gestione della cartella di lavoro.',
  },
  diagnostics: {
    title: 'Assistenza',
    description: "Segnala un problema e controlla che l'app sia pronta a trascrivere.",
  },
};

// The web build has no system preferences, folder or environment check: its headers say what is there.
const WEB_TAB_HEADERS: Record<TabType, { title: string; description: string }> = {
  general: {
    title: 'Generale',
    description: 'Modello di trascrizione e chiavi API Google Gemini salvate in questo browser.',
  },
  storage: {
    title: 'Archiviazione',
    description: 'Spazio occupato in questo browser da sbobine, audio delle lezioni ed elaborazioni.',
  },
  diagnostics: {
    title: 'Assistenza',
    description: 'Segnala un problema e allega il report con gli errori registrati.',
  },
};

// The settings card mounts a large tree whose first style and layout pass can outlast several
// frames on a slow machine. Starting the entrance on mount would spend that time off-screen and
// show the card already half-faded in, so it waits in its initial pose until a frame has been
// painted. Only this wrapper re-renders when it starts: the children keep their identity.
const SettingsCard: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => {
  const [hasPainted, setHasPainted] = useState(false);
  useEffect(() => {
    let nextFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => setHasPainted(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(nextFrame);
    };
  }, []);
  return (
    <motion.div
      initial={modalCard.initial}
      animate={hasPainted ? modalCard.animate : modalCard.initial}
      exit={modalCard.exit}
      data-entered={hasPainted ? 'true' : 'false'}
      className={className}
    >
      {children}
    </motion.div>
  );
};

interface SettingsSnapshot {
  apiKey: string;
  fallbackKeys: string[];
  preferredModel: string;

  notificationsEnabled: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appendConsole,
  onSettingsSaved,
  auth,
  models,
  updater,
  storage,
  initialTab,
}) => {
  const {
    apiKey,
    setApiKey,
    hasProtectedKey,
    fallbackKeys,
    setFallbackKeys,
    configuredFallbackKeyCount,
  } = auth;
  const {
    preferredModel,
    setPreferredModel,

    availableModels,
  } = models;
  const { latestVersion, checkForUpdates, isCheckingUpdate, hasChecked, checkFailed, updateInstallState, onInstallUpdate } = updater;
  const onSessionRootMoved = storage?.onSessionRootMoved;
  const hostCapabilities = getHostCapabilities();
  const [activeTab, setActiveTab] = useState<TabType>(initialTab ?? 'general');
  useEffect(() => {
    if (isOpen && initialTab) setActiveTab(initialTab);
  }, [isOpen, initialTab]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED) !== 'false',
  );
  const [credentialStorage, setCredentialStorage] = useState<CredentialStorage | undefined>();
  const [apiKeyInsecure, setApiKeyInsecure] = useState(false);
  const [apiKeyInsecureReason, setApiKeyInsecureReason] = useState<string | null>(null);

  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidatingEnvironment, setIsValidatingEnvironment] = useState(false);
  const [apiUsage, setApiUsage] = useState<ApiUsageResult | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [clearProtectedPrimary, setClearProtectedPrimary] = useState(false);
  const [keyDeleteTarget, setKeyDeleteTarget] = useState<DeleteKeyTarget | null>(null);
  // Update progress shows only where the install was started: the top notice by default,
  // the version section when the user installed from there.
  const [updateStartedInSection, setUpdateStartedInSection] = useState(false);
  const installUpdateFromNotice = useCallback((version: string) => {
    setUpdateStartedInSection(false);
    return onInstallUpdate!(version);
  }, [onInstallUpdate]);
  const installUpdateFromSection = useCallback((version: string) => {
    setUpdateStartedInSection(true);
    return onInstallUpdate!(version);
  }, [onInstallUpdate]);

  const isSavingRef = useRef(false);
  const isMountedRef = useRef(true);
  const settingsSnapshotRef = useRef<SettingsSnapshot | null>(null);
  const wasOpenRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab, isOpen]);

  const {
    sessionInfo,
    isLoadingSessionInfo,
    fetchSessionStorageInfo,
    isMoveInProgress,
    moveProgress,
    moveError,
    pendingMovePath,
    showMoveConfirm,
    handleOpenSessionFolder,
    handleAskMoveFolder,
    handleConfirmMove,
    handleCancelMove,
    isCleaningSession,
    showCleanupConfirm,
    setShowCleanupConfirm,
    cleanupPreview,
    cleanupResult,
    handleAskCleanup,
    handleCleanupSessions,
    handleDismissCleanupResult,
  } = useSettingsStorage({
    isOpen,
    activeTab,
    appendConsole,
    onSessionRootMoved,
  });

  const prevSettingsKeyRef = useRef<string>('');
  useEffect(() => {
    const key = `${apiKey}|${preferredModel}`;
    if (prevSettingsKeyRef.current && prevSettingsKeyRef.current !== key) {
      setValidationResult(null);
    }
    prevSettingsKeyRef.current = key;
  }, [apiKey, preferredModel]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      settingsSnapshotRef.current = {
        apiKey,
        fallbackKeys: [...fallbackKeys],
        preferredModel,

        notificationsEnabled: localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED) !== 'false',
      };
    } else if (!isOpen) {
      settingsSnapshotRef.current = null;
      // Reopened, the page starts at the top again, where the notice shows the progress.
      setUpdateStartedInSection(false);
    }
    wasOpenRef.current = isOpen;
  }, [apiKey, fallbackKeys, isOpen, preferredModel]);

  const snapshot = settingsSnapshotRef.current;
  const hasPendingChanges = Boolean(snapshot && (
    apiKey !== snapshot.apiKey ||
    preferredModel !== snapshot.preferredModel ||
    JSON.stringify(fallbackKeys) !== JSON.stringify(snapshot.fallbackKeys) ||
    notificationsEnabled !== snapshot.notificationsEnabled ||
    clearProtectedPrimary
  ));
  const showCloseOnly = activeTab !== 'general' && !hasPendingChanges;

  const usageRequestIdRef = useRef(0);
  const fetchApiUsage = useCallback(async (forceRefresh = false) => {
    if (!window.pywebview?.api?.get_api_usage) return;
    const requestId = ++usageRequestIdRef.current;
    setIsLoadingUsage(true);
    try {
      const res = await window.pywebview.api.get_api_usage(
        clearProtectedPrimary
          ? ''
          : hasProtectedKey && !apiKey.trim()
            ? undefined
            : apiKey.trim(),
        fallbackKeys,
        preferredModel,

        forceRefresh,
      );
      if (isMountedRef.current && requestId === usageRequestIdRef.current) {
        setApiUsage(res?.ok && res.result ? res.result : null);
      }
    } catch (e) {
      if (isMountedRef.current && requestId === usageRequestIdRef.current) setApiUsage(null);
      reportClientError('Failed to fetch api usage:', e);
    } finally {
      // A superseded request must not release the current request's busy state.
      if (requestId === usageRequestIdRef.current && isMountedRef.current) {
        setIsLoadingUsage(false);
      }
    }
  }, [apiKey, clearProtectedPrimary, fallbackKeys, hasProtectedKey, preferredModel]);

  const handleRefreshUsage = useCallback(() => {
    void fetchApiUsage(true);
  }, [fetchApiUsage]);

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'general') {
        void fetchApiUsage();
      }
      if (activeTab === 'storage') {
        void fetchSessionStorageInfo();
      }
    }
  }, [isOpen, activeTab, fetchApiUsage, fetchSessionStorageInfo]);

  useEffect(() => {
    if (isOpen) {
      setNotificationsEnabled(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED) !== 'false');
      setClearProtectedPrimary(false);
      setSaveError(null);
      setIsSaving(false);
      isSavingRef.current = false;
      if (window.pywebview?.api?.load_settings) {
        window.pywebview.api.load_settings().then(res => {
          if (isMountedRef.current && res) {
            setCredentialStorage(res.credential_storage);
            setApiKeyInsecure(!!res.api_key_insecure);
            setApiKeyInsecureReason(res.api_key_insecure_reason || null);
          }
        }).catch(() => {});
      }
    } else {
      setValidationResult(null);
      setActiveTab('general');
    }
  }, [isOpen]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSaveError(null);
    // The new page starts at the top, where the notice shows the progress.
    setUpdateStartedInSection(false);
  };

  const runEnvironmentValidation = async () => {
    if (isValidatingEnvironment || !window.pywebview?.api?.validate_environment) return;
    setIsValidatingEnvironment(true);
    try {
      const response = await window.pywebview.api.validate_environment(
        apiKey.trim(),
        true,
        preferredModel,

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

  const handleCopyReport = async (sessionDir?: string) => {
    if (!window.pywebview?.api?.get_diagnostic_report) return;
    const res = await window.pywebview.api.get_diagnostic_report(
      undefined, undefined, undefined, sessionDir, APP_VERSION,
    );
    if (res?.ok && res.report) {
      await navigator.clipboard.writeText(res.report);
      appendConsole('📋 Report diagnostico copiato negli appunti.');
    } else {
      appendConsole(`❌ Generazione report diagnostico fallita: ${res?.error || 'errore sconosciuto'}`);
      throw new Error(res?.error || 'Errore generazione report diagnostico');
    }
  };

  const handleSave = async () => {
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
        const apiKeyPayload = clearProtectedPrimary
          ? ''
          : hasProtectedKey && !apiKey.trim()
            ? null
            : apiKey.trim();
        const fallbackKeysPayload =
          fallbackKeys.length === 0 && (configuredFallbackKeyCount ?? 0) > 0
            ? null
            : keys;
        result = await window.pywebview.api.save_settings(
          apiKeyPayload,
          fallbackKeysPayload,
          preferredModel,

        );
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
      settingsSnapshotRef.current = { apiKey, fallbackKeys: [...fallbackKeys], preferredModel, notificationsEnabled };
      setCredentialStorage(result.credential_storage);
      setApiKeyInsecure(Boolean(result.api_key_insecure));
      setApiKeyInsecureReason(result.api_key_insecure_reason || null);
      localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED, String(notificationsEnabled));
      try {
        await onSettingsSaved?.();
      } catch (e: unknown) {
        appendConsole(`⚠ Impostazioni salvate, ma l'aggiornamento dello stato non è riuscito: ${getErrorMessage(e)}`);
      }
      if (credentialStorageWarning(result.credential_storage, result.api_key_insecure)) {
        setActiveTab('general');
      } else {
        onClose();
      }
    } finally {
      isSavingRef.current = false;
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  const handleClose = useCallback(() => {
    if (isSavingRef.current) return;
    setNotificationsEnabled(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED) !== 'false');
    const snapshot = settingsSnapshotRef.current;
    if (snapshot) {
      setApiKey(snapshot.apiKey);
      setFallbackKeys([...snapshot.fallbackKeys]);
      setPreferredModel(snapshot.preferredModel);

      setClearProtectedPrimary(false);
    }
    onClose();
  }, [onClose, setApiKey, setFallbackKeys, setPreferredModel]);

  const webKeyCount = [apiKey, ...fallbackKeys].filter(key => key.trim()).length;
  // Web build: "Rimuovi tutte le chiavi" deletes the keys from this browser right away, not on "Salva".
  const handleRemoveWebKeys = useCallback(async () => {
    if (isSavingRef.current || !window.pywebview?.api?.save_settings) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await window.pywebview.api.save_settings('', [], preferredModel);
      if (!isMountedRef.current) return;
      if (!result?.ok) {
        setSaveError(`Rimozione non riuscita: ${result?.error || 'errore sconosciuto'}`);
        return;
      }
      setApiKey('');
      setFallbackKeys([]);
      if (settingsSnapshotRef.current) settingsSnapshotRef.current = { ...settingsSnapshotRef.current, apiKey: '', fallbackKeys: [] };
      appendConsole('Chiavi API rimosse da questo browser.');
      await onSettingsSaved?.();
    } catch (e: unknown) {
      if (isMountedRef.current) setSaveError(`Rimozione non riuscita: ${getErrorMessage(e)}`);
    } finally {
      isSavingRef.current = false;
      if (isMountedRef.current) setIsSaving(false);
    }
  }, [appendConsole, onSettingsSaved, preferredModel, setApiKey, setFallbackKeys]);

  const handleConfirmDeleteKey = useCallback(() => {
    if (!keyDeleteTarget) return;

    if (keyDeleteTarget.type === 'primary') {
      const cleaned = fallbackKeys.map(k => k.trim()).filter(Boolean);
      if (cleaned.length > 0) {
        const [firstReserve, ...rest] = cleaned;
        setApiKey(firstReserve);
        setFallbackKeys(rest);
        setClearProtectedPrimary(false);
      } else {
        setApiKey('');
        if (hasProtectedKey) {
          setClearProtectedPrimary(true);
        }
      }
    } else if (keyDeleteTarget.type === 'fallback' && typeof keyDeleteTarget.index === 'number') {
      const cleaned = fallbackKeys.map(k => k.trim()).filter(Boolean);
      const updated = cleaned.filter((_, idx) => idx !== keyDeleteTarget.index);
      setFallbackKeys(updated);
    }

    setKeyDeleteTarget(null);
  }, [fallbackKeys, hasProtectedKey, keyDeleteTarget, setApiKey, setFallbackKeys]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSavingRef.current) {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="modal-overlay absolute inset-0"
            />

            <SettingsCard className="modal-card relative w-full max-w-md md:max-w-4xl h-[85vh] md:h-[80vh] overflow-hidden flex flex-col md:flex-row">
              <nav aria-label="Sezioni delle impostazioni" className="settings-nav app-scroll">
                <div className="hidden md:flex items-center gap-2 px-3 py-2.5 mb-3 border-b border-[var(--border-subtle)]">
                  <Settings className="w-5 h-5 text-[var(--accent-text)] shrink-0" />
                  <span role="heading" aria-level={2} className="font-semibold text-base text-[var(--text-primary)]">
                    Impostazioni
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleTabChange('general')}
                  aria-current={activeTab === 'general' ? 'page' : undefined}
                  className={`settings-nav-item ${activeTab === 'general' ? 'is-active' : ''}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <SlidersHorizontal className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'general' ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'}`} />
                    <span className="truncate">Generale</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange('storage')}
                  aria-current={activeTab === 'storage' ? 'page' : undefined}
                  className={`settings-nav-item ${activeTab === 'storage' ? 'is-active' : ''}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <HardDrive className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'storage' ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'}`} />
                    <span className="truncate">Archiviazione</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange('diagnostics')}
                  aria-current={activeTab === 'diagnostics' ? 'page' : undefined}
                  className={`settings-nav-item ${activeTab === 'diagnostics' ? 'is-active' : ''}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <LifeBuoy className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'diagnostics' ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'}`} />
                    <span className="truncate">Assistenza</span>
                  </div>
                </button>

                {/* One close button for both layouts (index.css .settings-close): beside the tabs at
                    the top of the compact card, at the page title's right on the wide one. */}
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSaving}
                  className="icon-button modal-icon-button settings-close"
                  aria-label="Chiudi finestra"
                >
                  <X className="w-4 h-4" />
                </button>
              </nav>

              <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-[var(--bg-surface)] relative">
                {/* The page title stays put above the scrolling content; on the wide card it leaves
                    room for the close button placed over its right end. */}
                <div className="px-6 md:pl-8 md:pr-16 pt-6 md:pt-8 pb-4 border-b border-[var(--border-subtle)]">
                  <SettingsPageHeader {...(hostCapabilities.kind === 'web' ? WEB_TAB_HEADERS : TAB_HEADERS)[activeTab]} />
                </div>
                <div ref={contentRef} data-testid="settings-content" className="app-scroll flex-1 overflow-y-auto overflow-x-hidden px-6 md:px-8 pt-5 pb-6 md:pb-8 space-y-6 [scrollbar-gutter:stable]">
                  {activeTab === 'general' && (
                    <div className="space-y-6 animate-fade-in">
                      <UpdateNotice
                        latestVersion={latestVersion}
                        updateInstallState={updateInstallState}
                        onInstallUpdate={onInstallUpdate && installUpdateFromNotice}
                        showsInstallFeedback={!updateStartedInSection}
                      />

                      <ModelSection
                        preferredModel={preferredModel}
                        setPreferredModel={setPreferredModel}
                        availableModels={availableModels}
                      />

                      <SettingsDivider />

                      <ApiKeySection
                        apiKey={apiKey}
                        setApiKey={key => {
                          if (key.trim()) setClearProtectedPrimary(false);
                          setApiKey(key);
                        }}
                        hasProtectedKey={hasProtectedKey && !clearProtectedPrimary}
                        credentialStorage={credentialStorage}
                        apiKeyInsecure={apiKeyInsecure}
                        apiKeyInsecureReason={apiKeyInsecureReason || ''}
                        fallbackKeys={fallbackKeys}
                        setFallbackKeys={setFallbackKeys}
                        onClearProtectedPrimary={() => setClearProtectedPrimary(true)}
                        apiUsage={apiUsage}
                        isLoadingUsage={isLoadingUsage}
                        preferredModel={preferredModel}
                        onAskDeleteKey={setKeyDeleteTarget}
                        onRefreshUsage={handleRefreshUsage}
                        statusSummary={<ApiStatusSection apiUsage={apiUsage} isLoadingUsage={isLoadingUsage} />}
                        headerActions={hostCapabilities.keyStorage === 'browser' && (
                          <WebRemoveKeysButton
                            keyCount={webKeyCount}
                            onRemoveKeys={() => void handleRemoveWebKeys()}
                            disabled={isSaving}
                          />
                        )}
                      />

                      {hostCapabilities.keyStorage === 'browser' && <WebSharedDeviceNotice keyCount={webKeyCount} />}

                      {hostCapabilities.osNotifications && (
                        <>
                          <SettingsDivider />

                          <NotificationSection
                            notificationsEnabled={notificationsEnabled}
                            onChange={setNotificationsEnabled}
                            disabled={isSaving}
                          />
                        </>
                      )}

                      {hostCapabilities.updateInstallation && (
                        <>
                          <SettingsDivider />

                          <UpdaterSection
                            latestVersion={latestVersion}
                            checkForUpdates={checkForUpdates}
                            isCheckingUpdate={isCheckingUpdate}
                            hasChecked={hasChecked}
                            checkFailed={checkFailed}
                            updateInstallState={updateInstallState}
                            onInstallUpdate={onInstallUpdate && installUpdateFromSection}
                            showsInstallFeedback={updateStartedInSection}
                          />
                        </>
                      )}

                      {hostCapabilities.kind === 'web' && (
                        <>
                          <SettingsDivider />
                          <div className="space-y-1" data-testid="web-version">
                            <SettingsSectionHeading>Versione</SettingsSectionHeading>
                            <p className="text-xs text-[var(--text-secondary)]">
                              {WEB_PREVIEW_BUILD ? `${APP_VERSION} (anteprima)` : APP_VERSION}. Gli aggiornamenti arrivano da soli alla prossima apertura del sito, senza toccare sbobine e chiavi salvate in questo browser.
                            </p>
                            <p className="text-xs text-[var(--text-secondary)]">
                              Cosa resta nel browser e cosa va a Google:{' '}
                              <a href={WEB_PRIVACY_PATH} target="_blank" rel="noopener" className="underline">informativa sulla privacy</a>.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {activeTab === 'storage' && (
                    <div className="space-y-6 animate-fade-in">
                      <StorageSection
                        sessionInfo={sessionInfo}
                        isLoadingSessionInfo={isLoadingSessionInfo}
                        onOpenSessionFolder={handleOpenSessionFolder}
                        onAskMoveFolder={handleAskMoveFolder}
                        isMoveInProgress={isMoveInProgress}
                        moveProgress={moveProgress}
                        moveError={moveError}
                        isCleaningSession={isCleaningSession}
                        onAskCleanup={handleAskCleanup}
                        cleanupResult={cleanupResult}
                        onDismissCleanupResult={handleDismissCleanupResult}
                        canManageSessionFolder={hostCapabilities.nativeFolderPicker && hostCapabilities.openLocalPath}
                        inBrowser={hostCapabilities.kind === 'web'}
                      />
                      {hostCapabilities.kind === 'web' && (
                        <>
                          <SettingsDivider />
                          <WebBackupSection
                            onArchiveImported={() => {
                              storage?.onArchiveImported?.();
                              fetchSessionStorageInfo();
                            }}
                          />
                          {/* Previews built with a Google client ID only. */}
                          {window.pywebview?.api?.get_drive_status && (
                            <>
                              <SettingsDivider />
                              <WebDriveSection />
                            </>
                          )}
                          {window.pywebview?.api?.list_trash && (
                            <>
                              <SettingsDivider />
                              <WebTrashSection
                                onArchiveChanged={() => {
                                  storage?.onArchiveImported?.();
                                  fetchSessionStorageInfo();
                                }}
                              />
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {activeTab === 'diagnostics' && (
                    <div className="space-y-6 animate-fade-in">
                      <DiagnosticsSection
                        isValidatingEnvironment={isValidatingEnvironment}
                        onRunValidation={runEnvironmentValidation}
                        validationResult={validationResult}
                        onCopyReport={handleCopyReport}
                        showEnvironmentCheck={hostCapabilities.environmentCheck}
                      />
                    </div>
                  )}
                </div>

                <div className="modal-footer flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {saveError && (
                      <p role="alert" className="text-xs text-[var(--error-text)] font-semibold break-words">
                        {saveError}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {!showCloseOnly && <button
                      type="button"
                      onClick={handleClose}
                      disabled={isSaving}
                      className="modal-action-button"
                    >
                      Annulla
                    </button>}

                    <button
                      type="button"
                      onClick={showCloseOnly ? handleClose : handleSave}
                      disabled={isSaving}
                      className="modal-action-button is-primary"
                    >
                      {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                      {showCloseOnly ? 'Chiudi' : 'Salva e Chiudi'}
                    </button>
                  </div>
                </div>
              </div>
            </SettingsCard>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Dialog Modals */}
      <ConfirmActionModal
        isOpen={showCleanupConfirm}
        title="Eliminare tutte le elaborazioni incomplete?"
        description={`Elimina subito tutte le sbobine interrotte o non finite, comprese quelle in pausa che potresti ancora riprendere. Sbobine interessate: ${cleanupPreview?.candidates ?? 0}. Spazio stimato: ${formatSize(cleanupPreview?.freed_bytes ?? 0)}. L'operazione è irreversibile.`}
        confirmLabel="Elimina incomplete"
        cancelLabel="Annulla"
        onClose={() => setShowCleanupConfirm(false)}
        onConfirm={() => {
          setShowCleanupConfirm(false);
          void handleCleanupSessions();
        }}
      />
      <ConfirmActionModal
        isOpen={showMoveConfirm}
        title="Spostare la cartella sessioni?"
        description={`Le sessioni verranno spostate subito in:\n${pendingMovePath ?? ''}\n\nL'operazione è rapida se la destinazione è sullo stesso disco.`}
        confirmLabel="Sposta"
        cancelLabel="Annulla"
        onClose={handleCancelMove}
        onConfirm={() => {
          void handleConfirmMove();
        }}
      />
      <ConfirmActionModal
        isOpen={Boolean(keyDeleteTarget)}
        title="Rimuovi chiave API"
        description={
          keyDeleteTarget?.type === 'primary'
            ? fallbackKeys.map(k => k.trim()).filter(Boolean).length > 0
              ? `Sei sicuro di voler rimuovere la Chiave Principale (${keyDeleteTarget.maskedKey})? La Chiave Riserva 1 verrà promossa automaticamente a nuova chiave principale.`
              : `Sei sicuro di voler rimuovere la Chiave Principale (${keyDeleteTarget?.maskedKey})? Non sarà più possibile eseguire trascrizioni fino all'inserimento di una nuova chiave.`
            : `Sei sicuro di voler rimuovere ${keyDeleteTarget?.label || 'questa chiave di riserva'} (${keyDeleteTarget?.maskedKey})?`
        }
        confirmLabel="Rimuovi"
        cancelLabel="Annulla"
        onClose={() => setKeyDeleteTarget(null)}
        onConfirm={handleConfirmDeleteKey}
      />
    </>
  );
};
