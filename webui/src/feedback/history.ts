import type { FeedbackKind } from '../monitoring/sentry';

// The codes of the reports this browser sent, so the user can quote one later (Impostazioni →
// Assistenza). Only code, date and type: the text went to Sentry and stays there.

export const REPORT_HISTORY_KEY = 'el-sbobinator-web-feedback-codes';
export const MAX_REPORT_HISTORY = 5;

export interface SentReport {
  code: string;
  /** ISO date of the send. */
  sentAt: string;
  kind: FeedbackKind;
}

const KINDS: ReadonlySet<string> = new Set<FeedbackKind>(['bug', 'idea', 'altro']);
const CODE_PATTERN = /^[0-9A-F]{8}$/;
const listeners = new Set<() => void>();
// Blocked site data or a failed write (quota full): the list lasts for this page only.
let fallback: SentReport[] = [];
// The last write failed, so the saved list (if readable) misses the newest codes.
let unsaved = false;

function isSentReport(value: unknown): value is SentReport {
  if (!value || typeof value !== 'object') return false;
  const { code, sentAt, kind } = value as Record<string, unknown>;
  return typeof code === 'string' && CODE_PATTERN.test(code)
    && typeof sentAt === 'string' && !Number.isNaN(Date.parse(sentAt))
    && typeof kind === 'string' && KINDS.has(kind);
}

export function loadReportHistory(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SentReport[] {
  if (unsaved) return fallback;
  try {
    const raw = storage?.getItem(REPORT_HISTORY_KEY);
    if (raw == null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSentReport).slice(0, MAX_REPORT_HISTORY) : [];
  } catch {
    return fallback;
  }
}

/** Newest first; sending the same code again moves it to the top. */
export function rememberReport(report: SentReport, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): void {
  const next = [report, ...loadReportHistory(storage).filter(entry => entry.code !== report.code)].slice(0, MAX_REPORT_HISTORY);
  fallback = next;
  try {
    storage?.setItem(REPORT_HISTORY_KEY, JSON.stringify(next));
    unsaved = false;
  } catch {
    // Kept in `fallback` for this page, which wins over the stale saved list until a write works.
    unsaved = true;
  }
  listeners.forEach(listener => listener());
}

/** Lets an open Assistenza tab show a code sent from the window it opened. */
export function subscribeReportHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function resetReportHistoryForTests(): void {
  fallback = [];
  unsaved = false;
  listeners.clear();
}
