import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { Check, ChevronDown, Copy, X } from 'lucide-react';
import type { AppStatus } from '../appState';
import { DURATION, enterTransition } from '../motion';

const COLLAPSED_LINES = 3;

// The height the tail will have, read from the scrolling logs: their last few lines and the same
// padding, in fractional pixels so the hand-over lands on the tail exactly. With no lines the
// tail shows the last message instead, last measured at `fallback`; a panel that opened expanded
// never measured it (0), so it is taken as one line of the logs' text.
function tailHeight(logs: HTMLElement, fallback: number) {
  const lines = logs.children;
  const { paddingTop, paddingBottom, lineHeight, fontSize } = getComputedStyle(logs);
  const padding = parseFloat(paddingTop) + parseFloat(paddingBottom);
  if (lines.length === 0) {
    if (fallback > 0) return fallback;
    const line = parseFloat(lineHeight);
    return padding + (Number.isFinite(line) ? line : parseFloat(fontSize) * 1.2);
  }
  const first = lines[Math.max(0, lines.length - COLLAPSED_LINES)].getBoundingClientRect();
  const last = lines[lines.length - 1].getBoundingClientRect();
  return padding + (last.bottom - first.top);
}

type LogTone = 'error' | 'warning' | 'success' | 'normal';

const TONE_COLORS: Record<LogTone, string> = {
  error: 'var(--console-error, var(--error-text))',
  warning: 'var(--console-warning, var(--warning-text))',
  success: 'var(--console-success, var(--success-text))',
  normal: 'var(--console-text)',
};

// appendConsole prefixes every line with toLocaleTimeString(), whose format depends on the locale.
const TIMESTAMP = /^\[[^\]]*\d[^\]]*\]/;

// Messages state their severity with a leading marker (❌ stops, ⚠ continues, ✅ done), so the
// colour never depends on words that can appear in any message. Uncaught Python errors carry no
// marker and are recognised by their traceback shape.
function logTone(message: string): LogTone {
  const body = message.trimStart();
  if (body.startsWith('❌') || /^(Traceback \(most recent call last\)|\w+(Error|Exception)\b.*:)/.test(body)) return 'error';
  if (body.startsWith('⚠')) return 'warning';
  if (body.startsWith('✅')) return 'success';
  return 'normal';
}

function LogLine({ log }: { log: string }) {
  const ts = log.match(TIMESTAMP)?.[0] ?? '';
  const rest = log.slice(ts.length);
  const tone = logTone(rest);
  if (ts) {
    return <div data-tone={tone}><span style={{ color: 'var(--console-muted, var(--text-muted))' }}>{ts}</span><span style={{ color: TONE_COLORS[tone] }}>{rest}</span></div>;
  }
  return <div data-tone={tone} style={{ color: TONE_COLORS[tone] }}>{log}</div>;
}

interface ConsolePanelProps {
  consoleLogs: string[];
  lastConsoleMessage: string;
  appState: AppStatus;
  isConsoleExpanded?: boolean;
  setIsConsoleExpanded?: (expanded: boolean | ((prev: boolean) => boolean)) => void;
  /** Hides the console: its button left the sidebar, so the panel closes itself. */
  onClose?: () => void;
}

export const ConsolePanel = memo(function ConsolePanel({
  consoleLogs,
  lastConsoleMessage,
  appState,
  isConsoleExpanded: propIsConsoleExpanded,
  setIsConsoleExpanded: propSetIsConsoleExpanded,
  onClose,
}: ConsolePanelProps) {
  const [localIsExpanded, setLocalIsExpanded] = useState(false);
  const isConsoleExpanded = propIsConsoleExpanded !== undefined ? propIsConsoleExpanded : localIsExpanded;
  const setIsConsoleExpanded = propSetIsConsoleExpanded !== undefined ? propSetIsConsoleExpanded : setLocalIsExpanded;

  const [isCopied, setIsCopied] = useState(false);
  const consoleScrollRef = useRef<HTMLDivElement>(null);
  const isMouseInConsoleRef = useRef(false);

  useEffect(() => {
    if (!isConsoleExpanded || isMouseInConsoleRef.current) return;
    const el = consoleScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleLogs, isConsoleExpanded]);

  // Expanding and collapsing ease one box, the scrolling logs, held at their last line: they
  // start (or end) at the height of the tail, where they show what the tail shows in the same
  // place, so the swap with the tail cannot be seen and the text never jumps. The logs stay
  // mounted while they ease back, and give way to the tail once they have reached it.
  const [scrollShown, setScrollShown] = useState(isConsoleExpanded);
  if (isConsoleExpanded && !scrollShown) setScrollShown(true);
  const tailRef = useRef<HTMLDivElement>(null);
  const tailHeightRef = useRef(0);
  useLayoutEffect(() => {
    if (tailRef.current) tailHeightRef.current = tailRef.current.getBoundingClientRect().height;
  });
  const easedExpandedRef = useRef(isConsoleExpanded);
  const easingRef = useRef<ReturnType<typeof animate> | null>(null);
  useLayoutEffect(() => {
    if (easedExpandedRef.current === isConsoleExpanded) return;
    easedExpandedRef.current = isConsoleExpanded;
    const el = consoleScrollRef.current;
    if (!el) return;
    easingRef.current?.stop();
    // Mid-ease it carries on from where it is; at rest the logs are as tall as their class says.
    const current = el.style.height ? el.getBoundingClientRect().height : null;
    el.style.height = '';
    const expandedHeight = el.getBoundingClientRect().height;
    const from = current ?? (isConsoleExpanded ? tailHeightRef.current : expandedHeight);
    const to = isConsoleExpanded ? expandedHeight : tailHeight(el, tailHeightRef.current);
    const holdAt = (height: number) => {
      el.style.height = `${height}px`;
      el.scrollTop = el.scrollHeight;
    };
    el.style.overflowY = 'hidden';
    holdAt(from);
    const easing = animate(from, to, { ...enterTransition(DURATION.slow), onUpdate: holdAt });
    easingRef.current = easing;
    void easing.finished.then(() => {
      if (easingRef.current !== easing) return;
      easingRef.current = null;
      // Collapsed, the logs stay held at the tail's height until the tail replaces them: let go
      // first, they were back at full height for the frame before React swapped them, and the
      // panel jumped down and up again.
      if (!isConsoleExpanded) {
        setScrollShown(false);
        return;
      }
      el.style.height = '';
      el.style.overflowY = '';
      el.scrollTop = el.scrollHeight;
    });
  }, [isConsoleExpanded]);
  useEffect(() => () => easingRef.current?.stop(), []);

  return (
    <div className="console-shell console-shell-subtle">
      <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'var(--console-header)', borderBottom: '1px solid var(--console-border, var(--border-subtle))' }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--console-heading)' }}>
          <span className={`w-2 h-2 rounded-full ${appState === 'processing' ? 'animate-pulse' : ''}`} style={appState !== 'processing' ? { background: 'var(--console-heading)' } : { background: 'var(--processing-dot)' }} />
          Console
        </h2>
        <div className="flex items-center gap-1">
          {isConsoleExpanded && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(consoleLogs.join('\n'));
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
              }}
              className="p-1.5 rounded-md hover:bg-[var(--border-subtle)] transition-colors"
              title={isCopied ? 'Copiato!' : 'Copia tutto'}
              style={{ color: isCopied ? 'var(--console-success, var(--success-text))' : 'var(--console-heading)', transition: 'color 0.2s' }}
            >
              {isCopied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          )}
          <button
            onClick={() => setIsConsoleExpanded(prev => !prev)}
            className="p-1.5 rounded-md hover:bg-[var(--border-subtle)] transition-colors"
            title={isConsoleExpanded ? 'Riduci' : 'Espandi'}
            style={{ color: 'var(--console-heading)' }}
          >
            <ChevronDown size={15} style={{ transform: isConsoleExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center w-[var(--icon-button-xs)] h-[var(--icon-button-xs)] rounded-md hover:bg-[var(--border-subtle)] transition-colors"
              title="Chiudi console"
              aria-label="Chiudi console"
              style={{ color: 'var(--console-heading)' }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {scrollShown ? (
        <div
          ref={consoleScrollRef}
          className="console-scroll console-lines relative px-4 py-3 overflow-y-auto font-mono text-xs space-y-1 h-52 select-text"
          style={{ color: 'var(--console-text)', background: 'var(--console-bg)', whiteSpace: 'pre-wrap' }}
          onMouseEnter={() => { isMouseInConsoleRef.current = true; }}
          onMouseLeave={() => { isMouseInConsoleRef.current = false; }}
        >
          {consoleLogs.map((log, i) => <LogLine key={i} log={log} />)}
        </div>
      ) : (
        // Collapsed it still reads as a terminal: the last few lines, not a summary sentence.
        <div ref={tailRef} className="console-tail console-lines px-4 py-3 overflow-hidden font-mono text-xs space-y-1" style={{ color: 'var(--console-text)', background: 'var(--console-bg)', whiteSpace: 'pre-wrap' }}>
          {consoleLogs.length > 0
            ? consoleLogs.slice(-COLLAPSED_LINES).map((log, i) => <LogLine key={consoleLogs.length - COLLAPSED_LINES + i} log={log} />)
            : <div>{lastConsoleMessage}</div>}
        </div>
      )}
    </div>
  );
});
