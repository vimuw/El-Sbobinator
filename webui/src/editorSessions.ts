import { STORAGE_KEYS } from './storageKeys';

export const EDITOR_SESSION_STORAGE_KEY = STORAGE_KEYS.EDITOR_SESSIONS_V1;
const EDITOR_SESSION_TTL_DAYS = 30;

/** What the audio dock showed: a player, the audio this device cannot find, or no audio at all. */
export type AudioDockKind = 'player' | 'missing' | 'none';

export type EditorSession = {
  audioTime?: number;
  /** The lecture's length, so a reopened player draws the saved position before the file loads. */
  audioDuration?: number;
  /** The dock at the last closing, drawn again while the audio gets ready on the next opening. */
  audioDock?: AudioDockKind;
  playbackRate?: number;
  volume?: number;
  scrollTop?: number;
  savedAt?: number;
  openedAt?: number;
};

type EditorSessionMap = Record<string, EditorSession>;

const hasSessionState = (session: EditorSession): boolean =>
  session.audioTime !== undefined
  || session.playbackRate !== undefined
  || session.volume !== undefined
  || session.scrollTop !== undefined
  || session.audioDock !== undefined
  || session.openedAt !== undefined;

export const normalizeEditorSessions = (
  sessions: EditorSessionMap,
  now: number = Date.now(),
): EditorSessionMap => {
  const cutoff = now - EDITOR_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

  return Object.fromEntries(
    Object.entries(sessions).flatMap(([key, session]) => {
      if (!session || typeof session !== 'object' || !hasSessionState(session)) {
        return [];
      }
      const cleanSession: EditorSession = {
        ...(session.audioTime !== undefined ? { audioTime: session.audioTime } : {}),
        ...(session.audioDuration !== undefined ? { audioDuration: session.audioDuration } : {}),
        ...(session.audioDock === 'player' || session.audioDock === 'missing' || session.audioDock === 'none' ? { audioDock: session.audioDock } : {}),
        ...(session.playbackRate !== undefined ? { playbackRate: session.playbackRate } : {}),
        ...(session.volume !== undefined ? { volume: session.volume } : {}),
        ...(session.scrollTop !== undefined ? { scrollTop: session.scrollTop } : {}),
        ...(session.openedAt !== undefined ? { openedAt: session.openedAt } : {}),
        savedAt: typeof session.savedAt === 'number' ? session.savedAt : now,
      };

      if (typeof session.savedAt === 'number') {
        return session.savedAt >= cutoff ? [[key, cleanSession]] : [];
      }
      return [[key, cleanSession]];
    }),
  );
};

export const loadAllEditorSessions = (now: number = Date.now()): EditorSessionMap => {
  try {
    const raw = window.localStorage.getItem(EDITOR_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EditorSessionMap;
    const sessions = normalizeEditorSessions(parsed, now);
    const normalizedRaw = JSON.stringify(sessions);
    if (normalizedRaw !== raw) {
      window.localStorage.setItem(EDITOR_SESSION_STORAGE_KEY, normalizedRaw);
    }
    return sessions;
  } catch (_) {
    return {};
  }
};

export const loadEditorSession = (key: string): EditorSession => {
  try {
    const sessions = loadAllEditorSessions();
    return sessions[key] ?? {};
  } catch (_) {
    return {};
  }
};

export const saveEditorSession = (key: string, session: EditorSession) => {
  try {
    const now = Date.now();
    const raw = window.localStorage.getItem(EDITOR_SESSION_STORAGE_KEY) ?? '{}';
    const parsed = JSON.parse(raw) as EditorSessionMap;
    const sessions = normalizeEditorSessions(
      { ...parsed, [key]: { ...session, savedAt: now } },
      now,
    );
    window.localStorage.setItem(EDITOR_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch (_) {}
};

export const touchEditorSession = (key: string, timestampMs: number = Date.now()) => {
  try {
    const raw = window.localStorage.getItem(EDITOR_SESSION_STORAGE_KEY) ?? '{}';
    const parsed = JSON.parse(raw) as EditorSessionMap;
    const existing = parsed[key] ?? {};
    const updated = { ...existing, openedAt: timestampMs, savedAt: timestampMs };
    const sessions = normalizeEditorSessions(
      { ...parsed, [key]: updated },
      timestampMs,
    );
    window.localStorage.setItem(EDITOR_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch (_) {}
};
