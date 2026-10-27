import { OAUTH_CHANNEL, isOAuthFragment, type OAuthReturnMessage } from './oauth';

// Script of drive-auth.html. Google sends the login answer here in the fragment; the window hands
// it to the app tab that opened it and closes. The app checks the state: this page trusts nothing.

function deliver(fragment: string): boolean {
  const message: OAuthReturnMessage = { type: 'el-sbobinator-oauth', fragment };
  let sent = false;
  // accounts.google.com can cut window.opener (Cross-Origin-Opener-Policy): the channel still
  // reaches the app as long as both pages share this origin.
  try {
    const channel = new BroadcastChannel(OAUTH_CHANNEL);
    channel.postMessage(message);
    channel.close();
    sent = true;
  } catch {
    // Old Safari without BroadcastChannel.
  }
  try {
    if (window.opener) {
      (window.opener as Window).postMessage(message, location.origin);
      sent = true;
    }
  } catch {
    // Opener gone or cross-origin.
  }
  return sent;
}

export function handleAuthReturn(): void {
  const fragment = location.hash;
  const text = document.getElementById('drive-auth-message');
  // The token must not stay in the address bar or the history.
  history.replaceState(null, '', location.pathname);
  if (!isOAuthFragment(fragment)) {
    if (text) text.textContent = 'Questa pagina serve solo all’accesso a Google Drive da El Sbobinator.';
    return;
  }
  const sent = deliver(fragment);
  if (text) {
    text.textContent = sent
      ? 'Fatto: puoi chiudere questa finestra e tornare a El Sbobinator.'
      : 'Non riesco a raggiungere la scheda di El Sbobinator: chiudi questa finestra e riprova da lì.';
  }
  if (sent) setTimeout(() => window.close(), 300);
}

handleAuthReturn();
