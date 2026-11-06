import { Page } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { createIssue } from '../utils/issueFactory';
import { EvidenceManager } from '../utils/evidence';
import { AuditCheck, AuditIssue, ScreenshotEvidence } from '../utils/types';

interface FilterOption {
  value: string;
  label: string;
}

interface FilterControl {
  name: string;
  label: string;
  options: FilterOption[];
}

interface SearchForm {
  action: string;
  controls: FilterControl[];
  selector: string;
  clearQueryNames: string[];
  submitParams: Array<{ name: string; value: string }>;
}

interface FormInspection {
  forms: SearchForm[];
}

interface ListingRecord {
  id: string;
  text: string;
}

interface ListingSnapshot {
  selector: string;
  records: ListingRecord[];
  reportedTotal: number | null;
  hasPagination: boolean;
  isLoading: boolean;
  emptyState: boolean;
  signature: string;
}

interface FilterCase {
  controls: Array<{ name: string; label: string; value: string; displayValue: string }>;
  expectedIds: string[];
}

export interface SearchFilterAuditResult {
  issues: AuditIssue[];
  checks: AuditCheck[];
  screenshots: ScreenshotEvidence[];
}

const MAX_CASES_PER_PAGE = 10;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesLabeledValue(text: string, label: string, value: string): boolean {
  const expression = new RegExp(
    `(?:^|[\\n\\r|•])\\s*${escapeRegExp(label)}\\s*:\\s*${escapeRegExp(value)}\\s*(?=$|[\\n\\r|•])`,
    'i'
  );
  return expression.test(text);
}

function makeCheck(input: {
  name: string;
  url: string;
  viewport: string;
  result: AuditCheck['result'];
  expected: string;
  actual: string;
  selector?: string;
}): AuditCheck {
  return {
    id: `${input.name}:${input.url}:${input.viewport}`,
    component: 'Functional Search',
    checkName: input.name,
    result: input.result,
    severity: 'High',
    url: input.url,
    viewport: input.viewport,
    expected: input.expected,
    actual: input.actual,
    comment: input.actual,
    selector: input.selector,
    timestamp: new Date().toISOString()
  };
}

export class SearchFilterAudit {
  async run(
    page: Page,
    url: string,
    viewport: string,
    targetName = 'default'
  ): Promise<SearchFilterAuditResult> {
    const result: SearchFilterAuditResult = { issues: [], checks: [], screenshots: [] };
    const inspection = await this.inspectForms(page);
    if (inspection.forms.length === 0) return result;

    for (const form of inspection.forms) {
      const baseUrl = this.makeBaselineUrl(form, url);
      if (!baseUrl) {
        result.checks.push(
          makeCheck({
            name: 'Search/filter functional verification',
            url,
            viewport,
            result: 'NOT_APPLICABLE',
            expected: 'A safe same-origin GET search form with a complete baseline.',
            actual: 'Not verified: the form could not be reduced to a safe baseline URL.',
            selector: form.selector
          })
        );
        continue;
      }

      const baselinePage = await page.context().newPage();
      try {
        const baselineErrors = this.monitorRuntimeErrors(baselinePage);
        const baselineResponse = await baselinePage
          .goto(baseUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 20_000
          })
          .catch(() => null);
        if (!baselineResponse || baselineResponse.status() < 200 || baselineResponse.status() >= 400) {
          result.checks.push(
            makeCheck({
              name: 'Search/filter functional verification',
              url,
              viewport,
              result: 'NOT_APPLICABLE',
              expected: 'A successful unfiltered baseline response.',
              actual: 'Not verified: the unfiltered baseline did not return a successful page response.',
              selector: form.selector
            })
          );
          continue;
        }

        if (!(await this.waitForNetworkIdle(baselinePage))) {
          result.checks.push(
            makeCheck({
              name: 'Search/filter functional verification',
              url,
              viewport,
              result: 'NOT_APPLICABLE',
              expected: 'A baseline page with completed network activity.',
              actual: 'Not verified: baseline network activity did not settle.',
              selector: form.selector
            })
          );
          continue;
        }

        if (baselineErrors.length > 0) {
          result.checks.push(
            makeCheck({
              name: 'Search/filter functional verification',
              url,
              viewport,
              result: 'NOT_APPLICABLE',
              expected: 'A baseline page without failed requests or runtime errors.',
              actual: 'Not verified: the baseline had request failures, HTTP errors, or JavaScript errors.',
              selector: form.selector
            })
          );
          continue;
        }

        const baseline = await this.inspectStableListing(baselinePage, form.controls);
        if (!baseline) {
          result.checks.push(
            makeCheck({
              name: 'Search/filter functional verification',
              url,
              viewport,
              result: 'NOT_APPLICABLE',
              expected: 'A stable baseline listing.',
              actual: 'Not verified: the baseline listing did not stabilize.',
              selector: form.selector
            })
          );
          continue;
        }
        if (baselineErrors.length > 0) {
          result.checks.push(
            makeCheck({
              name: 'Search/filter functional verification',
              url,
              viewport,
              result: 'NOT_APPLICABLE',
              expected: 'A baseline page without failed requests or runtime errors.',
              actual: 'Not verified: the baseline had request failures, HTTP errors, or JavaScript errors.',
              selector: form.selector
            })
          );
          continue;
        }
        if (!this.isCompleteBaseline(baseline)) {
          result.checks.push(
            makeCheck({
              name: 'Search/filter functional verification',
              url,
              viewport,
              result: 'NOT_APPLICABLE',
              expected:
                'A stable baseline with uniquely identifiable records and no contradictory result count.',
              actual: 'Not verified: the baseline records were ambiguous or contradicted its reported total.',
              selector: form.selector
            })
          );
          continue;
        }

        const cases = this.makeCases(form.controls, baseline.records);
        if (cases.length === 0) {
          result.checks.push(
            makeCheck({
              name: 'Search/filter functional verification',
              url,
              viewport,
              result: 'NOT_APPLICABLE',
              expected: 'At least one filter combination verified against labeled baseline records.',
              actual:
                'Not verified: the page records did not unambiguously expose the filter fields and values.',
              selector: form.selector
            })
          );
          continue;
        }

        for (const filterCase of cases) {
          const filteredUrl = this.makeFilteredUrl(form, baseUrl, filterCase.controls);
          if (!filteredUrl) continue;

          const filteredPage = await page.context().newPage();
          try {
            const filteredErrors = this.monitorRuntimeErrors(filteredPage);
            const response = await filteredPage
              .goto(filteredUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 20_000
              })
              .catch(() => null);
            if (!response || response.status() < 200 || response.status() >= 400) {
              result.checks.push(
                makeCheck({
                  name: 'Search/filter functional verification',
                  url,
                  viewport,
                  result: 'NOT_APPLICABLE',
                  expected: 'The filtered request should return a successful response.',
                  actual: `Not verified: filtered request returned ${response?.status() ?? 'no response'}.`,
                  selector: form.selector
                })
              );
              continue;
            }

            if (!(await this.waitForNetworkIdle(filteredPage))) {
              result.checks.push(
                makeCheck({
                  name: 'Search/filter functional verification',
                  url: filteredUrl,
                  viewport,
                  result: 'NOT_APPLICABLE',
                  expected: 'A filtered page with completed network activity.',
                  actual: 'Not verified: filtered network activity did not settle.',
                  selector: form.selector
                })
              );
              continue;
            }

            if (filteredErrors.length > 0) {
              result.checks.push(
                makeCheck({
                  name: 'Search/filter functional verification',
                  url: filteredUrl,
                  viewport,
                  result: 'NOT_APPLICABLE',
                  expected: 'A filtered page without failed requests or runtime errors.',
                  actual:
                    'Not verified: the filtered page had request failures, HTTP errors, or JavaScript errors.',
                  selector: form.selector
                })
              );
              continue;
            }

            const actualUrl = new URL(filteredPage.url());
            const filtersRetained = filterCase.controls.every(
              (control) => actualUrl.searchParams.get(control.name) === control.value
            );
            if (!filtersRetained) {
              result.checks.push(
                makeCheck({
                  name: 'Search/filter functional verification',
                  url: filteredUrl,
                  viewport,
                  result: 'NOT_APPLICABLE',
                  expected: 'The response URL retains the requested filter values.',
                  actual: 'Not verified: navigation redirected or removed one or more requested filters.',
                  selector: form.selector
                })
              );
              continue;
            }

            const filtered = await this.inspectStableListing(filteredPage, form.controls, baseline.selector);
            if (!filtered) {
              result.checks.push(
                makeCheck({
                  name: 'Search/filter functional verification',
                  url,
                  viewport,
                  result: 'NOT_APPLICABLE',
                  expected: 'A stable filtered listing.',
                  actual: 'Not verified: the filtered listing did not stabilize.',
                  selector: form.selector
                })
              );
              continue;
            }
            if (filteredErrors.length > 0) {
              result.checks.push(
                makeCheck({
                  name: 'Search/filter functional verification',
                  url: filteredUrl,
                  viewport,
                  result: 'NOT_APPLICABLE',
                  expected: 'A filtered page without failed requests or runtime errors.',
                  actual:
                    'Not verified: the filtered page had request failures, HTTP errors, or JavaScript errors.',
                  selector: form.selector
                })
              );
              continue;
            }
            if (!this.isCompleteFilteredResult(filtered, filterCase.expectedIds.length)) {
              result.checks.push(
                makeCheck({
                  name: 'Search/filter functional verification',
                  url,
                  viewport,
                  result: 'NOT_APPLICABLE',
                  expected: 'A complete, settled filtered result set.',
                  actual:
                    'Not verified: filtered results were incomplete, unstable, or lacked an explicit total.',
                  selector: form.selector
                })
              );
              continue;
            }

            const actualIds = new Set(filtered.records.map((record) => record.id));
            const filteredRecordsAreConsistent = filtered.records.every((record) =>
              filterCase.controls.every((control) => {
                const option = form.controls
                  .find((candidate) => candidate.name === control.name)
                  ?.options.find((item) => item.value === control.value);
                return Boolean(option && matchesLabeledValue(record.text, control.label, option.label));
              })
            );
            if (filtered.records.length > 0 && !filteredRecordsAreConsistent) {
              result.checks.push(
                makeCheck({
                  name: 'Search/filter functional verification',
                  url: filteredUrl,
                  viewport,
                  result: 'NOT_APPLICABLE',
                  expected: 'Every filtered result exposes the selected labeled filter values.',
                  actual:
                    'Not verified: the filtered records did not independently confirm the selected filters.',
                  selector: form.selector
                })
              );
              continue;
            }
            const missingIds = filterCase.expectedIds.filter((id) => !actualIds.has(id));
            if (missingIds.length === 0) {
              result.checks.push(
                makeCheck({
                  name: 'Search/filter result completeness',
                  url: filteredUrl,
                  viewport,
                  result: 'PASS',
                  expected: `${filterCase.expectedIds.length} known matching record(s) are present.`,
                  actual: `All ${filterCase.expectedIds.length} known matching record(s) were present.`,
                  selector: form.selector
                })
              );
              continue;
            }

            const screenshot =
              auditConfig.screenshotMode === 'off'
                ? null
                : await new EvidenceManager(filteredPage, filteredUrl, viewport, targetName)
                    .captureFullPage(`search-filter-missing-records-${result.issues.length + 1}`)
                    .catch(() => null);
            if (screenshot) result.screenshots.push(screenshot);

            const filters = filterCase.controls.map(({ label, displayValue }) => `${label}=${displayValue}`);
            const details = {
              filters,
              baselineReportedTotal: baseline.reportedTotal,
              baselineRecordCount: baseline.records.length,
              expectedRecordIds: filterCase.expectedIds,
              actualRecordIds: filtered.records.map((record) => record.id),
              missingRecordIds: missingIds,
              filteredReportedTotal: filtered.reportedTotal,
              filteredRecordCount: filtered.records.length,
              paginationPresent: false,
              evidenceSource: 'Unfiltered visible records with matching labeled filter attributes'
            };
            const evidence = screenshot ? [screenshot.path] : undefined;
            const issue = createIssue({
              category: 'Interactions',
              url: filteredUrl,
              viewport,
              selector: form.selector,
              description: 'Search/filter results omit records proven to match the selected filters.',
              severity: 'High',
              evidence,
              expected: `All matching records are returned for ${filters.join(', ')}.`,
              actual: `The filtered listing omitted ${missingIds.length} of ${filterCase.expectedIds.length} known matching record(s).`,
              businessImpact:
                'Users may be unable to find records that match their selected search criteria.',
              suggestedFix:
                'Correct the filter mapping, query construction, or server-side result filtering.',
              details
            });
            result.issues.push(issue);
            result.checks.push(
              makeCheck({
                name: 'Search/filter result completeness',
                url: filteredUrl,
                viewport,
                result: 'FAIL',
                expected: `All ${filterCase.expectedIds.length} known matching record(s) are present.`,
                actual: `The filtered listing omitted ${missingIds.length} proven matching record(s).`,
                selector: form.selector
              })
            );
          } finally {
            await filteredPage.close();
          }
        }
      } finally {
        await baselinePage.close();
      }
    }

    return result;
  }

  private async inspectForms(page: Page): Promise<FormInspection> {
    return page.evaluate(() => {
      const acceptedSubmitText = /\b(search|filter|find|show|apply)\b/i;
      const forms: SearchForm[] = [];
      for (const [formIndex, form] of Array.from(document.forms).entries()) {
        if (form.method.toLowerCase() !== 'get') continue;
        const action = new URL(form.action || location.href, location.href);
        if (action.origin !== location.origin) continue;

        const controls: FilterControl[] = [];
        const clearQueryNames: string[] = [];
        const submitParams: Array<{ name: string; value: string }> = [];
        let safe = true;
        for (const element of Array.from(form.elements)) {
          if (!(element instanceof HTMLElement) || (element as HTMLButtonElement).disabled) continue;
          if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
            const type = (
              element.getAttribute('type') || (element instanceof HTMLButtonElement ? 'submit' : 'text')
            ).toLowerCase();
            if (type === 'reset') continue;
            if (type === 'button') {
              const label = element.textContent || element.value || element.getAttribute('aria-label') || '';
              if (!/\b(reset|clear)\b/i.test(label)) safe = false;
              continue;
            }
            if (type === 'submit') {
              const submitText =
                element.textContent || element.value || element.getAttribute('aria-label') || '';
              if (!acceptedSubmitText.test(submitText)) {
                safe = false;
              } else if (type === 'submit' && element.name) {
                const submitValue =
                  element instanceof HTMLInputElement
                    ? element.value
                    : (element as HTMLButtonElement).value || (element.textContent ?? '').trim();
                if (submitValue) {
                  clearQueryNames.push(element.name);
                  submitParams.push({ name: element.name, value: submitValue });
                }
              }
              continue;
            }
            if (element instanceof HTMLInputElement && ['text', 'search'].includes(type)) {
              if (element.name) clearQueryNames.push(element.name);
              continue;
            }
            safe = false;
            break;
          }
          if (element instanceof HTMLFieldSetElement || element instanceof HTMLLegendElement) continue;
          if (!(element instanceof HTMLSelectElement) || element.multiple || !element.name) {
            safe = false;
            break;
          }
          const associatedLabel = Array.from(element.labels ?? [])
            .map((label) => label.innerText.trim())
            .filter(Boolean)
            .join(' ')
            .trim();
          const ariaLabel = element.getAttribute('aria-label')?.trim() ?? '';
          const label = associatedLabel || ariaLabel;
          if (!label || element.options.length < 2) {
            safe = false;
            break;
          }
          const options = Array.from(element.options)
            .filter((option) => option.value.trim() && option.label.trim())
            .map((option) => ({ value: option.value, label: option.label.trim() }));
          if (options.length < 2) {
            safe = false;
            break;
          }
          clearQueryNames.push(element.name);
          controls.push({ name: element.name, label, options });
        }
        if (
          !safe ||
          controls.length === 0 ||
          new Set(controls.map((control) => control.name)).size !== controls.length
        )
          continue;

        const selector = form.id ? `form#${CSS.escape(form.id)}` : `form:nth-of-type(${formIndex + 1})`;
        forms.push({ action: action.href, controls, selector, clearQueryNames, submitParams });
      }
      return { forms };
    });
  }

  private makeBaselineUrl(form: SearchForm, currentUrl: string): string | null {
    try {
      const baseline = new URL(form.action, currentUrl);
      for (const name of form.clearQueryNames) baseline.searchParams.delete(name);
      return baseline.href;
    } catch {
      return null;
    }
  }

  private makeFilteredUrl(
    form: SearchForm,
    baseUrl: string,
    controls: FilterCase['controls']
  ): string | null {
    try {
      const filtered = new URL(baseUrl);
      for (const param of form.submitParams) filtered.searchParams.set(param.name, param.value);
      for (const control of controls) filtered.searchParams.set(control.name, control.value);
      return filtered.href;
    } catch {
      return null;
    }
  }

  private async inspectStableListing(
    page: Page,
    controls: FilterControl[],
    preferredSelector?: string
  ): Promise<ListingSnapshot | null> {
    let previousSignature: string | undefined;
    let consecutiveStableSamples = 0;
    let latest: ListingSnapshot | undefined;
    for (let sample = 0; sample < 8; sample += 1) {
      await page.waitForTimeout(500);
      latest = await this.inspectListing(page, controls, preferredSelector);
      if (latest.isLoading) {
        previousSignature = undefined;
        consecutiveStableSamples = 0;
        continue;
      }
      if (latest.signature === previousSignature) consecutiveStableSamples += 1;
      else consecutiveStableSamples = 0;
      if (consecutiveStableSamples >= 2) return latest;
      previousSignature = latest.signature;
    }
    return null;
  }

  private async waitForNetworkIdle(page: Page): Promise<boolean> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  private monitorRuntimeErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('requestfailed', (request) => errors.push(`Request failed: ${request.url()}`));
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on('pageerror', (error) => errors.push(`JavaScript error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`Console error: ${message.text()}`);
    });
    return errors;
  }

  private async inspectListing(
    page: Page,
    controls: FilterControl[],
    preferredSelector?: string
  ): Promise<ListingSnapshot> {
    return page.evaluate(
      ({ controls: filterControls, preferredSelector: preferred }) => {
        const visible = (element: HTMLElement): boolean => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) > 0.01
          );
        };
        const readGroup = (selector: string): ListingRecord[] => {
          let elements: HTMLElement[] = [];
          try {
            elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(visible);
          } catch {
            return [];
          }
          return elements
            .map((element) => {
              const text = element.innerText.trim();
              const stableLink = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]'))
                .map((anchor) => {
                  try {
                    const link = new URL(anchor.href, location.href);
                    return link.origin === location.origin ? link.pathname.replace(/\/+$/, '') || '/' : '';
                  } catch {
                    return '';
                  }
                })
                .find(Boolean);
              const heading = element.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim();
              const dataId = element.getAttribute('data-id') || element.getAttribute('data-record-id');
              const id = dataId || stableLink || heading;
              return { id: id?.replace(/\s+/g, ' ').trim() ?? '', text };
            })
            .filter((record) => record.id && record.text.length > 10);
        };

        const allElements = Array.from(document.querySelectorAll<HTMLElement>('article,li,tr,[class]'));
        const groups = new Map<string, HTMLElement[]>();
        for (const element of allElements) {
          if (!visible(element)) continue;
          const isRow = element.tagName === 'TR' && element.parentElement?.tagName === 'TBODY';
          const isArticle = element.tagName === 'ARTICLE';
          const isListItem =
            element.tagName === 'LI' &&
            element.parentElement?.children.length &&
            element.parentElement.children.length > 1;
          const classTokens = Array.from(element.classList).filter((token) =>
            /card|result|listing|property|community|record|entry/i.test(token)
          );
          if (!isRow && !isArticle && !isListItem && classTokens.length === 0) continue;
          const classes = classTokens
            .sort()
            .map((token) => `.${CSS.escape(token)}`)
            .join('');
          const selector = isRow
            ? 'tbody > tr'
            : isArticle
              ? 'article'
              : isListItem
                ? 'li'
                : `${element.tagName.toLowerCase()}${classes}`;
          const group = groups.get(selector) ?? [];
          group.push(element);
          groups.set(selector, group);
        }

        let selector = preferred ?? '';
        let records = selector ? readGroup(selector) : [];
        if (!preferred) {
          const candidates = Array.from(groups.entries())
            .filter(([, elements]) => elements.length >= 2)
            .map(([candidate, elements]) => ({
              selector: candidate,
              records: readGroup(candidate),
              labeledMatches: elements.reduce((count, element) => {
                const text = element.innerText;
                const matches = filterControls.some((control) =>
                  control.options.some((option) => {
                    const expression = new RegExp(
                      `(?:^|[\\n\\r|•])\\s*${control.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*${option.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?=$|[\\n\\r|•])`,
                      'i'
                    );
                    return expression.test(text);
                  })
                );
                return count + Number(matches);
              }, 0)
            }))
            .filter((candidate) => candidate.records.length >= 2 && candidate.labeledMatches >= 2)
            .sort(
              (left, right) =>
                right.labeledMatches - left.labeledMatches || right.records.length - left.records.length
            );
          selector = candidates[0]?.selector ?? '';
          records = candidates[0]?.records ?? [];
        }

        const mainContent = document.querySelector<HTMLElement>('main, [role="main"]');
        const countTexts = Array.from(
          mainContent?.querySelectorAll<HTMLElement>(
            '[class*="result" i], [class*="count" i], [aria-live], [role="status"]'
          ) ?? []
        )
          .filter(visible)
          .map((element) => element.innerText.trim())
          .filter((text) => text.length > 0 && text.length <= 100);
        const countMatch = countTexts
          .map(
            (text) =>
              text.match(
                /^\s*showing\s+\d+\s*(?:-|to)\s*\d+\s+of\s+([\d,]+)(?:\s+(?:results|communities|properties|listings|records|items))?\s*$/i
              ) ?? text.match(/^\s*([\d,]+)\s+(?:results|communities|properties|listings|records|items)\s*$/i)
          )
          .find((match) => match !== null);
        const reportedTotal = countMatch ? Number(countMatch[1].replace(/,/g, '')) : null;
        const hasPagination = Boolean(
          document.querySelector(
            'nav[aria-label*="pagination" i], [class*="pagination" i], a[rel="next"], button[aria-label*="next page" i]'
          )
        );
        const isLoading = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[aria-busy="true"], [role="progressbar"], [class*="loading" i], [class*="spinner" i]'
          )
        ).some(visible);
        const emptyState =
          Boolean(mainContent) &&
          /\b(?:no results(?: found)?|no records(?: found)?|no items found|no communities found|sorry,\s*but nothing matched your search terms)\b/i.test(
            mainContent?.innerText ?? ''
          );
        const signature = JSON.stringify({
          ids: records.map((record) => record.id).sort(),
          reportedTotal,
          emptyState
        });
        return { selector, records, reportedTotal, hasPagination, isLoading, emptyState, signature };
      },
      { controls, preferredSelector }
    );
  }

  private isCompleteBaseline(snapshot: ListingSnapshot): boolean {
    if (
      snapshot.isLoading ||
      !snapshot.selector ||
      snapshot.records.length < 2 ||
      (snapshot.reportedTotal !== null && snapshot.reportedTotal < snapshot.records.length)
    ) {
      return false;
    }
    return new Set(snapshot.records.map((record) => record.id)).size === snapshot.records.length;
  }

  private isCompleteFilteredResult(snapshot: ListingSnapshot, expectedCount: number): boolean {
    if (snapshot.isLoading || snapshot.hasPagination) return false;
    if (snapshot.records.length === 0) {
      return (
        snapshot.emptyState &&
        expectedCount > 0 &&
        (snapshot.reportedTotal === null || snapshot.reportedTotal === 0)
      );
    }
    return (
      snapshot.reportedTotal !== null &&
      snapshot.reportedTotal === snapshot.records.length &&
      new Set(snapshot.records.map((record) => record.id)).size === snapshot.records.length
    );
  }

  private makeCases(controls: FilterControl[], records: ListingRecord[]): FilterCase[] {
    const cases = new Map<string, FilterCase>();
    for (const record of records) {
      const matchedControls = controls
        .map((control) => {
          const matches = control.options.filter((option) =>
            matchesLabeledValue(record.text, control.label, option.label)
          );
          return matches.length === 1
            ? {
                name: control.name,
                label: control.label,
                value: matches[0].value,
                displayValue: matches[0].label
              }
            : null;
        })
        .filter((control): control is NonNullable<typeof control> => control !== null);
      if (matchedControls.length === 0) continue;

      const key = matchedControls
        .map((control) => `${control.name}=${control.value}`)
        .sort()
        .join('&');
      const current = cases.get(key);
      if (current) current.expectedIds.push(record.id);
      else cases.set(key, { controls: matchedControls, expectedIds: [record.id] });
    }

    return Array.from(cases.values())
      .filter((filterCase) => filterCase.expectedIds.length > 0)
      .slice(0, MAX_CASES_PER_PAGE);
  }
}
