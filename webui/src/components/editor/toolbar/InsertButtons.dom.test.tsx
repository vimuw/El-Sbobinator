import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InsertImageButton, InsertMathButton, InsertYoutubeButton } from './InsertDropdownButton';
import type { Editor as TiptapEditor } from '@tiptap/core';

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

  it('InsertYoutubeButton prompts and sets YouTube video', () => {
    const setYoutubeVideoMock = vi.fn().mockReturnValue({ run: vi.fn().mockReturnValue(true) });
    const editor = {
      chain: vi.fn().mockReturnValue({
        focus: vi.fn().mockReturnValue({
          setYoutubeVideo: setYoutubeVideoMock,
        }),
      }),
    };

    vi.spyOn(window, 'prompt').mockReturnValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    render(<InsertYoutubeButton editor={editor as unknown as TiptapEditor} />);
    const btn = screen.getByTitle('Inserisci video YouTube');
    fireEvent.click(btn);

    expect(setYoutubeVideoMock).toHaveBeenCalledWith({
      src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  });
});
