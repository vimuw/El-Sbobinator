import type { FileItem } from './appState';

// The browser's copy of a file that left the queue, or never joined it, goes at once instead of
// lingering as "Audio in coda".
export function releaseQueueFiles(files: Array<Pick<FileItem, 'path'>>): void {
  const release = window.pywebview?.api?.release_queue_file;
  if (!release) return;
  for (const file of files) {
    if (file.path) void release(file.path)?.catch(() => {});
  }
}
