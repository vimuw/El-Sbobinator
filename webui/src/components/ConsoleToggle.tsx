import { Terminal } from 'lucide-react';

// Shows or hides the console from the Dashboard: it is about a run, so it sits by the run (under
// the progress, or where the console goes once the run is over) rather than in the sidebar.
export function ConsoleToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="console-toggle-row">
      <button type="button" className="console-toggle" onClick={onToggle} data-testid="console-toggle">
        <Terminal size={14} aria-hidden="true" />
        <span>{open ? 'Nascondi console' : 'Mostra console'}</span>
      </button>
    </div>
  );
}
