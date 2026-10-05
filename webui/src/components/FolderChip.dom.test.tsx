import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FolderIndicatorChip } from './FolderChip';

describe('FolderIndicatorChip component', () => {
  it('shows a contextual label, full path and inherited color inside an ancestor', () => {
    const folders = [
      { id: 'year', name: 'Anno', color: '', session_dirs: [] },
      { id: 'course', name: 'Materia', color: '#4D96FF', parent_id: 'year', session_dirs: [] },
      { id: 'module', name: 'Modulo', color: '', parent_id: 'course', session_dirs: [] },
    ];
    const { container } = render(<FolderIndicatorChip folder={folders[2]} folders={folders} relativeTo="course" />);
    expect(screen.getByText('Modulo')).toBeTruthy();
    expect(screen.getByTitle('Raccolta: Anno › Materia › Modulo')).toBeTruthy();
    expect(container.querySelector('.folder-indicator-chip')?.getAttribute('style')).toContain('--folder-color: #4D96FF');
  });
  it('renders with .folder-indicator-chip and .folder-color-dot without inline dimension styles', () => {
    const { container } = render(
      <FolderIndicatorChip folder={{ name: 'Neurologia', color: '#4a729c' }} />,
    );

    const chip = container.querySelector('.folder-indicator-chip') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('style')).toContain('--folder-color: #4a729c');
    expect(screen.getByText('Neurologia')).toBeTruthy();

    const dot = container.querySelector('.folder-color-dot.is-small') as HTMLElement;
    expect(dot).toBeTruthy();
    // Verify no inline width/height style is present
    expect(dot.getAttribute('style')).toBeNull();
  });

  it('uses a neutral color for automatic collections without a parent', () => {
    const { container } = render(
      <FolderIndicatorChip folder={{ name: 'Senza Colore', color: '' }} />,
    );

    const chip = container.querySelector('.folder-indicator-chip') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('style')).toContain('--folder-color: #94A3B8');
    expect(screen.getByText('Senza Colore')).toBeTruthy();
  });
});
