import { useState } from 'react';
import type { AuditPhase, AuditProgress, AuditRecord } from '../lib/api';
import { formatDuration, formatNumber, pagePath } from '../lib/format';
import { useInterval } from '../lib/hooks';
import { LogViewer } from './LogViewer';
import { Fact, SectionHeader } from './ui';

const phases: Array<{ key: AuditPhase; label: string; detail: string }> = [
  { key: 'crawling', label: 'Discover pages', detail: 'Sitemaps, navigation and links' },
  { key: 'auditing', label: 'Audit pages', detail: 'Every page in every selected viewport' },
  { key: 'reporting', label: 'Write reports', detail: 'HTML, JSON and spreadsheet files' }
];

/** Live audit progress. Every number comes from the engine's progress events and result files. */
export function ProgressView({
  audit,
  progress,
  onCancel,
  cancelling
}: {
  audit: AuditRecord;
  progress: AuditProgress | null;
  onCancel: () => void;
  cancelling: boolean;
}) {
  // Re-render each second so elapsed time keeps moving between polls.
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), 1000);
  const elapsed = now - Date.parse(audit.createdAt);
  const phase = progress?.phase ?? audit.phase;
  const phaseIndex = phases.findIndex((item) => item.key === phase);
  const percent = progress?.checksTotal ? Math.round((progress.checksCompleted / progress.checksTotal) * 100) : null;

  return (
    <div className="space-y-10">
      <section className="panel p-6 sm:p-8" aria-label="Audit progress">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <ol className="grid flex-1 gap-5 sm:grid-cols-3">
            {phases.map((item, index) => {
              const state = index < phaseIndex ? 'done' : index === phaseIndex ? 'current' : 'todo';
              return (
                <li key={item.key} className="flex gap-3" aria-current={state === 'current' ? 'step' : undefined}>
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      state === 'done'
                        ? 'bg-success-soft text-success'
                        : state === 'current'
                          ? 'bg-accent text-white ring-4 ring-accent-soft'
                          : 'bg-sunken text-ink-3 ring-1 ring-inset ring-line'
                    }`}
                  >
                    {state === 'done' ? '✓' : index + 1}
                    <span className="sr-only">{state === 'done' ? ' done' : state === 'current' ? ' in progress' : ' not started'}</span>
                  </span>
                  <span>
                    <span className={`block font-semibold ${state === 'todo' ? 'text-ink-3' : 'text-ink'}`}>{item.label}</span>
                    <span className="mt-0.5 block text-sm text-ink-3">{item.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <button type="button" className="btn-danger shrink-0" onClick={onCancel} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel audit'}
          </button>
        </div>

        <div className="mt-8 border-t border-line pt-6">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">Page checks</span>
            <span className="tabular-nums text-ink-2">
              {progress?.checksTotal
                ? `${progress.checksCompleted} of ${progress.checksTotal} done (${percent}%)`
                : 'Counted once page discovery finishes'}
            </span>
          </div>
          <div
            className="h-3 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress?.checksTotal ?? undefined}
            aria-valuenow={progress?.checksTotal ? progress.checksCompleted : undefined}
            aria-label="Page checks completed"
          >
            <div className="h-full rounded-full bg-accent-strong transition-[width] duration-500" style={{ width: `${percent ?? 0}%` }} />
          </div>
          <p className="hint">A check is one page in one viewport. The bar only moves when the engine finishes a check.</p>
        </div>

        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-6 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Elapsed">{formatDuration(elapsed)}</Fact>
          <Fact label="Pages found">{formatNumber(progress?.pagesDiscovered)}</Fact>
          <Fact label="Pages finished">{formatNumber(progress?.pagesCompleted)}</Fact>
          <Fact label="Pages left">{formatNumber(progress?.pagesRemaining)}</Fact>
          <Fact label="Findings so far">{formatNumber(progress?.issuesFound)}</Fact>
          <Fact label="Failed checks">
            <span className={progress?.checksFailed ? 'text-danger' : ''}>{formatNumber(progress?.checksFailed)}</span>
          </Fact>
        </dl>
      </section>

      <section aria-label="Pages being audited">
        <SectionHeader title="Checking now" description="Pages the engine is auditing at this moment, one row per viewport." />
        {progress?.current.length ? (
          <ul className="panel divide-y divide-line overflow-hidden">
            {progress.current.map((item) => (
              <li key={`${item.viewport}-${item.url}`} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 break-all font-semibold">{pagePath(item.url)}</span>
                <span className="shrink-0 text-sm text-ink-2">{item.viewport}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel px-5 py-4 text-ink-2">
            {phase === 'crawling'
              ? 'Discovering pages. Checks start when discovery finishes.'
              : phase === 'reporting'
                ? 'All checks are done. Writing the reports now.'
                : 'Starting the next check…'}
          </p>
        )}
      </section>

      <section className="panel p-6">
        <LogViewer auditId={audit.id} live />
      </section>
    </div>
  );
}
