import { ReactNode, useMemo, useState } from 'react';
import type { AuditResultsResponse, PageResult, Severity } from '../lib/api';
import { fileUrl, reportPdfUrl, screenshotsZipUrl } from '../lib/api';
import { IssueGroup, groupFindings, splitMeasuredDetails, unique } from '../lib/findings';
import { pagePath, plural, safeHref, screenshotLabel, shortUrl } from '../lib/format';
import { Lightbox, LightboxImage } from './Lightbox';
import { LogViewer } from './LogViewer';
import { EmptyState, SEVERITIES, SectionHeader, SeverityBadge, SeverityMark } from './ui';

type Tab = 'issues' | 'pages' | 'reports' | 'log';

interface Filters {
  severities: Severity[];
  category: string;
  page: string;
  viewport: string;
  search: string;
}

const emptyFilters: Filters = { severities: [], category: '', page: '', viewport: '', search: '' };
const PAGE_SIZE = 30;

type OpenImage = (path: string, caption: string) => void;

export function ResultsView({ results }: { results: AuditResultsResponse }) {
  const { audit } = results;
  const groups = useMemo(() => groupFindings(results.findings), [results.findings]);
  const [tab, setTab] = useState<Tab>(results.available ? 'issues' : 'log');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  const openImage: OpenImage = (path, caption) =>
    setLightbox({ src: fileUrl(audit.id, path), downloadHref: fileUrl(audit.id, path, true), caption });

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'issues', label: 'Issues', count: groups.length },
    { key: 'pages', label: 'Pages and screenshots', count: results.pages.length },
    { key: 'reports', label: 'Reports' },
    { key: 'log', label: 'Engine log' }
  ];

  return (
    <div>
      <div className="mb-8 border-b border-line">
        <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label="Audit results">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-[3px] px-4 pb-3 pt-2 text-base font-semibold transition-colors ${
                tab === item.key ? 'border-accent-strong text-ink' : 'border-transparent text-ink-3 hover:border-line-strong hover:text-ink'
              }`}
            >
              {item.label}
              {item.count !== undefined && (
                <span className={`rounded-full px-2 text-sm tabular-nums ${tab === item.key ? 'bg-accent-soft text-accent-ink' : 'bg-sunken text-ink-3'}`}>
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'issues' && (
        <IssuesTab results={results} groups={groups} filters={filters} setFilters={setFilters} openImage={openImage} />
      )}
      {tab === 'pages' && (
        <PagesTab
          results={results}
          openImage={openImage}
          showIssues={(page) => {
            setFilters({ ...emptyFilters, page });
            setTab('issues');
          }}
        />
      )}
      {tab === 'reports' && <ReportsTab results={results} />}
      {tab === 'log' && (
        <section className="panel p-6">
          <LogViewer auditId={audit.id} live={false} />
        </section>
      )}
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function IssuesTab({
  results,
  groups,
  filters,
  setFilters,
  openImage
}: {
  results: AuditResultsResponse;
  groups: IssueGroup[];
  filters: Filters;
  setFilters: (filters: Filters) => void;
  openImage: OpenImage;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  // Below the desktop breakpoint the filter rail is folded away so the issues come first.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pages = useMemo(() => unique(groups.map((group) => group.url)).sort(), [groups]);
  const viewports = results.summary.viewportsTested;

  const matches = (group: IssueGroup, ignore?: keyof Filters) => {
    const query = filters.search.trim().toLowerCase();
    return (
      (ignore === 'severities' || !filters.severities.length || filters.severities.includes(group.severity)) &&
      (ignore === 'category' || !filters.category || group.category === filters.category) &&
      (!filters.page || group.url === filters.page) &&
      (!filters.viewport || group.viewports.includes(filters.viewport)) &&
      (!query ||
        group.findings.some((finding) =>
          [finding.description, finding.selector ?? '', finding.suggestedFix].some((text) => text.toLowerCase().includes(query))
        ))
    );
  };
  const filtered = groups.filter((group) => matches(group));
  // Rail counts reflect the other active filters, so each number says what clicking it would show.
  const severityCounts = countBy(groups.filter((group) => matches(group, 'severities')), (group) => group.severity);
  const categoryCounts = countBy(groups.filter((group) => matches(group, 'category')), (group) => group.category);
  const categories = unique(groups.map((group) => group.category)).sort();

  const set = (patch: Partial<Filters>) => {
    setLimit(PAGE_SIZE);
    setFilters({ ...filters, ...patch });
  };
  const activeCount = filters.severities.length + [filters.category, filters.page, filters.viewport, filters.search].filter(Boolean).length;
  const active = activeCount > 0;

  if (!groups.length) {
    return <EmptyState title="No issues found">The engine reported no issues for the pages it audited.</EmptyState>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
      <button
        type="button"
        className="btn-secondary justify-between lg:hidden"
        aria-expanded={filtersOpen}
        aria-controls="issue-filters"
        onClick={() => setFiltersOpen(!filtersOpen)}
      >
        {active ? `Filters (${activeCount} on)` : 'Filters'}
        <span aria-hidden>{filtersOpen ? '▴' : '▾'}</span>
      </button>
      <aside
        id="issue-filters"
        className={`space-y-7 lg:sticky lg:top-24 lg:block lg:self-start ${filtersOpen ? '' : 'hidden'}`}
        aria-label="Filter issues"
      >
        <div>
          <label className="label" htmlFor="issue-search">
            Search
          </label>
          <input
            id="issue-search"
            type="search"
            className="input"
            placeholder="Text, element or fix"
            value={filters.search}
            onChange={(event) => set({ search: event.target.value })}
          />
        </div>

        <FilterGroup title="Severity">
          {SEVERITIES.map((severity) => {
            const selected = filters.severities.includes(severity);
            return (
              <RailButton
                key={severity}
                selected={selected}
                count={severityCounts.get(severity) ?? 0}
                onClick={() =>
                  set({ severities: selected ? filters.severities.filter((item) => item !== severity) : [...filters.severities, severity] })
                }
              >
                <SeverityMark severity={severity} />
                {severity}
              </RailButton>
            );
          })}
        </FilterGroup>

        <FilterGroup title="Issue type">
          {categories.map((category) => (
            <RailButton
              key={category}
              selected={filters.category === category}
              count={categoryCounts.get(category) ?? 0}
              onClick={() => set({ category: filters.category === category ? '' : category })}
            >
              {category}
            </RailButton>
          ))}
        </FilterGroup>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
          <div>
            <label className="label" htmlFor="issue-viewport">
              Viewport
            </label>
            <select id="issue-viewport" className="input" value={filters.viewport} onChange={(event) => set({ viewport: event.target.value })}>
              <option value="">All viewports</option>
              {viewports.map((viewport) => (
                <option key={viewport}>{viewport}</option>
              ))}
            </select>
          </div>
          {pages.length > 1 && (
            <div>
              <label className="label" htmlFor="issue-page">
                Page
              </label>
              <select id="issue-page" className="input" value={filters.page} onChange={(event) => set({ page: event.target.value })}>
                <option value="">All pages</option>
                {pages.map((page) => (
                  <option key={page} value={page}>
                    {pagePath(page)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="text-ink-2" aria-live="polite">
            <span className="font-semibold text-ink">{plural(filtered.length, 'issue')}</span>
            {active ? ' match your filters' : ''}, grouped from {plural(results.findings.length, 'finding')} across viewports
          </p>
          <div className="flex gap-4 text-sm">
            {active && (
              <button type="button" className="link" onClick={() => set(emptyFilters)}>
                Clear filters
              </button>
            )}
            {filtered.length > 0 && (
              <button type="button" className="link" onClick={() => setExpandAll(!expandAll)}>
                {expandAll ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
        </div>
        {filters.page && (
          <p className="mb-4 text-sm text-ink-2">
            Showing issues on <span className="font-semibold text-ink">{pagePath(filters.page)}</span> only.
          </p>
        )}

        {filtered.length === 0 ? (
          <EmptyState title="No issues match these filters">Remove a filter, or clear them all, to see more issues.</EmptyState>
        ) : (
          <ul className="panel divide-y divide-line overflow-hidden">
            {filtered.slice(0, limit).map((group, index) => (
              <IssueRow
                key={`${group.key}-${String(expandAll)}`}
                group={group}
                defaultOpen={expandAll ?? index === 0}
                showPage={pages.length > 1}
                auditId={results.audit.id}
                openImage={openImage}
              />
            ))}
          </ul>
        )}
        {filtered.length > limit && (
          <button type="button" className="btn-secondary mt-4 w-full" onClick={() => setLimit(limit + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, filtered.length - limit)} more ({filtered.length - limit} remaining)
          </button>
        )}
      </div>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="label">{title}</legend>
      <div className="-mx-2 space-y-0.5">{children}</div>
    </fieldset>
  );
}

function RailButton({ selected, count, onClick, children }: { selected: boolean; count: number; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-control px-2 py-1.5 text-left transition-colors ${
        selected ? 'bg-accent-soft font-semibold text-ink ring-1 ring-inset ring-accent/40' : 'text-ink-2 hover:bg-sunken hover:text-ink'
      } ${count === 0 && !selected ? 'opacity-60' : ''}`}
    >
      <span className="flex min-w-0 items-center gap-2.5">{children}</span>
      <span className="tabular-nums text-ink-3">{count}</span>
    </button>
  );
}

function IssueRow({
  group,
  defaultOpen,
  showPage,
  auditId,
  openImage
}: {
  group: IssueGroup;
  defaultOpen: boolean;
  showPage: boolean;
  auditId: string;
  openImage: OpenImage;
}) {
  const first = group.findings[0];
  const selectors = unique(group.findings.map((finding) => finding.selector).filter((value): value is string => Boolean(value)));
  const evidence = group.findings.flatMap((finding) => unique(finding.evidence).map((path) => ({ path, viewport: finding.viewport })));
  const actual = first.actual ? splitMeasuredDetails(first.actual) : null;
  const where = group.viewports.length <= 2 ? group.viewports.join(' and ') : plural(group.viewports.length, 'viewport');

  return (
    <li>
      <details open={defaultOpen} className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-5 py-4 hover:bg-sunken/70 focus:outline-none focus-visible:bg-sunken focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-strong sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] [&::-webkit-details-marker]:hidden">
          <span className="hidden pt-0.5 sm:block">
            <SeverityBadge severity={group.severity} />
          </span>
          <span className="min-w-0">
            <span className="mb-1.5 block sm:hidden">
              <SeverityBadge severity={group.severity} />
            </span>
            <span className="block font-semibold text-ink">{group.title}</span>
            <span className="mt-0.5 block text-sm text-ink-3">
              {group.category} issue in {where}
              {showPage && <> on {pagePath(group.url)}</>}
            </span>
          </span>
          <span className="mt-1 text-ink-3 transition-transform group-open:rotate-180" aria-hidden>
            ▾
          </span>
        </summary>

        <div className="space-y-5 px-5 pb-6 sm:pl-[8.5rem]">
          {group.summary && <p className="max-w-[72ch] text-ink-2">{group.summary}</p>}

          <div className="rounded-control border-l-4 border-accent-strong bg-accent-soft px-4 py-3">
            <div className="text-sm font-semibold text-accent-ink">How to fix</div>
            <p className="mt-0.5 max-w-[72ch] text-ink">{first.suggestedFix}</p>
          </div>

          {(first.expected || actual) && (
            <dl className="grid gap-5 md:grid-cols-2">
              {first.expected && (
                <div>
                  <dt className="caption">Expected</dt>
                  <dd className="mt-0.5 break-words">{first.expected}</dd>
                </div>
              )}
              {actual && (
                <div className="min-w-0">
                  <dt className="caption">Found</dt>
                  <dd className="mt-0.5 break-words">{actual.text || first.actual}</dd>
                </div>
              )}
            </dl>
          )}
          {actual?.details && (
            <div>
              <div className="caption mb-1">Measured details</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control bg-sunken px-4 py-3 font-mono text-xs leading-5 text-ink-2 ring-1 ring-inset ring-line">
                {actual.details}
              </pre>
            </div>
          )}

          {selectors.length > 0 && (
            <div>
              <div className="caption mb-1">{selectors.length === 1 ? 'Element' : `Elements (${selectors.length})`}</div>
              <ul className="space-y-1.5">
                {selectors.slice(0, 3).map((selector) => (
                  <li key={selector}>
                    <code className="block overflow-x-auto whitespace-pre-wrap break-all rounded-control bg-sunken px-3 py-2 font-mono text-xs leading-5 text-ink-2 ring-1 ring-inset ring-line">
                      {selector}
                    </code>
                  </li>
                ))}
              </ul>
              {selectors.length > 3 && <p className="hint">And {selectors.length - 3} more in the downloadable report.</p>}
            </div>
          )}

          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="min-w-0">
              <dt className="caption inline">Page: </dt>
              <dd className="inline">
                <a href={safeHref(group.url)} target="_blank" rel="noreferrer noopener" className="link break-all font-normal">
                  {shortUrl(group.url)}
                </a>
              </dd>
            </div>
            <div>
              <dt className="caption inline">Viewports: </dt>
              <dd className="inline text-ink-2">{group.viewports.join(', ')}</dd>
            </div>
          </dl>

          {evidence.length > 0 && (
            <div>
              <div className="caption mb-2">Evidence</div>
              <div className="flex flex-wrap gap-3">
                {evidence.slice(0, 10).map((item) => (
                  <Thumbnail
                    key={`${item.viewport}-${item.path}`}
                    auditId={auditId}
                    path={item.path}
                    label={item.viewport}
                    caption={`${group.title}, ${item.viewport}`}
                    openImage={openImage}
                  />
                ))}
              </div>
              {evidence.length > 10 && <p className="hint">{evidence.length - 10} more screenshots are in the Pages and screenshots tab.</p>}
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

function PagesTab({ results, openImage, showIssues }: { results: AuditResultsResponse; openImage: OpenImage; showIssues: (page: string) => void }) {
  if (!results.pages.length) return <EmptyState title="No pages were audited">The run stopped before any page finished.</EmptyState>;
  return (
    <ul className="space-y-8">
      {results.pages.map((page) => (
        <PageCard key={page.url} page={page} auditId={results.audit.id} openImage={openImage} showIssues={showIssues} />
      ))}
    </ul>
  );
}

function PageCard({ page, auditId, openImage, showIssues }: { page: PageResult; auditId: string; openImage: OpenImage; showIssues: (page: string) => void }) {
  return (
    <li className="panel p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg">{page.title || pagePath(page.url)}</h3>
          <a href={safeHref(page.url)} target="_blank" rel="noreferrer noopener" className="link mt-0.5 block break-all font-normal">
            {page.url}
          </a>
          <p className="mt-2 text-sm text-ink-2">
            {page.status !== undefined && <span className={page.status >= 400 ? 'font-semibold text-danger' : ''}>HTTP {page.status}. </span>}
            {plural(page.issues, 'finding')} across {plural(page.viewports.length, 'viewport')}.
          </p>
        </div>
        {page.issues > 0 && (
          <button type="button" className="btn-secondary shrink-0" onClick={() => showIssues(page.url)}>
            Show this page’s issues
          </button>
        )}
      </div>
      <div className="mt-6 space-y-6">
        {page.viewports.map((viewport) => (
          <section key={viewport.viewport} className="border-t border-line pt-5" aria-label={viewport.viewport}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h4 className="font-semibold">
                {viewport.viewport}
                {viewport.resolution && <span className="ml-2 font-normal text-ink-3">{viewport.resolution.replace(`${viewport.viewport} — `, '')}</span>}
              </h4>
              <span className="text-sm text-ink-3">
                {plural(viewport.issues, 'finding')}
                {viewport.loadTimeMs !== undefined && `, loaded in ${(viewport.loadTimeMs / 1000).toFixed(1)} s`}
              </span>
            </div>
            {viewport.screenshots.length ? (
              <div className="flex flex-wrap gap-3">
                {viewport.screenshots.map((shot) => (
                  <Thumbnail
                    key={shot.path}
                    auditId={auditId}
                    path={shot.path}
                    label={screenshotLabel(shot.label)}
                    caption={`${pagePath(page.url)}, ${viewport.viewport}, ${screenshotLabel(shot.label)}`}
                    openImage={openImage}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-3">No screenshots were captured for this viewport.</p>
            )}
          </section>
        ))}
      </div>
    </li>
  );
}

function Thumbnail({ auditId, path, label, caption, openImage }: { auditId: string; path: string; label: string; caption: string; openImage: OpenImage }) {
  return (
    <button
      type="button"
      onClick={() => openImage(path, caption)}
      className="w-40 overflow-hidden rounded-control border border-line bg-surface text-left transition-colors hover:border-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
      title={`${label}: view full size`}
    >
      <img src={fileUrl(auditId, path)} alt={caption} loading="lazy" className="h-24 w-full bg-sunken object-cover object-top" />
      <span className="block truncate border-t border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2">{label}</span>
    </button>
  );
}

function ReportsTab({ results }: { results: AuditResultsResponse }) {
  const { audit, reports } = results;
  if (!reports.length && !results.hasScreenshots) {
    return <EmptyState title="No reports were generated">The engine writes reports at the end of a run, so a cancelled or failed audit has none.</EmptyState>;
  }
  const rows: Array<{ key: string; label: string; kind: string; open?: string; pdf?: string; download: string }> = [
    ...reports.map((report) => ({
      key: report.path,
      label: report.label,
      kind: report.kind,
      open: report.kind === 'html' ? fileUrl(audit.id, report.path) : undefined,
      pdf: report.kind === 'html' ? reportPdfUrl(audit.id, report.path) : undefined,
      download: fileUrl(audit.id, report.path, true)
    })),
    ...(results.hasScreenshots ? [{ key: 'zip', label: 'All screenshots', kind: 'zip', download: screenshotsZipUrl(audit.id) }] : [])
  ];
  return (
    <section>
      <SectionHeader title="Reports and downloads" description="Files the engine generated for this audit only." />
      <ul className="panel divide-y divide-line overflow-hidden">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-chip bg-sunken text-xs font-bold text-ink-2 ring-1 ring-inset ring-line">
                {row.kind.toUpperCase()}
              </span>
              <span className="font-semibold">{row.label}</span>
            </div>
            <div className="flex gap-2">
              {row.open && (
                <a className="btn-secondary btn-sm" href={row.open} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
              )}
              {row.pdf && (
                <a className="btn-secondary btn-sm" href={row.pdf} title="The first download of each PDF takes a few seconds to render">
                  Download PDF
                </a>
              )}
              <a className="btn-secondary btn-sm" href={row.download}>
                {row.pdf ? 'Download HTML' : 'Download'}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(key(item), (counts.get(key(item)) ?? 0) + 1));
  return counts;
}
