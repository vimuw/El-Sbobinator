import { useCallback, useEffect, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../storageKeys';

// The console is closed by default and many people never learn what it is for. The first few
// runs started with it closed say what it shows, right under the progress; opening the console
// once (from here or the sidebar) or closing the hint retires it for good.
export const CONSOLE_HINT_RUNS = 3;
const RETIRED = 'done';

function readHint(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.CONSOLE_HINT_V1);
  } catch {
    // Without storage the count cannot be kept: stay quiet rather than show it on every run.
    return RETIRED;
  }
}

function writeHint(value: string) {
  try {
    localStorage.setItem(STORAGE_KEYS.CONSOLE_HINT_V1, value);
  } catch {
    // Best effort: the hint simply shows again next time.
  }
}

/**
 * Whether the hint shows for the run in progress, and how to close it for good. A batch is one run:
 * between its auto-continued files the app is idle for a moment while `betweenFiles` holds.
 */
export function useConsoleHint(isProcessing: boolean, betweenFiles: boolean, showConsole: boolean) {
  const [visible, setVisible] = useState(false);
  // A run already going when the page mounts (back from the archive) is not a new start.
  const runningRef = useRef(isProcessing);

  useEffect(() => {
    // Idle with a batch still counted is a new start being prepared unless a file of it just ran.
    const running = isProcessing || (runningRef.current && betweenFiles);
    const started = running && !runningRef.current;
    runningRef.current = running;
    if (!running) {
      setVisible(false);
      return;
    }
    if (!started || showConsole) return;
    const stored = readHint();
    if (stored === RETIRED) return;
    const runs = Number(stored) || 0;
    if (runs >= CONSOLE_HINT_RUNS) return;
    writeHint(String(runs + 1));
    setVisible(true);
  }, [isProcessing, betweenFiles, showConsole]);

  useEffect(() => {
    if (!showConsole) return;
    writeHint(RETIRED);
    setVisible(false);
  }, [showConsole]);

  const dismiss = useCallback(() => {
    writeHint(RETIRED);
    setVisible(false);
  }, []);

  return { visible, dismiss };
}
