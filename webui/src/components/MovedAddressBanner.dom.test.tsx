import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MovedAddressBanner } from './MovedAddressBanner';

describe('moved-address notice', () => {
  it('asks for a backup to import on elsbobinator.com and reminds that keys stay behind', () => {
    const onOpenBackup = vi.fn();
    render(<MovedAddressBanner onOpenBackup={onOpenBackup} />);

    const banner = screen.getByRole('region', { name: 'El Sbobinator ora è su elsbobinator.com' });
    expect(banner.textContent).toContain('Le tue sbobine sono in questo indirizzo: fai il backup (Impostazioni → Archiviazione) e importalo su elsbobinator.com');
    expect(banner.textContent).toContain('Le chiavi Gemini non sono nel backup');
    expect(screen.getByRole('link', { name: 'Vai a elsbobinator.com' }).getAttribute('href')).toBe('https://elsbobinator.com');

    fireEvent.click(screen.getByRole('button', { name: 'Apri il backup' }));
    expect(onOpenBackup).toHaveBeenCalledTimes(1);
  });

  it('hides only until the next load', () => {
    const { unmount } = render(<MovedAddressBanner onOpenBackup={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nascondi fino alla prossima apertura' }));
    expect(screen.queryByTestId('moved-address-banner')).toBeNull();

    // Nothing is remembered: a new page shows it again.
    unmount();
    render(<MovedAddressBanner onOpenBackup={vi.fn()} />);
    expect(screen.getByTestId('moved-address-banner')).toBeTruthy();
  });
});
