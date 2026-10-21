import type { FileDescriptor } from '../appState';

// The web build never uploads audio: picked files stay in this page and the queue refers to them
// through a synthetic path. After a reload the path no longer resolves and the queue asks for the
// file again (check_path_exists → ask_media_file).
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
