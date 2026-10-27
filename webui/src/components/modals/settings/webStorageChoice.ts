import { STORAGE_KEYS } from '../../../storageKeys';

// "Dove tengo le sbobine?" (web previews with Drive sync): the answer of this browser. There is no
// "Drive only": the browser always keeps the working copy. Not a secret, so localStorage.

export type WebStorageChoice = 'browser' | 'drive';

export const LOCAL_ONLY_WARNING = 'Le sbobine stanno solo in questo browser, su questo dispositivo. Safari può cancellarle se non apri il sito per qualche settimana o se manca spazio: ogni tanto fai un backup.';

export function loadStorageChoice(): WebStorageChoice | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEYS.WEB_STORAGE_CHOICE_V1);
    return value === 'browser' || value === 'drive' ? value : null;
  } catch {
    return null;
  }
}

export function saveStorageChoice(choice: WebStorageChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.WEB_STORAGE_CHOICE_V1, choice);
  } catch {
    // Storage blocked: the question comes back on the next visit.
  }
}
