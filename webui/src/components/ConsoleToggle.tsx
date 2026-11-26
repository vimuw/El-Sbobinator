import { Terminal } from 'lucide-react';

// Shows or hides the console from the Dashboard: it is about a run, so it sits by the run (under
// the progress, or where the console goes once the run is over) rather than in the sidebar.
// `underProgress` keeps it further from the Interrompi button above it, so the two are not hit
// one for the other.
export function ConsoleToggle({ open, onToggle, underProgress = false }: { open: boolean; onToggle: () => void; underProgress?: boolean }) {
  return (
    <div className={underProgress ? 'console-toggle-row is-under-progress' : 'console-toggle-row'}>
      <button type="button" className="console-toggle" onClick={onToggle} data-testid="console-toggle">
        <Terminal size={14} aria-hidden="true" />
        <span>{open ? 'Nascondi console' : 'Mostra console'}</span>
      </button>
    </div>
  );
}
