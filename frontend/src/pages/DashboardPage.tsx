import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AuditTable } from '../components/AuditTable';
import { Alert, EmptyState, HealthScore, PageHeader, SectionHeader, SeverityStrip, Spinner, StatusBadge } from '../components/ui';
import type { AuditRecord } from '../lib/api';
import { api } from '../lib/api';
import { formatDateTime, plural, shortUrl, websiteName } from '../lib/format';
import { useAsync, useInterval } from '../lib/hooks';
import { useRerun } from '../lib/useRerun';

export function DashboardPage() {
  const { data, error, loading, reload } = useAsync(api.dashboard, 'dashboard');
  const { rerun, rerunError, rerunning } = useRerun();
  // Keep the page fresh while an audit is running.
  useInterval(reload, data?.activeAuditId ? 4000 : null);

  const latest = data?.recent.find((audit) => audit.status === 'completed' && audit.summary);
  const running = data?.recent.find((audit) => audit.id === data.activeAuditId);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="What is running now, how the latest audit went, and every recent run."
        actions={
          <Link to="/audits/new" className="btn-primary">
            Start new audit
          </Link>
        }
      />
      {error && <Alert>{error}</Alert>}
      {rerunError && (
        <div className="mb-6">
          <Alert>{rerunError}</Alert>
        </div>
      )}
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-10">
          {running && <RunningAudit audit={running} />}

          {latest ? (
            <LatestResult audit={latest} onRerun={() => void rerun(latest)} rerunDisabled={rerunning || Boolean(data.activeAuditId)} />
          ) : (
            !running && (
              <EmptyState title="No audits yet">
                Start an audit to crawl a website and check every page in up to five viewports.{' '}
                <Link to="/audits/new" className="link">
                  Start new audit
                </Link>
              </EmptyState>
            )
          )}

          {data.recent.length > 0 && (
            <section>
              <SectionHeader
                title="Recent audits"
                description={
                  <>
                    {plural(data.totals.audits, 'audit')} in total, {plural(data.totals.pagesTested, 'page')} tested and{' '}
                    {plural(data.totals.issuesFound, 'issue')} found.
                  </>
                }
                actions={
                  <Link to="/audits" className="link text-sm">
                    See all audits
                  </Link>
                }
              />
              <div className="panel overflow-hidden">
                <AuditTable audits={data.recent} onRerun={rerun} rerunDisabled={rerunning || Boolean(data.activeAuditId)} />
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function LatestResult({ audit, onRerun, rerunDisabled }: { audit: AuditRecord; onRerun: () => void; rerunDisabled: boolean }) {
  const summary = audit.summary;
  if (!summary) return null;
  return (
    <section aria-labelledby="latest-heading">
      <h2 id="latest-heading" className="mb-4 text-lg">
        Latest result
      </h2>
      <div className="panel p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <Link to={`/audits/${audit.id}`} className="text-xl font-semibold text-ink underline-offset-4 hover:underline">
                {websiteName(audit)}
              </Link>
              <StatusBadge status={audit.status} />
            </div>
            <p className="mt-1 text-ink-2">
              {shortUrl(audit.settings.url)}, audited {formatDateTime(audit.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <button type="button" className="btn-secondary" onClick={onRerun} disabled={rerunDisabled}>
              Re-run audit
            </button>
            <Link to={`/audits/${audit.id}`} className="btn-primary">
              Open results
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-8 md:grid-cols-[auto_minmax(0,1fr)] md:items-start md:gap-12">
          <HealthScore score={summary.healthScore} />
          <div>
            <p className="mb-3 text-ink">
              <span className="font-semibold">{plural(summary.totalIssues, 'issue')}</span> on {plural(summary.pagesTested, 'page')} across{' '}
              {plural(summary.viewportsTested.length, 'viewport')}
            </p>
            <SeverityStrip summary={summary} />
          </div>
        </div>
      </div>
    </section>
  );
}

function RunningAudit({ audit }: { audit: AuditRecord }) {
  const fetchProgress = useCallback(() => api.progress(audit.id), [audit.id]);
  const { data: progress, reload } = useAsync(fetchProgress, `progress-${audit.id}`);
  useInterval(reload, 3000);
  const percent = progress?.checksTotal ? Math.round((progress.checksCompleted / progress.checksTotal) * 100) : null;
  const phase = { crawling: 'Discovering pages', auditing: 'Auditing pages', reporting: 'Generating reports', finished: 'Finishing' }[
    progress?.phase ?? audit.phase
  ];

  return (
    <section aria-labelledby="running-heading" className="panel border-accent/40 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="running-heading" className="flex flex-wrap items-center gap-3 text-lg">
            Running now: {websiteName(audit)}
            <StatusBadge status="running" />
          </h2>
          <p className="mt-1 text-ink-2">
            {phase}
            {progress?.checksTotal ? `, ${progress.checksCompleted} of ${progress.checksTotal} page checks done` : ''}
          </p>
        </div>
        <Link to={`/audits/${audit.id}`} className="btn-primary shrink-0">
          View live progress
        </Link>
      </div>
      <div
        className="mt-5 h-2.5 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line"
        role="progressbar"
        aria-label="Page checks completed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div className="h-full rounded-full bg-accent-strong transition-[width] duration-500" style={{ width: `${percent ?? 0}%` }} />
      </div>
    </section>
  );
}
