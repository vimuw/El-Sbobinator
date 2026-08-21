import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SortMenu } from './SortMenu';

describe('SortMenu component', () => {
  it('opens sort menu on click, displays options, and selects an option', async () => {
    const handleSortChange = vi.fn();
    render(<SortMenu sort="newest" onSortChange={handleSortChange} />);

    const button = screen.getByRole('button', { name: 'Cambia ordinamento' });
    expect(screen.queryByText('Più recenti')).toBeNull();

    fireEvent.click(button);
    expect(screen.getByText('Più recenti')).toBeTruthy();
    expect(screen.getByText('Meno recenti')).toBeTruthy();
    expect(screen.getByText('Nome (A-Z)')).toBeTruthy();
    expect(screen.getByText('Aperti di recente')).toBeTruthy();

    fireEvent.click(screen.getByText('Nome (A-Z)'));
    expect(handleSortChange).toHaveBeenCalledWith('name');
    await waitFor(() => {
      expect(screen.queryByText('Più recenti')).toBeNull();
    });
  });

  it('closes sort menu on outside click', async () => {
    render(
      <div>
        <button type="button">Outside Button</button>
        <SortMenu sort="newest" onSortChange={vi.fn()} />
      </div>,
    );

    const sortButton = screen.getByRole('button', { name: 'Cambia ordinamento' });
    fireEvent.click(sortButton);
    expect(screen.getByText('Più recenti')).toBeTruthy();

    const outsideButton = screen.getByRole('button', { name: 'Outside Button' });
    fireEvent.pointerDown(outsideButton);
    fireEvent.mouseDown(outsideButton);

    await waitFor(() => {
      expect(screen.queryByText('Più recenti')).toBeNull();
    });
  });

  it('closes sort menu when pressing Escape key', async () => {
    render(<SortMenu sort="newest" onSortChange={vi.fn()} />);

    const sortButton = screen.getByRole('button', { name: 'Cambia ordinamento' });
    fireEvent.click(sortButton);
    expect(screen.getByText('Più recenti')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Più recenti')).toBeNull();
    });
  });
});
