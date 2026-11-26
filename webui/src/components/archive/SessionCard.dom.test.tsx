import { readFileSync } from 'node:fs';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { reportClientError } from '../../diagnostics';
import { RevisionRetryError } from '../../hooks/useRevisionRetry';
import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { DraggableSessionCard, SortableSessionCard } from './SessionCard';

vi.mock('../../diagnostics', () => ({ reportClientError: vi.fn() }));

// CSS specificity as [ids, classes/attributes/pseudo-classes, types], enough for index.css:
// :where() counts nothing, :not()/:is()/:has() count their most specific argument.
const compareSpecificity = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const specificity = (selector: string): number[] => {
  const total = [0, 0, 0];
  const rest = selector
    .replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/:(?:not|is|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_, args: string) => {
      const best = args.split(',').map(arg => specificity(arg.trim()))
        .reduce((a, b) => (compareSpecificity(a, b) >= 0 ? a : b));
      best.forEach((count, i) => { total[i] += count; });
      return '';
    })
    .replace(/\[[^\]]*\]/g, () => { total[1] += 1; return ''; })
    .replace(/::[\w-]+/g, () => { total[2] += 1; return ''; });
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length;
  total[1] += (rest.match(/\.[\w-]+|:[\w-]+/g) ?? []).length;
  total[2] += (rest.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return total;
};

const { sortableKeyDown, sortable } = vi.hoisted(() => ({ sortableKeyDown: vi.fn(), sortable: { isDragging: false } }));

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: { role: 'button', tabIndex: 0 },
    listeners: { onKeyDown: sortableKeyDown },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: sortable.isDragging,
  }),
}));

const mockSession: ArchiveSession = {
  session_dir: '/sessions/s1',
  name: 'Istologia lezione 9 parte 3.m4a',
  html_path: '/sessions/s1/out.html',
  input_path: '/audio/s1.m4a',
  completed_at_iso: '2026-09-03T10:00:00Z',
  effective_model: 'gemini-2.5-flash',
};

const mockWarningSession: ArchiveSession = {
  ...mockSession,
  completion_status: 'completed_with_warnings',
  revision_failed_blocks: [0],
};

const mockFolders: ArchiveFolder[] = [
  {
    id: 'f1',
    name: 'Istologia',
    color: '#3d6b3a',
    session_dirs: ['/sessions/s1'],
  },
];

describe('SessionCard components selection styling', () => {
  describe('DraggableSessionCard', () => {
    it('applies is-selected class when selected=true and toggles selection', () => {
      const onToggleSelect = vi.fn();
      const { container } = render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={mockFolders}
          selected={true}
          onToggleSelect={onToggleSelect}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      const card = container.querySelector('.archive-session-card');
      expect(card).toBeTruthy();
      expect(card?.classList.contains('is-selected')).toBe(true);

      const selectBtn = screen.getByTitle('Deseleziona');
      fireEvent.click(selectBtn);
      expect(onToggleSelect).toHaveBeenCalledTimes(1);
    });

    it('does not have is-selected class when selected=false', () => {
      const { container } = render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={mockFolders}
          selected={false}
          onToggleSelect={vi.fn()}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      const card = container.querySelector('.archive-session-card');
      expect(card).toBeTruthy();
      expect(card?.classList.contains('is-selected')).toBe(false);
    });

    it('applies warning styling when not selected and yields to is-selected when selected', () => {
      const { container: c1 } = render(
        <DraggableSessionCard
          session={mockWarningSession}
          allFolders={mockFolders}
          selected={false}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const card1 = c1.querySelector('.archive-session-card') as HTMLElement;
      expect(card1.style.borderColor).toBe('var(--warning-ring)');
      expect(card1.classList.contains('is-warning')).toBe(true);
      expect(card1.classList.contains('is-selected')).toBe(false);

      const { container: c2 } = render(
        <DraggableSessionCard
          session={mockWarningSession}
          allFolders={mockFolders}
          selected={true}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const card2 = c2.querySelector('.archive-session-card') as HTMLElement;
      expect(card2.classList.contains('is-selected')).toBe(true);
      expect(card2.style.borderColor).toBe('');
      expect(card2.style.background).toBe('');
    });

    it('does not show Rimuovi collegamento audio in kebab menu', () => {
      render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={mockFolders}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      const kebabBtn = screen.getByLabelText('Altre opzioni');
      fireEvent.click(kebabBtn);

      expect(screen.queryByText('Rimuovi collegamento audio')).toBeNull();
    });

    it('groups folders under Raccolta submenu and assigns to folder on click', () => {
      const onAssignToFolder = vi.fn();
      render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={mockFolders}
          onAssignToFolder={onAssignToFolder}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByLabelText('Altre opzioni'));

      // Raccolta submenu trigger is visible, folders are not yet visible before opening submenu
      const raccoltaBtn = screen.getByText('Raccolta');
      expect(raccoltaBtn).toBeTruthy();
      expect(screen.queryByText('Istologia')).toBeNull();

      // Click Raccolta to open submenu
      fireEvent.click(raccoltaBtn);
      const folderOption = screen.getByText('Istologia');
      expect(folderOption).toBeTruthy();

      // Click folder option
      fireEvent.click(folderOption);
      expect(onAssignToFolder).toHaveBeenCalledWith('f1');
    });

    it('shows Rimuovi da folder in Raccolta submenu when currentFolder is set', () => {
      const onRemoveFromFolder = vi.fn();
      render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={mockFolders}
          currentFolder={mockFolders[0]}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={onRemoveFromFolder}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByLabelText('Altre opzioni'));
      fireEvent.click(screen.getByText('Raccolta'));

      const removeOption = screen.getByText('Rimuovi da "Istologia"');
      expect(removeOption).toBeTruthy();

      fireEvent.click(removeOption);
      expect(onRemoveFromFolder).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])('offers direct removal with Sposta in only for assigned lessons (assigned=%s)', (assigned) => {
      const onRemoveFromFolder = vi.fn();
      const onMove = vi.fn();
      const onPreview = vi.fn();
      const onDeleteSession = vi.fn();
      render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={mockFolders}
          currentFolder={assigned ? mockFolders[0] : undefined}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={onRemoveFromFolder}
          onMove={onMove}
          onPreview={onPreview}
          onDeleteSession={onDeleteSession}
        />,
      );

      fireEvent.click(screen.getByLabelText('Altre opzioni'));
      expect(screen.getByRole('button', { name: 'Sposta in…' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Elimina' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Raccolta' })).toBeNull();
      const remove = screen.queryByRole('button', { name: 'Rimuovi dalla raccolta' });
      if (assigned) {
        expect(remove).toBeTruthy();
        fireEvent.click(remove!);
        expect(onRemoveFromFolder).toHaveBeenCalledTimes(1);
      } else {
        expect(remove).toBeNull();
        expect(onRemoveFromFolder).not.toHaveBeenCalled();
      }
      expect(onMove).not.toHaveBeenCalled();
      expect(onDeleteSession).not.toHaveBeenCalled();
      expect(onPreview).not.toHaveBeenCalled();
    });

    it('does not display Raccolta item when allFolders is empty and no currentFolder is set', () => {
      render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={[]}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByLabelText('Altre opzioni'));
      expect(screen.queryByText('Raccolta')).toBeNull();
    });
  });

  describe('SortableSessionCard', () => {
    it('applies is-selected class when selected=true and toggles selection', () => {
      const onToggleSelect = vi.fn();
      const { container } = render(
        <SortableSessionCard
          session={mockSession}
          folderColor="#3d6b3a"
          disabled={false}
          selected={true}
          onToggleSelect={onToggleSelect}
          onRemove={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      const card = container.querySelector('.archive-session-card');
      expect(card).toBeTruthy();
      expect(card?.classList.contains('is-selected')).toBe(true);

      const selectBtn = screen.getByTitle('Deseleziona');
      fireEvent.click(selectBtn);
      expect(onToggleSelect).toHaveBeenCalledTimes(1);
    });

    it('does not have is-selected class when selected=false', () => {
      const { container } = render(
        <SortableSessionCard
          session={mockSession}
          folderColor="#3d6b3a"
          disabled={false}
          selected={false}
          onToggleSelect={vi.fn()}
          onRemove={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      const card = container.querySelector('.archive-session-card');
      expect(card).toBeTruthy();
      expect(card?.classList.contains('is-selected')).toBe(false);
    });

    it('applies warning styling when not selected and yields to is-selected when selected', () => {
      const { container: c1 } = render(
        <SortableSessionCard
          session={mockWarningSession}
          folderColor="#3d6b3a"
          disabled={false}
          selected={false}
          onRemove={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const card1 = c1.querySelector('.archive-session-card') as HTMLElement;
      expect(card1.style.borderColor).toBe('var(--warning-ring)');
      expect(card1.classList.contains('is-warning')).toBe(true);
      expect(card1.classList.contains('is-selected')).toBe(false);

      const { container: c2 } = render(
        <SortableSessionCard
          session={mockWarningSession}
          folderColor="#3d6b3a"
          disabled={false}
          selected={true}
          onRemove={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const card2 = c2.querySelector('.archive-session-card') as HTMLElement;
      expect(card2.classList.contains('is-selected')).toBe(true);
      expect(card2.style.borderColor).toBe('');
      expect(card2.style.background).toBe('');
    });
  });
});

// The list's cards opened only on a mouse click: a plain div with no tabIndex, so Tab skipped every
// sbobina in "Tutte le sbobine" and the keyboard could not open one.
describe('SessionCard keyboard opening', () => {
  beforeEach(() => {
    sortableKeyDown.mockClear();
    sortable.isDragging = false;
  });

  it('lets Tab reach a list card and Enter open it, but not Enter on its own controls', () => {
    const onPreview = vi.fn();
    render(
      <DraggableSessionCard
        session={mockSession}
        allFolders={mockFolders}
        onToggleSelect={vi.fn()}
        onAssignToFolder={vi.fn()}
        onRemoveFromFolder={vi.fn()}
        onPreview={onPreview}
        onDeleteSession={vi.fn()}
      />,
    );
    const card = screen.getByRole('link', { name: mockSession.name });
    expect(card.tabIndex).toBe(0);

    fireEvent.keyDown(screen.getByRole('button', { name: `Seleziona ${mockSession.name}` }), { key: 'Enter' });
    expect(onPreview).not.toHaveBeenCalled();

    fireEvent.keyDown(card, { key: ' ' });
    expect(onPreview).not.toHaveBeenCalled();

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onPreview).toHaveBeenCalledWith(mockSession.html_path, mockSession.name, mockSession.input_path, undefined, mockSession.session_dir);
  });

  it('opens a collection card on Enter and leaves Space to reordering', () => {
    const onPreview = vi.fn();
    const { container } = render(
      <SortableSessionCard
        session={mockSession}
        folderColor="#3d6b3a"
        disabled={false}
        onRemove={vi.fn()}
        onPreview={onPreview}
        onDeleteSession={vi.fn()}
      />,
    );
    const card = container.querySelector('.archive-session-card') as HTMLElement;

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(sortableKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(card, { key: ' ' });
    expect(sortableKeyDown).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  // dnd-kit drops a card picked up by keyboard on Enter from its own document listener; focus is
  // still on the card, so the card must not open the sbobina for that same Enter.
  it('does not open a collection card when Enter drops it after a keyboard drag', () => {
    sortable.isDragging = true;
    const onPreview = vi.fn();
    const { container } = render(
      <SortableSessionCard
        session={mockSession}
        folderColor="#3d6b3a"
        disabled={false}
        onRemove={vi.fn()}
        onPreview={onPreview}
        onDeleteSession={vi.fn()}
      />,
    );
    const card = container.querySelector('.archive-session-card') as HTMLElement;

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('keeps the warning colour on the sheet icon of a card with warnings', () => {
    const { container } = render(
      <DraggableSessionCard
        session={mockWarningSession}
        allFolders={mockFolders}
        onAssignToFolder={vi.fn()}
        onRemoveFromFolder={vi.fn()}
        onPreview={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );
    expect(container.querySelector('.session-card-icon')?.classList.contains('is-warning')).toBe(true);
  });

  it('eases the sheet icon colour on hover instead of losing it to the older icon-scale rule', () => {
    // jsdom resolves no cascaded transition, so pick the winning top-level rule of index.css by hand.
    const style = document.createElement('style');
    style.textContent = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '');
    document.head.appendChild(style);
    try {
      const { container } = render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={mockFolders}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const icon = container.querySelector('.session-card-icon')!;
      let winner: { specificity: number[]; transition: string } | undefined;
      for (const cssRule of Array.from(style.sheet!.cssRules)) {
        if (!(cssRule instanceof CSSStyleRule)) continue;
        const transition = cssRule.style.getPropertyValue('transition');
        if (!transition) continue;
        for (const selector of cssRule.selectorText.split(/,(?![^(]*\))/).map(part => part.trim())) {
          if (!icon.matches(selector)) continue;
          const weight = specificity(selector);
          if (!winner || compareSpecificity(weight, winner.specificity) >= 0) winner = { specificity: weight, transition };
        }
      }
      expect(winner?.transition).toMatch(/(^|,\s*)color\s/);
      expect(winner?.transition).toMatch(/(^|,\s*)transform\s/);
    } finally {
      style.remove();
    }
  });
});

describe('SessionCard without local folders', () => {
  it('offers no "Apri cartella" in its menu', () => {
    render(
      <DraggableSessionCard
        session={mockSession}
        allFolders={mockFolders}
        onAssignToFolder={vi.fn()}
        onRemoveFromFolder={vi.fn()}
        onPreview={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Altre opzioni'));
    expect(screen.getByText('Elimina')).toBeTruthy();
    expect(screen.queryByText('Apri cartella')).toBeNull();
  });
});

describe('SessionCard meta line', () => {
  const opened: ArchiveSession = { ...mockWarningSession, completed_at_iso: new Date(Date.now() - 4 * 3_600_000).toISOString(), last_opened_at_iso: new Date(Date.now() - 23 * 60_000).toISOString() };
  const renderCard = () => render(
    <DraggableSessionCard
      session={opened}
      allFolders={[]}
      onAssignToFolder={vi.fn()}
      onRemoveFromFolder={vi.fn()}
      onPreview={vi.fn()}
      onDeleteSession={vi.fn()}
    />,
  );

  it('shows both times and every warning on wider screens, wrapping when they do not fit', () => {
    const { container } = renderCard();
    const meta = container.querySelector('.session-card-meta') as HTMLElement;
    expect(meta.classList.contains('flex-wrap')).toBe(true);
    expect(meta.textContent).toContain('4 ore fa');
    expect(meta.textContent).toContain('Aperto 23 minuti fa');
    expect(meta.textContent).toContain('Completata con avvisi');
    expect(meta.textContent).toContain('1 blocco non revisionato');
  });

  it('shows the size of the audio kept in this browser, and nothing without it', () => {
    const { container, rerender } = renderCard();
    expect(screen.queryByTestId('session-kept-audio')).toBeNull();

    rerender(
      <DraggableSessionCard
        session={{ ...opened, kept_audio_bytes: 412 * 1024 * 1024 }}
        allFolders={[]}
        onAssignToFolder={vi.fn()}
        onRemoveFromFolder={vi.fn()}
        onPreview={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('session-kept-audio');
    expect(badge.textContent).toBe('Audio salvato: 412,0 MB');
    expect(badge.getAttribute('title')).toBe('Audio salvato in questo browser: 412,0 MB');
    // At the card's right edge, right before the menu, so the badges line up down the list;
    // the line under the name stays as it was.
    expect(container.querySelector('.session-card-meta')?.textContent).not.toContain('412,0 MB');
    expect(badge.parentElement?.classList.contains('archive-session-card')).toBe(true);
    expect(badge.nextElementSibling?.contains(screen.getByLabelText('Altre opzioni'))).toBe(true);
  });

  it('keeps the audio badge to its icon on a phone, the size still in its title', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      render(
        <DraggableSessionCard
          session={{ ...opened, kept_audio_bytes: 2 * 1024 * 1024 }}
          allFolders={[]}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const badge = screen.getByTestId('session-kept-audio');
      expect(badge.getAttribute('title')).toBe('Audio salvato in questo browser: 2,0 MB');
      expect(screen.getByText('2,0 MB').classList.contains('sr-only')).toBe(true);
      expect(badge.classList.contains('is-icon')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps one line on a phone, so every card has the same height, and never cuts the time', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      const { container } = renderCard();
      const meta = container.querySelector('.session-card-meta') as HTMLElement;
      expect(meta.classList.contains('flex-nowrap')).toBe(true);
      // Only the latest activity, first and whole; the model and the warning take the ellipsis.
      expect(meta.textContent).not.toContain('4 ore fa');
      const time = meta.firstElementChild as HTMLElement;
      expect(time.textContent).toBe('Aperto 23 minuti fa');
      expect(time.classList.contains('shrink-0')).toBe(true);
      expect(screen.getByText('2.5-flash').classList.contains('truncate')).toBe(true);
      expect(meta.textContent).not.toContain('Completata con avvisi');
      expect(screen.getByText('1 blocco non revisionato').classList.contains('truncate')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// Sentry ELSBOBINATOR-WEB-4: in the Archivio, "Riprova revisione" let a failure the user was already
// told about (RevisionRetryError, thrown after the hook's notification) escape as an unhandled rejection.
describe('SessionCard revision retry button', () => {
  const variants = [
    ['DraggableSessionCard', (onRetry: (dir: string) => Promise<void>) => (
      <DraggableSessionCard
        session={mockWarningSession}
        allFolders={mockFolders}
        selected={false}
        onToggleSelect={vi.fn()}
        onAssignToFolder={vi.fn()}
        onRemoveFromFolder={vi.fn()}
        onPreview={vi.fn()}
        onDeleteSession={vi.fn()}
        onRetryFailedRevisionBlocks={onRetry}
      />
    )],
    ['SortableSessionCard', (onRetry: (dir: string) => Promise<void>) => (
      <SortableSessionCard
        session={mockWarningSession}
        folderColor="#3d6b3a"
        disabled={false}
        selected={false}
        onRemove={vi.fn()}
        onPreview={vi.fn()}
        onDeleteSession={vi.fn()}
        onRetryFailedRevisionBlocks={onRetry}
      />
    )],
  ] as const;

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  beforeEach(() => {
    unhandled.length = 0;
    vi.mocked(reportClientError).mockClear();
    process.on('unhandledRejection', onUnhandled);
  });
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  // Lets Node notice a rejection nobody handled before the test checks for one.
  const flushRejections = () => new Promise(resolve => setTimeout(resolve, 0));

  it.each(variants)('%s ends a notified failure quietly and lets the button be used again', async (_name, renderCard) => {
    let rejectRetry: (error: unknown) => void = () => {};
    const onRetry = vi.fn((_dir: string) => new Promise<void>((_resolve, reject) => { rejectRetry = reject; }));
    render(renderCard(onRetry));

    const button = screen.getByRole('button', { name: 'Riprova revisione' });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledWith('/sessions/s1');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toBe('Riprovo…');

    await act(async () => {
      rejectRetry(new RevisionRetryError('Nessun blocco recuperato.'));
      await flushRejections();
    });

    expect(unhandled).toEqual([]);
    expect(reportClientError).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.textContent).toBe('Riprova revisione');
  });

  it.each(variants)('%s reports an unexpected retry error instead of leaving it unhandled', async (_name, renderCard) => {
    const crash = new Error('bridge crashed');
    const onRetry = vi.fn((_dir: string) => Promise.reject(crash));
    render(renderCard(onRetry));

    const button = screen.getByRole('button', { name: 'Riprova revisione' });
    await act(async () => {
      fireEvent.click(button);
      await flushRejections();
    });

    expect(unhandled).toEqual([]);
    expect(reportClientError).toHaveBeenCalledWith('Revision retry error:', crash);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
