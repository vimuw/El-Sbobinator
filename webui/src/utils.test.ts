import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorLabel, formatDuration, formatRelativeTime, formatSize, isQuotaError, isResumableError, shortModelName } from './utils';

describe('isQuotaError', () => {
  it('returns false for undefined', () => {
    expect(isQuotaError(undefined)).toBe(false);
  });

  it('returns true for quota_daily_limit_phase1', () => {
    expect(isQuotaError('quota_daily_limit_phase1')).toBe(true);
  });

  it('returns true for quota_daily_limit_phase2', () => {
    expect(isQuotaError('quota_daily_limit_phase2')).toBe(true);
  });

  it('returns false for non-quota errors', () => {
    expect(isQuotaError('phase1_all_models_unavailable')).toBe(false);
    expect(isQuotaError('html_export_failed')).toBe(false);
  });
});

describe('isResumableError', () => {
  it('returns false for undefined', () => {
    expect(isResumableError(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isResumableError('')).toBe(false);
  });

  it('returns true for quota_daily_limit_phase1', () => {
    expect(isResumableError('quota_daily_limit_phase1')).toBe(true);
  });

  it('returns true for quota_daily_limit_phase2', () => {
    expect(isResumableError('quota_daily_limit_phase2')).toBe(true);
  });

  it('returns true for phase1_all_models_unavailable', () => {
    expect(isResumableError('phase1_all_models_unavailable')).toBe(true);
  });

  it('returns false for phase1_chunk_failed — persistent failure, not confident-resume', () => {
    expect(isResumableError('phase1_chunk_failed_3')).toBe(false);
  });

  it('returns false for non-resumable errors', () => {
    expect(isResumableError('html_export_failed')).toBe(false);
    expect(isResumableError('processing_failed')).toBe(false);
  });
});

describe('errorLabel', () => {
  it('returns default message for undefined', () => {
    expect(errorLabel(undefined)).toBe('Elaborazione non completata.');
  });

  it('returns default message for empty string', () => {
    expect(errorLabel('')).toBe('Elaborazione non completata.');
  });

  it('returns mapped label for known error key', () => {
    expect(errorLabel('quota_daily_limit_phase1')).toContain('Quota');
  });

  it('returns chunk-specific error for phase1_chunk_failed_ prefix', () => {
    expect(errorLabel('phase1_chunk_failed_3')).toContain('blocco 3');
  });

  it('returns raw string for unknown error key', () => {
    expect(errorLabel('some_unknown_error')).toBe('some_unknown_error');
  });

  it('maps autosave_failed to Italian human-readable message', () => {
    expect(errorLabel('autosave_failed')).toContain('salvataggio sessione fallito');
  });

  it('returns raw key for boundary_ai_failed (no Python emitter, no mapping)', () => {
    expect(errorLabel('boundary_ai_failed')).toBe('boundary_ai_failed');
  });

  it('maps session_collision to Italian human-readable message mentioning Impostazioni', () => {
    const label = errorLabel('session_collision');
    expect(label).toContain('sbobina');
    expect(label).toContain('Impostazioni');
  });
});

describe('formatSize', () => {
  it('formats bytes to KB', () => {
    expect(formatSize(512)).toBe('1 KB');
  });

  it('formats bytes to MB', () => {
    expect(formatSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('formats bytes to GB', () => {
    expect(formatSize(1024 * 1024 * 1024 * 1.2)).toBe('1.2 GB');
  });
});

describe('formatDuration', () => {
  it('returns fallback for 0 seconds', () => {
    expect(formatDuration(0, 'N/A')).toBe('N/A');
  });

  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1m 30s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3661)).toBe('1h 1m');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00'));
  });

  it('returns "adesso" for very recent', () => {
    expect(formatRelativeTime(Date.now() - 30_000)).toBe('adesso');
  });

  it('returns minutes ago', () => {
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5 minuti fa');
  });

  it('returns singular minute for 1 minute ago', () => {
    expect(formatRelativeTime(Date.now() - 61_000)).toBe('1 minuto fa');
  });

  it('returns hours ago', () => {
    expect(formatRelativeTime(Date.now() - 2 * 3600_000)).toBe('2 ore fa');
  });

  it('returns singular for 1 hour ago', () => {
    expect(formatRelativeTime(Date.now() - 3600_000 - 1000)).toBe('1 ora fa');
  });

  it('returns "ieri" for yesterday', () => {
    expect(formatRelativeTime(Date.now() - 25 * 3600_000)).toBe('ieri');
  });

  it('returns days ago for 2-6 days', () => {
    expect(formatRelativeTime(Date.now() - 3 * 24 * 3600_000)).toBe('3 giorni fa');
  });

  it('returns formatted date for older timestamps', () => {
    const old = new Date('2025-11-15').getTime();
    expect(formatRelativeTime(old)).toMatch(/nov|15/i);
  });
});

describe('shortModelName', () => {
  it('returns empty for empty string', () => {
    expect(shortModelName('')).toBe('');
  });

  it('strips models/ prefix', () => {
    expect(shortModelName('models/gemini-2.5-flash')).toBe('2.5-flash');
  });

  it('strips gemini- prefix', () => {
    expect(shortModelName('gemini-2.5-flash')).toBe('2.5-flash');
  });

  it('returns original for non-gemini model', () => {
    expect(shortModelName('claude-3')).toBe('claude-3');
  });
});
