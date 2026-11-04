import { STORAGE_KEYS } from '../../storageKeys';
import {
  DRIVE_APPDATA_SCOPE,
  OAUTH_CHANNEL,
  buildAuthUrl,
  fragmentState,
  isOAuthReturnMessage,
  needsInteractiveLogin,
  newState,
  oauthErrorMessage,
  parseOAuthFragment,
  type OAuthToken,
} from './oauth';

// The Drive login of this tab. The access token lives in sessionStorage (never localStorage): it
// survives Safari reloading a discarded page within its hour, and goes with the tab. Only the
// account's email stays in localStorage, so a later tap re-authorizes it without questions
// (login_hint + prompt=none). The Google window opens from a tap: browsers block it otherwise.

const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const WINDOW_NAME = 'el-sbobinator-google';
const WINDOW_FEATURES = 'popup,width=500,height=650';
// A token this close to expiry is treated as gone: a sync round must not die halfway.
const EXPIRY_MARGIN_MS = 60_000;
const ANSWER_TIMEOUT_MS = 180_000;
const REVOKE_TIMEOUT_MS = 10_000;

export class DriveAuthError extends Error {
  constructor(readonly code: string, description?: string) {
    super(oauthErrorMessage(code, description));
    this.name = 'DriveAuthError';
  }

  /** The silent attempt was not enough: the user must log in with the full Google page. */
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
  redirectUri: string;
  /** Origin the return page posts from (window.postMessage fallback). */
  origin?: string;
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
  /** A valid access token, or null when the user must (re)connect. */
  token(): string | null;
  /** Email of the connected account, remembered across reloads (not a secret). */
  account(): string | null;
  /** Remembers the account, which this tab's token belongs to as well. */
  setAccount(email: string): void;
  /**
   * The account this tab's token was issued for, null when unknown. A tab restored with its
   * sessionStorage (reopened, duplicated, back) may hold the token of an account this browser has
   * left since: the sync checks it against the account the database is bound to.
   */
  tokenAccount(): string | null;
  /**
   * Opens the Google window: call it synchronously inside a tap. Silent = the remembered account
   * without questions (prompt=none); it fails with needsInteractiveLogin when Google wants a choice.
   * scope asks for another permission, and the token carries only that one; keep: false leaves the
   * tab's token as it was (the export's token serves the export only; the sync's waits for adopt).
   */
  connect(options?: { silent?: boolean; scope?: string; keep?: boolean }): Promise<OAuthToken>;
  /** Keeps a token connect() returned with keep: false as this tab's. */
  adopt(token: OAuthToken): void;
  /** Drive answered 401: the token is gone, the account stays for a silent reconnect. */
  expire(): void;
  /** "Disconnetti": revokes the token at Google and forgets token and account. */
  disconnect(): Promise<void>;
}

/** The token kept by the tab, with the account it was issued for once known. */
type StoredToken = OAuthToken & { account?: string };

function readToken(storage: Storage | null, now: number): StoredToken | null {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1) ?? 'null') as StoredToken | null;
    if (!value || typeof value.accessToken !== 'string' || typeof value.expiresAt !== 'number') return null;
    return value.expiresAt - EXPIRY_MARGIN_MS > now ? value : null;
  } catch {
    return null;
  }
}

function safely(action: () => void): void {
  try {
    action();
  } catch {
    // Storage blocked (private mode): the token stays for this page only.
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
  // Also in memory: sessionStorage may be blocked, and a write must not be lost then.
  let current: StoredToken | null = null;

  const storedToken = () => {
    if (current && current.expiresAt - EXPIRY_MARGIN_MS > now()) return current;
    current = readToken(session, now());
    return current;
  };
  const adopt = (token: StoredToken) => {
    current = token;
    safely(() => session?.setItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1, JSON.stringify(token)));
  };
  const clearToken = () => {
    current = null;
    safely(() => session?.removeItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1));
  };
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

  return {
    token: () => storedToken()?.accessToken ?? null,
    account,
    setAccount(email) {
      if (!email) return;
      unsavedAccount = null;
      try {
        local?.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, email);
      } catch {
        unsavedAccount = email;
      }
      const token = storedToken();
      if (token) adopt({ ...token, account: email });
    },
    tokenAccount: () => storedToken()?.account ?? null,

    connect({ silent = false, scope, keep = true } = {}) {
      const state = newState();
      const hint = account();
      const requiredScope = scope ?? DRIVE_APPDATA_SCOPE;
      const url = buildAuthUrl({
        clientId: options.clientId,
        redirectUri: options.redirectUri,
        state,
        scope: requiredScope,
        // A new permission for the remembered account: Google asks only for that.
        prompt: silent && hint ? 'none' : scope && hint ? undefined : 'select_account',
        loginHint: hint ?? undefined,
      });
      // Before any await: the window must open inside the tap.
      const popup = openWindow(url);
      if (!popup) return Promise.reject(new DriveAuthError('popup_blocked'));
      return new Promise<OAuthToken>((resolve, reject) => {
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
          const result = parseOAuthFragment(data.fragment, state, now(), requiredScope);
          if (result.kind === 'token') {
            if (keep) adopt(result.token);
            resolve(result.token);
          } else if (result.kind === 'error') {
            reject(new DriveAuthError(result.error, result.description));
          }
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
    },

    adopt: token => adopt({ ...token, account: undefined }),

    expire: clearToken,

    async disconnect() {
      const token = storedToken()?.accessToken ?? readTokenIgnoringExpiry(session);
      clearToken();
      unsavedAccount = null;
      safely(() => local?.removeItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1));
      if (!token) return;
      // Best effort: an expired token is already useless, and the user is offline sometimes. A revoke
      // left hanging must not hold the disconnect (nor the erase, which runs in the sync's queue).
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), REVOKE_TIMEOUT_MS);
      await fetchImpl(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        signal: abort.signal,
      }).catch(() => undefined).finally(() => clearTimeout(timer));
    },
  };
}

function readTokenIgnoringExpiry(storage: Storage | null): string | null {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1) ?? 'null') as OAuthToken | null;
    return typeof value?.accessToken === 'string' ? value.accessToken : null;
  } catch {
    return null;
  }
}
