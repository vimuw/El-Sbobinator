import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('closes menu when clicking outside', async () => {
    const items: KebabMenuItem[] = [{ label: 'Option A', onClick: vi.fn() }];
    render(
      <div>
        <button type="button">Outside Button</button>
        <KebabMenu items={items} />
      </div>,
    );

    const kebabButton = screen.getByRole('button', { name: 'Altre opzioni' });
    fireEvent.click(kebabButton);
    expect(screen.getByText('Option A')).toBeTruthy();

    const outsideButton = screen.getByRole('button', { name: 'Outside Button' });
    fireEvent.pointerDown(outsideButton);
    fireEvent.mouseDown(outsideButton);

    await waitFor(() => {
      expect(screen.queryByText('Option A')).toBeNull();
    });
  });

  it('closes menu when pressing Escape key', async () => {
    const items: KebabMenuItem[] = [{ label: 'Option Escape', onClick: vi.fn() }];
    render(<KebabMenu items={items} />);

    const kebabButton = screen.getByRole('button', { name: 'Altre opzioni' });
    fireEvent.click(kebabButton);
    expect(screen.getByText('Option Escape')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Option Escape')).toBeNull();
    });
  });

  it('closes existing menu when clicking another KebabMenu button (only one open at a time)', async () => {
    const items1: KebabMenuItem[] = [{ label: 'Menu 1 Item', onClick: vi.fn() }];
    const items2: KebabMenuItem[] = [{ label: 'Menu 2 Item', onClick: vi.fn() }];
    const items3: KebabMenuItem[] = [{ label: 'Menu 3 Item', onClick: vi.fn() }];

    render(
      <div>
        <KebabMenu items={items1} buttonClassName="kebab-1" />
        <KebabMenu items={items2} buttonClassName="kebab-2" />
        <KebabMenu items={items3} buttonClassName="kebab-3" />
      </div>,
    );

    const buttons = screen.getAllByRole('button', { name: 'Altre opzioni' });
    expect(buttons).toHaveLength(3);

    // Open first menu
    fireEvent.click(buttons[0]);
    expect(screen.getByText('Menu 1 Item')).toBeTruthy();
    expect(screen.queryByText('Menu 2 Item')).toBeNull();
    expect(screen.queryByText('Menu 3 Item')).toBeNull();

    // Click second menu trigger (pointerDown -> mouseDown -> click)
    fireEvent.pointerDown(buttons[1]);
    fireEvent.mouseDown(buttons[1]);
    fireEvent.click(buttons[1]);

    // First menu must be closed, second menu must be open
    await waitFor(() => {
      expect(screen.queryByText('Menu 1 Item')).toBeNull();
    });
    expect(screen.getByText('Menu 2 Item')).toBeTruthy();
    expect(screen.queryByText('Menu 3 Item')).toBeNull();

    // Click third menu trigger
    fireEvent.pointerDown(buttons[2]);
    fireEvent.mouseDown(buttons[2]);
    fireEvent.click(buttons[2]);

    // Second menu must be closed, third menu must be open
    await waitFor(() => {
      expect(screen.queryByText('Menu 2 Item')).toBeNull();
    });
    expect(screen.queryByText('Menu 1 Item')).toBeNull();
    expect(screen.getByText('Menu 3 Item')).toBeTruthy();
  });
});
