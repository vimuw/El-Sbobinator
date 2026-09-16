import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuotasSection } from './QuotasSection';
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

  it('renders operational hero, work stats, telemetry, project limits, and credentials', () => {
    const onRefreshUsage = vi.fn();
    render(
      <QuotasSection
        apiUsage={dummyUsage}
        isLoadingUsage={false}
        onRefreshUsage={onRefreshUsage}
      />
    );

    expect(screen.getByText('Quote & Telemetria API')).toBeTruthy();
    expect(screen.getByText('API Google Gemini Operativa')).toBeTruthy();
    expect(screen.getByText('Lavoro Svolto Oggi')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy(); // Chunks
    expect(screen.getByText('Telemetria Chiamate')).toBeTruthy();
    expect(screen.getByText('19')).toBeTruthy(); // Inviate
    expect(screen.getByText('Limiti di Progetto & Modelli')).toBeTruthy();
    expect(screen.getByText('gemini-2.5-flash')).toBeTruthy();
    expect(screen.getByText('Stato Chiavi Configurate')).toBeTruthy();
    expect(screen.getByText('Chiave Principale')).toBeTruthy();
    expect(screen.getByText('Progetto: 1234567890')).toBeTruthy();
    expect(screen.getByText('Attiva')).toBeTruthy();
    expect(screen.getByText('Non utilizzata')).toBeTruthy();

    const refreshBtn = screen.getByLabelText('Aggiorna conteggio quote');
    fireEvent.click(refreshBtn);
    expect(onRefreshUsage).toHaveBeenCalled();
  });

  it('renders rate limited status hero banner when rate limited', () => {
    const rateLimitedUsage: ApiUsageResult = {
      ...dummyUsage,
      primary_status: 'rate_limited',
      retry_after_seconds: 42,
      status_message: 'In attesa per rate limit temporaneo.',
    };

    render(
      <QuotasSection
        apiUsage={rateLimitedUsage}
        isLoadingUsage={false}
      />
    );

    expect(screen.getByText('In attesa — Rate limit temporaneo')).toBeTruthy();
    expect(screen.getByText('In attesa per rate limit temporaneo.')).toBeTruthy();
  });

  it('renders quota exhausted status hero banner when RPD is exhausted', () => {
    const exhaustedUsage: ApiUsageResult = {
      ...dummyUsage,
      primary_status: 'quota_exhausted',
      status_message: 'Quota giornaliera (RPD) esaurita. Reset alle ore 09:00 (fuso PT).',
    };

    render(
      <QuotasSection
        apiUsage={exhaustedUsage}
        isLoadingUsage={false}
      />
    );

    expect(screen.getByText('Quota giornaliera esaurita (RPD)')).toBeTruthy();
    expect(
      screen.getByText('Quota giornaliera (RPD) esaurita. Reset alle ore 09:00 (fuso PT).')
    ).toBeTruthy();
  });

  it('renders credential error hero banner when credentials fail', () => {
    const credentialErrorUsage: ApiUsageResult = {
      ...dummyUsage,
      primary_status: 'credential_error',
      status_message: 'Chiave API non valida (HTTP 401). Verifica le impostazioni.',
      credentials: [
        {
          id: 'key-1',
          label: 'Chiave Principale',
          masked_key: 'AIza...dbtI',
          is_primary: true,
          operational_status: 'invalid',
          last_error_message: 'API_KEY_INVALID: API key not valid. Please pass a valid API key.',
        },
      ],
    };

    render(
      <QuotasSection
        apiUsage={credentialErrorUsage}
        isLoadingUsage={false}
      />
    );

    expect(screen.getByText('Errore Autenticazione API')).toBeTruthy();
    expect(screen.getByText(/Non valida \(401\)/)).toBeTruthy();
    expect(
      screen.getByText(/API_KEY_INVALID: API key not valid/)
    ).toBeTruthy();
  });

  it('renders fallback text when no apiUsage is provided', () => {
    render(
      <QuotasSection
        apiUsage={null}
        isLoadingUsage={false}
      />
    );

    expect(
      screen.getByText(/Inserisci una chiave API per visualizzare lo stato operativo/i)
    ).toBeTruthy();
  });
});
