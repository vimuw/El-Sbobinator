import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { preloadableLazy } from './editorPreload';

function Ready() {
  return <p>Pronto</p>;
}

describe('preloadableLazy', () => {
  it('renders a preloaded chunk on the first commit without its fallback', async () => {
    const chunk = preloadableLazy(() => Promise.resolve(Ready));
    await chunk.preload();

    act(() => { render(<Suspense fallback={<p>Caricamento editor...</p>}><chunk.Component /></Suspense>); });

    expect(screen.getByText('Pronto')).toBeTruthy();
    expect(screen.queryByText('Caricamento editor...')).toBeNull();
  });

  it('still shows the fallback while a cold chunk loads', async () => {
    const chunk = preloadableLazy(() => Promise.resolve(Ready));

    act(() => { render(<Suspense fallback={<p>Caricamento editor...</p>}><chunk.Component /></Suspense>); });
    expect(screen.getByText('Caricamento editor...')).toBeTruthy();

    expect(await screen.findByText('Pronto')).toBeTruthy();
  });
});
