import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InsertImageButton, InsertMathButton, InsertYoutubeButton } from './InsertDropdownButton';

describe('InsertButtons', () => {
  it('InsertImageButton calls onOpenImagePicker when clicked', () => {
    const onOpen = vi.fn();
    render(<InsertImageButton onOpenImagePicker={onOpen} />);
    const btn = screen.getByTitle('Inserisci immagine');
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('InsertMathButton opens the inline composer without a native prompt', () => {
    const onOpenMath = vi.fn();
    const prompt = vi.spyOn(window, 'prompt');
    render(<InsertMathButton onOpenMath={onOpenMath} />);
    const btn = screen.getByTitle('Inserisci formula matematica (LaTeX)');
    fireEvent.click(btn);

    expect(onOpenMath).toHaveBeenCalledOnce();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('InsertYoutubeButton opens the link panel instead of embedding a player', () => {
    const onOpenLink = vi.fn();
    const prompt = vi.spyOn(window, 'prompt');
    render(<InsertYoutubeButton onOpenLink={onOpenLink} />);
    fireEvent.click(screen.getByTitle('Inserisci link a un video YouTube'));
    expect(onOpenLink).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });
});
