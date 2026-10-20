import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ArchivePageTitle } from './ArchiveLayout';

describe('ArchivePageTitle', () => {
  it('shows the item count as the quiet header pill used by the dashboard sections', () => {
    render(<ArchivePageTitle count={12}>Archivio Sbobine</ArchivePageTitle>);
    const count = screen.getByText('12');
    expect(count.className).toContain('status-pill');
    expect(count.className).toContain('is-quiet');
    expect(count.className).toContain('is-count');
  });
});
