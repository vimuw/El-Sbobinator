import { useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, Key } from 'lucide-react';
import { GEMINI_KEY_PATTERN } from '../utils';

interface SetupPageProps {
  hasProtectedKey: boolean;
  onSaved: (key: string) => void;
  preferredModel: string;
  fallbackKeys: string[];
  fallbackModels: string[];
}

export function SetupPage({
  hasProtectedKey,
  onSaved,
  preferredModel,
  fallbackKeys,
  fallbackModels,
}: SetupPageProps) {
  const [setupKeyInput, setSetupKeyInput] = useState('');
  const [setupKeyShowRaw, setSetupKeyShowRaw] = useState(false);
  const [setupKeySaving, setSetupKeySaving] = useState(false);
  const [setupKeyError, setSetupKeyError] = useState<string | null>(null);

  const handleSetupSave = async () => {
    setSetupKeySaving(true);
    setSetupKeyError(null);
    try {
      if (!window.pywebview?.api?.save_settings) {
        setSetupKeyError('Bridge Python non disponibile — impostazioni non salvate.');
        return;
      }
      let result;
      try {
        result = await window.pywebview.api.save_settings(
          setupKeyInput.trim(),
          fallbackKeys,
          preferredModel,
          fallbackModels,
        );
      } catch (e: unknown) {
        setSetupKeyError(`Errore salvataggio: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!result?.ok) {
        setSetupKeyError(`Errore salvataggio: ${result?.error || 'errore sconosciuto'}`);
        return;
      }
      onSaved(setupKeyInput.trim());
    } finally {
      setSetupKeySaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="relative overflow-hidden rounded-xl px-6 py-8 sm:px-8 sm:py-10 flex flex-col items-center gap-6 w-full max-w-lg mx-auto"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.03)',
      }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <motion.div
          initial={{ rotate: 0 }}
          animate={{
            y: [0, -4, 0],
            rotate: 0,
          }}
          transition={{
            y: {
              duration: 3.5,
              repeat: Infinity,
              ease: 'easeInOut',
            },
          }}
          whileHover={{
            rotate: [0, -10, 10, -5, 5, 0],
            transition: { duration: 0.5 },
          }}
          className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm cursor-default"
          style={{ background: 'var(--accent-subtle)', border: '1px solid var(--border-subtle)' }}
        >
          <Key className="w-5 h-5" style={{ color: 'var(--accent-text)' }} />
        </motion.div>
        <h3
          className="text-xl font-bold tracking-tight mt-1"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {hasProtectedKey ? 'Chiave API non accessibile' : 'Configura la tua API Key'}
        </h3>
        <p className="text-sm leading-relaxed max-w-sm" style={{ color: 'var(--text-muted)' }}>
          {hasProtectedKey
            ? 'La tua chiave era salvata ma non è accessibile (errore di sistema). Reinseriscila per continuare.'
            : 'El Sbobinator usa Google Gemini per trascrivere audio e video. Inserisci una chiave API gratuita per iniziare.'}
        </p>
      </div>

      <div className="w-full flex flex-col gap-3">
        <div className="flex flex-col">
          <label
            className="text-[10px] font-bold uppercase tracking-wider mb-1.5 px-0.5 select-none"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}
          >
            Chiave API Gemini
          </label>
          <div className="relative">
            <input
              type={setupKeyShowRaw ? 'text' : 'password'}
              value={setupKeyInput}
              onChange={e => setSetupKeyInput(e.target.value)}
              onKeyDown={async e => {
                if (e.key !== 'Enter') return;
                if (!GEMINI_KEY_PATTERN.test(setupKeyInput.trim())) return;
                if (setupKeySaving) return;
                await handleSetupSave();
              }}
              placeholder="Incolla qui la tua API Key (AIzaSy... o AQ...)"
              className="app-input font-mono text-sm pr-10"
              style={{
                background: 'var(--bg-input)',
                border: `1px solid ${
                  setupKeyInput.trim() && GEMINI_KEY_PATTERN.test(setupKeyInput.trim())
                    ? 'var(--success-ring)'
                    : setupKeyInput.trim()
                      ? 'var(--warning-ring)'
                      : 'var(--border-default)'
                }`,
                color: 'var(--text-primary)',
                borderRadius: '6px',
                padding: '0.75rem 0.85rem',
              }}
            />
            <button
              onClick={() => setSetupKeyShowRaw(v => !v)}
              tabIndex={-1}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: '2px',
                lineHeight: 1,
              }}
              aria-label={setupKeyShowRaw ? 'Nascondi chiave' : 'Mostra chiave'}
            >
              {setupKeyShowRaw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {setupKeyInput.trim() && (
          <p
            className="text-xs px-0.5"
            style={{
              color: GEMINI_KEY_PATTERN.test(setupKeyInput.trim())
                ? 'var(--success-text)'
                : 'var(--warning-text)',
            }}
          >
            {GEMINI_KEY_PATTERN.test(setupKeyInput.trim())
              ? '✓ Formato valido — premi Salva per continuare'
              : '⚠ Formato non valido — le chiavi iniziano con AIzaSy... o AQ.'}
          </p>
        )}

        <motion.button
          whileHover={GEMINI_KEY_PATTERN.test(setupKeyInput.trim()) && !setupKeySaving ? { scale: 1.01 } : {}}
          whileTap={GEMINI_KEY_PATTERN.test(setupKeyInput.trim()) && !setupKeySaving ? { scale: 0.99 } : {}}
          disabled={!GEMINI_KEY_PATTERN.test(setupKeyInput.trim()) || setupKeySaving}
          onClick={handleSetupSave}
          className="premium-button w-full mt-2"
          style={{
            cursor: !GEMINI_KEY_PATTERN.test(setupKeyInput.trim()) || setupKeySaving ? 'not-allowed' : 'pointer',
            opacity: !GEMINI_KEY_PATTERN.test(setupKeyInput.trim()) ? 0.5 : 1,
            borderRadius: '6px',
            padding: '0.8rem 1rem',
          }}
        >
          <Key className="w-4 h-4" />
          {setupKeySaving ? 'Salvataggio…' : 'Salva e inizia'}
        </motion.button>

        {setupKeyError && (
          <p className="text-xs text-center mt-1" style={{ color: 'var(--error-text)' }}>
            ❌ {setupKeyError}
          </p>
        )}
      </div>

      <div
        className="w-full rounded-lg p-4 flex gap-3 text-left pl-5"
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-subtle)',
          borderLeft: '3px solid var(--accent-bg)',
        }}
      >
        <div className="flex flex-col gap-2">
          <p
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--text-secondary)', opacity: 0.8, letterSpacing: '0.05em' }}
          >
            Come ottenere la chiave in 1 minuto
          </p>
          <ol className="flex flex-col gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <li className="flex items-start gap-2">
              <span className="shrink-0 font-bold" style={{ color: 'var(--accent-text)' }}>1.</span>
              <span>
                Vai su{' '}
                <a
                  href="#"
                  onClick={e => {
                    e.preventDefault();
                    window.pywebview?.api?.open_url?.('https://aistudio.google.com/apikey');
                  }}
                  className="underline hover:opacity-100 opacity-80 transition-opacity font-medium"
                  style={{ color: 'var(--accent-text)' }}
                >
                  aistudio.google.com/apikey
                </a>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="shrink-0 font-bold" style={{ color: 'var(--accent-text)' }}>2.</span>
              <span>
                Clicca <strong>"Create API key"</strong> e copia la chiave
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="shrink-0 font-bold" style={{ color: 'var(--accent-text)' }}>3.</span>
              <span>
                Incollala nel campo qui sopra e premi <strong>Salva e inizia</strong>
              </span>
            </li>
          </ol>
        </div>
      </div>
    </motion.div>
  );
}
