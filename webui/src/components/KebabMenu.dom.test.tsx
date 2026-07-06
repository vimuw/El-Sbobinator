import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { KebabMenu, type KebabMenuItem } from './KebabMenu';

describe('KebabMenu component', () => {
  it('opens menu on click and displays items', () => {
    const handleAction = vi.fn();
    const items: KebabMenuItem[] = [
      { label: 'Option 1', onClick: handleAction },
      { separator: true },
      { label: 'Option 2', danger: true, onClick: handleAction },
    ];

    render(<KebabMenu items={items} />);

    // Initially menu is closed
    expect(screen.queryByText('Option 1')).toBeNull();

    // Click kebab button
    const button = screen.getByRole('button', { name: 'Altre opzioni' });
    fireEvent.click(button);

    // Menu should be open
    expect(screen.getByText('Option 1')).toBeTruthy();
    expect(screen.getByText('Option 2')).toBeTruthy();

    // Click item
    fireEvent.click(screen.getByText('Option 1'));
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it('flips upwards when near the bottom of viewport', () => {
    // Mock innerHeight and button getBoundingClientRect
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 600 });
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 800 });

    const items: KebabMenuItem[] = [
      { label: 'Option 1', onClick: vi.fn() },
      { label: 'Option 2', onClick: vi.fn() },
      { label: 'Option 3', onClick: vi.fn() },
    ];

    render(<KebabMenu items={items} />);
    const button = screen.getByRole('button', { name: 'Altre opzioni' });

    // Mock button bounding rect near bottom
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      top: 550,
      bottom: 580,
      left: 700,
      right: 730,
      width: 30,
      height: 30,
      x: 700,
      y: 550,
      toJSON: () => {},
    });

    fireEvent.click(button);

    // Menu should render in DOM
    const menuOption = screen.getByText('Option 1').parentElement?.parentElement;
    expect(menuOption).toBeTruthy();
    // In opensUp mode, style should have bottom instead of top
    expect(menuOption?.style.bottom).not.toBe('');
  });
});
