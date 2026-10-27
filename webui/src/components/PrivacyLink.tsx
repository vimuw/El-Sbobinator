import { ShieldCheck } from 'lucide-react';
import { WEB_PRIVACY_PATH } from '../branding';
import { getHostCapabilities } from '../hostCapabilities';

export function PrivacyLink({ className = 'footer-link' }: { className?: string }) {
  if (getHostCapabilities().kind !== 'web') return null;
  return (
    <a href={WEB_PRIVACY_PATH} target="_blank" rel="noopener" className={className}>
      <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
      Privacy
    </a>
  );
}
