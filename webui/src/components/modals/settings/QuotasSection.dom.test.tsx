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

  it('renders operational hero, active model with autonomy, and supported models', () => {
    const onRefreshUsage = vi.fn();
    render(
      <QuotasSection
        apiUsage={dummyUsage}
        isLoadingUsage={false}
        onRefreshUsage={onRefreshUsage}
        preferredModel="gemini-2.5-flash"
      />
    );

    expect(screen.getByText('API Google Gemini Operativa')).toBeTruthy();
    expect(screen.getByText('2 chiavi')).toBeTruthy();
    expect(screen.getByText('In uso')).toBeTruthy();
    expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy();
    expect(screen.getByText('2 su 2 chiavi pronte')).toBeTruthy();
    expect(screen.getByText('Autonomia Stimata')).toBeTruthy();
    expect(screen.getByText('Altri Modelli Disponibili (Quote Separate)')).toBeTruthy();
    expect(screen.getByText('Gemini 3.6 Flash')).toBeTruthy();

    const refreshBtn = screen.getByLabelText('Aggiorna conteggio quote');
    fireEvent.click(refreshBtn);
    expect(onRefreshUsage).toHaveBeenCalled();
  });

  it('renders reserve mode status hero banner when degraded', () => {
    const degradedUsage: ApiUsageResult = {
      ...dummyUsage,
      primary_status: 'degraded',
      is_degraded_mode: true,
      degraded_reason: 'Chiave principale esaurita per oggi. Il lavoro prosegue automaticamente sulla chiave di riserva.',
      credentials: [
        {
          id: 'key-1',
          label: 'Chiave Principale',
          masked_key: 'AIza...dbtI',
          is_primary: true,
          operational_status: 'temporarily_failing',
          last_error_message: 'Quota giornaliera (RPD) esaurita per gemini-2.5-flash',
          last_error_code: 429,
          exhausted_models: ['gemini-2.5-flash'],
        },
        {
          id: 'key-2',
          label: 'Chiave Riserva 1',
          masked_key: 'AIza...Tih4',
          is_primary: false,
          operational_status: 'active',
          exhausted_models: [],
        },
      ],
    };

    render(
      <QuotasSection
        apiUsage={degradedUsage}
        isLoadingUsage={false}
        preferredModel="gemini-2.5-flash"
      />
    );

    expect(screen.getByText('Modalità Riserva Attiva')).toBeTruthy();
    expect(screen.getAllByText(/chiave di riserva/i).length).toBeGreaterThan(0);
    expect(screen.getByText('1 su 2 chiavi pronte')).toBeTruthy();
    expect(screen.getByText('Chiave principale esaurita — riserva subentrata')).toBeTruthy();
  });

  it('renders correct subtitle for single key when quota is exhausted', () => {
    const singleKeyExhaustedUsage: ApiUsageResult = {
      ...dummyUsage,
      primary_status: 'quota_exhausted',
      status_message: 'Quota giornaliera (RPD) esaurita. Reset alle ore 09:00 (ora italiana / 00:00 PT).',
      credentials: [
        {
          id: 'key-1',
          label: 'Chiave Principale',
          masked_key: 'AIza...dbtI',
          is_primary: true,
          operational_status: 'temporarily_failing',
          exhausted_models: ['gemini-3.5-flash'],
        },
      ],
    };

    render(
      <QuotasSection
        apiUsage={singleKeyExhaustedUsage}
        isLoadingUsage={false}
        preferredModel="gemini-3.5-flash"
      />
    );

    expect(screen.getByText('0 su 1 chiavi pronte')).toBeTruthy();
    expect(screen.getByText('Quota esaurita (nessuna riserva configurata)')).toBeTruthy();
    expect(screen.queryByText(/riserva subentrata/i)).toBeNull();
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
    expect(
      screen.getByText('Chiave API non valida (HTTP 401). Verifica le impostazioni.')
    ).toBeTruthy();
    expect(screen.getByText('0 su 1 chiavi pronte')).toBeTruthy();
  });

  it('renders fallback text when no apiUsage is provided', () => {
    render(
      <QuotasSection
        apiUsage={null}
        isLoadingUsage={false}
      />
    );

    expect(
      screen.getByText(/Inserisci una chiave API in Generale/i)
    ).toBeTruthy();
  });

  it('renders telemetry and work stats when apiUsage contains telemetry data', () => {
    render(
      <QuotasSection
        apiUsage={dummyUsage}
        isLoadingUsage={false}
      />
    );

    expect(screen.getByText('Attività & Telemetria di Oggi')).toBeTruthy();
    expect(screen.getByText('Lavoro Svolto Oggi')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getAllByText('1')).toHaveLength(2);
    expect(screen.getByText('Telemetria Rete API')).toBeTruthy();
    expect(screen.getByText('19')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
  });
});
