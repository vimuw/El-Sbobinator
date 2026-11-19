import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_REPORT_HISTORY, REPORT_EXCERPT_LENGTH, REPORT_HISTORY_KEY, REPORT_MAX_AGE_DAYS, loadReportHistory, rememberReport, reportExcerpt, resetReportHistoryForTests, subscribeReportHistory, type SentReport } from './history';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

function report(index: number, kind: SentReport['kind'] = 'bug'): SentReport {
  return { code: `A1B2C3${String(index).padStart(2, '0')}`, sentAt: new Date(Date.UTC(2026, 10, 17, 10, index)).toISOString(), kind };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = Date.UTC(2026, 10, 18, 12);

// The fixture dates are fixed: the clock is pinned the day after, so they never turn 30 days old.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(TODAY); });
afterEach(() => { vi.useRealTimers(); resetReportHistoryForTests(); });

describe('report history', () => {
  it('keeps the last five codes, newest first, without repeating one', () => {
    const storage = memoryStorage();
    for (let index = 0; index < MAX_REPORT_HISTORY + 2; index++) rememberReport(report(index), storage);
    rememberReport(report(4, 'idea'), storage);

    const history = loadReportHistory(storage);
    expect(history.map(entry => entry.code)).toEqual(['A1B2C304', 'A1B2C306', 'A1B2C305', 'A1B2C303', 'A1B2C302']);
    expect(history[0].kind).toBe('idea');
    // Only code, date and type are kept.
    expect(Object.keys(JSON.parse(storage.getItem(REPORT_HISTORY_KEY)!)[0]).sort()).toEqual(['code', 'kind', 'sentAt']);
  });

  // Regression: with only code, type and date, two reports of the same week could not be told apart.
  it('keeps the start of the description, on one line and masked, to tell the reports apart', () => {
    const excerpt = reportExcerpt('Il titolo non si salva.\n\n  Scrivetemi a mario.rossi@example.com, chiave AIzaSyA1234567890abcdefghijklmnopqrstuv');
    expect(excerpt).toBe('Il titolo non si salva. Scrivetemi a [nascosto], chiave [nascosto]');
    const long = reportExcerpt('a'.repeat(REPORT_EXCERPT_LENGTH + 40));
    expect(long).toBe(`${'a'.repeat(REPORT_EXCERPT_LENGTH)}…`);

    const storage = memoryStorage();
    rememberReport({ ...report(1), excerpt: long }, storage);
    expect(loadReportHistory(storage)).toEqual([{ ...report(1), excerpt: long }]);
  });

  it('reads a saved code without an excerpt, but not a broken excerpt', () => {
    const storage = memoryStorage({
      [REPORT_HISTORY_KEY]: JSON.stringify([report(1), { ...report(2), excerpt: 42 }, { ...report(3), excerpt: 'x'.repeat(500) }]),
    });
    expect(loadReportHistory(storage)).toEqual([report(1)]);
  });

  it('ignores what it did not write', () => {
    const storage = memoryStorage({
      [REPORT_HISTORY_KEY]: JSON.stringify([report(1), { code: 'nope', sentAt: 'ieri', kind: 'bug' }, { ...report(2), kind: 'spam' }, 'testo']),
    });
    expect(loadReportHistory(storage).map(entry => entry.code)).toEqual(['A1B2C301']);
    expect(loadReportHistory(memoryStorage({ [REPORT_HISTORY_KEY]: '{rotto' }))).toEqual([]);
  });

  it('keeps the list for this page when site data is blocked', () => {
    const blocked = {
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    };
    rememberReport(report(1), blocked);
    expect(loadReportHistory(blocked).map(entry => entry.code)).toEqual(['A1B2C301']);
  });

  it('still lists a new code when the saved list can be read but not rewritten', () => {
    // Quota full: the old list is still readable, the new code was never written.
    const storage = memoryStorage({ [REPORT_HISTORY_KEY]: JSON.stringify([report(1)]) });
    const writable = storage.setItem;
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };

    rememberReport(report(2), storage);
    expect(loadReportHistory(storage).map(entry => entry.code)).toEqual(['A1B2C302', 'A1B2C301']);
    rememberReport(report(3), storage);
    expect(loadReportHistory(storage).map(entry => entry.code)).toEqual(['A1B2C303', 'A1B2C302', 'A1B2C301']);

    // Once a write works again, the saved list holds everything and is read as usual.
    storage.setItem = writable;
    rememberReport(report(4), storage);
    expect(JSON.parse(storage.getItem(REPORT_HISTORY_KEY)!).map((entry: SentReport) => entry.code))
      .toEqual(['A1B2C304', 'A1B2C303', 'A1B2C302', 'A1B2C301']);
    storage.setItem(REPORT_HISTORY_KEY, JSON.stringify([report(5)]));
    expect(loadReportHistory(storage).map(entry => entry.code)).toEqual(['A1B2C305']);
  });

  // Sentry deletes a report after 30 days: a code past that pointed to nothing the developer could find.
  it('drops the codes Sentry no longer holds, from the list and from the next save', () => {
    const sentDaysAgo = (code: string, days: number): SentReport => ({ code, sentAt: new Date(TODAY - days * DAY_MS).toISOString(), kind: 'bug' });
    const storage = memoryStorage({
      [REPORT_HISTORY_KEY]: JSON.stringify([
        sentDaysAgo('0000000A', 1),
        sentDaysAgo('0000000B', REPORT_MAX_AGE_DAYS - 0.01),
        sentDaysAgo('0000000C', REPORT_MAX_AGE_DAYS),
        sentDaysAgo('0000000D', 90),
      ]),
    });
    expect(loadReportHistory(storage).map(entry => entry.code)).toEqual(['0000000A', '0000000B']);

    // A day later the second one is gone too, and a new send no longer writes the expired ones back.
    vi.setSystemTime(TODAY + DAY_MS);
    rememberReport(sentDaysAgo('0000000E', -1), storage);
    expect(JSON.parse(storage.getItem(REPORT_HISTORY_KEY)!).map((entry: SentReport) => entry.code)).toEqual(['0000000E', '0000000A']);
  });

  it('drops expired codes kept only for this page', () => {
    const blocked = {
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    };
    rememberReport(report(1), blocked);
    vi.setSystemTime(TODAY + REPORT_MAX_AGE_DAYS * DAY_MS);
    expect(loadReportHistory(blocked)).toEqual([]);
  });

  it('tells an open Diagnostica about a new code', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReportHistory(listener);
    rememberReport(report(1), memoryStorage());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    rememberReport(report(2), memoryStorage());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
