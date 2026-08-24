import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorContextMenu } from './EditorContextMenu';
import type { Editor as TiptapEditor } from '@tiptap/core';

describe('EditorContextMenu', () => {
  it('does not render when contextMenu is null', () => {
    const { container } = render(
      <EditorContextMenu
        contextMenu={null}
        onClose={vi.fn()}
        editor={null}
        onOpenImagePicker={vi.fn()}
        onOpenFind={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders menu items when position and editor are provided', () => {
    const onClose = vi.fn();
    const onOpenFind = vi.fn();
    const mockEditor = {
      state: { selection: { empty: true, from: 0, to: 0 }, doc: { textBetween: () => '' } },
      chain: () => ({
        focus: () => ({
          toggleBold: () => ({ run: vi.fn() }),
        }),
      }),
      commands: { insertContent: vi.fn() },
    } as unknown as TiptapEditor;

    render(
      <EditorContextMenu
        contextMenu={{ x: 100, y: 100 }}
        onClose={onClose}
        editor={mockEditor}
        onOpenImagePicker={vi.fn()}
        onOpenFind={onOpenFind}
      />,
    );

    expect(screen.getByText('Taglia')).toBeTruthy();
    expect(screen.getByText('Copia')).toBeTruthy();
    expect(screen.getByText('Grassetto')).toBeTruthy();
    expect(screen.getByText('Trova e sostituisci')).toBeTruthy();

    const findBtn = screen.getByText('Trova e sostituisci').closest('button');
    if (findBtn) fireEvent.click(findBtn);
    expect(onOpenFind).toHaveBeenCalled();
  });
});
