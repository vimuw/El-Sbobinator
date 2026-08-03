import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollaborationModal } from './CollaborationModal';

describe('CollaborationModal', () => {
  it('renders nothing when isOpen is false', () => {
    render(
      <CollaborationModal
        isOpen={false}
        onClose={vi.fn()}
        onStartCollaboration={vi.fn()}
        onStopCollaboration={vi.fn()}
      />
    );
    expect(screen.queryByText('Lavora in Gruppo')).toBeNull();
  });

  it('renders form fields when isOpen is true and no activeRoom', () => {
    render(
      <CollaborationModal
        isOpen={true}
        onClose={vi.fn()}
        onStartCollaboration={vi.fn()}
        onStopCollaboration={vi.fn()}
      />
    );
    expect(screen.getByText('Lavora in Gruppo')).toBeTruthy();
    expect(screen.getByText('Collaborazione P2P in tempo reale')).toBeTruthy();
    expect(screen.getByPlaceholderText('es. sbobina-anatomia-05')).toBeTruthy();
    expect(screen.getByPlaceholderText('es. Marco')).toBeTruthy();
    expect(screen.getByText('Genera')).toBeTruthy();
    expect(screen.getByText('Avvia / Partecipa')).toBeTruthy();
  });

  it('generates a random room code when Genera is clicked', () => {
    render(
      <CollaborationModal
        isOpen={true}
        onClose={vi.fn()}
        onStartCollaboration={vi.fn()}
        onStopCollaboration={vi.fn()}
      />
    );
    const input = screen.getByPlaceholderText('es. sbobina-anatomia-05') as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.click(screen.getByText('Genera'));
    expect(input.value).toMatch(/^sbobina-[a-z0-9]+$/);
  });

  it('submits form with lowercased room and user options', () => {
    const onStartCollaboration = vi.fn();
    const onClose = vi.fn();
    render(
      <CollaborationModal
        isOpen={true}
        onClose={onClose}
        onStartCollaboration={onStartCollaboration}
        onStopCollaboration={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('es. sbobina-anatomia-05'), {
      target: { value: ' My-Room-123 ' },
    });
    fireEvent.change(screen.getByPlaceholderText('es. Marco'), {
      target: { value: ' Mario Rossi ' },
    });
    fireEvent.click(screen.getByText('Avvia / Partecipa'));

    expect(onStartCollaboration).toHaveBeenCalledWith('my-room-123', {
      name: 'Mario Rossi',
      color: '#3b82f6',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays active room view when activeRoom prop is set', () => {
    const onStopCollaboration = vi.fn();
    render(
      <CollaborationModal
        isOpen={true}
        activeRoom="sbobina-active-room"
        onClose={vi.fn()}
        onStartCollaboration={vi.fn()}
        onStopCollaboration={onStopCollaboration}
      />
    );
    expect(screen.getByText('Sessione Attiva')).toBeTruthy();
    expect(screen.getByText('sbobina-active-room')).toBeTruthy();
    expect(screen.getByText('Interrompi Sessione Collaborativa')).toBeTruthy();

    fireEvent.click(screen.getByText('Interrompi Sessione Collaborativa'));
    expect(onStopCollaboration).toHaveBeenCalledTimes(1);
  });
});
