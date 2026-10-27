// Google login for the Drive sync: OAuth 2.0 for client-side web apps (implicit flow, token in the
// URL fragment), proved on iPad Safari by the B0 probe. A "Web application" client needs a secret
// for the code flow, so a static site without a server gets its access token this way. No refresh
// token: after about an hour the page asks again, silently (prompt=none) for the remembered account.

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/** Asked only by "Esporta tutte le sbobine nel mio Drive": files this app creates, nothing else. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Page of this site Google sends the answer to (webui/drive-auth.html, served without .html). */
export const DRIVE_AUTH_RETURN_PATH = '/drive-auth';

/** Google prompt values: none = no UI if already granted, select_account = choose the account. */
export type OAuthPrompt = 'none' | 'consent' | 'select_account';

export interface AuthUrlOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
  prompt?: OAuthPrompt;
  loginHint?: string;
}

export function buildAuthUrl(options: AuthUrlOptions): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'token',
    scope: options.scope ?? DRIVE_APPDATA_SCOPE,
    state: options.state,
    include_granted_scopes: 'true',
  });
  if (options.prompt) params.set('prompt', options.prompt);
  if (options.loginHint) params.set('login_hint', options.loginHint);
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** Random state, so the page accepts only the answer to the login it started. */
export function newState(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The return page of this origin: it must match one of the client's redirect URIs exactly. */
export function redirectUriFor(origin: string): string {
  return `${origin}${DRIVE_AUTH_RETURN_PATH}`;
}

export interface OAuthToken {
  accessToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  scopes: string[];
}

export type OAuthResult =
  | { kind: 'none' }
  | { kind: 'token'; token: OAuthToken }
  | { kind: 'error'; error: string; description?: string };

/** True when the fragment is an OAuth answer (token or error), whatever its state. */
export function isOAuthFragment(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.has('state') && (params.has('access_token') || params.has('error'));
}

export function fragmentState(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('state');
}

/**
 * Reads Google's answer from the fragment. The state must be the one this page sent: anything else
 * (a stale window, a forged link) is rejected before the token is looked at.
 */
export function parseOAuthFragment(hash: string, expectedState: string | null, now: number, requiredScope = DRIVE_APPDATA_SCOPE): OAuthResult {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('access_token') && !params.has('error')) return { kind: 'none' };
  const state = params.get('state');
  if (!expectedState || state !== expectedState) {
    return { kind: 'error', error: 'state_mismatch', description: 'Risposta di Google non richiesta da questa pagina.' };
  }
  const error = params.get('error');
  if (error) return { kind: 'error', error, description: params.get('error_description') ?? undefined };
  const accessToken = params.get('access_token') ?? '';
  const tokenType = params.get('token_type') ?? '';
  const expiresIn = Number.parseInt(params.get('expires_in') ?? '', 10);
  if (!accessToken || tokenType.toLowerCase() !== 'bearer' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return { kind: 'error', error: 'invalid_response', description: 'Risposta di Google incompleta.' };
  }
  const scopes = (params.get('scope') ?? '').split(/\s+/).filter(Boolean);
  // Granular consent lets the user untick a scope: without it every Drive call would fail.
  if (!scopes.includes(requiredScope)) {
    return requiredScope === DRIVE_FILE_SCOPE
      ? { kind: 'error', error: 'file_scope_missing', description: 'Permesso per creare file nel tuo Drive non concesso.' }
      : { kind: 'error', error: 'scope_missing', description: 'Permesso per la cartella dell’app su Drive non concesso.' };
  }
  return { kind: 'token', token: { accessToken, expiresAt: now + expiresIn * 1000, scopes } };
}

/** Message the return page sends to the page that opened it (same origin only). */
export interface OAuthReturnMessage {
  type: 'el-sbobinator-oauth';
  fragment: string;
}

export const OAUTH_CHANNEL = 'el-sbobinator-oauth';

export function isOAuthReturnMessage(data: unknown): data is OAuthReturnMessage {
  return typeof data === 'object' && data !== null
    && (data as OAuthReturnMessage).type === 'el-sbobinator-oauth'
    && typeof (data as OAuthReturnMessage).fragment === 'string';
}

/** Italian text for Google's error codes, for the settings panel. */
export function oauthErrorMessage(error: string, description?: string): string {
  switch (error) {
    case 'admin_policy_enforced':
      return 'Il tuo ateneo o la tua organizzazione non permette ad app esterne di usare Google Drive. Usa un account personale o chiedi all’amministratore.';
    case 'access_denied':
      return 'Accesso a Google Drive non concesso. Se hai annullato, riprova. Con un account universitario l’ateneo potrebbe bloccare le app esterne.';
    case 'interaction_required':
    case 'login_required':
    case 'consent_required':
    case 'account_selection_required':
      return 'Google chiede di confermare l’accesso: tocca “Collega Google Drive”.';
    case 'scope_missing':
      return 'Serve il permesso per la cartella dell’app su Drive: ricollega e lascia la casella spuntata.';
    case 'file_scope_missing':
      return 'Per esportare serve il permesso di creare file nel tuo Drive: riprova e lascia la casella spuntata.';
    case 'popup_blocked':
      return 'Il browser ha bloccato la finestra di Google: consenti le finestre pop-up per questo sito e riprova.';
    case 'timeout':
      return 'Nessuna risposta da Google: chiudi la finestra di accesso e riprova.';
    default:
      return `Accesso a Google non riuscito${description ? `: ${description}` : ` (${error}).`}`;
  }
}

/** Errors after which only an interactive login (a tap on "Collega") can help. */
export function needsInteractiveLogin(error: string): boolean {
  return ['interaction_required', 'login_required', 'consent_required', 'account_selection_required'].includes(error);
}
