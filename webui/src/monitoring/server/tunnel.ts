// The site's tunnel to Sentry: a Cloudflare Pages Function on the site's own origin
// (functions/api/report.ts at the repo root) runs it. The page's SDK sends its envelopes to
// POST /api/report instead of Sentry's host, so ad blockers leave the reports alone, the policy
// keeps connect-src 'self' and Sentry never sees the user's address.
// It forwards only to the one project of SENTRY_DSN and only the envelope: never the browser's
// cookies (the Drive login's __Host-drive goes with every request to the site), never its IP.
// Nothing is stored here; never log a body.

export interface ReportServerEnv {
  /** The project's DSN, as in the page's build (EL_SBOBINATOR_SENTRY_DSN). */
  SENTRY_DSN?: string;
  /**
   * Other origins allowed to send, comma-separated: https://elsbobinator.com, or staging's on
   * Preview. A page on the address the request came to is always allowed: the site still runs on
   * www. and *.pages.dev (canonicalOrigin.ts shows a notice there, it does not redirect).
   */
  REPORT_ALLOWED_ORIGIN?: string;
}

export interface ReportServerDeps {
  fetchImpl?: typeof fetch;
}

export const REPORT_PATH = '/api/report';
/** Three re-encoded images plus the event and the tech info, with room to spare. */
export const MAX_ENVELOPE_BYTES = 5 * 1024 * 1024;
const SENTRY_TIMEOUT_MS = 10_000;
const ENVELOPE_CONTENT_TYPE = 'application/x-sentry-envelope';

interface Project { host: string; projectId: string; publicKey: string }

function parseDsn(value: string | undefined): Project | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    const projectId = url.pathname.replace(/^\/+|\/+$/g, '');
    if (url.protocol !== 'https:' || !url.username || !/^[0-9]+$/.test(projectId) || !url.hostname.endsWith('.sentry.io')) return null;
    return { host: url.hostname, projectId, publicKey: url.username };
  } catch {
    return null;
  }
}

function answer(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}

async function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** The envelope's first line names its project: it must be ours. */
function sameProject(body: Uint8Array, project: Project): boolean {
  const end = body.indexOf(0x0a);
  try {
    const header = JSON.parse(new TextDecoder().decode(end >= 0 ? body.subarray(0, end) : body)) as { dsn?: unknown };
    if (typeof header.dsn !== 'string') return false;
    const sent = parseDsn(header.dsn);
    return sent !== null && sent.host === project.host && sent.projectId === project.projectId && sent.publicKey === project.publicKey;
  } catch {
    return false;
  }
}

/** The page's own site (whatever address it was opened on), or one the project lists. */
function allowedOrigin(request: Request, env: ReportServerEnv): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  if (origin === new URL(request.url).origin) return true;
  const allowed = (env.REPORT_ALLOWED_ORIGIN ?? '').split(',').map(item => item.trim()).filter(Boolean);
  return allowed.includes(origin);
}

export async function handleReportRequest(request: Request, env: ReportServerEnv, deps: ReportServerDeps = {}): Promise<Response> {
  const project = parseDsn(env.SENTRY_DSN);
  // A site built without reports has no tunnel either.
  if (!project) return answer(404);
  if (request.method !== 'POST') return answer(405, { Allow: 'POST' });
  if (!allowedOrigin(request, env)) return answer(403);
  const body = await readLimited(request, MAX_ENVELOPE_BYTES);
  if (!body) return answer(413);
  if (!sameProject(body, project)) return answer(400);
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const upstream = await fetchImpl(`https://${project.host}/api/${project.projectId}/envelope/`, {
      method: 'POST',
      // The envelope and its type only: no cookie, no Authorization, no client address.
      headers: { 'Content-Type': ENVELOPE_CONTENT_TYPE },
      body,
      signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
    });
    // The SDK pauses by itself on Sentry's rate limits; nothing else of the answer goes back.
    const extra: Record<string, string> = {};
    for (const name of ['Retry-After', 'X-Sentry-Rate-Limits']) {
      const value = upstream.headers.get(name);
      if (value) extra[name] = value;
    }
    return answer(upstream.status >= 500 ? 502 : upstream.status, extra);
  } catch {
    return answer(502);
  }
}
