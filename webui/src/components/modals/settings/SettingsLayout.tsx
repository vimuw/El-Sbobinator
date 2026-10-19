import type { ReactNode } from 'react';

// Shared building blocks of the settings pages, so every tab speaks one visual language
// and a restyle happens here instead of in each section.

export function SettingsPageHeader({ title, description }: { title: string; description: ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">{title}</h2>
      <p className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</p>
    </div>
  );
}

interface SettingsSectionHeadingProps {
  children: ReactNode;
  id?: string;
  // Sits right after the title, e.g. a count chip.
  adornment?: ReactNode;
}

// A plain sentence-case title, like the dashboard's: no icon, no shouted caps.
export function SettingsSectionHeading({ children, id, adornment }: SettingsSectionHeadingProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <h3 id={id} className="text-sm font-semibold text-[var(--text-primary)] truncate">
        {children}
      </h3>
      {adornment}
    </div>
  );
}

export function SettingsDivider() {
  return <div className="border-t border-[var(--border-default)]" />;
}

export type StatusBadgeTone = 'accent' | 'neutral' | 'warning' | 'error';

const BADGE_TONE: Record<StatusBadgeTone, string> = {
  accent: 'bg-[var(--accent-subtle)] text-[var(--accent-text)] border-[var(--accent-ring)]',
  neutral: 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-default)]',
  warning: 'bg-[var(--warning-subtle,var(--bg-surface))] text-[var(--warning-text)] border-[var(--warning-ring)]',
  error: 'bg-[var(--error-subtle,var(--bg-surface))] text-[var(--error-text)] border-[var(--error-ring)]',
};

interface StatusBadgeProps {
  tone: StatusBadgeTone;
  children: ReactNode;
  title?: string;
  // A secondary note next to a main badge: smaller and lighter.
  minor?: boolean;
}

export function StatusBadge({ tone, children, title, minor = false }: StatusBadgeProps) {
  const size = minor
    ? 'text-[10px] font-medium px-2'
    : 'text-[11px] font-semibold px-2.5';
  return (
    <span
      className={`${size} py-0.5 rounded-full border inline-flex items-center justify-center gap-1 leading-normal shrink-0 ${BADGE_TONE[tone]}`}
      title={title}
    >
      {children}
    </span>
  );
}
