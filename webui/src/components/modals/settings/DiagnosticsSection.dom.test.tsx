import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiagnosticsSection } from './DiagnosticsSection';
import type { ApiUsageResult } from '../../../bridge';

describe('DiagnosticsSection', () => {
  const dummyUsage: ApiUsageResult = {
    quota_date: '2026-09-02',
    total_requests_remaining: 95,
    estimated_sbobine_remaining: 5,
    next_reset_info: 'Reset quote: ore 09:00 (fuso Google PT)',
    is_degraded_mode: false,
    degraded_reason: null,
    keys: [
      {
        id: 'key-1',
        label: 'Chiave Principale',
        masked_key: 'AIza...dbtI',
        is_primary: true,
        models: {
          'gemini-2.5-flash': {
            model_id: 'gemini-2.5-flash',
            used_today: 5,
            limit: 20,
            remaining: 15,
            is_exhausted: false,
          },
        },
      },
      {
        id: 'key-2',
        label: 'Chiave Riserva 1',
        masked_key: 'AIza...Tih4',
        is_primary: false,
        models: {
          'gemini-2.5-flash': {
            model_id: 'gemini-2.5-flash',
            used_today: 0,
            limit: 20,
            remaining: 20,
            is_exhausted: false,
          },
        },
      },
    ],
  };

  it('renders quota tracker with keys and remaining counts', () => {
    const onRefreshUsage = vi.fn();
    render(
      <DiagnosticsSection
        isValidatingEnvironment={false}
        onRunValidation={vi.fn()}
        validationResult={null}
        displayChecks={[]}
        apiUsage={dummyUsage}
        isLoadingUsage={false}
        onRefreshUsage={onRefreshUsage}
      />
    );

    expect(screen.getByText('Quote & Utilizzo Google AI Studio')).toBeTruthy();
    expect(screen.getByText('95 chiamate rimaste')).toBeTruthy();
    expect(screen.getByText('~5 lezioni (3h)')).toBeTruthy();
    expect(screen.getByText('Chiave Principale')).toBeTruthy();
    expect(screen.getByText('Chiave Riserva 1')).toBeTruthy();
    expect(screen.getByText('5/20')).toBeTruthy();
    expect(screen.getByText('(15 rimaste)')).toBeTruthy();

    const refreshBtn = screen.getByLabelText('Aggiorna conteggio quote');
    fireEvent.click(refreshBtn);
    expect(onRefreshUsage).toHaveBeenCalled();
  });

  it('renders fallback text when no apiUsage is provided', () => {
    render(
      <DiagnosticsSection
        isValidatingEnvironment={false}
        onRunValidation={vi.fn()}
        validationResult={null}
        displayChecks={[]}
        apiUsage={null}
        isLoadingUsage={false}
      />
    );

    expect(
      screen.getByText(/Inserisci una chiave API per monitorare le quote giornaliere/i)
    ).toBeTruthy();
  });
});
