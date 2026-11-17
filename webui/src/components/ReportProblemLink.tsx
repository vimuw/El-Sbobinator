import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { Bug } from 'lucide-react';
import { BUG_REPORT_URL } from '../branding';
import { reportClientError } from '../diagnostics';
import { getHostCapabilities } from '../hostCapabilities';
import { ExternalLinkIcon } from './ExternalLinkIcon';
import { FeedbackModal } from './modals/FeedbackModal';

// In the footer it stays a plain link like its neighbours; elsewhere it carries the external-link arrow.
// Web builds with Sentry open the feedback window instead of the Google form.
export function ReportProblemLink({ className = 'footer-link' }: { className?: string }) {
  const [open, setOpen] = useState(false);

  if (!getHostCapabilities().reportForm) {
    return (
      <>
        <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <Bug className="w-3.5 h-3.5" aria-hidden="true" />
          Segnala un problema
        </button>
        {/* On the page, not inside the opener: Impostazioni is itself a moving card. */}
        {createPortal(
          <AnimatePresence>{open && <FeedbackModal onClose={() => setOpen(false)} />}</AnimatePresence>,
          document.body,
        )}
      </>
    );
  }

  return (
    <a
      href={BUG_REPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={event => {
        if (!window.pywebview?.api?.open_url) return;
        event.preventDefault();
        void window.pywebview.api.open_url?.(BUG_REPORT_URL)
          .then(result => {
            if (!result.ok) throw new Error(result.error || 'Impossibile aprire il modulo.');
          })
          .catch(error => reportClientError('bug-report-open', error));
      }}
    >
      <Bug className="w-3.5 h-3.5" aria-hidden="true" />
      Segnala un problema
      {className !== 'footer-link' && <ExternalLinkIcon />}
    </a>
  );
}
