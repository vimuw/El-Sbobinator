import type { ReactNode } from 'react';
import { ChevronDown, CircleHelp, Trash2, type LucideIcon } from 'lucide-react';

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
  icon: LucideIcon;
  children: ReactNode;
  id?: string;
  // Sits right after the title, e.g. a count chip.
  adornment?: ReactNode;
}

// A section title as on the desktop settings: an accent icon and small tracked caps, so it reads
// as a title and not as one more line of text.
export function SettingsSectionHeading({ icon: Icon, children, id, adornment }: SettingsSectionHeadingProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="w-4 h-4 text-[var(--accent-text)] shrink-0" aria-hidden="true" />
      <h3 id={id} className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] truncate">
        {children}
      </h3>
      {adornment}
    </div>
  );
}

// The small caption of a stat card or a collapsible row: sentence case, like the section
// titles, one step quieter.
export function SettingsCardLabel({ children, block = false }: { children: ReactNode; block?: boolean }) {
  return (
    <span className={`text-xs font-semibold text-[var(--text-secondary)]${block ? ' block' : ''}`}>
      {children}
    </span>
  );
}

export function SettingsDivider() {
  return <div className="border-t border-[var(--border-default)]" />;
}

interface SettingsPanelProps {
  icon: LucideIcon;
  title: string;
  /** One line: what this section is for. The long story goes in a SettingsMoreInfo. */
  description: ReactNode;
  badge?: ReactNode;
  /** A single control at the right of the description, for a section that is one action. */
  action?: ReactNode;
  testId?: string;
  children?: ReactNode;
}

// One section per job on a settings page, drawn like the desktop ones: a plain title, one line of
// why, then the controls. Consecutive sections are split by the same rule as SettingsDivider.
export function SettingsPanel({ icon, title, description, badge, action, testId, children }: SettingsPanelProps) {
  return (
    <section data-testid={testId} aria-label={title} className="settings-panel space-y-4">
      {/* Every settings title sits 8px (space-y-2) above its first line of text. */}
      <div className="space-y-2 min-w-0">
        {/* The status pill follows the title it qualifies, not the far edge of the card, and its
            negative margin keeps the row as tall as a bare title so the gap stays the same. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <SettingsSectionHeading icon={icon}>{title}</SettingsSectionHeading>
          {badge && <span className="inline-flex -my-1">{badge}</span>}
        </div>
        {action ? (
          // The action's negative margin keeps a one-line description as close to the title as elsewhere.
          <div className="flex items-center justify-between gap-3 [&>:last-child]:-my-2.5">
            <p className="text-xs text-[var(--text-secondary)] min-w-0">{description}</p>
            {action}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-secondary)]">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

interface SettingsRowProps {
  title: ReactNode;
  description?: ReactNode;
  descriptionId?: string;
  /** The control on the right: a switch, a button. */
  children?: ReactNode;
}

// A labelled row with its control on the right, like "Elaborazioni incomplete" on the desktop.
export function SettingsRow({ title, description, descriptionId, children }: SettingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors -mx-2">
      <div className="space-y-0.5 min-w-0">
        <span className="text-sm font-bold text-[var(--text-primary)] block">{title}</span>
        {description && <p id={descriptionId} className="text-xs text-[var(--text-secondary)]">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// The longer explanations, folded so a page reads at a glance.
export function SettingsMoreInfo({ children, label = 'Più informazioni' }: { children: ReactNode; label?: string }) {
  return (
    <details className="settings-more-info">
      <summary className="text-xs font-medium">
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{label}</span>
      </summary>
      <div className="settings-more-info-content space-y-1.5 text-xs text-[var(--text-secondary)]">{children}</div>
    </details>
  );
}

interface SettingsCalloutProps {
  /** Left out when the section title above already shows the same icon. */
  icon?: LucideIcon;
  tone: 'warning' | 'accent' | 'danger' | 'neutral';
  title: ReactNode;
  children?: ReactNode;
  /** The button that answers the text: on its right, or under it when the card is narrow. */
  action?: ReactNode;
  /** Full-width detail under text and action (e.g. a SettingsMoreInfo). */
  footer?: ReactNode;
  testId?: string;
  role?: string;
  /** Accessible name, for a callout that is a group (InlineConfirm). */
  label?: string;
}

// A suggestion inside a section (link Drive, mind the browser's cleanup): a quiet card with a
// tinted icon and the title and text in the usual colours, so it stands out without shouting like
// a full-colour alert. The action sits on the text's right so the card has no empty half.
export function SettingsCallout({ icon: Icon, tone, title, children, action, footer, testId, role, label }: SettingsCalloutProps) {
  return (
    <div data-testid={testId} role={role} aria-label={label} className={`settings-callout is-${tone}${Icon ? '' : ' is-plain'}`}>
      {Icon && <span className="settings-callout-icon" aria-hidden="true"><Icon className="w-4 h-4" /></span>}
      <div className="settings-callout-body">
        <div className="settings-callout-main">
          <div className="settings-callout-text">
            <p className="settings-callout-title">{title}</p>
            {children}
          </div>
          {action && <div className="settings-callout-action">{action}</div>}
        </div>
        {footer}
      </div>
    </div>
  );
}

interface InlineConfirmProps {
  /** Accessible name of the group, e.g. the action being confirmed. */
  label: string;
  title: string;
  /** The explanation under the question; left out when the question says it all. */
  children?: ReactNode;
  actions: ReactNode;
  tone?: 'danger';
  /** Defaults to a bin for a danger, a question mark otherwise. */
  icon?: LucideIcon;
}

// The confirmation that opens in place of a button, compact like a system dialog's bar: the
// question (and at most one sentence) on the left, "Annulla" then the action on the right, on the
// same row while it fits. Callers pass the actions in that order, as short text-only buttons.
// The same card as the other notices, the question as its title; the buttons close it at the
// bottom right, as in a dialog, with the one that cannot be undone last.
export function InlineConfirm({ label, title, children, actions, tone, icon }: InlineConfirmProps) {
  return (
    <SettingsCallout
      role="group"
      label={label}
      tone={tone === 'danger' ? 'danger' : 'neutral'}
      icon={icon ?? (tone === 'danger' ? Trash2 : CircleHelp)}
      title={title}
      footer={<div className="settings-confirm-actions">{actions}</div>}
    >
      {children && <div className="space-y-1">{children}</div>}
    </SettingsCallout>
  );
}

export type StatusBadgeTone = 'accent' | 'neutral' | 'success' | 'warning' | 'error';

const BADGE_TONE: Record<StatusBadgeTone, string> = {
  accent: 'bg-[var(--accent-subtle)] text-[var(--accent-text)] border-[var(--accent-ring)]',
  success: 'bg-[var(--success-subtle,var(--bg-surface))] text-[var(--success-text)] border-[var(--success-ring,var(--border-default))]',
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
