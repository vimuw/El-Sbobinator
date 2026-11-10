import { STORAGE_KEYS } from '../../storageKeys';
import { DriveError } from './driveApi';
import {
  DRIVE_APPDATA_SCOPE,
  DRIVE_FILE_SCOPE,
  OAUTH_CHANNEL,
  buildAuthUrl,
  fragmentState,
  isOAuthReturnMessage,
  needsInteractiveLogin,
  newState,
  oauthErrorMessage,
  parseOAuthFragment,
  parseServerReturn,
  type OAuthToken,
} from './oauth';

// The Drive login of this tab. The site's server (server/driveServer.ts) keeps the login in a
// cookie this page cannot read and hands it an access token for an hour whenever it asks: no
// window, no tap, no hourly reconnect. The token lives in this page's memory only. The account's
// email stays in localStorage: without it the page asks for no token (after "Disconnetti" in
// another tab, or a cookie the server could not clear). A Google window opens only to link the
// account and for the export's own permission (drive.file), from a tap: browsers block it otherwise.

const SERVER_PATH = '/api/drive';
const WINDOW_NAME = 'el-sbobinator-google';
const WINDOW_FEATURES = 'popup,width=500,height=650';
// token() treats a token this close to expiry as gone; freshToken() renews it earlier, so a sync
// round never starts on one that dies halfway.
const EXPIRY_MARGIN_MS = 60_000;
const REFRESH_MARGIN_MS = 5 * 60_000;
const ANSWER_TIMEOUT_MS = 180_000;
const SERVER_TIMEOUT_MS = 15_000;
const DISCONNECT_TIMEOUT_MS = 10_000;

export class DriveAuthError extends Error {
  constructor(readonly code: string, description?: string) {
    super(oauthErrorMessage(code, description));
    this.name = 'DriveAuthError';
  }

  /** Google wants a choice the export's window did not offer: the user must log in again. */
  get needsInteractiveLogin(): boolean {
    return needsInteractiveLogin(this.code);
  }
}

interface MessageSource {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface DriveAuthOptions {
  clientId: string;
  /** Google's return page for the export's login (implicit flow). */
  redirectUri: string;
  /** This site's origin: the server's /api/drive and the return page's messages. */
  origin?: string;
  /** Only to clear the token older builds kept there. */
  session?: Storage | null;
  local?: Storage | null;
  openWindow?: (url: string) => Window | null;
  /** Same-origin channel the return page answers on (accounts.google.com can cut window.opener). */
  openChannel?: () => (MessageSource & { close(): void }) | null;
  windowEvents?: MessageSource | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface DriveAuth {
  /** A valid access token already in memory, or null. */
  token(): string | null;
  /**
   * A valid access token, renewed by the server when it is about to expire. Null when there is no
   * login to renew (never linked, disconnected, lost, or a link being bound); throws a DriveError
   * when no valid token is left and the server cannot be reached (status 0, offline) or fails (its
   * own status, never 401).
   */
  freshToken(): Promise<string | null>;
  /** Email of the connected account, remembered across reloads (not a secret). */
  account(): string | null;
  /** Remembers the account, which this tab's token belongs to as well. */
  setAccount(email: string): void;
  /** The account this tab's token was issued for, null when unknown. */
  tokenAccount(): string | null;
  /** The server has no usable login for this browser (revoked, expired, or another account's): "Riconnetti". */
  needsReconnect(): boolean;
  /**
   * "Collega Google Drive": opens the site's login window (call it synchronously inside a tap). The
   * token it resolves with is not this tab's until adopt(): the sync binds its account first.
   */
  connect(): Promise<DriveToken>;
  /** "Esporta": opens Google's window for drive.file only; its token serves the export, never the tab. */
  connectExport(): Promise<OAuthToken>;
  /** Keeps a token connect() returned as this tab's. */
  adopt(token: OAuthToken): void;
  /** Forgets this tab's token (Drive answered 401); needsReconnect: the login is unusable. */
  expire(needsReconnect?: boolean): void;
  /**
   * Another tab took over ("Usa qui"): no token from here on, and no renewal either. The server's
   * login stays (the other tab uses it); this page only waits for its reload.
   */
  stop(): void;
  /**
   * "Disconnetti": the account is forgotten, and the server revokes the login at Google and clears
   * its cookie. Until the server confirms that, the disconnect stays pending (disconnectPending).
   */
  disconnect(): Promise<void>;
  /** A "Disconnetti" the server has not confirmed yet: the cookie may still hold the login. */
  disconnectPending(): boolean;
  /**
   * Sends a pending disconnect again (startup, back online); true when none is left. Never during a
   * link: the server's answer would clear the new login's cookie.
   */
  finishDisconnect(): Promise<boolean>;
}

/** An access token with the account it was issued for, once known (the server tells it). */
export type DriveToken = OAuthToken & { account?: string };
type StoredToken = DriveToken;

/** A failed answer of the site's login service (server/driveServer.ts), by its error code. */
function serverError(status: number, code: unknown): DriveError {
  const reason = typeof code === 'string' ? code : undefined;
  if (reason === 'server_not_configured' || reason === 'google_unreachable') {
    return new DriveError(status, oauthErrorMessage(reason), reason);
  }
  return new DriveError(status, `Il servizio di accesso a Google Drive non è disponibile al momento (${status}): riprova più tardi. Le sbobine restano in questo browser.`, reason);
}

function safely(action: () => void): void {
  try {
    action();
  } catch {
    // Storage blocked (private mode): the value stays for this page only.
  }
}

export function createDriveAuth(options: DriveAuthOptions): DriveAuth {
  const session = options.session === undefined ? globalThis.sessionStorage ?? null : options.session;
  const local = options.local === undefined ? globalThis.localStorage ?? null : options.local;
  const now = options.now ?? (() => Date.now());
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const openWindow = options.openWindow ?? (url => window.open(url, WINDOW_NAME, WINDOW_FEATURES));
  const openChannel = options.openChannel ?? (() => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(OAUTH_CHANNEL)));
  const windowEvents = options.windowEvents === undefined ? globalThis.window ?? null : options.windowEvents;
  const origin = options.origin ?? globalThis.location?.origin ?? '';
  let current: StoredToken | null = null;
  // The server said there is no login to renew: no more asking until a new link.
  let lost = false;
  // A link in progress: its server login may already be another account's, not yet bound.
  let linking = false;
  // Bumped by every change of login: an answer that arrives after one is dropped.
  let epoch = 0;
  let refreshing: Promise<string | null> | null = null;
  // Taken over by another tab: nothing renews or installs a token again on this page.
  let stopped = false;
  // Builds before the server login kept the token in sessionStorage: it goes.
  safely(() => session?.removeItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1));

  const valid = (margin: number) => (current && current.expiresAt - margin > now() ? current : null);

  // Also in memory when localStorage refuses it: the settings still name the connected account.
  let unsavedAccount: string | null = null;
  const account = () => {
    if (unsavedAccount) return unsavedAccount;
    try {
      return local?.getItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1) || null;
    } catch {
      return null;
    }
  };

  // A "Disconnetti" the server has not confirmed: its cookie may still hold the login for six months.
  // In memory too when localStorage refuses it, so this page at least retries.
  let pendingInMemory = false;
  const disconnectPending = () => {
    if (pendingInMemory) return true;
    try {
      return Boolean(local?.getItem(STORAGE_KEYS.WEB_DRIVE_DISCONNECT_PENDING_V1));
    } catch {
      return false;
    }
  };
  const setDisconnectPending = (pending: boolean) => {
    pendingInMemory = pending;
    try {
      if (pending) local?.setItem(STORAGE_KEYS.WEB_DRIVE_DISCONNECT_PENDING_V1, '1');
      else local?.removeItem(STORAGE_KEYS.WEB_DRIVE_DISCONNECT_PENDING_V1);
    } catch {
      // Storage blocked: the flag stays for this page only.
    }
  };
  let finishing: Promise<boolean> | null = null;
  const finishDisconnect = (): Promise<boolean> => {
    if (!disconnectPending()) return Promise.resolve(true);
    if (linking) return Promise.resolve(false);
    finishing ??= server('disconnect', DISCONNECT_TIMEOUT_MS).then(
      // 204 once the cookie is cleared (server/driveServer.ts); anything else leaves it there.
      response => response.ok,
      () => false,
    ).then(done => {
      if (done) setDisconnectPending(false);
      return done;
    }).finally(() => {
      finishing = null;
    });
    return finishing;
  };

  async function server(action: 'token' | 'disconnect', timeoutMs: number): Promise<Response> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      return await fetchImpl(`${origin}${SERVER_PATH}/${action}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** The server's token for this browser's login; null when it has none (401). */
  async function requestToken(): Promise<StoredToken | null> {
    let response: Response;
    try {
      response = await server('token', SERVER_TIMEOUT_MS);
    } catch {
      throw new DriveError(0, 'Google Drive non raggiungibile.');
    }
    if (response.status === 401) return null;
    const body = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown; email?: unknown; error?: unknown } | null;
    // The server answered: its real status, never 0, which reads as "offline" (describeDriveError).
    // A misconfigured deploy (503 server_not_configured, 502 google_error) must not look like a lost
    // connection. Not 401 either: only a missing login asks for "Riconnetti".
    if (!response.ok) throw serverError(response.status, body?.error);
    const expiresIn = Number(body?.expires_in);
    if (typeof body?.access_token !== 'string' || !body.access_token || !(expiresIn > 0)) {
      throw new DriveError(response.status, 'Il servizio di accesso a Google Drive ha dato una risposta incompleta: riprova tra poco.');
    }
    return {
      accessToken: body.access_token,
      expiresAt: now() + expiresIn * 1000,
      scopes: [DRIVE_APPDATA_SCOPE],
      account: typeof body.email === 'string' && body.email ? body.email : undefined,
    };
  }

  /** The answer the return page posts for this login's state (channel, or window.opener). */
  function waitForAnswer(state: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const channel = openChannel();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (timer) clearTimeout(timer);
        channel?.removeEventListener('message', onChannel);
        channel?.close();
        windowEvents?.removeEventListener('message', onWindow);
      };
      const onAnswer = (data: unknown) => {
        if (!isOAuthReturnMessage(data) || fragmentState(data.fragment) !== state) return;
        finish();
        resolve(data.fragment);
      };
      const onChannel = (event: MessageEvent) => onAnswer(event.data);
      const onWindow = (event: MessageEvent) => {
        if (event.origin === origin) onAnswer(event.data);
      };
      channel?.addEventListener('message', onChannel);
      windowEvents?.addEventListener('message', onWindow);
      timer = setTimeout(() => {
        finish();
        reject(new DriveAuthError('timeout'));
      }, options.timeoutMs ?? ANSWER_TIMEOUT_MS);
    });
  }

  return {
    token: () => (stopped ? null : valid(EXPIRY_MARGIN_MS)?.accessToken ?? null),

    freshToken() {
      if (stopped) return Promise.resolve(null);
      const usable = valid(REFRESH_MARGIN_MS);
      if (usable) return Promise.resolve(usable.accessToken);
      const fallback = valid(EXPIRY_MARGIN_MS)?.accessToken ?? null;
      // A pending "Disconnetti": the cookie's login is the one the user asked to leave.
      if (lost || linking || !account() || disconnectPending()) return Promise.resolve(fallback);
      if (!refreshing) {
        const asked = epoch;
        refreshing = requestToken().then(
          token => {
            if (asked !== epoch) return null;
            // No login, or the cookie now holds another account than the one this browser remembers
            // (a link whose binding failed, another account linked meanwhile): a mid-round renewal
            // must not hand that account's Drive to a round confirmed for this one.
            if (!token || token.account !== account()) {
              current = null;
              lost = true;
              return null;
            }
            current = token;
            return token.accessToken;
          },
          (error: unknown) => {
            // Offline or the service failing for a moment: the token in hand serves while it lasts.
            if (asked === epoch && valid(EXPIRY_MARGIN_MS)) return valid(EXPIRY_MARGIN_MS)!.accessToken;
            throw error;
          },
        ).finally(() => {
          refreshing = null;
        });
      }
      return refreshing;
    },

    account,
    setAccount(email) {
      if (!email) return;
      unsavedAccount = null;
      try {
        local?.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, email);
      } catch {
        unsavedAccount = email;
      }
      if (current) current = { ...current, account: email };
    },
    tokenAccount: () => valid(EXPIRY_MARGIN_MS)?.account ?? null,
    needsReconnect: () => lost,

    connect() {
      const state = newState();
      const params = new URLSearchParams({ state });
      const hint = account();
      if (hint) params.set('login_hint', hint);
      // Before any await: the window must open inside the tap.
      const popup = openWindow(`${origin}${SERVER_PATH}/start?${params.toString()}`);
      if (!popup) return Promise.reject(new DriveAuthError('popup_blocked'));
      epoch += 1;
      linking = true;
      const asked = epoch;
      return waitForAnswer(state).then(async fragment => {
        const result = parseServerReturn(fragment, state);
        if (result.kind === 'error') throw new DriveAuthError(result.error, result.description);
        if (result.kind !== 'ok') throw new DriveAuthError('invalid_response');
        // A retry sent before the tap: its answer clears the cookie, so the new one must come after.
        if (finishing) await finishing;
        const token = await requestToken();
        // Linked, yet no login comes back: the browser did not keep the cookie.
        if (!token) throw new DriveAuthError('cookie_blocked');
        // The new login replaced the cookie: nothing of the old one is left to clear.
        setDisconnectPending(false);
        return token;
      }).catch((error: unknown) => {
        if (asked === epoch) linking = false;
        throw error;
      });
    },

    connectExport() {
      const state = newState();
      const hint = account();
      const url = buildAuthUrl({
        clientId: options.clientId,
        redirectUri: options.redirectUri,
        state,
        scope: DRIVE_FILE_SCOPE,
        // A new permission for the remembered account: Google asks only for that.
        prompt: hint ? undefined : 'select_account',
        loginHint: hint ?? undefined,
      });
      // Before any await: the window must open inside the tap.
      const popup = openWindow(url);
      if (!popup) return Promise.reject(new DriveAuthError('popup_blocked'));
      return waitForAnswer(state).then(fragment => {
        const result = parseOAuthFragment(fragment, state, now(), DRIVE_FILE_SCOPE);
        if (result.kind === 'token') return result.token;
        if (result.kind === 'error') throw new DriveAuthError(result.error, result.description);
        throw new DriveAuthError('invalid_response');
      });
    },

    adopt(token) {
      if (stopped) return;
      epoch += 1;
      current = { ...token, account: undefined };
      lost = false;
      linking = false;
    },

    expire(needsReconnect = false) {
      epoch += 1;
      current = null;
      linking = false;
      if (needsReconnect) lost = true;
    },

    stop() {
      stopped = true;
      epoch += 1;
      current = null;
      linking = false;
    },

    async disconnect() {
      epoch += 1;
      current = null;
      lost = false;
      linking = false;
      unsavedAccount = null;
      safely(() => local?.removeItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1));
      // Pending until the server confirms: offline, timed out or refused, the cookie keeps the login
      // for up to six months, so the disconnect is sent again at the next start or when back online
      // (driveService.ts), and no token is taken from the cookie meanwhile. A new link replaces it.
      setDisconnectPending(true);
      await finishDisconnect();
    },

    disconnectPending,
    finishDisconnect,
  };
}
