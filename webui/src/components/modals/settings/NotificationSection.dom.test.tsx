import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationSection } from './NotificationSection';
import { STORAGE_KEYS } from '../../../storageKeys';

describe('NotificationSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders title and default enabled switch', () => {
    render(<NotificationSection />);
    expect(screen.getByText('Notifiche di sistema')).toBeTruthy();
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles notification setting and writes to localStorage', () => {
    render(<NotificationSection />);
    const toggle = screen.getByRole('switch');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED)).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED)).toBe('true');
  });
});
