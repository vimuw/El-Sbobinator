import { ExternalLink } from 'lucide-react';

// The small arrow after a link that leaves the app (a new tab or the system browser), as on
// "Ottieni gratis su aistudio.google.com". Decorative: the link text already names the place.
export function ExternalLinkIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return <ExternalLink className={`${className} shrink-0`} aria-hidden="true" data-testid="external-link-icon" />;
}
