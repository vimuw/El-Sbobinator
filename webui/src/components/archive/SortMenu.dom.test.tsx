import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SortMenu } from './SortMenu';

describe('SortMenu component', () => {
  it('opens sort menu on click, displays options, and selects an option', async () => {
    const handleSortChange = vi.fn();
    render(<SortMenu sort="newest" onSortChange={handleSortChange} />);

    const button = screen.getByRole('button', { name: 'Cambia ordinamento' });
    expect(screen.queryByText('Create di recente')).toBeNull();

    fireEvent.click(button);
    expect(Array.from(document.querySelectorAll('.kebab-item'), item => item.textContent?.trim())).toEqual([
      'Create di recente',
      'Aperte di recente',
      'Nome (A-Z)',
    ]);
    expect(screen.queryByText('Meno recenti')).toBeNull();

    fireEvent.click(screen.getByText('Nome (A-Z)'));
    expect(handleSortChange).toHaveBeenCalledWith('name');
    await waitFor(() => {
      expect(screen.queryByText('Create di recente')).toBeNull();
    });
  });

  it('frames the options with the shared menu panel', () => {
    render(<SortMenu sort="newest" onSortChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambia ordinamento' }));

    const panel = screen.getByText('Create di recente').closest('.kebab-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    expect(panel?.style.borderRadius).toBe('');
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
    expect(screen.getByText('Create di recente')).toBeTruthy();

    const outsideButton = screen.getByRole('button', { name: 'Outside Button' });
    fireEvent.pointerDown(outsideButton);
    fireEvent.mouseDown(outsideButton);

    await waitFor(() => {
      expect(screen.queryByText('Create di recente')).toBeNull();
    });
  });

  it('closes sort menu when pressing Escape key', async () => {
    render(<SortMenu sort="newest" onSortChange={vi.fn()} />);

    const sortButton = screen.getByRole('button', { name: 'Cambia ordinamento' });
    fireEvent.click(sortButton);
    expect(screen.getByText('Create di recente')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Create di recente')).toBeNull();
    });
  });

  it('renders custom options such as relevance for full-text mode', () => {
    const handleSortChange = vi.fn();
    const customOptions = [
      { id: 'relevance' as const, label: 'Più occorrenze' },
      { id: 'newest' as const, label: 'Create di recente' },
    ];
    render(<SortMenu sort="relevance" onSortChange={handleSortChange} options={customOptions} />);

    const button = screen.getByRole('button', { name: 'Cambia ordinamento' });
    fireEvent.click(button);

    expect(screen.getByText('Più occorrenze')).toBeTruthy();
    expect(screen.getByText('Create di recente')).toBeTruthy();
    expect(screen.queryByText('Nome (A-Z)')).toBeNull();
  });
});
