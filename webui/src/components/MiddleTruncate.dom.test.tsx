import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MiddleTruncate } from './MiddleTruncate';

describe('MiddleTruncate', () => {
  it('keeps the end of a long lecture name apart, so a phone cuts its middle', () => {
    const name = 'Patologia Generale I Lezione 8 - Infiammazione acuta, prof. Bianchi.m4a';
    const { container } = render(<p><MiddleTruncate text={name} /></p>);
    const head = container.querySelector('.middle-truncate-head')!;
    const tail = container.querySelector('.middle-truncate-tail')!;
    expect(tail.textContent).toBe(' Bianchi.m4a');
    expect(head.textContent! + tail.textContent!).toBe(name);
    // The whole name stays in the tooltip.
    expect(container.querySelector('.middle-truncate')!.getAttribute('title')).toBe(name);
  });

  it('leaves a name that fits as plain text', () => {
    const { container } = render(<p><MiddleTruncate text="Anatomia 3.m4a" /></p>);
    expect(container.querySelector('.middle-truncate')).toBeNull();
    expect(container.textContent).toBe('Anatomia 3.m4a');
  });
});
