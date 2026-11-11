import { DRIVE_APPDATA_SCOPE, DRIVE_AUTH_RETURN_PATH, GOOGLE_AUTH_ENDPOINT } from '../oauth';

// Server half of the Drive login: a Cloudflare Pages Function on the site's own origin
// (functions/api/drive/[action].ts at the repo root) runs it. It keeps the long-lived part of the
// login, so the page never has to ask Google again after the first link:
//   GET  /api/drive/start       a tap opens it in a window: PKCE + state, then Google's consent page
//   GET  /api/drive/callback    Google's answer: the code becomes a refresh token, kept encrypted in
//                               an HttpOnly cookie the page cannot read, then back to /drive-auth
//   POST /api/drive/token       an access token for an hour (+ the account's email), as often as asked
//   POST /api/drive/disconnect  revokes the login at Google and clears the cookie
// Nothing is stored on the server: the cookie is the only copy. The page's Drive files never pass
// here, only tokens. Never log a request body, a cookie or a token.

export interface DriveServerEnv {
  GOOGLE_CLIENT_ID?: string;
  /** Cloudflare secret: never in the page, never in the repository. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Cloudflare secret: 32 random bytes in base64; encrypts both cookies (AES-GCM). */
  DRIVE_COOKIE_KEY?: string;
}

export interface DriveServerDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** The login kept for this browser: the refresh token and its account. */
export const SESSION_COOKIE = '__Host-drive';
/** The login in progress (state + PKCE verifier), from the tap to Google's answer. */
export const LOGIN_COOKIE = '__Host-drive-login';
// Renewed at each token: only six months without opening the app end the login (as Google does).
export const SESSION_MAX_AGE_S = 180 * 24 * 3600;
export const LOGIN_MAX_AGE_S = 600;
export const CALLBACK_PATH = '/api/drive/callback';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)';
const GOOGLE_TIMEOUT_MS = 10_000;
const STATE_PATTERN = /^[0-9a-f]{32}$/;
const ERROR_CODE_PATTERN = /^[a-z_]{1,64}$/;

interface LoginCookie { v: 1; state: string; verifier: string; exp: number }
interface SessionCookie { v: 1; refresh: string; email: string }
interface Config { clientId: string; clientSecret: string; key: CryptoKey }

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const plain = text.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const binary = atob(plain + '==='.slice((plain.length + 3) % 4));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function randomBytes(size: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(size));
}

// Values pasted into the Cloudflare dashboard can keep a trailing newline: Google then knows
// neither the client ID ("OAuth client was not found") nor the secret.
async function configFrom(env: DriveServerEnv): Promise<Config | null> {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const raw = env.DRIVE_COOKIE_KEY ? fromBase64(env.DRIVE_COOKIE_KEY) : null;
  if (!clientId || !clientSecret || raw?.byteLength !== 32) return null;
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { clientId, clientSecret, key };
}

// The cookie's name is the additional data: a login cookie never opens as a session one.
async function seal(key: CryptoKey, name: string, payload: LoginCookie | SessionCookie): Promise<string> {
  const iv = randomBytes(12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(name) }, key, encoder.encode(JSON.stringify(payload)),
  ));
  const out = new Uint8Array(iv.byteLength + sealed.byteLength);
  out.set(iv);
  out.set(sealed, iv.byteLength);
  return toBase64Url(out);
}

async function unseal<T>(key: CryptoKey, name: string, value: string | null): Promise<T | null> {
  const bytes = value ? fromBase64(value) : null;
  if (!bytes || bytes.byteLength <= 12) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(name) }, key, bytes.slice(12),
    );
    const payload = JSON.parse(new TextDecoder().decode(plain)) as { v?: number };
    return payload?.v === 1 ? payload as T : null;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

// __Host-: Secure, Path=/ and no Domain, so no other subdomain can set or read it.
function setCookie(name: string, value: string, maxAge: number, sameSite: 'Strict' | 'Lax'): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=${sameSite}`;
}

function clearCookie(name: string): string {
  return `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function headers(cookies: string[], extra: Record<string, string> = {}): Headers {
  const result = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  for (const cookie of cookies) result.append('Set-Cookie', cookie);
  return result;
}

function json(status: number, body: unknown, cookies: string[] = []): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(cookies, { 'Content-Type': 'application/json; charset=utf-8' }) });
}

function redirect(location: string, cookies: string[] = []): Response {
  return new Response(null, { status: 303, headers: headers(cookies, { Location: location }) });
}

/** Back to the site's return page, which hands the answer to the tab that opened the window. */
function backToApp(origin: string, fields: Record<string, string>, cookies: string[]): Response {
  return redirect(`${origin}${DRIVE_AUTH_RETURN_PATH}#${new URLSearchParams(fields).toString()}`, cookies);
}

async function google(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), GOOGLE_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

/** A request of the site's own page: a fetch from another site (or a form it posts) is refused. */
function fromThisSite(request: Request, origin: string): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return false;
  return request.headers.get('Origin') === origin;
}

async function start(url: URL, config: Config | null, now: number): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  if (!STATE_PATTERN.test(state)) return json(400, { error: 'invalid_request' });
  if (!config) return backToApp(url.origin, { state, error: 'server_not_configured' }, []);
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
  const login = await seal(config.key, LOGIN_COOKIE, { v: 1, state, verifier, exp: now + LOGIN_MAX_AGE_S * 1000 });
  const hint = url.searchParams.get('login_hint');
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${url.origin}${CALLBACK_PATH}`,
    response_type: 'code',
    scope: DRIVE_APPDATA_SCOPE,
    state,
    // offline + consent: a refresh token, also for an account that granted the app before.
    access_type: 'offline',
    prompt: hint ? 'consent' : 'select_account consent',
    include_granted_scopes: 'false',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (hint && hint.length <= 320) params.set('login_hint', hint);
  // Lax, not Strict: Google's answer is a navigation from another site, and Strict would not come back.
  return redirect(`${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`, [setCookie(LOGIN_COOKIE, login, LOGIN_MAX_AGE_S, 'Lax')]);
}

async function callback(request: Request, url: URL, config: Config | null, fetchImpl: typeof fetch, now: number): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const cleared = [clearCookie(LOGIN_COOKIE)];
  const fail = (error: string) => backToApp(url.origin, { state, error }, cleared);
  if (!config) return fail('server_not_configured');
  const login = await unseal<LoginCookie>(config.key, LOGIN_COOKIE, readCookie(request, LOGIN_COOKIE));
  // Only the answer to the login this browser started, within its ten minutes.
  if (!login || !STATE_PATTERN.test(state) || login.state !== state || login.exp <= now) return fail('login_expired');
  const googleError = url.searchParams.get('error');
  if (googleError) return fail(ERROR_CODE_PATTERN.test(googleError) ? googleError : 'login_failed');
  const code = url.searchParams.get('code');
  if (!code) return fail('invalid_response');

  let grant: { access_token?: string; refresh_token?: string; scope?: string };
  try {
    const answer = await google(fetchImpl, GOOGLE_TOKEN_ENDPOINT, form({
      grant_type: 'authorization_code',
      code,
      code_verifier: login.verifier,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: `${url.origin}${CALLBACK_PATH}`,
    }));
    if (!answer.ok) return fail('login_failed');
    grant = await answer.json() as typeof grant;
  } catch {
    return fail('google_unreachable');
  }
  if (!grant.access_token) return fail('invalid_response');
  // Granular consent lets the user untick the box: without it no Drive call would work.
  if (!(grant.scope ?? '').split(/\s+/).includes(DRIVE_APPDATA_SCOPE)) return fail('scope_missing');
  if (!grant.refresh_token) return fail('no_refresh_token');

  let email = '';
  try {
    const about = await google(fetchImpl, DRIVE_ABOUT, { headers: { Authorization: `Bearer ${grant.access_token}` } });
    if (about.ok) email = ((await about.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? '';
  } catch {
    return fail('google_unreachable');
  }
  if (!email) return fail('login_failed');
  const session = await seal(config.key, SESSION_COOKIE, { v: 1, refresh: grant.refresh_token, email });
  return backToApp(url.origin, { state, result: 'ok' }, [...cleared, setCookie(SESSION_COOKIE, session, SESSION_MAX_AGE_S, 'Strict')]);
}

async function token(request: Request, config: Config | null, fetchImpl: typeof fetch): Promise<Response> {
  if (!config) return json(503, { error: 'server_not_configured' });
  const raw = readCookie(request, SESSION_COOKIE);
  const session = await unseal<SessionCookie>(config.key, SESSION_COOKIE, raw);
  if (!session) return json(401, { error: 'login_required' }, raw ? [clearCookie(SESSION_COOKIE)] : []);
  let answer: Response;
  let body: { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; error?: string };
  try {
    answer = await google(fetchImpl, GOOGLE_TOKEN_ENDPOINT, form({
      grant_type: 'refresh_token',
      refresh_token: session.refresh,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }));
    body = await answer.json().catch(() => ({})) as typeof body;
  } catch {
    return json(502, { error: 'google_unreachable' });
  }
  // Revoked from the Google account, or unused for six months: only a new link helps.
  if (body.error === 'invalid_grant') return json(401, { error: 'login_required' }, [clearCookie(SESSION_COOKIE)]);
  if (!answer.ok || !body.access_token || !(Number(body.expires_in) > 0)) return json(502, { error: 'google_error' });
  if (body.scope && !body.scope.split(/\s+/).includes(DRIVE_APPDATA_SCOPE)) {
    return json(401, { error: 'login_required' }, [clearCookie(SESSION_COOKIE)]);
  }
  // Google rarely hands a new refresh token; the old cookie otherwise, its six months renewed.
  const kept = body.refresh_token
    ? await seal(config.key, SESSION_COOKIE, { ...session, refresh: body.refresh_token })
    : raw!;
  return json(200, { access_token: body.access_token, expires_in: Number(body.expires_in), email: session.email }, [
    setCookie(SESSION_COOKIE, kept, SESSION_MAX_AGE_S, 'Strict'),
  ]);
}

async function disconnect(request: Request, config: Config | null, fetchImpl: typeof fetch): Promise<Response> {
  const session = config ? await unseal<SessionCookie>(config.key, SESSION_COOKIE, readCookie(request, SESSION_COOKIE)) : null;
  if (session) {
    // Best effort: the cookie goes anyway, and with it the only copy of the refresh token.
    await google(fetchImpl, GOOGLE_REVOKE_ENDPOINT, form({ token: session.refresh })).catch(() => undefined);
  }
  return new Response(null, { status: 204, headers: headers([clearCookie(SESSION_COOKIE)]) });
}

export async function handleDriveRequest(request: Request, env: DriveServerEnv, action: string, deps: DriveServerDeps = {}): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = (deps.now ?? Date.now)();
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const config = await configFrom(env);
  switch (action) {
    case 'start':
      return method === 'GET' ? start(url, config, now) : json(405, { error: 'method_not_allowed' });
    case 'callback':
      return method === 'GET' ? callback(request, url, config, fetchImpl, now) : json(405, { error: 'method_not_allowed' });
    case 'token':
    case 'disconnect':
      if (method !== 'POST') return json(405, { error: 'method_not_allowed' });
      if (!fromThisSite(request, url.origin)) return json(403, { error: 'forbidden' });
      return action === 'token' ? token(request, config, fetchImpl) : disconnect(request, config, fetchImpl);
    default:
      return json(404, { error: 'not_found' });
  }
}
