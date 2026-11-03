import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDockEmpty } from './AudioDockEmpty';

const FOLD_KEY = 'el-sbobinator.audio-player.v1';

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('AudioDockEmpty', () => {
  it('keeps the prompt to one row: title, hint beside it and the action', () => {
    const { container } = render(<AudioDockEmpty state="none" audioPicked={false} onRelink={vi.fn()} />);
    const row = container.querySelector('.audio-dock-empty')!;
    expect(row.querySelectorAll('p')).toHaveLength(1);
    const hint = 'Aggiungi un file audio: una copia verrà conservata nella sbobina.';
    expect(screen.getByText(hint).closest('p')).toBe(screen.getByText('Nessun audio collegato').closest('p'));
    // Phones hide the hint (index.css); the tooltip keeps it.
    expect(screen.getByRole('button', { name: 'Aggiungi audio' }).title).toBe(hint);
  });

  it('folds into a corner button like the player and opens again on tap', () => {
    vi.useFakeTimers();
    const { container } = render(<AudioDockEmpty state="none" audioPicked={false} onRelink={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Riduci la barra audio a icona' }));
    expect(container.querySelector('.audio-player.is-folding')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(280); });

    const pill = screen.getByRole('button', { name: 'Mostra la barra audio (nessun audio collegato)' });
    expect(container.querySelector('.audio-player.audio-dock-empty.is-collapsed.did-fold')).not.toBeNull();
    expect(document.activeElement).toBe(pill);
    expect(screen.queryByRole('button', { name: 'Aggiungi audio' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(FOLD_KEY)!)).toEqual({ collapsed: true, side: 'right' });

    fireEvent.click(pill);
    expect(screen.getByRole('button', { name: 'Aggiungi audio' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Riduci la barra audio a icona' }));
  });

  it('opens folded in the corner the player was folded to', () => {
    localStorage.setItem(FOLD_KEY, JSON.stringify({ collapsed: true, side: 'left' }));
    const { container } = render(<AudioDockEmpty state="missing" audioPicked onRelink={vi.fn()} />);
    expect(container.querySelector('.audio-player.is-collapsed.is-left')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Mostra la barra audio (audio non salvato)' })).toBeTruthy();
  });

  it('offers to drop the missing copy beside the relink, as one row', async () => {
    const onRemove = vi.fn();
    const onRelink = vi.fn().mockResolvedValue(true);
    render(<AudioDockEmpty state="missing" audioPicked={false} onRelink={onRelink} onRemove={onRemove} />);
    expect(screen.getByText('Audio non trovato')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi audio dalla sbobina' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ricollega audio' }));
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Ricollegato')).toBeTruthy();
  });
});
