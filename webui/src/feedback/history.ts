import type { FeedbackKind } from '../monitoring/sentry';
import { scrubText } from '../monitoring/scrub';

// The codes of the reports this browser sent, so the user can quote one later (Impostazioni →
// Assistenza). Code, date, type and the start of what the user wrote, so they can tell which report
// a code belongs to; the whole text went to Sentry and stays there.

export const REPORT_HISTORY_KEY = 'el-sbobinator-web-feedback-codes';
export const MAX_REPORT_HISTORY = 5;
/** How much of the description is kept: a line in the list, enough to recognise it. */
export const REPORT_EXCERPT_LENGTH = 80;
/** Sentry deletes a report after 30 days (privacy.html): an older code leads to nothing, so it goes. */
export const REPORT_MAX_AGE_DAYS = 30;
const REPORT_MAX_AGE_MS = REPORT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export interface SentReport {
  code: string;
  /** ISO date of the send. */
  sentAt: string;
  kind: FeedbackKind;
  /** The start of the description, on one line and masked; missing on reports saved before it was kept. */
  excerpt?: string;
}

const KINDS: ReadonlySet<string> = new Set<FeedbackKind>(['bug', 'idea', 'altro']);
const CODE_PATTERN = /^[0-9A-F]{8}$/;
const listeners = new Set<() => void>();
// Blocked site data or a failed write (quota full): the list lasts for this page only.
let fallback: SentReport[] = [];
// The last write failed, so the saved list (if readable) misses the newest codes.
let unsaved = false;

/**
 * The start of a description as the list shows it: one line, with emails and keys masked like the
 * tech info, since it stays in this browser in clear.
 */
export function reportExcerpt(message: string): string {
  return scrubText(message.replace(/\s+/g, ' ').trim(), REPORT_EXCERPT_LENGTH);
}

function isSentReport(value: unknown): value is SentReport {
  if (!value || typeof value !== 'object') return false;
  const { code, sentAt, kind, excerpt } = value as Record<string, unknown>;
  return typeof code === 'string' && CODE_PATTERN.test(code)
    && typeof sentAt === 'string' && !Number.isNaN(Date.parse(sentAt))
    && typeof kind === 'string' && KINDS.has(kind)
    && (excerpt === undefined || (typeof excerpt === 'string' && excerpt.length <= REPORT_EXCERPT_LENGTH + 1));
}

function isStillKept(report: SentReport, now: number): boolean {
  // A date ahead of the clock (a clock set back) still counts as recent.
  return now - Date.parse(report.sentAt) < REPORT_MAX_AGE_MS;
}

function readSaved(storage: Pick<Storage, 'getItem'> | undefined): SentReport[] {
  if (unsaved) return fallback;
  try {
    const raw = storage?.getItem(REPORT_HISTORY_KEY);
    if (raw == null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSentReport) : [];
  } catch {
    return fallback;
  }
}

/** The codes Sentry still holds, newest first. */
export function loadReportHistory(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SentReport[] {
  const now = Date.now();
  return readSaved(storage).filter(report => isStillKept(report, now)).slice(0, MAX_REPORT_HISTORY);
}

/** Newest first; sending the same code again moves it to the top. Expired codes are dropped. */
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
