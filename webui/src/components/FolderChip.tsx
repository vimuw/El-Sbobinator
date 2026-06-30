import type { ArchiveFolder } from '../bridge';

// Tiny shared chip — kept separate so QueueFileCard can import it
// without creating a QueueFileCard → ArchivePage circular dependency.
export function FolderIndicatorChip({ folder }: { folder: Pick<ArchiveFolder, 'name' | 'color'> }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
      style={{ background: `${folder.color}22`, color: folder.color, border: `1px solid ${folder.color}55` }}
      title={`Raccolta: ${folder.name}`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: folder.color }} />
      {folder.name}
    </span>
  );
}
