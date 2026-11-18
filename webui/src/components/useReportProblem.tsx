import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { openReportEmail } from '../feedback/reportEmail';
import { getHostCapabilities } from '../hostCapabilities';
import { FeedbackModal } from './modals/FeedbackModal';

/**
 * "Segnala un problema" wherever it appears (the sidebar, Impostazioni → Assistenza): web builds
 * with Sentry open the feedback window, the others (no DSN, desktop) write an email.
 */
export function useReportProblem() {
  const [open, setOpen] = useState(false);
  const byEmail = getHostCapabilities().reportByEmail;
  const openReport = () => {
    if (byEmail) openReportEmail();
    else setOpen(true);
  };
  // On the page, not inside the opener: Impostazioni is itself a moving card.
  const modal = byEmail ? null : createPortal(
    <AnimatePresence>{open && <FeedbackModal onClose={() => setOpen(false)} />}</AnimatePresence>,
    document.body,
  );
  return { byEmail, open, openReport, modal };
}
