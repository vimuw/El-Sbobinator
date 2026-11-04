import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { PANEL_EDGE_GAP_PX, fitPanelLeft } from './anchoredPanel';
import { ColorPickerButton } from './ColorPickerButton';
import { AlignDropdownButton } from './AlignDropdownButton';

const PANEL_WIDTHS: Record<string, number> = { 'color-picker-panel': 196, 'editor-dropdown-panel': 200 };

// jsdom has no layout. A fixed panel near the right edge shrinks to the room left, as a browser does.
const fakeLayout = (viewportWidth: number) => {
  vi.stubGlobal('innerWidth', viewportWidth);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    const natural = Object.entries(PANEL_WIDTHS).find(([cls]) => this.classList.contains(cls))?.[1] ?? 0;
    return Math.min(natural, viewportWidth - (parseFloat(this.style.left) || 0));
  });
};

const placeButton = (button: HTMLElement, left: number) => {
  button.getBoundingClientRect = () => ({ top: 8, bottom: 40, left, right: left + 36, width: 36, height: 32, x: left, y: 8, toJSON: () => ({}) });
};

const mockEditor = () => ({
  isActive: vi.fn().mockReturnValue(false),
  getAttributes: vi.fn().mockReturnValue({}),
  chain: vi.fn(() => ({ focus: vi.fn().mockReturnThis(), setColor: vi.fn().mockReturnThis(), setTextAlign: vi.fn().mockReturnThis(), run: vi.fn() })),
}) as unknown as TiptapEditor;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fitPanelLeft', () => {
  it('keeps the button-aligned left edge when the panel fits', () => {
    expect(fitPanelLeft(322, 196, 1024)).toBe(322);
  });

  it('moves a panel left so it ends 8px inside the window', () => {
    const left = fitPanelLeft(322, 196, 390);
    expect(left + 196).toBe(390 - PANEL_EDGE_GAP_PX);
  });

  it('starts a panel at the gap when it is wider than the window or its button is scrolled off the left', () => {
    expect(fitPanelLeft(322, 500, 390)).toBe(PANEL_EDGE_GAP_PX);
    expect(fitPanelLeft(-20, 196, 390)).toBe(PANEL_EDGE_GAP_PX);
  });
});

describe('toolbar popovers at the right edge of a phone', () => {
  it('keeps the colour panel, with its footer, inside a 390px window', () => {
    fakeLayout(390);
    render(<ColorPickerButton editor={mockEditor()} />);
    const button = screen.getByTitle('Colore testo');
    placeButton(button, 322);
    fireEvent.click(button);

    const panel = document.querySelector<HTMLElement>('.color-picker-panel')!;
    expect(panel.style.top).toBe('46px');
    expect(parseFloat(panel.style.left) + PANEL_WIDTHS['color-picker-panel']).toBeLessThanOrEqual(390 - PANEL_EDGE_GAP_PX);
    expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(PANEL_EDGE_GAP_PX);
  });

  it('keeps the alignment list inside a 390px window', () => {
    fakeLayout(390);
    render(<AlignDropdownButton editor={mockEditor()} />);
    const button = screen.getByTitle('Allineamento testo');
    placeButton(button, 330);
    fireEvent.click(button);

    const panel = document.querySelector<HTMLElement>('.editor-dropdown-panel')!;
    expect(screen.getByRole('button', { name: 'Giustificato' })).toBeTruthy();
    expect(parseFloat(panel.style.left) + PANEL_WIDTHS['editor-dropdown-panel']).toBeLessThanOrEqual(390 - PANEL_EDGE_GAP_PX);
  });

  it('opens a gap below the toolbar the button sits in, not flush with its bottom border', () => {
    fakeLayout(390);
    const { container } = render(<div className="editor-toolbar"><AlignDropdownButton editor={mockEditor()} /></div>);
    const bar = container.querySelector<HTMLElement>('.editor-toolbar')!;
    bar.getBoundingClientRect = () => ({ top: 0, bottom: 52, left: 0, right: 390, width: 390, height: 52, x: 0, y: 0, toJSON: () => ({}) });
    const button = screen.getByTitle('Allineamento testo');
    placeButton(button, 200);
    fireEvent.click(button);

    // The button ends at 40px, the bar at 52px: the list starts 6px under the bar, as menus do.
    expect(document.querySelector<HTMLElement>('.editor-dropdown-panel')!.style.top).toBe('58px');
  });

  it('leaves a panel under its button where there is room', () => {
    fakeLayout(1024);
    render(<ColorPickerButton editor={mockEditor()} />);
    const button = screen.getByTitle('Colore testo');
    placeButton(button, 322);
    fireEvent.click(button);

    expect(document.querySelector<HTMLElement>('.color-picker-panel')!.style.left).toBe('322px');
  });
});
