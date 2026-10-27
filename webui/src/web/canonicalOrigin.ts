import { CANONICAL_WEB_URL, setMovedAddressNotice } from '../movedAddress';
import { STORAGE_KEYS } from '../storageKeys';
import { CHECKPOINTS, DOCUMENTS, FOLDERS, MEDIA, SESSIONS, inTransaction, requestValue } from './webDatabase';

// The site used to answer on these addresses too. A server redirect would hide the sbobine kept
// there (each address has its own IndexedDB and localStorage), so the page decides: an empty
// browser moves to the official address, one with sbobine stays and asks for a backup. Branch
// previews (<branch>.elsbobinator.pages.dev), localhost and any other host are left alone.
const OLD_HOSTS = new Set(['www.elsbobinator.com', 'elsbobinator.pages.dev']);

/** What this browser keeps on this address: unknown when the archive cannot be read. */
export type ArchiveState = 'empty' | 'has-data' | 'unknown';
export type CanonicalOriginAction = 'redirect' | 'notice' | 'none';

export function isOldWebHost(hostname: string): boolean {
  return OLD_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ''));
}

/**
 * Redirect only when nothing would be left behind. An unreadable archive (blocked by another tab,
 * private browsing) neither moves nor warns: the notice would claim sbobine that may not exist.
 */
export function decideCanonicalOrigin(hostname: string, archive: ArchiveState): CanonicalOriginAction {
  if (!isOldWebHost(hostname)) return 'none';
  if (archive === 'empty') return 'redirect';
  return archive === 'has-data' ? 'notice' : 'none';
}

/** Same page on the official address. */
export function canonicalUrl(location: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  return `${CANONICAL_WEB_URL}${location.pathname}${location.search}${location.hash}`;
}

function queueHasItems(storage: Pick<Storage, 'getItem'>): boolean {
  const raw = storage.getItem(STORAGE_KEYS.QUEUE_V1);
  if (!raw) return false;
  try {
    const queue = JSON.parse(raw) as unknown;
    return !Array.isArray(queue) || queue.length > 0;
  } catch {
    // Unreadable but present: keep it, as if it held something.
    return true;
  }
}

/** Sbobine, raccolte, audio, progress of runs or a saved queue: anything a redirect would hide. */
export async function readArchiveState(
  factory: IDBFactory | undefined,
  storage: Pick<Storage, 'getItem'> | undefined,
): Promise<ArchiveState> {
  try {
    if (storage && queueHasItems(storage)) return 'has-data';
    const stores = [SESSIONS, DOCUMENTS, FOLDERS, MEDIA, CHECKPOINTS];
    const counts = await inTransaction(factory, stores, 'readonly', transaction =>
      Promise.all(stores.map(store => requestValue(transaction.objectStore(store).count()))));
    return counts.some(count => count > 0) ? 'has-data' : 'empty';
  } catch {
    return 'unknown';
  }
}

/**
 * Runs before the app mounts. Returns true when the page is leaving for the official address, so
 * the caller does not mount the app; on the official address it reads nothing.
 */
export async function applyCanonicalOrigin(
  location: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash' | 'replace'> = window.location,
  factory: IDBFactory | undefined = globalThis.indexedDB,
  storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage(),
): Promise<boolean> {
  if (!isOldWebHost(location.hostname)) return false;
  const action = decideCanonicalOrigin(location.hostname, await readArchiveState(factory, storage));
  if (action === 'redirect') {
    location.replace(canonicalUrl(location));
    return true;
  }
  setMovedAddressNotice(action === 'notice');
  return false;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
