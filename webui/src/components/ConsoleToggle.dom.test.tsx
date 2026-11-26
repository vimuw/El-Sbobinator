import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConsoleToggle } from './ConsoleToggle';

describe('ConsoleToggle', () => {
  it('keeps the lucide terminal icon the hover animation in index.css selects', () => {
    const onToggle = vi.fn();
    render(<ConsoleToggle open={false} onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: 'Mostra console' });
    expect(button.classList.contains('console-toggle')).toBe(true);
    // index.css moves the prompt (second child) and blinks the cursor (first child).
    const icon = button.querySelector('svg.lucide-terminal');
    expect(icon?.children).toHaveLength(2);
    expect(icon?.firstElementChild?.getAttribute('d')).toBe('M12 19h8');

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps its extra distance from Interrompi only under the progress', () => {
    const { container, rerender } = render(<ConsoleToggle open={false} onToggle={() => {}} underProgress />);
    expect(container.querySelector('.console-toggle-row')?.classList.contains('is-under-progress')).toBe(true);
    rerender(<ConsoleToggle open={false} onToggle={() => {}} />);
    expect(container.querySelector('.console-toggle-row')?.classList.contains('is-under-progress')).toBe(false);
  });
});
