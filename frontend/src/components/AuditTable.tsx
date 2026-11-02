import { Link } from 'react-router-dom';
import type { AuditRecord } from '../lib/api';
import { fileUrl } from '../lib/api';
import { formatDateTime, plural, shortUrl, websiteName } from '../lib/format';
import { SeverityStrip, StatusBadge } from './ui';

/** Audit list shared by the dashboard (recent runs) and the history page. */
export function AuditTable({
  audits,
  onRerun,
  rerunDisabled
}: {
  audits: AuditRecord[];
  onRerun?: (audit: AuditRecord) => void;
  rerunDisabled?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left">
        <thead className="border-b border-line bg-sunken text-sm text-ink-3">
          <tr>
            <th scope="col" className="px-5 py-3 font-semibold">Website</th>
            <th scope="col" className="px-4 py-3 font-semibold">Started</th>
            <th scope="col" className="w-56 px-4 py-3 font-semibold">Result</th>
            <th scope="col" className="px-4 py-3 font-semibold">Status</th>
            <th scope="col" className="px-5 py-3 text-right font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {audits.map((audit) => (
            <tr key={audit.id} className="align-middle hover:bg-sunken/60">
              <td className="px-5 py-4">
                <Link to={`/audits/${audit.id}`} className="font-semibold text-ink underline-offset-2 hover:text-accent-ink hover:underline">
                  {websiteName(audit)}
                </Link>
                <div className="mt-0.5 text-sm text-ink-3">{shortUrl(audit.settings.url)}</div>
                {audit.settings.label && <div className="mt-1 text-sm text-ink-2">{audit.settings.label}</div>}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-sm text-ink-2">{formatDateTime(audit.createdAt)}</td>
              <td className="px-4 py-4">
                {audit.summary ? (
                  <>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-semibold text-ink">{plural(audit.summary.totalIssues, 'issue')}</span>
                      <span className="text-ink-3">{plural(audit.summary.pagesTested, 'page')}</span>
                    </div>
                    <SeverityStrip summary={audit.summary} size="sm" />
                  </>
                ) : (
                  <span className="text-sm text-ink-3">{audit.status === 'running' ? 'In progress' : 'No results'}</span>
                )}
              </td>
              <td className="px-4 py-4">
                <StatusBadge status={audit.status} />
              </td>
              <td className="px-5 py-4">
                <div className="flex justify-end gap-2 whitespace-nowrap">
                  {audit.status === 'completed' && (
                    <a
                      className="btn-secondary btn-sm"
                      href={fileUrl(audit.id, 'reports/website-audit-report.html')}
                      target="_blank"
                      rel="noreferrer"
                      title="Opens the full report in a new tab. Use Download PDF there to save it."
                    >
                      View report
                    </a>
                  )}
                  {onRerun && audit.status !== 'running' && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={rerunDisabled}
                      title={rerunDisabled ? 'Another audit is running' : 'Run again with the same settings'}
                      onClick={() => onRerun(audit)}
                    >
                      Re-run
                    </button>
                  )}
                  <Link to={`/audits/${audit.id}`} className="btn-primary btn-sm">
                    {audit.status === 'running' ? 'View progress' : 'Open'}
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
