import { showNoticePage } from './noticePage';

// The browser blocks this site's data (cookies and site data refused in its settings): every use of
// localStorage throws, IndexedDB with it, and the app would stop at its first read with a blank
// page. Nothing could be kept here anyway: a page says so and how to allow it.

/** Whether the browser refuses this site's storage. */
export function siteDataBlocked(target: Pick<Window, 'localStorage'> = window): boolean {
  try {
    return !target.localStorage;
  } catch {
    return true;
  }
}

export function showSiteDataBlockedPage(reload: () => void = () => window.location.reload(), target: Document = document): void {
  showNoticePage({
    title: 'Il browser blocca i dati di questo sito',
    text: 'El Sbobinator conserva sbobine e impostazioni in questo browser, ma il browser non lo permette a questo sito. Consenti cookie e dati dei siti per questo indirizzo nelle impostazioni del browser, poi ricarica la pagina.',
    button: 'Ricarica',
    onClick: reload,
  }, target);
}
