import {
  addIntegration,
  breadcrumbsIntegration,
  captureException,
  captureFeedback,
  dedupeIntegration,
  getClient,
  httpContextIntegration,
  init,
  linkedErrorsIntegration,
  type BrowserOptions,
  type Event,
  type EventHint,
} from '@sentry/browser';
import { APP_VERSION, WEB_PREVIEW_BUILD } from '../branding';
import { setErrorMonitor } from '../diagnostics';
import { REPORT_TUNNEL_PATH, loadAutoReports, saveAutoReports } from './config';
import { scrubBreadcrumb, scrubEvent } from './scrub';

type Attachment = NonNullable<EventHint['attachments']>[number];
type Integration = Parameters<typeof addIntegration>[0];

// Feedback and error reports of the web build (piano-feedback.md). Only main.tsx loads this
// module, and only in builds with a DSN: drive-auth.html, where Google's answer arrives, never does.
// Errors come from diagnostics.ts, which already listens to the page; Sentry's own global handlers,
// console capture, replay and tracing stay off. Everything goes through the site's /api/report.

export type FeedbackKind = 'bug' | 'idea' | 'altro';

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  email?: string;
  images: Array<{ data: Uint8Array; filename: string }>;
  /** The diagnostic report shown to the user (Impostazioni → Diagnostica); undefined when they left it out. */
  techReport?: string;
}

export type FeedbackResult = { ok: true; code: string } | { ok: false; reason: 'rate_limited' | 'unavailable' };

export const MAX_AUTOMATIC_REPORTS = 10;
export const MAX_FEEDBACK = 3;
export const FEEDBACK_WINDOW_MS = 10 * 60_000;
export const FEEDBACK_SEND_TIMEOUT_MS = 20_000;
// Marks a feedback sent without the tech info: the filter strips it to the user's words.
const BARE_TAG = 'feedback.tech';

let autoReports = true;
let automaticSent = 0;
let lastErrorId: string | undefined;
const feedbackTimes: number[] = [];

function scrubbingIntegration(): Integration {
  return {
    name: 'ElSbobinatorScrub',
    // Runs on every event, feedback included (beforeSend only sees errors).
    processEvent(event: Event) {
      if (event.type !== 'feedback' && !autoReports) return null;
      return scrubEvent(event, { bare: event.type === 'feedback' && event.tags?.[BARE_TAG] === 'off' });
    },
  };
}

export function monitoringOptions(dsn: string): BrowserOptions {
  return {
    dsn,
    tunnel: REPORT_TUNNEL_PATH,
    release: APP_VERSION,
    environment: WEB_PREVIEW_BUILD ? 'preview' : 'production',
    // SDK 11 collects user, cookies, headers, bodies and query strings unless told otherwise.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      frameContextLines: 0,
      genAI: { inputs: false, outputs: false },
    },
    defaultIntegrations: false,
    integrations: [
      // No console breadcrumbs: they come only with consoleIntegration, which stays out.
      breadcrumbsIntegration({ dom: true, fetch: true, history: true, xhr: true, sentry: false }),
      dedupeIntegration(),
      linkedErrorsIntegration(),
      httpContextIntegration(),
      scrubbingIntegration(),
    ],
    maxBreadcrumbs: 30,
    beforeBreadcrumb: breadcrumb => scrubBreadcrumb(breadcrumb),
  };
}

function captureAutomatic(source: string, error: unknown) {
  if (!autoReports || automaticSent >= MAX_AUTOMATIC_REPORTS) return;
  automaticSent += 1;
  lastErrorId = captureException(error, { tags: { source: source.slice(0, 32) } });
}

/** Once, from main.tsx; tests pass a transport in `overrides`. */
export function initMonitoring(dsn: string, overrides: Partial<BrowserOptions> = {}): void {
  autoReports = loadAutoReports();
  init({ ...monitoringOptions(dsn), ...overrides });
  setErrorMonitor(captureAutomatic);
}

export function autoReportsEnabled(): boolean {
  return autoReports;
}

export function setAutoReports(on: boolean): void {
  autoReports = on;
  saveAutoReports(on);
}

function waitForDelivery(eventId: string): Promise<boolean> {
  const client = getClient();
  if (!client) return Promise.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => finish(false), FEEDBACK_SEND_TIMEOUT_MS);
    const off = client.on('afterSendEvent', (event, response) => {
      if (event.event_id !== eventId) return;
      const status = response.statusCode;
      finish(status !== undefined && status >= 200 && status < 300);
    });
    function finish(delivered: boolean) {
      clearTimeout(timer);
      off();
      resolve(delivered);
    }
  });
}

export async function sendFeedback(input: FeedbackInput, now: number = Date.now()): Promise<FeedbackResult> {
  while (feedbackTimes.length && now - feedbackTimes[0] > FEEDBACK_WINDOW_MS) feedbackTimes.shift();
  if (feedbackTimes.length >= MAX_FEEDBACK) return { ok: false, reason: 'rate_limited' };
  if (!getClient()) return { ok: false, reason: 'unavailable' };
  const attachments: Attachment[] = input.images.map(image => ({ data: image.data, filename: image.filename, contentType: 'image/jpeg' }));
  if (input.techReport !== undefined) {
    attachments.push({ data: input.techReport, filename: 'info-tecniche.txt', contentType: 'text/plain' });
  }
  const email = input.email?.trim();
  const eventId = captureFeedback({
    message: input.message.trim(),
    ...(email ? { email } : {}),
    source: 'el-sbobinator-modal',
    url: globalThis.location?.href,
    // The last error this page reported: what just went wrong, with its breadcrumbs.
    associatedEventId: input.techReport !== undefined ? lastErrorId : undefined,
    tags: { 'feedback.kind': input.kind, [BARE_TAG]: input.techReport !== undefined ? 'on' : 'off' },
  }, { attachments });
  // The slot is taken while the report travels, so parallel sends still count, and given back if
  // it is not delivered: a failed try must not cost the user the next one, or the Google form link
  // that comes only with 'unavailable'.
  feedbackTimes.push(now);
  const delivered = await waitForDelivery(eventId);
  if (!delivered) {
    const slot = feedbackTimes.indexOf(now);
    if (slot >= 0) feedbackTimes.splice(slot, 1);
    return { ok: false, reason: 'unavailable' };
  }
  return { ok: true, code: eventId.slice(0, 8).toUpperCase() };
}

/** Tests only: back to a fresh page. */
export function resetMonitoringForTests(): void {
  autoReports = true;
  automaticSent = 0;
  lastErrorId = undefined;
  feedbackTimes.length = 0;
  setErrorMonitor(null);
}
