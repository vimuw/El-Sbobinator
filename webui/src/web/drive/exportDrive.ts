import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import type { WebArchive } from '../webSessions';
import type { DriveApi } from './driveApi';

// "Esporta tutte le sbobine nel mio Drive": a one-way copy in a visible folder of My Drive, one
// readable HTML file per sbobina, subfolders for the raccolte. It needs the drive.file scope (only
// files this app creates) and the app never reads that folder back: the sync stays in the hidden one.

const EXPORT_STYLE = '<meta name="viewport" content="width=device-width, initial-scale=1"><style>'
  + 'body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f2328}'
  + 'h1,h2,h3{line-height:1.25}table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:.3rem .5rem}'
  + '</style>';

export function exportFolderName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `El Sbobinator – esportazione ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The sbobina's full document (readHtml) with a plain style, readable when opened from Drive. */
export function exportDocument(html: string): string {
  return html.includes('</head>') ? html.replace('</head>', `${EXPORT_STYLE}</head>`) : html;
}

function safeName(name: string): string {
  const printable = Array.from(name, char => (char.charCodeAt(0) < 32 ? ' ' : char)).join('');
  return printable.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sbobina';
}

/** Names already used in one Drive folder: a second "Lezione 1" becomes "Lezione 1 (2)". */
function uniqueNames() {
  const used = new Map<string, Set<string>>();
  return (parent: string, base: string, extension = '') => {
    const names = used.get(parent) ?? new Set<string>();
    used.set(parent, names);
    let candidate = `${base}${extension}`;
    for (let index = 2; names.has(candidate.toLowerCase()); index += 1) candidate = `${base} (${index})${extension}`;
    names.add(candidate.toLowerCase());
    return candidate;
  };
}

export interface ExportProgress {
  done: number;
  total: number;
}

export interface ExportOutcome {
  exported: number;
  total: number;
  folderName: string;
  folderUrl?: string;
}

export class ExportError extends Error {
  constructor(readonly reason: unknown, readonly outcome: ExportOutcome) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = 'ExportError';
  }
}

/**
 * Writes the export. Failing halfway (quota, connection) throws ExportError with what was already
 * written: those files stay in Drive, a new export makes a new folder.
 */
export async function exportToDrive(options: {
  archive: WebArchive;
  api: DriveApi;
  now?: Date;
  onProgress?: (progress: ExportProgress) => void;
}): Promise<ExportOutcome> {
  const { archive, api } = options;
  const [sessions, folders] = await Promise.all([archive.list(), archive.loadFolders().catch(() => [] as ArchiveFolder[])]);
  const outcome: ExportOutcome = { exported: 0, total: sessions.length, folderName: exportFolderName(options.now ?? new Date()) };
  try {
    const root = await api.createFolder(outcome.folderName);
    outcome.folderUrl = root.webViewLink;
    const name = uniqueNames();
    // Raccolte as subfolders, parents first; one with an unknown parent goes at the top.
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    const driveIds = new Map<string, string>();
    const folderId = async (folder: ArchiveFolder, path: Set<string> = new Set()): Promise<string> => {
      const known = driveIds.get(folder.id);
      if (known) return known;
      const parent = folder.parent_id ? byId.get(folder.parent_id) : undefined;
      // A loop in the tree (never made by the app) ends at the top.
      const parentId = parent && !path.has(parent.id) ? await folderId(parent, new Set([...path, folder.id])) : root.id;
      const created = await api.createFolder(name(parentId, safeName(folder.name || 'Raccolta')), parentId);
      driveIds.set(folder.id, created.id);
      return created.id;
    };
    for (const folder of folders) await folderId(folder);
    const owner = new Map<string, ArchiveFolder>();
    for (const folder of folders) for (const dir of folder.session_dirs ?? []) if (!owner.has(dir)) owner.set(dir, folder);

    options.onProgress?.({ done: 0, total: sessions.length });
    for (const [index, session] of (sessions as ArchiveSession[]).entries()) {
      const html = await archive.readHtml(session.html_path);
      if (html !== null) {
        const folder = owner.get(session.session_dir);
        const parentId = folder ? driveIds.get(folder.id) ?? root.id : root.id;
        await api.createFile(name(parentId, safeName(session.name), '.html'), 'text/html', exportDocument(html), parentId);
        outcome.exported += 1;
      }
      options.onProgress?.({ done: index + 1, total: sessions.length });
    }
    return outcome;
  } catch (error) {
    throw new ExportError(error, outcome);
  }
}
