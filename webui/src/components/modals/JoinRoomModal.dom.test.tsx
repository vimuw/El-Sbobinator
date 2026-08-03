import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JoinRoomModal } from './JoinRoomModal';

describe('JoinRoomModal', () => {
  it('renders correctly when open', () => {
    render(<JoinRoomModal isOpen={true} onClose={vi.fn()} onJoinRoom={vi.fn()} />);

    expect(screen.getByText('Partecipa a una Stanza')).toBeTruthy();
    expect(screen.getByPlaceholderText('es. sbobina-anatomia-05')).toBeTruthy();
    expect(screen.getByPlaceholderText('es. Marco')).toBeTruthy();
    expect(screen.getByText('Entra nella Stanza')).toBeTruthy();
  });

  it('submits sanitized room code and user details', () => {
    const onJoinRoom = vi.fn();
    const onClose = vi.fn();

    render(<JoinRoomModal isOpen={true} onClose={onClose} onJoinRoom={onJoinRoom} />);

    fireEvent.change(screen.getByPlaceholderText('es. sbobina-anatomia-05'), {
      target: { value: '  ANATOMIA-ROOMA-123  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('es. Marco'), {
      target: { value: ' Giulia ' },
    });

    fireEvent.click(screen.getByText('Entra nella Stanza'));

    expect(onJoinRoom).toHaveBeenCalledWith('anatomia-rooma-123', {
      name: 'Giulia',
      color: '#3b82f6',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when isOpen is false', () => {
    render(<JoinRoomModal isOpen={false} onClose={vi.fn()} onJoinRoom={vi.fn()} />);
    expect(screen.queryByText('Partecipa a una Stanza')).toBeNull();
  });
});
