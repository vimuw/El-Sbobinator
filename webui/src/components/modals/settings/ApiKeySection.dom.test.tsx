import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeySection } from './ApiKeySection';

describe('ApiKeySection component', () => {
  const defaultProps = {
    apiKey: 'AIzaSyPrimary0123456789012345',
    setApiKey: vi.fn(),
    hasProtectedKey: false,
    apiKeyInsecure: false,
    apiKeyInsecureReason: '',
    fallbackKeys: [],
    setFallbackKeys: vi.fn(),
  };

  it('renders primary API key and shows empty fallback state', () => {
    render(<ApiKeySection {...defaultProps} />);

    const primaryInput = screen.getByPlaceholderText(/AIzaSy\.\.\. oppure AQ\.\.\./i) as HTMLInputElement;
    expect(primaryInput.value).toBe(defaultProps.apiKey);

    expect(screen.getByText(/Nessuna chiave di riserva aggiunta\./i)).toBeTruthy();
  });

  it('renders existing fallback keys as masked chips (...XXXX)', () => {
    const fallbackKeys = [
      'AIzaSyBackupKey11111111111111ABCD',
      'AIzaSyBackupKey22222222222222WXYZ',
    ];

    render(<ApiKeySection {...defaultProps} fallbackKeys={fallbackKeys} />);

    // Should show masked keys
    expect(screen.getByText('...ABCD')).toBeTruthy();
    expect(screen.getByText('...WXYZ')).toBeTruthy();
    // Count badge should show 2
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('adds a valid fallback key when clicking Aggiungi button', () => {
    const setFallbackKeys = vi.fn();
    render(<ApiKeySection {...defaultProps} setFallbackKeys={setFallbackKeys} />);

    const input = screen.getByLabelText('Nuova chiave di riserva');
    const addButton = screen.getByRole('button', { name: 'Aggiungi chiave di riserva' }) as HTMLButtonElement;

    // Button should be disabled initially
    expect(addButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'AIzaSyValidKey9999999999999999' } });
    expect(addButton.disabled).toBe(false);

    fireEvent.click(addButton);

    expect(setFallbackKeys).toHaveBeenCalledWith(['AIzaSyValidKey9999999999999999']);
  });

  it('adds a valid fallback key when pressing Enter', () => {
    const setFallbackKeys = vi.fn();
    render(<ApiKeySection {...defaultProps} setFallbackKeys={setFallbackKeys} />);

    const input = screen.getByLabelText('Nuova chiave di riserva');

    fireEvent.change(input, { target: { value: 'AIzaSyValidKey9999999999999999' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(setFallbackKeys).toHaveBeenCalledWith(['AIzaSyValidKey9999999999999999']);
  });

  it('shows error if the key format is invalid', () => {
    const setFallbackKeys = vi.fn();
    render(<ApiKeySection {...defaultProps} setFallbackKeys={setFallbackKeys} />);

    const input = screen.getByLabelText('Nuova chiave di riserva');
    fireEvent.change(input, { target: { value: 'invalid_key_format' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(setFallbackKeys).not.toHaveBeenCalled();
    expect(screen.getByText(/Formato API key non valido/i)).toBeTruthy();
  });

  it('shows error if the key matches the primary key', () => {
    const setFallbackKeys = vi.fn();
    render(<ApiKeySection {...defaultProps} setFallbackKeys={setFallbackKeys} />);

    const input = screen.getByLabelText('Nuova chiave di riserva');
    fireEvent.change(input, { target: { value: defaultProps.apiKey } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(setFallbackKeys).not.toHaveBeenCalled();
    expect(screen.getByText(/già impostata come chiave principale/i)).toBeTruthy();
  });

  it('shows error if the key is already in the fallback list', () => {
    const setFallbackKeys = vi.fn();
    render(
      <ApiKeySection
        {...defaultProps}
        fallbackKeys={['AIzaSyBackupKey11111111111111ABCD']}
        setFallbackKeys={setFallbackKeys}
      />
    );

    const input = screen.getByLabelText('Nuova chiave di riserva');
    fireEvent.change(input, { target: { value: 'AIzaSyBackupKey11111111111111ABCD' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(setFallbackKeys).not.toHaveBeenCalled();
    expect(screen.getByText(/già presente tra le riserve/i)).toBeTruthy();
  });

  it('supports multiple comma-separated keys typed into input', () => {
    const setFallbackKeys = vi.fn();
    render(<ApiKeySection {...defaultProps} setFallbackKeys={setFallbackKeys} />);

    const input = screen.getByLabelText('Nuova chiave di riserva');
    const bulk = 'AIzaSyKeyOne11111111111111111, AIzaSyKeyTwo22222222222222222, AIzaSyKeyThree3333333333333333';
    fireEvent.change(input, { target: { value: bulk } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(setFallbackKeys).toHaveBeenCalledWith([
      'AIzaSyKeyOne11111111111111111',
      'AIzaSyKeyTwo22222222222222222',
      'AIzaSyKeyThree3333333333333333',
    ]);
  });

  it('supports clipboard paste of multi-line keys', () => {
    const setFallbackKeys = vi.fn();
    render(<ApiKeySection {...defaultProps} setFallbackKeys={setFallbackKeys} />);

    const input = screen.getByLabelText('Nuova chiave di riserva');
    const multiLine = 'AIzaSyPasteOne111111111111111\nAIzaSyPasteTwo222222222222222';
    fireEvent.paste(input, {
      clipboardData: {
        getData: (type: string) => (type === 'text' ? multiLine : ''),
      },
    });

    expect(setFallbackKeys).toHaveBeenCalledWith([
      'AIzaSyPasteOne111111111111111',
      'AIzaSyPasteTwo222222222222222',
    ]);
  });

  it('removes a fallback key when clicking the X button', () => {
    const setFallbackKeys = vi.fn();
    const fallbackKeys = [
      'AIzaSyBackupKey11111111111111ABCD',
      'AIzaSyBackupKey22222222222222WXYZ',
    ];

    render(<ApiKeySection {...defaultProps} fallbackKeys={fallbackKeys} setFallbackKeys={setFallbackKeys} />);

    const removeButtons = screen.getAllByTitle('Rimuovi chiave di riserva');
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[0]);

    expect(setFallbackKeys).toHaveBeenCalledWith(['AIzaSyBackupKey22222222222222WXYZ']);
  });

  it('toggles visibility of full fallback keys when eye button is clicked', () => {
    const fallbackKeys = ['AIzaSyBackupKey11111111111111ABCD'];
    render(<ApiKeySection {...defaultProps} fallbackKeys={fallbackKeys} />);

    // Initially masked
    expect(screen.getByText('...ABCD')).toBeTruthy();
    expect(screen.queryByText('AIzaSyBackupKey11111111111111ABCD')).toBeNull();

    const eyeButton = screen.getByLabelText('Mostra chiavi');
    fireEvent.click(eyeButton);

    // Now full key is visible
    expect(screen.getByText('AIzaSyBackupKey11111111111111ABCD')).toBeTruthy();
  });

  it('renders onboarding info card with uniform styling and handles external link click', () => {
    const openUrlMock = vi.fn();
    (window as unknown as { pywebview: { api: { open_url: typeof openUrlMock } } }).pywebview = {
      api: { open_url: openUrlMock },
    };

    render(<ApiKeySection {...defaultProps} />);

    expect(screen.getByText('Non hai una chiave?')).toBeTruthy();
    expect(screen.getByText(/È gratuita al 100%:/)).toBeTruthy();

    const link = screen.getByRole('link', { name: /Ottieni gratis su aistudio\.google\.com/i });
    expect(link).toBeTruthy();

    fireEvent.click(link);
    expect(openUrlMock).toHaveBeenCalledWith('https://aistudio.google.com/apikey');
  });

  it('adds valid keys from a mixed batch and displays notice for skipped duplicates/invalid keys', () => {
    const setFallbackKeys = vi.fn();
    render(
      <ApiKeySection
        {...defaultProps}
        fallbackKeys={['AIzaSyBackupKey11111111111111ABCD']}
        setFallbackKeys={setFallbackKeys}
      />
    );

    const input = screen.getByLabelText('Nuova chiave di riserva');
    // Mixed: 1 valid new, 1 duplicate of existing, 1 invalid format, 1 matching primary key
    const mixedBatch = `AIzaSyValidNewKey22222222222222\nAIzaSyBackupKey11111111111111ABCD\ninvalid_format\n${defaultProps.apiKey}`;
    fireEvent.paste(input, {
      clipboardData: {
        getData: (type: string) => (type === 'text' ? mixedBatch : ''),
      },
    });

    expect(setFallbackKeys).toHaveBeenCalledWith([
      'AIzaSyBackupKey11111111111111ABCD',
      'AIzaSyValidNewKey22222222222222',
    ]);
    expect(screen.getByText(/1 chiave aggiunta\. 3 ignorate/i)).toBeTruthy();
  });

  it('shows error notice when all keys in a batch are invalid or duplicates', () => {
    const setFallbackKeys = vi.fn();
    render(
      <ApiKeySection
        {...defaultProps}
        fallbackKeys={['AIzaSyBackupKey11111111111111ABCD']}
        setFallbackKeys={setFallbackKeys}
      />
    );

    const input = screen.getByLabelText('Nuova chiave di riserva');
    const invalidBatch = `AIzaSyBackupKey11111111111111ABCD\n${defaultProps.apiKey}\ninvalid_format`;
    fireEvent.paste(input, {
      clipboardData: {
        getData: (type: string) => (type === 'text' ? invalidBatch : ''),
      },
    });

    expect(setFallbackKeys).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Nessuna chiave valida aggiunta: le chiavi inserite sono già presenti o non valide\./i)
    ).toBeTruthy();
  });
});
