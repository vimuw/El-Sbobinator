import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorShortcuts } from './EditorShortcuts';

// jsdom has dialog elements but no native top-layer API. Chromium acceptance
// below the component tier verifies focus trapping, restoration and Escape.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterAll(() => {
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('EditorShortcuts', () => {
  it('opens a shared guide without audio and closes it without bubbling Escape to the editor', () => {
    render(<EditorShortcuts audioAvailable={false} />);
    const trigger = screen.getByRole('button', { name: 'Scorciatoie da tastiera' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Scorciatoie da tastiera' });
    expect(within(dialog).getByRole('region', { name: 'Editor' })).toBeTruthy();
    expect(within(dialog).getByRole('region', { name: 'Audio' })).toBeTruthy();
    expect(within(dialog).getByText('Ctrl+.')).toBeTruthy();
    expect(within(dialog).getByText('Ctrl+,')).toBeTruthy();
    expect(within(dialog).getByText('Collega un file audio per usare questi comandi.')).toBeTruthy();
    const closeEditor = vi.fn();
    window.addEventListener('keydown', closeEditor);
    try {
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(closeEditor).not.toHaveBeenCalled();
      fireEvent(dialog, new Event('cancel', { cancelable: true }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    } finally {
      window.removeEventListener('keydown', closeEditor);
    }
  });

  it('shows audio focus rules and dismisses with the close button or backdrop', () => {
    render(<EditorShortcuts audioAvailable />);
    const trigger = screen.getByRole('button', { name: 'Scorciatoie da tastiera' });
    fireEvent.click(trigger);
    expect(screen.queryByText('Collega un file audio per usare questi comandi.')).toBeNull();
    expect(screen.getByText(/Spazio e frecce controllano l’audio/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi scorciatoie' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
