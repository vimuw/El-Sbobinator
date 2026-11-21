// What the web build turns on or off at start-up (web/webHost.ts, monitoring/start.ts); the UI
// follows. Everything else the site always does the same way.
export interface HostCapabilities {
  // Deleting a sbobina removes it at once; without this (builds with Drive sync) it goes to a
  // trash kept 30 days.
  permanentDelete: boolean;
  // "Segnala un problema" writes an email to the developer; builds with a Sentry DSN turn it off
  // for the in-app feedback window (components/modals/FeedbackModal.tsx).
  reportByEmail: boolean;
}

export const DEFAULT_CAPABILITIES: HostCapabilities = {
  permanentDelete: true,
  reportByEmail: true,
};

let hostCapabilities: HostCapabilities = DEFAULT_CAPABILITIES;

export function getHostCapabilities(): HostCapabilities {
  return hostCapabilities;
}

/** The web build on a touch-first device (tablet, phone), where files are picked, not dragged onto the page. */
export function isTouchWeb(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

export function setHostCapabilities(capabilities: Partial<HostCapabilities>): void {
  hostCapabilities = { ...DEFAULT_CAPABILITIES, ...capabilities };
}
