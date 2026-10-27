import { describe, expect, it } from 'vitest';
import {
  DRIVE_APPDATA_SCOPE,
  buildAuthUrl,
  isOAuthFragment,
  isOAuthReturnMessage,
  needsInteractiveLogin,
  newState,
  oauthErrorMessage,
  parseOAuthFragment,
  redirectUriFor,
} from './oauth';

const answer = (fields: Record<string, string>) => `#${new URLSearchParams(fields).toString()}`;

describe('Drive OAuth', () => {
  it('asks Google for the hidden app folder only, with the remembered account as hint', () => {
    const url = new URL(buildAuthUrl({ clientId: '1-abc.apps.googleusercontent.com', redirectUri: 'https://elsbobinator.com/drive-auth', state: 's1', prompt: 'none', loginHint: 'a@b.it' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1-abc.apps.googleusercontent.com',
      redirect_uri: 'https://elsbobinator.com/drive-auth',
      response_type: 'token',
      scope: DRIVE_APPDATA_SCOPE,
      state: 's1',
      include_granted_scopes: 'true',
      prompt: 'none',
      login_hint: 'a@b.it',
    });
  });

  it('builds the return address and a random state', () => {
    expect(redirectUriFor('https://anteprima.elsbobinator.pages.dev')).toBe('https://anteprima.elsbobinator.pages.dev/drive-auth');
    expect(newState(bytes => bytes.fill(171))).toBe('ab'.repeat(16));
  });

  it('accepts only the answer to its own state, with a bearer token and the scope', () => {
    const good = answer({ access_token: 'tok', token_type: 'Bearer', expires_in: '3599', scope: DRIVE_APPDATA_SCOPE, state: 's1' });
    expect(isOAuthFragment(good)).toBe(true);
    expect(parseOAuthFragment(good, 's1', 1000)).toEqual({ kind: 'token', token: { accessToken: 'tok', expiresAt: 1000 + 3599_000, scopes: [DRIVE_APPDATA_SCOPE] } });
    expect(parseOAuthFragment(good, 'other', 1000)).toMatchObject({ kind: 'error', error: 'state_mismatch' });
    expect(parseOAuthFragment(good, null, 1000)).toMatchObject({ kind: 'error', error: 'state_mismatch' });
    expect(parseOAuthFragment('#foo=1', 's1', 1000)).toEqual({ kind: 'none' });
    expect(parseOAuthFragment(answer({ access_token: 'tok', token_type: 'Bearer', expires_in: '3599', scope: 'email', state: 's1' }), 's1', 0))
      .toMatchObject({ kind: 'error', error: 'scope_missing' });
    expect(parseOAuthFragment(answer({ access_token: 'tok', token_type: 'mac', expires_in: '3599', state: 's1' }), 's1', 0))
      .toMatchObject({ kind: 'error', error: 'invalid_response' });
    expect(parseOAuthFragment(answer({ error: 'admin_policy_enforced', state: 's1' }), 's1', 0))
      .toEqual({ kind: 'error', error: 'admin_policy_enforced', description: undefined });
  });

  it('explains blocked accounts and silent failures in Italian', () => {
    expect(oauthErrorMessage('admin_policy_enforced')).toContain('ateneo');
    expect(oauthErrorMessage('access_denied')).toContain('utenti di prova');
    expect(oauthErrorMessage('popup_blocked')).toContain('pop-up');
    expect(oauthErrorMessage('strano', 'dettaglio')).toBe('Accesso a Google non riuscito: dettaglio');
    expect(oauthErrorMessage('strano')).toBe('Accesso a Google non riuscito (strano).');
    expect(needsInteractiveLogin('interaction_required')).toBe(true);
    expect(needsInteractiveLogin('access_denied')).toBe(false);
  });

  it('recognizes the return page message', () => {
    expect(isOAuthReturnMessage({ type: 'el-sbobinator-oauth', fragment: '#a' })).toBe(true);
    expect(isOAuthReturnMessage({ type: 'other', fragment: '#a' })).toBe(false);
    expect(isOAuthReturnMessage(null)).toBe(false);
  });
});
