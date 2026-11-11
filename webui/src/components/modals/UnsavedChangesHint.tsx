export const UNSAVED_CHANGES_HINT = 'Modifiche non salvate: salva o annulla per chiudere.';

// Why a click outside shook the modal (useBackdropDismiss's showHint). The live region is always
// in the page, so screen readers announce the line when it appears; empty, it takes no room.
export function UnsavedChangesHint({ show, className = '' }: { show: boolean; className?: string }) {
  return (
    <p role="status" className={`modal-unsaved-hint ${className}`.trim()}>
      {show ? UNSAVED_CHANGES_HINT : null}
    </p>
  );
}
