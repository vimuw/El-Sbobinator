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

  it('renders form fields with auto-generated room code when isOpen is true and no activeRoom', () => {
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
    expect(screen.getByText('Codice Stanza Generato')).toBeTruthy();
    const input = screen.getByLabelText('Codice stanza generato') as HTMLInputElement;
    expect(input.value).toMatch(/^sbobina-[a-z0-9]+$/);
    expect(screen.getByPlaceholderText('es. Marco')).toBeTruthy();
    expect(screen.getByLabelText('Rigenera codice')).toBeTruthy();
    expect(screen.getByLabelText('Copia codice')).toBeTruthy();
    expect(screen.getByText('Avvia')).toBeTruthy();
  });

  it('generates a new random room code when Rigenera is clicked', () => {
    render(
      <CollaborationModal
        isOpen={true}
        onClose={vi.fn()}
        onStartCollaboration={vi.fn()}
        onStopCollaboration={vi.fn()}
      />
    );
    const input = screen.getByLabelText('Codice stanza generato') as HTMLInputElement;
    const initialCode = input.value;
    expect(initialCode).toMatch(/^sbobina-[a-z0-9]+$/);

    fireEvent.click(screen.getByLabelText('Rigenera codice'));
    expect(input.value).toMatch(/^sbobina-[a-z0-9]+$/);
  });

  it('copies the room code when Copia is clicked', () => {
    const writeTextMock = vi.fn();
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <CollaborationModal
        isOpen={true}
        onClose={vi.fn()}
        onStartCollaboration={vi.fn()}
        onStopCollaboration={vi.fn()}
      />
    );
    const input = screen.getByLabelText('Codice stanza generato') as HTMLInputElement;
    fireEvent.click(screen.getByLabelText('Copia codice'));

    expect(writeTextMock).toHaveBeenCalledWith(input.value);
    expect(screen.getByLabelText('Codice copiato')).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText('Codice stanza generato'), {
      target: { value: ' My-Custom-Room ' },
    });
    fireEvent.change(screen.getByPlaceholderText('es. Marco'), {
      target: { value: ' Mario Rossi ' },
    });
    fireEvent.click(screen.getByText('Avvia'));

    expect(onStartCollaboration).toHaveBeenCalledWith('my-custom-room', {
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
