import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageUsagePart } from '../bridge';

export interface SessionStorageInfo {
  total_bytes: number;
  total_sessions: number;
  session_root: string;
  /** Host's breakdown of the space, shown under the total (audio, texts, browser estimate). */
  usage_detail?: string;
  /** The same space, part by part, and the browser's own (often lower) estimate. */
  usage_breakdown?: StorageUsagePart[];
  browser_estimate_bytes?: number;
  /** Whether the browser promised to keep the data (navigator.storage.persisted()). */
  persisted?: boolean;
}

function toSessionInfo(res: Omit<SessionStorageInfo, 'total_bytes' | 'total_sessions' | 'session_root'> & { total_bytes?: number; total_sessions?: number; session_root?: string }): SessionStorageInfo {
  return {
    total_bytes: res.total_bytes ?? 0,
    total_sessions: res.total_sessions ?? 0,
    session_root: res.session_root ?? '',
    ...(res.usage_detail ? { usage_detail: res.usage_detail } : {}),
    ...(res.usage_breakdown?.length ? { usage_breakdown: res.usage_breakdown } : {}),
    ...(typeof res.browser_estimate_bytes === 'number' ? { browser_estimate_bytes: res.browser_estimate_bytes } : {}),
    ...(typeof res.persisted === 'boolean' ? { persisted: res.persisted } : {}),
  };
}

export interface UseSettingsStorageOptions {
  isOpen: boolean;
  activeTab: string;
}

/** The space the sbobine take in this browser, read for Impostazioni → Archiviazione. */
export function useSettingsStorage({ isOpen, activeTab }: UseSettingsStorageOptions) {
  const [sessionInfo, setSessionInfo] = useState<SessionStorageInfo | null>(null);
  const [isLoadingSessionInfo, setIsLoadingSessionInfo] = useState(false);

  const isMountedRef = useRef(true);
  const isOpenRef = useRef(isOpen);
  const sessionInfoReqIdRef = useRef(0);
  // The reading in flight, if any: a tab entry joins it instead of starting the count again.
  const pendingSessionInfoReqRef = useRef<number | null>(null);
  const sessionInfoRef = useRef<SessionStorageInfo | null>(null);
  sessionInfoRef.current = sessionInfo;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchSessionStorageInfo = useCallback((options?: { quiet?: boolean; reuse?: boolean }) => {
    if (!window.pywebview?.api?.get_session_storage_info) return;
    // Reuse: opening the settings or the tab. A reading already in flight will answer it, and
    // figures read before stay in view until the new ones arrive, so the page opens at once.
    if (options?.reuse && pendingSessionInfoReqRef.current === sessionInfoReqIdRef.current) return;
    const reqId = ++sessionInfoReqIdRef.current;
    pendingSessionInfoReqRef.current = reqId;
    // Quiet: the archive changed under an open page, whose figures stay until the new ones arrive.
    if (!options?.quiet && !(options?.reuse && sessionInfoRef.current)) {
      setIsLoadingSessionInfo(true);
      setSessionInfo(null);
    }
    try {
      const p = window.pywebview.api.get_session_storage_info();
      if (!p || typeof p.then !== 'function') {
        pendingSessionInfoReqRef.current = null;
        return;
      }
      p.then((res) => {
        if (!isOpenRef.current || !isMountedRef.current || reqId !== sessionInfoReqIdRef.current) return;
        if (res?.ok) {
          setSessionInfo(toSessionInfo(res));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (pendingSessionInfoReqRef.current === reqId) pendingSessionInfoReqRef.current = null;
        if (isOpenRef.current && isMountedRef.current && reqId === sessionInfoReqIdRef.current) {
          setIsLoadingSessionInfo(false);
        }
      });
    } catch {
      pendingSessionInfoReqRef.current = null;
      setIsLoadingSessionInfo(false);
    }
  }, []);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) {
      ++sessionInfoReqIdRef.current;
      return;
    }
    if (activeTab === 'storage') {
      fetchSessionStorageInfo({ reuse: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return {
    sessionInfo,
    isLoadingSessionInfo,
    fetchSessionStorageInfo,
  };
}
