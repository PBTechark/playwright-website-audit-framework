import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuditTable } from '../components/AuditTable';
import { Alert, EmptyState, PageHeader, Spinner } from '../components/ui';
import type { AuditStatus } from '../lib/api';
import { api } from '../lib/api';
import { plural } from '../lib/format';
import { useAsync, useInterval } from '../lib/hooks';
import { useRerun } from '../lib/useRerun';

const statusOptions: Array<{ value: AuditStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'interrupted', label: 'Interrupted' }
];

export function HistoryPage() {
  const { data, error, loading, reload } = useAsync(api.audits, 'audits');
  const { rerun, rerunError, rerunning } = useRerun();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AuditStatus | ''>('');
  const isRunning = Boolean(data?.some((audit) => audit.status === 'running'));
  useInterval(reload, isRunning ? 5000 : null);

  const audits = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data ?? []).filter(
      (audit) =>
        (!status || audit.status === status) &&
        (!query ||
          [audit.settings.url, audit.settings.name, audit.settings.label, audit.id].some((value) =>
            value.toLowerCase().includes(query)
          ))
    );
  }, [data, search, status]);

  return (
    <>
      <PageHeader
        title="Audit history"
        description="Every audit started from the dashboard, newest first. Each one keeps its own reports and screenshots."
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
        <>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-80">
              <label className="label" htmlFor="audit-search">
                Search
              </label>
              <input
                id="audit-search"
                type="search"
                className="input"
                placeholder="Website, label or audit ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="sm:w-52">
              <label className="label" htmlFor="audit-status">
                Status
              </label>
              <select id="audit-status" className="input" value={status} onChange={(event) => setStatus(event.target.value as AuditStatus | '')}>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-sm text-ink-3 sm:mb-3 sm:ml-auto" aria-live="polite">
              Showing {audits.length} of {plural(data.length, 'audit')}
            </p>
          </div>
          {audits.length ? (
            <div className="panel overflow-hidden">
              <AuditTable audits={audits} onRerun={rerun} rerunDisabled={rerunning || isRunning} />
            </div>
          ) : (
            <EmptyState title={data.length ? 'No audits match these filters' : 'No audits yet'}>
              {data.length ? 'Try a different search or status.' : 'Audits you start appear here with their results.'}
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}
