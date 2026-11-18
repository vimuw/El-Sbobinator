import { Bug } from 'lucide-react';
import { BUG_REPORT_URL } from '../branding';
import { ExternalLinkIcon } from './ExternalLinkIcon';
import { useReportProblem } from './useReportProblem';

// "Segnala un problema" as a labelled button (Impostazioni → Assistenza); the sidebar has its own
// icon. As an email it carries the external-link arrow.
export function ReportProblemLink({ className = 'app-button-secondary is-settings-action shrink-0' }: { className?: string }) {
  const { byEmail, openReport, modal } = useReportProblem();

  if (!byEmail) {
    return (
      <>
        <button type="button" className={className} aria-haspopup="dialog" onClick={openReport}>
          <Bug className="w-3.5 h-3.5" aria-hidden="true" />
          Segnala un problema
        </button>
        {modal}
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
        event.preventDefault();
        openReport();
      }}
    >
      <Bug className="w-3.5 h-3.5" aria-hidden="true" />
      Segnala un problema
      <ExternalLinkIcon />
    </a>
  );
}
