import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupPage } from './SetupPage';

const baseProps = {
  hasProtectedKey: false,
  onSaved: vi.fn(),
  preferredModel: 'gemini-2.5-flash',
  fallbackKeys: [],

};

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => setPywebview(undefined));
afterEach(() => setPywebview(undefined));

describe('SetupPage', () => {
  it('passes temporary credential storage to the queue after setup', async () => {
    const onSaved = vi.fn();
    const storage = { primary: 'session_only', fallback: 'absent' };
    setPywebview({ save_settings: vi.fn().mockResolvedValue({ ok: true, credential_storage: storage }) });
    render(<SetupPage {...baseProps} onSaved={onSaved} />);
    fireEvent.change(screen.getByPlaceholderText(/Incolla qui la tua API Key/), { target: { value: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Salva e inizia/i })); });
    expect(onSaved).toHaveBeenCalledWith('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'gemini-2.5-flash', storage);
  });

  it('uses the shared page title, pill field, pill save action and sentence-case guide card', () => {
    const { container } = render(<SetupPage {...baseProps} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Configura la tua API Key' }).classList.contains('page-title')).toBe(true);
    const input = screen.getByLabelText('Chiave API Gemini');
    expect(input.classList.contains('is-settings-input')).toBe(true);
    expect(screen.getByRole('button', { name: 'Salva e inizia' }).classList.contains('settings-pill-button')).toBe(true);
    const guide = screen.getByRole('region', { name: 'Come ottenere la chiave in 1 minuto' });
    expect(guide.classList.contains('setup-guide')).toBe(true);
    expect(guide.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelector('.uppercase, .rounded-xl')).toBeNull();
    fireEvent.change(input, { target: { value: 'bad-key' } });
    expect(input.classList.contains('is-warning')).toBe(true);
    fireEvent.change(input, { target: { value: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345' } });
    expect(input.classList.contains('is-valid')).toBe(true);
  });

  it('shows "Configura la tua API Key" when no protected key', () => {
    render(<SetupPage {...baseProps} />);
    expect(screen.getByText('Configura la tua API Key')).toBeTruthy();
  });

  it('shows alternative text when hasProtectedKey is true', () => {
    render(<SetupPage {...baseProps} hasProtectedKey />);
    expect(screen.getByText('Chiave API non accessibile')).toBeTruthy();
  });

  it('masks input by default with obscured-text', () => {
    render(<SetupPage {...baseProps} />);
    const input = screen.getByPlaceholderText(/Incolla qui la tua API Key/);
    expect(input.classList.contains('obscured-text')).toBe(true);
    expect(input.getAttribute('data-masked')).toBe('true');
  });

  it('toggles input visibility on eye button click', () => {
    render(<SetupPage {...baseProps} />);
    const input = screen.getByPlaceholderText(/Incolla qui la tua API Key/) as HTMLInputElement;
    expect(input.classList.contains('obscured-text')).toBe(true);
    expect(input.getAttribute('data-masked')).toBe('true');
    fireEvent.click(screen.getByLabelText('Mostra chiave'));
    expect(input.classList.contains('obscured-text')).toBe(false);
    expect(input.getAttribute('data-masked')).toBe('false');
    fireEvent.click(screen.getByLabelText('Nascondi chiave'));
    expect(input.classList.contains('obscured-text')).toBe(true);
    expect(input.getAttribute('data-masked')).toBe('true');
  });

  it('shows valid format hint for a valid AIzaSy key', () => {
    render(<SetupPage {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Incolla qui la tua API Key/), {
      target: { value: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345' },
    });
    expect(screen.getByText(/Formato valido/)).toBeTruthy();
  });

  it('shows invalid format warning for a bad key', () => {
    render(<SetupPage {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Incolla qui la tua API Key/), {
      target: { value: 'bad-key' },
    });
    expect(screen.getByText(/Formato non valido/)).toBeTruthy();
  });

  it('Save button is disabled when key is empty', () => {
    render(<SetupPage {...baseProps} />);
    const btn = screen.getAllByText('Salva e inizia').find(
      el => el.closest('button') !== null,
    )?.closest('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  it('shows error when bridge is unavailable on save', async () => {
    render(<SetupPage {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Incolla qui la tua API Key/), {
      target: { value: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345' },
    });
    const saveBtn = screen.getAllByText('Salva e inizia').find(
      el => el.closest('button') !== null,
    )?.closest('button') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await vi.waitFor(() =>
      expect(screen.getByText(/Bridge Python non disponibile/)).toBeTruthy(),
    );
  });

  it('calls open_url when AI Studio link is clicked', () => {
    const openUrl = vi.fn();
    setPywebview({ open_url: openUrl });
    render(<SetupPage {...baseProps} />);
    fireEvent.click(screen.getByText('aistudio.google.com/apikey'));
    expect(openUrl).toHaveBeenCalledWith('https://aistudio.google.com/apikey');
  });

  it('shows error when save_settings returns {ok:false}', async () => {
    const mockSave = vi.fn().mockResolvedValue({ ok: false, error: 'quota esaurita' });
    setPywebview({ save_settings: mockSave });
    render(<SetupPage {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Incolla qui la tua API Key/), {
      target: { value: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345' },
    });
    const saveBtn = screen.getAllByText('Salva e inizia').find(
      el => el.closest('button') !== null,
    )?.closest('button') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await vi.waitFor(() =>
      expect(screen.getByText(/quota esaurita/)).toBeTruthy(),
    );
  });

  it('calls onSaved when save_settings succeeds', async () => {
    const onSaved = vi.fn();
    const mockSave = vi.fn().mockResolvedValue({ ok: true });
    setPywebview({ save_settings: mockSave });
    render(<SetupPage {...baseProps} onSaved={onSaved} />);
    fireEvent.change(screen.getByPlaceholderText(/Incolla qui la tua API Key/), {
      target: { value: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345' },
    });
    const saveBtn = screen.getAllByText('Salva e inizia').find(
      el => el.closest('button') !== null,
    )?.closest('button') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await vi.waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
        'gemini-2.5-flash',
      ),
    );
  });

  it('Enter key on valid input triggers save', async () => {
    const mockSave = vi.fn().mockResolvedValue({ ok: true });
    setPywebview({ save_settings: mockSave });
    render(<SetupPage {...baseProps} />);
    const input = screen.getByPlaceholderText(/Incolla qui la tua API Key/);
    fireEvent.change(input, { target: { value: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await vi.waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  });

  it('Enter key on invalid input does NOT trigger save', async () => {
    const mockSave = vi.fn().mockResolvedValue({ ok: true });
    setPywebview({ save_settings: mockSave });
    render(<SetupPage {...baseProps} />);
    const input = screen.getByPlaceholderText(/Incolla qui la tua API Key/);
    fireEvent.change(input, { target: { value: 'bad-key' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(mockSave).not.toHaveBeenCalled());
  });

  it('shows throw error when save_settings throws', async () => {
    const mockSave = vi.fn().mockRejectedValue(new Error('network error'));
    setPywebview({ save_settings: mockSave });
    render(<SetupPage {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Incolla qui la tua API Key/), {
      target: { value: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345' },
    });
    const saveBtn = screen.getAllByText('Salva e inizia').find(
      el => el.closest('button') !== null,
    )?.closest('button') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await vi.waitFor(() =>
      expect(screen.getByText(/network error/)).toBeTruthy(),
    );
  });

  it('finishes setup without remote verification even when the selected model is inaccessible', async () => {
    const onSaved = vi.fn();
    const save = vi.fn().mockResolvedValue({ ok: true });
    const verify = vi.fn().mockRejectedValue(new Error('404 NOT_FOUND'));
    const validate = vi.fn().mockResolvedValue({ ok: true, result: { ok: false, checks: [] } });
    setPywebview({ save_settings: save, verify_model_access: verify, validate_environment: validate });
    render(<SetupPage {...baseProps} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Chiave API Gemini'), { target: { value: 'AQ.abcdefghijklmnopqrstuvwxyz012345' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salva e inizia' })); });
    expect(save).toHaveBeenCalledExactlyOnceWith('AQ.abcdefghijklmnopqrstuvwxyz012345', [], 'gemini-2.5-flash');
    expect(onSaved).toHaveBeenCalledExactlyOnceWith('AQ.abcdefghijklmnopqrstuvwxyz012345', 'gemini-2.5-flash');
    expect(verify).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Accesso ai modelli' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continua' })).toBeNull();
  });

  it('keeps a failed save in setup and clears the compact error when the key is edited', async () => {
    const onSaved = vi.fn();
    setPywebview({ save_settings: vi.fn().mockResolvedValue({ ok: false, error: 'Disco non disponibile' }) });
    render(<SetupPage {...baseProps} onSaved={onSaved} />);
    const input = screen.getByLabelText('Chiave API Gemini');
    fireEvent.change(input, { target: { value: 'AQ.abcdefghijklmnopqrstuvwxyz012345' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salva e inizia' })); });
    expect(screen.getByRole('alert').textContent).toContain('Disco non disponibile');
    expect(screen.queryByText(/Formato valido/)).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'AQ.abcdefghijklmnopqrstuvwxyz012346' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Formato valido/)).toBeTruthy();
  });
});
