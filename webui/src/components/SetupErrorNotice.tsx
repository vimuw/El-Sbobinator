import { useId, useState } from 'react';
import { AlertCircle, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import type { ValidationCheck } from '../bridge';

interface SetupErrorNoticeProps {
  check: ValidationCheck;
  apiKey: string;
}

export function SetupErrorNotice({ check, apiKey }: SetupErrorNoticeProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const redact = (text: string) => {
    const withoutKey = apiKey ? text.replaceAll(apiKey, '[API_KEY_REDACTED]') : text;
    return withoutKey.replace(/\b(?:AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,})\b/g, '[API_KEY_REDACTED]');
  };
  const message = redact(check.message);
  const hint = redact(check.hint || '');
  const details = redact(check.details || '');
  const report = [
    message,
    check.model ? `Modello: ${check.model}` : '',
    check.error_code ? `Codice: ${check.error_code}` : '',
    details,
  ].filter(Boolean).join('\n');

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(redact(report));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className="setup-error-notice">
      <AlertCircle className="setup-error-icon" aria-hidden="true" />
      <div className="setup-error-content">
        <div role="alert">
          <p className="setup-error-title">{message}</p>
          {hint && <p className="setup-error-hint">{hint}</p>}
        </div>
        <div className="setup-error-actions">
          {check.help_action === 'ai_studio' && (
            <a
              className="setup-error-action"
              href="https://aistudio.google.com/apikey"
              onClick={e => {
                if (window.pywebview?.api?.open_url) {
                  e.preventDefault();
                  void window.pywebview.api.open_url('https://aistudio.google.com/apikey');
                }
              }}
              target="_blank"
              rel="noreferrer"
            >
              Apri AI Studio <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
          {(details || check.model || check.error_code) && (
            <button type="button" className="setup-error-action setup-error-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(v => !v)}>
              <ChevronRight size={12} aria-hidden="true" /> Dettagli
            </button>
          )}
        </div>
        {(details || check.model || check.error_code) && (
          <div id={detailsId} className="setup-error-technical" hidden={!expanded}>
            {check.model && <p>Modello: {redact(check.model)}</p>}
            {check.error_code && <p>Codice: {redact(check.error_code)}</p>}
            {details && <pre>{details}</pre>}
            <button type="button" className="setup-error-action" onClick={copyDetails}>
              <Copy size={12} aria-hidden="true" />
              {copyState === 'copied' ? 'Copiato!' : 'Copia dettagli'}
            </button>
            <p role="status" className="setup-error-copy-status">
              {copyState === 'failed' ? 'Copia non riuscita. Seleziona il testo per copiarlo manualmente.' : copyState === 'copied' ? 'Dettagli copiati.' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
