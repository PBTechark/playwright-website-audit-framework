import { ReactNode } from 'react';
import type { AuditStatus, AuditSummary, Severity } from '../lib/api';

const statusStyles: Record<AuditStatus, { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-accent-soft text-accent-ink' },
  completed: { label: 'Completed', className: 'bg-success-soft text-success' },
  failed: { label: 'Failed', className: 'bg-danger-soft text-danger' },
  cancelled: { label: 'Cancelled', className: 'bg-sunken text-ink-2 ring-1 ring-inset ring-line' },
  interrupted: { label: 'Interrupted', className: 'bg-warning-soft text-warning' }
};

export function StatusBadge({ status }: { status: AuditStatus }) {
  const style = statusStyles[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === 'running' ? 'animate-pulse' : ''}`} aria-hidden />
      {style.label}
    </span>
  );
}

export const SEVERITIES: Severity[] = ['Critical', 'High', 'Medium', 'Low'];

export const severityColor: Record<Severity, string> = {
  Critical: 'bg-severity-critical',
  High: 'bg-severity-high',
  Medium: 'bg-severity-medium',
  Low: 'bg-severity-low'
};

export const severityCountKey: Record<Severity, 'critical' | 'high' | 'medium' | 'low'> = {
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low'
};

const severityIcon: Record<Severity, string> = { Critical: '!!', High: '!', Medium: '•', Low: 'i' };

/** The coloured square used everywhere a severity appears; it carries an icon so colour is never the only cue. */
export function SeverityMark({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-0.5 text-[11px] font-bold leading-none ${severityColor[severity]} ${severity === 'Medium' ? 'text-[#2a1d00]' : 'text-white'}`}
      aria-hidden
    >
      {severityIcon[severity]}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
      <SeverityMark severity={severity} />
      {severity}
    </span>
  );
}

/**
 * The triage strip: one segmented bar showing how an audit's issues split across severities.
 * Segments are in fixed severity order with a 2px gap; the legend repeats every count as text.
 */
export function SeverityStrip({ summary, size = 'lg' }: { summary: Pick<AuditSummary, 'critical' | 'high' | 'medium' | 'low'>; size?: 'lg' | 'sm' }) {
  const counts = SEVERITIES.map((severity) => ({ severity, value: summary[severityCountKey[severity]] }));
  const total = counts.reduce((sum, item) => sum + item.value, 0);
  const label = total
    ? counts.map((item) => `${item.value} ${item.severity.toLowerCase()}`).join(', ')
    : 'No issues found';
  const bar = (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={`flex w-full gap-[2px] overflow-hidden rounded ${size === 'lg' ? 'h-3' : 'h-2'} ${total ? '' : 'bg-success/30'}`}
    >
      {counts
        .filter((item) => item.value > 0)
        .map((item) => (
          <span key={item.severity} className={severityColor[item.severity]} style={{ flexGrow: item.value, flexBasis: 0, minWidth: 4 }} />
        ))}
    </div>
  );
  if (size === 'sm') return bar;
  return (
    <div>
      {bar}
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {counts.map((item) => (
          <li key={item.severity} className={`flex items-center gap-2 text-sm ${item.value ? 'text-ink' : 'text-ink-3'}`}>
            <SeverityMark severity={item.severity} />
            <span>
              <span className="font-semibold tabular-nums">{item.value.toLocaleString()}</span> {item.severity.toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HealthScore({ score }: { score: number | null }) {
  return (
    <div>
      <div className="caption">Health score</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums text-ink">{score ?? '—'}</span>
        {score !== null && <span className="text-ink-3">/ 100</span>}
      </div>
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'warning'; children: ReactNode }) {
  const styles = {
    error: 'border-danger/30 bg-danger-soft text-danger',
    warning: 'border-warning/30 bg-warning-soft text-warning',
    info: 'border-accent/30 bg-accent-soft text-accent-ink'
  };
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-control border px-4 py-3 text-base ${styles[kind]}`}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-8">
      {back && <div className="mb-3 text-sm">{back}</div>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl tracking-tight sm:text-3xl">{title}</h1>
          {description && <div className="mt-2 max-w-[68ch] text-base text-ink-2">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
      </div>
    </div>
  );
}

/** Heading for a panel or a page section, with optional supporting text and actions. */
export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-lg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

/** A labelled value in a facts row. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="caption">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink">{children}</dd>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-12 text-ink-2" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent-strong" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-container border border-dashed border-line-strong px-6 py-12 text-center">
      <div className="text-lg font-semibold text-ink">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-[52ch] text-ink-2">{children}</div>}
    </div>
  );
}
