import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTocScrollSpy } from './useTocScrollSpy';
import type { Heading } from '../editorExtensions';

describe('useTocScrollSpy Hook', () => {
  const headings: Heading[] = [
    { id: 'heading-1', text: 'Introduzione', level: 1 },
    { id: 'heading-2', text: 'Capitolo 1', level: 2 },
  ];

  it('initializes with null active heading and valid refs', () => {
    const scrollContainerRef = { current: document.createElement('div') };
    const { result } = renderHook(() =>
      useTocScrollSpy({
        tocHeadings: headings,
        scrollContainerRef,
      })
    );

    expect(result.current.activeHeadingId).toBeNull();
    expect(result.current.tocNavRef).toBeDefined();
    expect(result.current.tocStickyRef).toBeDefined();
  });

  it('measures a heading redrawn by a restyle instead of its detached element', async () => {
    // Regression: aligning a heading replaces its element while the index stays
    // equal, so the cached detached element (top 0) passed as already scrolled.
    const container = document.createElement('div');
    container.innerHTML = '<div class="tiptap-editor"><h2>Uno</h2><p>Testo</p><h2>Due</h2></div>';
    document.body.appendChild(container);
    const at = (el: Element, top: number) => {
      el.getBoundingClientRect = () => ({ top } as DOMRect);
    };
    const [uno, due] = Array.from(container.querySelectorAll('h2'));
    at(container, 0);
    at(uno, -100);
    at(due, 500);
    const sameHeadings: Heading[] = [
      { id: 'h-uno', text: 'Uno', level: 2 },
      { id: 'h-due', text: 'Due', level: 2 },
    ];
    const { result } = renderHook(() => useTocScrollSpy({ tocHeadings: sameHeadings, scrollContainerRef: { current: container } }));
    try {
      container.dispatchEvent(new Event('scroll'));
      await waitFor(() => expect(result.current.activeHeadingId).toBe('h-uno'));

      const redrawn = document.createElement('h2');
      redrawn.textContent = 'Due';
      redrawn.style.textAlign = 'center';
      at(redrawn, 500);
      due.replaceWith(redrawn);
      at(due, 0);
      at(uno, -200);
      container.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
      expect(result.current.activeHeadingId).toBe('h-uno');
    } finally {
      container.remove();
    }
  });
});
