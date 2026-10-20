import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuotasSection } from './QuotasSection';
import { ApiStatusSection } from './ApiStatusSection';
import type { ApiUsageResult } from '../../../bridge';

describe('QuotasSection', () => {
  const dummyUsage: ApiUsageResult = {
    schema_version: 2,
    quota_date: '2026-09-02',
    primary_status: 'operational',
    status_message: 'API Google Gemini operative.',
    next_reset_info: 'Reset quote: ore 09:00 (fuso Google PT)',
    is_degraded_mode: false,
    degraded_reason: null,
    project_limits: {
      'gemini-2.5-flash': {
        model_name: 'gemini-2.5-flash',
        rpd_limit: 20,
        rpm_limit: 5,
        tpm_limit: 250000,
        source: 'configured',
        quota_state: 'normal',
      },
      'gemini-3.6-flash': {
        model_name: 'gemini-3.6-flash',
        rpd_limit: 500,
        rpm_limit: 15,
        tpm_limit: 1000000,
        source: 'configured',
        quota_state: 'normal',
      },
    },
    work_stats: {
      chunks_completed: 12,
      revisions_completed: 7,
      sbobine_completed: 1,
    },
    telemetry: {
      requests_sent: 19,
      responses_succeeded: 18,
      final_failures: 0,
      retries_total: 1,
      retries_by_type: {
        server_error_503: 1,
      },
    },
    credentials: [
      {
        id: 'key-1',
        label: 'Chiave Principale',
        masked_key: 'AIza...dbtI',
        is_primary: true,
        operational_status: 'active',
        project_id: '1234567890',
      },
      {
        id: 'key-2',
        label: 'Chiave Riserva 1',
        masked_key: 'AIza...Tih4',
        is_primary: false,
        operational_status: 'unused',
        project_id: null,
      },
    ],
  };

  it('keeps model quotas collapsed without activity or configuration links', () => {
    const { container } = render(<QuotasSection apiUsage={dummyUsage} />);
    expect(Array.from(container.querySelectorAll('summary')).map(el => el.textContent?.trim()))
      .toEqual(['Quote per modello']);
    expect(container.querySelector('details')?.open).toBe(false);
    const selectedModel = screen.getByText('Gemini 3.6 Flash');
    expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy();
    expect(screen.getByText('Gemini 3.8 Flash')).toBeTruthy();
    expect(screen.queryByText('Gemini 3.5 Flash')).toBeNull();
    expect(screen.queryByText('Gemini 3.7 Flash')).toBeNull();
    expect(screen.getAllByText('Selezionato')).toHaveLength(1);
    expect(selectedModel.parentElement?.contains(screen.getByText('Selezionato'))).toBe(true);
    expect(screen.queryByText('Attività di oggi')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Configura modelli in Generale' })).toBeNull();
  });

  it('titles the model quotas row in sentence case', () => {
    const { container } = render(<QuotasSection apiUsage={dummyUsage} />);
    const label = container.querySelector('summary > span');

    expect(label?.textContent?.trim()).toBe('Quote per modello');
    expect(label?.className).not.toContain('uppercase');
  });

  it.each([
    ['rate_limited', 'In attesa: ripresa automatica'],
    ['quota_exhausted', 'Quota giornaliera esaurita'],
    ['credential_error', 'Verifica la chiave API'],
  ] as const)('shows a compact actionable status for %s', (status, title) => {
    render(<ApiStatusSection apiUsage={{ ...dummyUsage, primary_status: status }} />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.queryByText('Quote per modello')).toBeNull();
    expect(screen.queryByText('Attività di oggi')).toBeNull();
  });

  it.each(['operational', 'degraded'] as const)('hides the status banner when %s', status => {
    const { container } = render(<ApiStatusSection apiUsage={{ ...dummyUsage, primary_status: status }} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not claim readiness without telemetry or while refreshing', () => {
    const props = {};
    const { rerender } = render(<ApiStatusSection {...props} apiUsage={null} />);
    expect(screen.getByText('Stato API non disponibile')).toBeTruthy();
    rerender(<ApiStatusSection {...props} apiUsage={dummyUsage} isLoadingUsage />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Puoi continuare a trascrivere')).toBeNull();
    rerender(<ApiStatusSection {...props} apiUsage={{ ...dummyUsage, credentials: [] }} />);
    expect(screen.getByText('Configura una chiave API')).toBeTruthy();
  });

  it('keeps actionable errors visible while refreshing without a loading banner', () => {
    render(<ApiStatusSection apiUsage={{ ...dummyUsage, primary_status: 'credential_error' }} isLoadingUsage />);
    expect(screen.getByText('Verifica la chiave API')).toBeTruthy();
    expect(screen.queryByText('Verifica dello stato API…')).toBeNull();
  });

  it('does not show a temporary unavailable banner during the initial verification', () => {
    const { container } = render(<ApiStatusSection apiUsage={null} isLoadingUsage />);
    expect(container.firstChild).toBeNull();
  });
});
