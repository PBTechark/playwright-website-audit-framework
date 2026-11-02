import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ProgressView } from '../components/ProgressView';
import { ResultsView } from '../components/ResultsView';
import { Alert, Fact, HealthScore, PageHeader, SeverityStrip, Spinner, StatusBadge } from '../components/ui';
import type { AuditProgress, AuditRecord, AuditResultsResponse } from '../lib/api';
import { api } from '../lib/api';
import { formatDateTime, formatDuration, plural, websiteName } from '../lib/format';
import { useInterval } from '../lib/hooks';
import { useRerun } from '../lib/useRerun';

const POLL_MS = 2000;

export function AuditPage() {
  const { id = '' } = useParams();
  const [audit, setAudit] = useState<AuditRecord | null>(null);
  const [progress, setProgress] = useState<AuditProgress | null>(null);
  const [results, setResults] = useState<AuditResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const { rerun, rerunError, rerunning } = useRerun();

  const loadFinished = useCallback(async () => {
    const data = await api.results(id);
    setResults(data);
    setAudit(data.audit);
  }, [id]);

  useEffect(() => {
    setAudit(null);
    setResults(null);
    setProgress(null);
    setError(null);
    setCancelling(false);
    api
      .audit(id)
      .then(async (record) => {
        setAudit(record);
        if (record.status !== 'running') await loadFinished();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [id, loadFinished]);

  const running = audit?.status === 'running';

  useInterval(
    () => {
      api
        .progress(id)
        .then(async (next) => {
          setProgress(next);
          if (next.status !== 'running') await loadFinished();
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    },
    running ? POLL_MS : null
  );

  async function cancel() {
    if (!window.confirm('Cancel this audit? Pages already audited stay in the results.')) return;
    setCancelling(true);
    try {
      await api.cancel(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setCancelling(false);
    }
  }

  const back = (
    <Link to="/audits" className="link">
      ← Audit history
    </Link>
  );

  if (error && !audit) {
    return (
      <>
        <div className="mb-4 text-sm">{back}</div>
        <Alert>{error}</Alert>
      </>
    );
  }
  if (!audit) return <Spinner />;

  const summary = results?.summary ?? audit.summary;
  const alerts = [
    error && <Alert key="error">{error}</Alert>,
    rerunError && <Alert key="rerun">{rerunError}</Alert>,
    audit.error && audit.status !== 'completed' && (
      <Alert key="audit" kind={audit.status === 'cancelled' ? 'warning' : 'error'}>
        {audit.error}
      </Alert>
    ),
    audit.status === 'completed' && Boolean(audit.failedChecks) && (
      <Alert key="checks" kind="warning">
        {plural(audit.failedChecks, 'page check')} did not finish cleanly in the engine, for example because a page returned an HTTP
        error. Findings from those checks are still listed below.
      </Alert>
    )
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        back={back}
        title={websiteName(audit)}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <a href={audit.settings.url} target="_blank" rel="noreferrer noopener" className="link break-all font-normal">
              {audit.settings.url}
            </a>
            <StatusBadge status={audit.status} />
            {audit.settings.label && <span className="text-ink-2">{audit.settings.label}</span>}
          </span>
        }
        actions={
          !running && (
            <button type="button" className="btn-secondary" onClick={() => void rerun(audit)} disabled={rerunning}>
              {rerunning ? 'Starting…' : 'Re-run audit'}
            </button>
          )
        }
      />

      {alerts.length > 0 && <div className="mb-8 space-y-3">{alerts}</div>}

      <section className="panel mb-10 p-6 sm:p-8" aria-label="Audit summary">
        {summary && !running ? (
          <div className="grid gap-8 md:grid-cols-[auto_minmax(0,1fr)] md:items-start md:gap-12">
            <HealthScore score={summary.healthScore} />
            <div>
              <p className="mb-3">
                <span className="font-semibold">{plural(summary.totalIssues, 'issue')}</span> on {plural(summary.pagesTested, 'page')} across{' '}
                {plural(summary.viewportsTested.length, 'viewport')}
              </p>
              <SeverityStrip summary={summary} />
            </div>
          </div>
        ) : (
          <p className="text-ink-2">{running ? 'The result summary appears here when the audit finishes.' : 'This audit produced no results.'}</p>
        )}
        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-6 sm:grid-cols-4">
          <Fact label="Started">{formatDateTime(audit.createdAt)}</Fact>
          <Fact label="Duration">{running ? 'In progress' : formatDuration(audit.durationMs)}</Fact>
          <Fact label="Crawl limits">
            {plural(audit.settings.maxPages, 'page')}, depth {audit.settings.maxDepth}
          </Fact>
          <Fact label="Viewports">{plural(audit.settings.viewports.length, 'viewport')}</Fact>
        </dl>
        <p className="mt-5 text-sm text-ink-3">
          {audit.settings.viewports.join(', ')}. Audit ID <span className="font-mono text-ink-2">{audit.id}</span>
        </p>
      </section>

      {running ? (
        <ProgressView audit={audit} progress={progress} onCancel={() => void cancel()} cancelling={cancelling} />
      ) : results ? (
        <ResultsView results={results} />
      ) : (
        <Spinner label="Loading results…" />
      )}
    </>
  );
}
