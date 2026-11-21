import { reportClientError } from '../../diagnostics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, HardDrive, SlidersHorizontal, Loader2, X, LifeBuoy, Tag, Cloud } from 'lucide-react';
import type { ApiUsageResult, ModelOption } from '../../bridge';
import { ConfirmActionModal } from './ConfirmActionModal';
import { UnsavedChangesHint } from './UnsavedChangesHint';
import { ApiKeySection, type DeleteKeyTarget } from './settings/ApiKeySection';
import { ModelSection } from './settings/ModelSection';
import { WebStoragePage } from './settings/WebStoragePage';
import { prefetchWebStorage } from './settings/webStorageSnapshot';
import { WebDrivePage } from './settings/WebDrivePage';
import { ExternalLinkIcon } from '../ExternalLinkIcon';
import { DiagnosticsSection } from './settings/DiagnosticsSection';
import { ApiStatusSection } from './settings/ApiStatusSection';
import { WebSharedDeviceNotice } from './settings/WebSharedDeviceNotice';
import { SettingsDivider, SettingsPageHeader, SettingsSectionHeading } from './settings/SettingsLayout';

import { useSettingsStorage } from '../../hooks/useSettingsStorage';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { APP_VERSION, WEB_PREVIEW_BUILD, WEB_PRIVACY_PATH } from '../../branding';
import { DURATION, largeModalCard } from '../../motion';


function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SettingsAuthProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  fallbackKeys: string[];
  setFallbackKeys: React.Dispatch<React.SetStateAction<string[]>>;
  configuredFallbackKeyCount?: number;
}

export interface SettingsModelsProps {
  preferredModel: string;
  setPreferredModel: (model: string) => void;

  availableModels: ModelOption[];
}

export interface SettingsStorageProps {
  /** Web build: a backup was imported, the archive must be reloaded. */
  onArchiveImported?: () => void;
  /** Web build: grows each time a Drive sync changes the archive; an open Archiviazione re-reads the space. */
  archiveRevision?: number;
  /** Web build: "Vedi quali" on the sbobine's audio: the archive, filtered to the sbobine that keep it. */
  onShowKeptAudio?: () => void;
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appendConsole: (msg: string) => void;
  onSettingsSaved?: () => Promise<unknown> | unknown;
  auth: SettingsAuthProps;
  models: SettingsModelsProps;
  storage?: SettingsStorageProps;
  /** Section shown when the modal opens, e.g. the backup from the moved-address notice. */
  initialTab?: SettingsTab;
}

// 'drive' exists only in web builds with the Google Drive sync.
export type SettingsTab = 'general' | 'drive' | 'storage' | 'diagnostics';
type TabType = SettingsTab;

const TAB_HEADERS: Record<TabType, { title: string; description: string }> = {
  general: {
    title: 'Generale',
    description: 'Modello di trascrizione e chiavi API Google Gemini salvate in questo browser.',
  },
  drive: {
    title: 'Google Drive',
    description: 'Una copia delle sbobine nel tuo Google Drive, per ritrovarle sugli altri dispositivi.',
  },
  storage: {
    title: 'Archiviazione',
    description: 'Dove sono le tue sbobine, come farne una copia e come recuperare quelle eliminate.',
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
      initial={largeModalCard.initial}
      animate={hasPainted ? largeModalCard.animate : largeModalCard.initial}
      exit={largeModalCard.exit}
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
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appendConsole,
  onSettingsSaved,
  auth,
  models,
  storage,
  initialTab,
}) => {
  const {
    apiKey,
    setApiKey,
    fallbackKeys,
    setFallbackKeys,
    configuredFallbackKeyCount,
  } = auth;
  const {
    preferredModel,
    setPreferredModel,

    availableModels,
  } = models;
  // Drive sits right under Generale, so the sync is seen as soon as the settings open.
  const hasDriveTab = Boolean(window.pywebview?.api?.get_drive_status);
  const [activeTab, setActiveTab] = useState<TabType>(initialTab ?? 'general');
  useEffect(() => {
    if (isOpen && initialTab) setActiveTab(initialTab);
  }, [isOpen, initialTab]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiUsage, setApiUsage] = useState<ApiUsageResult | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [keyDeleteTarget, setKeyDeleteTarget] = useState<DeleteKeyTarget | null>(null);

  const isSavingRef = useRef(false);
  const isMountedRef = useRef(true);
  const settingsSnapshotRef = useRef<SettingsSnapshot | null>(null);
  const wasOpenRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab, isOpen]);

  const { sessionInfo, isLoadingSessionInfo, fetchSessionStorageInfo } = useSettingsStorage({ isOpen, activeTab });

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
      };
    } else if (!isOpen) {
      settingsSnapshotRef.current = null;
    }
    wasOpenRef.current = isOpen;
  }, [apiKey, fallbackKeys, isOpen, preferredModel]);

  const snapshot = settingsSnapshotRef.current;
  const hasPendingChanges = Boolean(snapshot && (
    apiKey !== snapshot.apiKey ||
    preferredModel !== snapshot.preferredModel ||
    JSON.stringify(fallbackKeys) !== JSON.stringify(snapshot.fallbackKeys)
  ));
  const showCloseOnly = activeTab !== 'general' && !hasPendingChanges;

  const usageRequestIdRef = useRef(0);
  const fetchApiUsage = useCallback(async (forceRefresh = false) => {
    if (!window.pywebview?.api?.get_api_usage) return;
    const requestId = ++usageRequestIdRef.current;
    setIsLoadingUsage(true);
    try {
      const res = await window.pywebview.api.get_api_usage(
        apiKey.trim(),
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
  }, [apiKey, fallbackKeys, preferredModel]);

  const handleRefreshUsage = useCallback(() => {
    void fetchApiUsage(true);
  }, [fetchApiUsage]);

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'general') {
        void fetchApiUsage();
      }
      if (activeTab === 'storage') {
        void fetchSessionStorageInfo({ reuse: true });
      }
    }
  }, [isOpen, activeTab, fetchApiUsage, fetchSessionStorageInfo]);

  // Web build: Archiviazione's figures come from reading this browser's whole archive. They are read
  // as soon as the settings open, so the tab shows at once like the others instead of waiting for them.
  useEffect(() => {
    if (!isOpen) return;
    fetchSessionStorageInfo({ reuse: true });
    prefetchWebStorage();
  }, [isOpen, fetchSessionStorageInfo]);

  // A Drive sync changed the archive (a sbobina restored or trashed on another device) while
  // Archiviazione is open: its figures follow, as the trash list below already does.
  const archiveRevision = storage?.archiveRevision;
  const seenArchiveRevisionRef = useRef(archiveRevision);
  useEffect(() => {
    if (archiveRevision === seenArchiveRevisionRef.current) return;
    seenArchiveRevisionRef.current = archiveRevision;
    if (isOpen && activeTab === 'storage') fetchSessionStorageInfo({ quiet: true });
  }, [archiveRevision, isOpen, activeTab, fetchSessionStorageInfo]);

  useEffect(() => {
    if (isOpen) {
      setSaveError(null);
      setIsSaving(false);
      isSavingRef.current = false;
    } else {
      setActiveTab('general');
    }
  }, [isOpen]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSaveError(null);
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
        const err = 'Salvataggio non disponibile: impostazioni non salvate.';
        if (isMountedRef.current) setSaveError(err);
        appendConsole(`❌ ${err}`);
        return;
      }
      const keys = fallbackKeys.map(k => k.trim()).filter(Boolean);
      let result;
      try {
        const apiKeyPayload = apiKey.trim();
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
      settingsSnapshotRef.current = { apiKey, fallbackKeys: [...fallbackKeys], preferredModel };
      try {
        await onSettingsSaved?.();
      } catch (e: unknown) {
        appendConsole(`⚠ Impostazioni salvate, ma l'aggiornamento dello stato non è riuscito: ${getErrorMessage(e)}`);
      }
      onClose();
    } finally {
      isSavingRef.current = false;
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  const handleClose = useCallback(() => {
    if (isSavingRef.current) return;
    const snapshot = settingsSnapshotRef.current;
    if (snapshot) {
      setApiKey(snapshot.apiKey);
      setFallbackKeys([...snapshot.fallbackKeys]);
      setPreferredModel(snapshot.preferredModel);
    }
    onClose();
  }, [onClose, setApiKey, setFallbackKeys, setPreferredModel]);
  // Only the edits "Salva e Chiudi" would keep count: Drive, storage and key removal apply at once.
  const backdrop = useBackdropDismiss({ dirty: hasPendingChanges, onClose: handleClose, blocked: isSaving });

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
      } else {
        setApiKey('');
      }
    } else if (keyDeleteTarget.type === 'fallback' && typeof keyDeleteTarget.index === 'number') {
      const cleaned = fallbackKeys.map(k => k.trim()).filter(Boolean);
      const updated = cleaned.filter((_, idx) => idx !== keyDeleteTarget.index);
      setFallbackKeys(updated);
    }

    setKeyDeleteTarget(null);
  }, [fallbackKeys, keyDeleteTarget, setApiKey, setFallbackKeys]);

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
          <div className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast }}
              className="modal-overlay absolute inset-0"
              onClick={backdrop.onBackdropClick}
              data-testid="settings-backdrop"
            />

            <SettingsCard className={`modal-card${backdrop.shaking ? ' is-shaking' : ''} relative w-full max-w-md md:max-w-4xl h-[85vh] md:h-[80vh] overflow-hidden flex flex-col md:flex-row`}>
              <nav
                aria-label="Sezioni delle impostazioni"
                className="settings-nav app-scroll"
                style={{ '--settings-tab-count': hasDriveTab ? 4 : 3 } as React.CSSProperties}
              >
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

                {hasDriveTab && (
                  <button
                    type="button"
                    onClick={() => handleTabChange('drive')}
                    aria-current={activeTab === 'drive' ? 'page' : undefined}
                    className={`settings-nav-item ${activeTab === 'drive' ? 'is-active' : ''}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Cloud className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'drive' ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'}`} />
                      {/* Named after the service, in full as Google asks: shorter than "Archiviazione",
                          it fits the phone's tab row too. */}
                      <span className="truncate">Google Drive</span>
                    </div>
                  </button>
                )}

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

              </nav>

              <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-[var(--bg-surface)] relative">
                {/* One close button for both layouts (index.css .settings-close), over the right end
                    of the page title, so the tabs of the compact card keep the whole row. */}
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSaving}
                  className="icon-button modal-icon-button settings-close"
                  aria-label="Chiudi finestra"
                >
                  <X className="w-4 h-4" />
                </button>
                {/* The page title stays put above the scrolling content and leaves room for the
                    close button placed over its right end. */}
                <div className="pl-6 pr-14 md:pl-8 md:pr-16 pt-6 md:pt-8 pb-4 border-b border-[var(--border-subtle)]">
                  <SettingsPageHeader {...TAB_HEADERS[activeTab]} />
                </div>
                <div ref={contentRef} data-testid="settings-content" className="app-scroll flex-1 overflow-y-auto overflow-x-hidden px-6 md:px-8 pt-5 pb-6 md:pb-8 space-y-6 [scrollbar-gutter:stable]">
                  {activeTab === 'general' && (
                    <div className="space-y-6 animate-fade-in">
                      <ModelSection
                        preferredModel={preferredModel}
                        setPreferredModel={setPreferredModel}
                        availableModels={availableModels}
                      />

                      <SettingsDivider />

                      <ApiKeySection
                        apiKey={apiKey}
                        setApiKey={setApiKey}
                        fallbackKeys={fallbackKeys}
                        setFallbackKeys={setFallbackKeys}
                        apiUsage={apiUsage}
                        isLoadingUsage={isLoadingUsage}
                        preferredModel={preferredModel}
                        onAskDeleteKey={setKeyDeleteTarget}
                        onRefreshUsage={handleRefreshUsage}
                        statusSummary={<ApiStatusSection apiUsage={apiUsage} isLoadingUsage={isLoadingUsage} />}
                      />

                      <WebSharedDeviceNotice
                        keyCount={webKeyCount}
                        onRemoveKeys={() => void handleRemoveWebKeys()}
                        disabled={isSaving}
                      />

                      <SettingsDivider />
                      <div className="space-y-2" data-testid="web-version">
                        <SettingsSectionHeading icon={Tag}>Versione</SettingsSectionHeading>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {WEB_PREVIEW_BUILD ? `${APP_VERSION} (anteprima)` : APP_VERSION}. Gli aggiornamenti arrivano da soli alla prossima apertura del sito, senza toccare sbobine e chiavi salvate in questo browser.
                        </p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          Cosa resta nel browser e cosa va a Google:{' '}
                          <a href={WEB_PRIVACY_PATH} target="_blank" rel="noopener" className="underline inline-flex items-center gap-0.5">informativa sulla privacy<ExternalLinkIcon /></a>.
                        </p>
                      </div>
                    </div>
                  )}

                  {activeTab === 'drive' && hasDriveTab && (
                    <div className="space-y-6 animate-fade-in">
                      <WebDrivePage />
                    </div>
                  )}

                  {activeTab === 'storage' && (
                    <div className="space-y-6 animate-fade-in">
                      <WebStoragePage
                        sessionInfo={sessionInfo}
                        isLoadingSessionInfo={isLoadingSessionInfo}
                        onOpenDrive={hasDriveTab ? () => handleTabChange('drive') : undefined}
                        onShowKeptAudio={storage?.onShowKeptAudio}
                        onArchiveChanged={() => {
                          storage?.onArchiveImported?.();
                          // The page is open: its figures stay until the new ones arrive.
                          fetchSessionStorageInfo({ quiet: true });
                        }}
                      />
                    </div>
                  )}

                  {activeTab === 'diagnostics' && (
                    <div className="space-y-6 animate-fade-in">
                      <DiagnosticsSection onCopyReport={handleCopyReport} />
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
                    <UnsavedChangesHint show={backdrop.showHint && !saveError} />
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
                      className={`modal-action-button is-primary${backdrop.shaking ? ' is-attention' : ''}`}
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
