import type { FileDescriptor } from '../appState';

// The web build never uploads audio: picked files stay in this browser and the queue refers to them
// through a synthetic path local://<id>/<name>. The page keeps the File in memory; the web host also
// copies it into IndexedDB (webMedia.ts) under the same id, so the path still resolves after a reload.
export const WEB_FILE_PREFIX = 'local://';
export const WEB_MEDIA_ACCEPT = '.mp3,.m4a,.mp4,audio/mpeg,audio/mp4,video/mp4';
const SUPPORTED_EXTENSIONS = ['.mp3', '.m4a', '.mp4'];

const files = new Map<string, File>();

export function isWebSupportedMedia(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function registerWebFile(file: File): FileDescriptor {
  const id = crypto.randomUUID();
  const path = `${WEB_FILE_PREFIX}${id}/${file.name}`;
  files.set(path, file);
  return { id, path, name: file.name, size: file.size };
}

/** The id inside a local:// path, or null for any other path. */
export function webFileId(path: string): string | null {
  if (!path.startsWith(WEB_FILE_PREFIX)) return null;
  const id = path.slice(WEB_FILE_PREFIX.length).split('/')[0];
  return id || null;
}

/** Puts a file found in IndexedDB back under its path, after a reload. */
export function restoreWebFile(path: string, file: File): void {
  files.set(path, file);
}

export function getWebFile(path: string): File | undefined {
  return files.get(path);
}

export function hasWebFile(path: string): boolean {
  return files.has(path);
}

export function promptWebFiles(multiple: boolean): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = WEB_MEDIA_ACCEPT;
    input.style.display = 'none';
    const finish = (picked: File[]) => {
      input.remove();
      resolve(picked);
    };
    input.onchange = () => finish(Array.from(input.files ?? []));
    input.oncancel = () => finish([]);
    document.body.appendChild(input);
    input.click();
  });
}

/** Forgets the files held by this page, as a reload does (tests). */
export function forgetWebFiles(): void {
  files.clear();
}
