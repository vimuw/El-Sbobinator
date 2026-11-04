import { ShieldCheck } from 'lucide-react';
import { WEB_PRIVACY_PATH } from '../branding';
import { getHostCapabilities } from '../hostCapabilities';

// Same tab: the page has its own "Torna a El Sbobinator", and nothing in the app is left unsaved here.
export function PrivacyLink({ className = 'footer-link' }: { className?: string }) {
  if (getHostCapabilities().kind !== 'web') return null;
  return (
    <a href={WEB_PRIVACY_PATH} className={className}>
      <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
      Informativa sulla privacy
    </a>
  );
}
