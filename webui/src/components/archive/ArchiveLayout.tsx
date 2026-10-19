import type { ReactNode } from 'react';

// Shared building blocks of the archive pages, so the archive root and a folder speak one
// visual language and a restyle happens here instead of in each view.

interface ArchivePageTitleProps {
  children: ReactNode;
  count: number;
  // Layout of the title row inside its parent, e.g. its grid placement.
  className?: string;
}

// The page title with its item count; long folder names wrap instead of overflowing.
export function ArchivePageTitle({ children, count, className = '' }: ArchivePageTitleProps) {
  return (
    <div className={`flex flex-wrap items-center gap-3 min-w-0 ${className}`}>
      <h1 className="min-w-0 max-w-full [overflow-wrap:anywhere] text-[1.75rem] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
        {children}
      </h1>
      <span className="status-pill shrink-0">{count}</span>
    </div>
  );
}

export function ArchiveSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h3>
  );
}
