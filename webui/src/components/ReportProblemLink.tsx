import { Bug } from 'lucide-react';
import { BUG_REPORT_URL } from '../branding';
import { reportClientError } from '../diagnostics';

export function ReportProblemLink({ className = 'footer-link' }: { className?: string }) {
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
    </a>
  );
}
