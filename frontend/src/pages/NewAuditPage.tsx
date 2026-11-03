import { FormEvent, ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, PageHeader, Spinner } from '../components/ui';
import type { AppConfigResponse, AuditSettings } from '../lib/api';
import { api } from '../lib/api';
import { plural, shortUrl } from '../lib/format';
import { useAsync } from '../lib/hooks';

type Mode = 'manual' | 'saved';
type FieldErrors = Partial<Record<'url' | 'maxPages' | 'maxDepth' | 'viewports', string>>;

interface FormState {
  url: string;
  name: string;
  label: string;
  maxPages: string;
  maxDepth: string;
  viewports: string[];
  screenshots: boolean;
  savedWebsite: string | null;
}

export function NewAuditPage() {
  const { data: config, error, loading } = useAsync(api.config, 'config');
  return (
    <>
      <PageHeader
        title="New audit"
        description="Choose a website and how much of it to check. These settings apply to this audit only."
      />
      {error && <Alert>{error}</Alert>}
      {loading && !config && <Spinner />}
      {config && <AuditForm config={config} />}
    </>
  );
}

function AuditForm({ config }: { config: AppConfigResponse }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('manual');
  const [form, setForm] = useState<FormState>({
    url: '',
    name: '',
    label: '',
    maxPages: String(config.defaults.maxPages),
    maxDepth: String(config.defaults.maxDepth),
    viewports: config.viewports.map((viewport) => viewport.name),
    screenshots: config.defaults.screenshots,
    savedWebsite: null
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  // Saved websites prefill the form; edits afterwards never change the master CSV.
  function chooseSaved(name: string) {
    const site = config.savedWebsites.find((item) => item.name === name);
    if (!site) {
      update({ savedWebsite: null });
      return;
    }
    update({
      savedWebsite: site.name,
      url: site.url,
      name: site.name,
      maxPages: String(Math.min(site.maxPages, config.limits.maxPages)),
      maxDepth: String(Math.min(site.maxDepth, config.limits.maxDepth))
    });
    setErrors({});
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    try {
      const url = new URL(form.url.trim());
      if (!['http:', 'https:'].includes(url.protocol)) next.url = 'Use an http:// or https:// address.';
    } catch {
      next.url = 'Enter a full address, for example https://example.com/';
    }
    const pages = Number(form.maxPages);
    if (!Number.isInteger(pages) || pages < 1 || pages > config.limits.maxPages) {
      next.maxPages = `Enter a whole number from 1 to ${config.limits.maxPages}.`;
    }
    const depth = Number(form.maxDepth);
    if (!Number.isInteger(depth) || depth < 1 || depth > config.limits.maxDepth) {
      next.maxDepth = `Enter a whole number from 1 to ${config.limits.maxDepth}.`;
    }
    if (form.viewports.length === 0) next.viewports = 'Select at least one viewport.';
    return next;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fieldErrors = validate();
    setErrors(fieldErrors);
    setSubmitError(null);
    if (Object.keys(fieldErrors).length) return;
    const settings: AuditSettings = {
      url: form.url.trim(),
      name: form.name.trim(),
      label: form.label.trim(),
      maxPages: Number(form.maxPages),
      maxDepth: Number(form.maxDepth),
      viewports: form.viewports,
      screenshots: form.screenshots,
      savedWebsite: mode === 'saved' ? form.savedWebsite : null
    };
    setSubmitting(true);
    try {
      const audit = await api.startAudit(settings);
      navigate(`/audits/${audit.id}`);
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
    }
  }

  const allSelected = form.viewports.length === config.viewports.length;
  const checkCount = form.viewports.length;

  const pageLimit = Number(form.maxPages) || 0;

  return (
    <form onSubmit={submit} noValidate className="space-y-10">
      {config.activeAuditId && (
        <Alert kind="warning">
          Another audit is running, and only one can run at a time.{' '}
          <Link to={`/audits/${config.activeAuditId}`} className="font-semibold underline">
            View its progress
          </Link>
        </Alert>
      )}

      <Section title="Website" description="The page the crawler starts from. Name and label help you find this audit later.">
        <div className="mb-6 inline-flex rounded-control bg-sunken p-1 ring-1 ring-inset ring-line" role="radiogroup" aria-label="Website source">
          {(['manual', 'saved'] as Mode[]).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              disabled={option === 'saved' && !config.savedWebsites.length}
              onClick={() => {
                setMode(option);
                if (option === 'manual') update({ savedWebsite: null });
              }}
              className={`rounded-[0.375rem] px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
                mode === option ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {option === 'saved' ? `Saved website (${config.savedWebsites.length})` : 'Enter an address'}
            </button>
          ))}
        </div>

        {mode === 'saved' && (
          <div className="mb-6">
            <label className="label" htmlFor="savedWebsite">
              Saved website
            </label>
            <select id="savedWebsite" className="input" value={form.savedWebsite ?? ''} onChange={(event) => chooseSaved(event.target.value)}>
              <option value="">Choose a website…</option>
              {config.savedWebsites.map((site) => (
                <option key={site.name} value={site.name}>
                  {site.name} ({shortUrl(site.url)})
                </option>
              ))}
            </select>
            <p className="hint">Fills in the address and crawl limits from test-data/audit-targets.csv. Changes here never edit that file.</p>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="label" htmlFor="url">
              Website address <Required />
            </label>
            <input
              id="url"
              type="url"
              className="input"
              placeholder="https://example.com/"
              value={form.url}
              onChange={(event) => update({ url: event.target.value })}
              aria-invalid={Boolean(errors.url)}
              aria-describedby={errors.url ? 'url-error' : undefined}
            />
            {errors.url && (
              <p id="url-error" className="field-error">
                {errors.url}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="name">
              Website name <Optional />
            </label>
            <input id="name" className="input" maxLength={80} placeholder="Uses the domain if empty" value={form.name} onChange={(event) => update({ name: event.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="label">
              Audit label <Optional />
            </label>
            <input id="label" className="input" maxLength={120} placeholder="For example, November release" value={form.label} onChange={(event) => update({ label: event.target.value })} />
          </div>
        </div>
      </Section>

      <Section
        title="Viewports"
        description="Each page is checked once in every viewport you select."
        actions={
          <button type="button" className="link text-sm" onClick={() => update({ viewports: allSelected ? [] : config.viewports.map((viewport) => viewport.name) })}>
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        }
      >
        <fieldset aria-describedby={errors.viewports ? 'viewports-error' : undefined}>
          <legend className="sr-only">Viewports</legend>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {config.viewports.map((viewport) => {
              const checked = form.viewports.includes(viewport.name);
              return (
                <label
                  key={viewport.name}
                  className={`flex cursor-pointer items-start gap-3 rounded-control border px-4 py-3.5 transition-colors ${
                    checked ? 'border-accent-strong bg-accent-soft' : 'border-line-strong hover:bg-sunken'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="check mt-0.5"
                    checked={checked}
                    onChange={() =>
                      update({
                        viewports: checked ? form.viewports.filter((name) => name !== viewport.name) : [...form.viewports, viewport.name]
                      })
                    }
                  />
                  <span>
                    <span className="block font-semibold text-ink">{viewport.name}</span>
                    <span className="text-sm tabular-nums text-ink-3">
                      {viewport.width} by {viewport.height} pixels
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.viewports && (
            <p id="viewports-error" className="field-error">
              {errors.viewports}
            </p>
          )}
        </fieldset>
      </Section>

      <Section title="Crawl limits" description="How far the crawler goes. The backend caps these values whatever is entered here.">
        <div className="grid gap-6 md:grid-cols-2">
          <NumberField
            id="maxPages"
            label="Maximum pages"
            value={form.maxPages}
            max={config.limits.maxPages}
            error={errors.maxPages}
            hint={`The crawler stops after this many pages. Up to ${config.limits.maxPages}.`}
            onChange={(maxPages) => update({ maxPages })}
          />
          <NumberField
            id="maxDepth"
            label="Link depth"
            value={form.maxDepth}
            max={config.limits.maxDepth}
            error={errors.maxDepth}
            hint="1 means the start page and the pages it links to. Each extra level follows links one step further."
            onChange={(maxDepth) => update({ maxDepth })}
          />
        </div>
        <p className="mt-6 border-t border-line pt-5 text-sm text-ink-2">
          Pages are found from {listSentence(config.crawlSources.map((source) => source.toLowerCase()))}, on the same domain only. Logout, email and
          phone links are skipped.
        </p>
      </Section>

      <Section title="Output" description="Reports are always written. Screenshots make issues easier to verify.">
        <div className="space-y-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="check mt-0.5" checked={form.screenshots} onChange={(event) => update({ screenshots: event.target.checked })} />
            <span>
              <span className="font-semibold text-ink">Capture screenshots</span>
              <span className="block text-sm text-ink-3">Full page, above the fold, and evidence for each issue, in every viewport.</span>
            </span>
          </label>
          <div className="flex items-start gap-3 text-ink-3">
            <input type="checkbox" className="check mt-0.5" checked disabled aria-label="HTML, JSON and spreadsheet reports, always written" />
            <span>
              <span className="font-semibold">HTML, JSON and spreadsheet reports</span>
              <span className="block text-sm">Always written by the audit engine.</span>
            </span>
          </div>
        </div>
      </Section>

      {submitError && <Alert>{submitError}</Alert>}
      <div className="sticky bottom-0 z-10 -mx-5 flex flex-col gap-3 border-t border-line bg-canvas/95 px-5 py-4 backdrop-blur sm:-mx-8 sm:flex-row sm:items-center sm:justify-end sm:gap-6 sm:px-8">
        <span className="text-ink-2" aria-live="polite">
          {checkCount
            ? `Up to ${(pageLimit * checkCount).toLocaleString()} page checks: ${plural(pageLimit, 'page')} in ${plural(checkCount, 'viewport')}`
            : 'Select at least one viewport'}
        </span>
        <button type="submit" className="btn-primary px-7 py-3 text-base" disabled={submitting || Boolean(config.activeAuditId)}>
          {submitting ? 'Checking the website…' : 'Start audit'}
        </button>
      </div>
    </form>
  );
}

function Required() {
  return (
    <span className="font-normal text-danger" aria-label="required">
      *
    </span>
  );
}

function Optional() {
  return <span className="font-normal text-ink-3">(optional)</span>;
}

/** "a, b and c". */
function listSentence(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Settings-style section: title and explanation on the left, fields on the right. */
function Section({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
      <div className="flex items-start justify-between gap-4 lg:block">
        <div>
          <h2 className="text-lg">{title}</h2>
          {description && <p className="mt-1 text-ink-3">{description}</p>}
        </div>
        {actions && <div className="shrink-0 lg:mt-3">{actions}</div>}
      </div>
      <div className="panel p-6">{children}</div>
    </section>
  );
}

function NumberField({
  id,
  label,
  value,
  max,
  error,
  hint,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  error?: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label} <Required />
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        step={1}
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint`}
      />
      {error ? <p className="field-error">{error}</p> : <p id={`${id}-hint`} className="hint">{hint}</p>}
    </div>
  );
}
