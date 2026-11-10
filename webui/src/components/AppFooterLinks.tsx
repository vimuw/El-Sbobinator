import { GITHUB_URL } from '../branding';
import { GithubIcon } from './icons/GithubIcon';
import { PrivacyLink } from './PrivacyLink';
import { ReportProblemLink } from './ReportProblemLink';

// The links under the dashboard and the archive. On a phone they keep one row: the long labels
// give way to short ones (index.css) instead of stacking one link per line.
export function AppFooterLinks() {
  return (
    <footer className="app-footer app-footer-links">
      <a
        href="#"
        onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(GITHUB_URL); }}
        className="footer-link"
        aria-label="Progetto Open-Source — GitHub"
      >
        <GithubIcon className="w-3.5 h-3.5" />
        <span className="footer-label-long">Progetto Open-Source — GitHub</span>
        <span className="footer-label-short" aria-hidden="true">GitHub</span>
      </a>
      <ReportProblemLink />
      <PrivacyLink />
    </footer>
  );
}
