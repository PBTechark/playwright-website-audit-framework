import fs from 'fs';
import path from 'path';
import { auditConfig } from '../config/auditConfig';
import { ensureDir, listJsonFiles, readJsonFile, safeFileName, writeJsonFile } from '../utils/fileSystem';
import { sanitizeAuditResultForReporting } from '../utils/reportFilters';
import { AuditIssue, AuditResult } from '../utils/types';
import { isBlockingSeverity, qualityGateLabel } from '../utils/severityGate';

export class HtmlReportGenerator {
  /** Writes every report and returns the reportable results it was built from. */
  async generate(): Promise<AuditResult[]> {
    ensureDir(auditConfig.reportsDir);
    ensureDir(auditConfig.historyDir);
    const results = listJsonFiles(auditConfig.rawResultsDir).map((file) => readJsonFile<AuditResult | null>(file, null));
    const validResults = results
      .filter((result): result is AuditResult => Boolean(result))
      .map(sanitizeAuditResultForReporting);
    const allIssues = validResults.flatMap((result) => result.issues);
    const batchSummary = this.summary(validResults, allIssues);
    const runId = this.createRunId();
    const history = this.saveHistory(runId, batchSummary);

    writeJsonFile(path.join(auditConfig.reportsDir, 'website-audit-report.json'), {
      summary: batchSummary,
      results: validResults
    });
    this.writeExcelReport(auditConfig.reportsDir, 'website-audit-report.xls', validResults, allIssues, batchSummary, runId);
    this.writeBatchSummary(validResults);
    this.writeReport(
      auditConfig.reportsDir,
      'website-audit-report.html',
      'Combined Website Audit Report',
      'All CSV targets',
      validResults,
      allIssues,
      batchSummary,
      { runId, history }
    );
    this.writeReport(
      auditConfig.reportsDir,
      'broken-links-report.html',
      'Combined Broken Links Report',
      'All CSV targets',
      validResults,
      this.filter(allIssues, ['Links']),
      batchSummary,
      { runId, history }
    );
    this.writeReport(
      auditConfig.reportsDir,
      'broken-images-report.html',
      'Combined Broken Images Report',
      'All CSV targets',
      validResults,
      this.filter(allIssues, ['Images']),
      batchSummary,
      { runId, history }
    );
    this.writeReport(
      auditConfig.reportsDir,
      'video-report.html',
      'Combined Video Report',
      'All CSV targets',
      validResults,
      this.filter(allIssues, ['Videos']),
      batchSummary,
      { runId, history }
    );
    this.writeReport(
      auditConfig.reportsDir,
      'responsive-report.html',
      'Combined Responsive Report',
      'All CSV targets',
      validResults,
      this.filter(allIssues, ['Responsive', 'Visual']),
      batchSummary,
      { runId, history }
    );
    this.writeReport(
      auditConfig.reportsDir,
      'performance-report.html',
      'Combined Performance Report',
      'All CSV targets',
      validResults,
      this.filter(allIssues, ['Performance']),
      batchSummary,
      { runId, history }
    );
    this.writeReport(
      auditConfig.reportsDir,
      'accessibility-report.html',
      'Combined Accessibility Report',
      'All CSV targets',
      validResults,
      this.filter(allIssues, ['Accessibility']),
      batchSummary,
      { runId, history }
    );
    this.writeReport(
      auditConfig.reportsDir,
      'seo-report.html',
      'Combined SEO Report',
      'All CSV targets',
      validResults,
      this.filter(allIssues, ['SEO']),
      batchSummary,
      { runId, history }
    );

    for (const [targetName, targetResults] of this.groupByTarget(validResults)) {
      const targetDir = path.join(auditConfig.reportsDir, safeFileName(targetName));
      ensureDir(targetDir);
      const targetIssues = targetResults.flatMap((result) => result.issues);
      const targetSummary = this.summary(targetResults, targetIssues);
      const targetBaseUrl = targetResults[0]?.targetBaseUrl ?? targetResults[0]?.page.targetBaseUrl ?? targetName;

      writeJsonFile(path.join(targetDir, 'website-audit-report.json'), {
        summary: targetSummary,
        results: targetResults
      });
      this.writeExcelReport(targetDir, 'website-audit-report.xls', targetResults, targetIssues, targetSummary, runId);
      this.writeReport(
        targetDir,
        'website-audit-report.html',
        'Website Audit Report',
        targetBaseUrl,
        targetResults,
        targetIssues,
        targetSummary,
        { runId, history }
      );
      this.writeReport(
        targetDir,
        'broken-links-report.html',
        'Broken Links Report',
        targetBaseUrl,
        targetResults,
        this.filter(targetIssues, ['Links']),
        targetSummary,
        { runId, history }
      );
      this.writeReport(
        targetDir,
        'broken-images-report.html',
        'Broken Images Report',
        targetBaseUrl,
        targetResults,
        this.filter(targetIssues, ['Images']),
        targetSummary,
        { runId, history }
      );
      this.writeReport(
        targetDir,
        'video-report.html',
        'Video Report',
        targetBaseUrl,
        targetResults,
        this.filter(targetIssues, ['Videos']),
        targetSummary,
        { runId, history }
      );
      this.writeReport(
        targetDir,
        'responsive-report.html',
        'Responsive Report',
        targetBaseUrl,
        targetResults,
        this.filter(targetIssues, ['Responsive', 'Visual']),
        targetSummary,
        { runId, history }
      );
      this.writeReport(
        targetDir,
        'performance-report.html',
        'Performance Report',
        targetBaseUrl,
        targetResults,
        this.filter(targetIssues, ['Performance']),
        targetSummary,
        { runId, history }
      );
      this.writeReport(
        targetDir,
        'accessibility-report.html',
        'Accessibility Report',
        targetBaseUrl,
        targetResults,
        this.filter(targetIssues, ['Accessibility']),
        targetSummary,
        { runId, history }
      );
      this.writeReport(
        targetDir,
        'seo-report.html',
        'SEO Report',
        targetBaseUrl,
        targetResults,
        this.filter(targetIssues, ['SEO']),
        targetSummary,
        { runId, history }
      );
    }
    return validResults;
  }

  private groupByTarget(results: AuditResult[]): Map<string, AuditResult[]> {
    const grouped = new Map<string, AuditResult[]>();
    for (const result of results) {
      const targetName = result.targetName || result.page.targetName || 'unknown-target';
      grouped.set(targetName, [...(grouped.get(targetName) ?? []), result]);
    }
    return grouped;
  }

  private createRunId(): string {
    return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  }

  private saveHistory(runId: string, summary: Record<string, number | string>): Array<Record<string, number | string>> {
    const historyPath = path.join(auditConfig.historyDir, 'severity-history.json');
    let history: Array<Record<string, number | string>> = [];
    if (fs.existsSync(historyPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf-8')) as unknown;
        if (Array.isArray(parsed)) history = parsed.filter((item): item is Record<string, number | string> => Boolean(item && typeof item === 'object'));
      } catch {
        history = [];
      }
    }
    history.push({
      runId,
      timestamp: new Date().toISOString(),
      totalIssues: summary.totalIssues,
      criticalIssues: summary.criticalIssues,
      highIssues: summary.highIssues,
      mediumIssues: summary.mediumIssues,
      lowIssues: summary.lowIssues,
      healthScore: summary.healthScore
    });
    const retained = history.slice(-auditConfig.historyRetention);
    fs.writeFileSync(historyPath, JSON.stringify(retained, null, 2), 'utf-8');
    return retained;
  }

  private chartBars(items: Array<[string, number | string, string]>): string {
    const maximum = Math.max(1, ...items.map(([, value]) => Number(value)));
    return `<div class="bar-chart">${items
      .map(([label, value, tone]) => {
        const width = Number(value) ? Math.max(2, (Number(value) / maximum) * 100) : 0;
        return `<button type="button" class="bar-row" data-filter-severity="${this.escapeAttr(label)}" title="Show ${this.escapeAttr(label.toLowerCase())} issues"><span class="bar-label"><i class="sev-mark ${tone}" aria-hidden="true"></i>${this.escape(label)}</span><span class="bar-track"><i class="bar-fill ${tone}" style="width:${width}%"></i></span><strong>${this.escape(value)}</strong></button>`;
      })
      .join('')}</div>`;
  }

  private trendBars(history: Array<Record<string, number | string>>): string {
    if (!history.length) return '<p class="empty-chart">No earlier runs yet. Run another audit to compare.</p>';
    const maximum = Math.max(1, ...history.map((item) => Number(item.totalIssues ?? 0)));
    return `<div class="trend-chart">${history
      .map((item) => {
        const total = Number(item.totalIssues ?? 0);
        const runId = String(item.runId ?? '');
        const when = runId.length >= 12 ? `${runId.slice(6, 8)}/${runId.slice(4, 6)} ${runId.slice(8, 10)}:${runId.slice(10, 12)}` : runId;
        return `<div class="trend-column" title="${this.escapeAttr(`Run ${runId}: ${total} issues`)}"><span class="trend-value">${total}</span><i style="height:${Math.max(4, (total / maximum) * 100)}%"></i><span class="trend-label">${this.escape(when)}</span></div>`;
      })
      .join('')}</div>`;
  }

  private chartTable(summary: Record<string, number | string>): string {
    return `${this.escape(summary.totalIssues ?? 0)} in total: ${['criticalIssues', 'highIssues', 'mediumIssues', 'lowIssues']
      .map((key) => `${this.escape(summary[key] ?? 0)} ${this.escape(this.label(key).replace(/ issues$/, ''))}`)
      .join(', ')}.`;
  }

  private pageRows(results: AuditResult[]): string {
    const pages = new Map<string, { target: string; issues: AuditIssue[]; viewports: Set<string> }>();
    for (const result of results) {
      const current = pages.get(result.page.url) ?? { target: result.targetName || result.page.targetName, issues: [], viewports: new Set<string>() };
      current.issues.push(...result.issues);
      current.viewports.add(result.viewport);
      pages.set(result.page.url, current);
    }
    return Array.from(pages.entries()).map(([url, page]) => {
      const highest = page.issues.reduce<AuditIssue['severity'] | 'Pass'>((current, issue) => {
        const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 } as Record<AuditIssue['severity'], number>;
        return current === 'Pass' || (issue.severity !== 'Low' && rank[issue.severity] < rank[current as AuditIssue['severity']]) ? issue.severity : current;
      }, 'Pass');
      return `<button type="button" class="page-card" data-filter-page="${this.escapeAttr(url)}" data-search="${this.escapeAttr(`${url} ${page.target}`)}" title="Show the issues on this page">
        <span class="page-card-head"><span class="severity-badge ${highest}">${highest === 'Pass' ? '' : `<i class="sev-mark ${highest.toLowerCase()}" aria-hidden="true"></i>`}${highest === 'Pass' ? 'No issues' : `Highest: ${this.escape(highest)}`}</span><span class="page-count">${this.plural(page.issues.length, 'finding')}</span></span>
        <span class="page-title">${this.escape(page.target)}</span>
        <span class="page-url">${this.escape(url)}</span>
        <span class="page-meta">${this.plural(page.viewports.size, 'viewport')} audited.<span class="screen-only"> Show this page's issues</span></span>
      </button>`;
    }).join('') || '<div class="empty-state">No audited pages were produced.</div>';
  }

  private filter(issues: AuditIssue[], categories: string[]): AuditIssue[] {
    return issues.filter((issue) => categories.includes(issue.category));
  }

  private summary(results: AuditResult[], issues: AuditIssue[]): Record<string, number | string> {
    const pages = new Set(results.map((result) => result.page.url)).size;
    const targets = new Set(results.map((result) => result.targetName || result.page.targetName)).size;
    const weighted = issues.reduce((score, issue) => {
      const penalty = issue.severity === 'Critical' ? 15 : issue.severity === 'High' ? 10 : issue.severity === 'Medium' ? 5 : 2;
      return score - penalty;
    }, 100);
    const healthScore = Math.max(0, Math.min(100, weighted));
    const status = healthScore >= 90 ? 'Excellent' : healthScore >= 75 ? 'Healthy' : healthScore >= 50 ? 'Warning' : 'Needs Attention';
    return {
      targets,
      pagesCrawled: pages,
      viewportExecutions: results.length,
      totalIssues: issues.length,
      criticalIssues: issues.filter((issue) => issue.severity === 'Critical').length,
      highIssues: issues.filter((issue) => issue.severity === 'High').length,
      mediumIssues: issues.filter((issue) => issue.severity === 'Medium').length,
      lowIssues: issues.filter((issue) => issue.severity === 'Low').length,
      healthScore,
      status
    };
  }

  private writeBatchSummary(results: AuditResult[]): void {
    const rows = Array.from(this.groupByTarget(results)).map(([targetName, targetResults]) => {
      const issues = targetResults.flatMap((result) => result.issues);
      const summary = this.summary(targetResults, issues);
      const targetDir = safeFileName(targetName);
      return {
        targetName,
        targetBaseUrl: targetResults[0]?.targetBaseUrl ?? targetResults[0]?.page.targetBaseUrl ?? '',
        summary,
        reportPath: `${targetDir}/website-audit-report.html`
      };
    });

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Batch Website Audit Summary</title>
  ${this.styles()}
</head>
<body>
  <header>
    <h1>Batch Website Audit Summary</h1>
    <div>Generated ${new Date().toISOString()} from ${this.escape(auditConfig.targetsCsvPath)}</div>
  </header>
  <main>
    <table>
      <thead>
        <tr><th>Target</th><th>Base URL</th><th>Pages</th><th>Executions</th><th>Total</th><th>Critical</th><th>High</th><th>Medium</th><th>Low</th><th>Report</th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
              <td>${this.escape(row.targetName)}</td>
              <td><a href="${this.escapeAttr(row.targetBaseUrl)}">${this.escape(row.targetBaseUrl)}</a></td>
              <td>${row.summary.pagesCrawled}</td>
              <td>${row.summary.viewportExecutions}</td>
              <td>${row.summary.totalIssues}</td>
              <td>${row.summary.criticalIssues}</td>
              <td>${row.summary.highIssues}</td>
              <td>${row.summary.mediumIssues}</td>
              <td>${row.summary.lowIssues}</td>
              <td><a href="${this.escapeAttr(row.reportPath)}">Open</a></td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </main>
</body>
</html>`;
    fs.writeFileSync(path.join(auditConfig.reportsDir, 'batch-summary.html'), html, 'utf-8');
  }

  private writeReport(
    outputDir: string,
    fileName: string,
    title: string,
    targetLabel: string,
    results: AuditResult[],
    issues: AuditIssue[],
    summary: Record<string, number | string>,
    metadata: { runId: string; history: Array<Record<string, number | string>> }
  ): void {
    ensureDir(outputDir);
    const orderedIssues = [...issues].sort(
      (left, right) => this.severityRank(left.severity) - this.severityRank(right.severity)
    );
    const blockingCount = issues.filter((issue) =>
      isBlockingSeverity(issue.severity, auditConfig.qualityGateSeverity)
    ).length;
    const gateEnabled = auditConfig.qualityGateSeverity !== 'Off';
    const gateFailed = gateEnabled && blockingCount > 0;
    // Page executions are numbered so issue cards can link to the row for each viewport.
    const executionIndex = new Map(results.map((result, index) => [`${result.page.url}\u0000${result.viewport}`, index] as const));
    const groups = this.groupIssues(orderedIssues);
    const issueMarkup = groups.length
      ? groups.map((group, index) => this.issueGroupHtml(group, index, outputDir, results, executionIndex)).join('')
      : '<div class="empty-state">No issues matched the current report scope.</div>';

    const severityKeys: Record<string, AuditIssue['severity']> = {
      criticalIssues: 'Critical',
      highIssues: 'High',
      mediumIssues: 'Medium',
      lowIssues: 'Low'
    };
    const summaryCards = Object.entries(summary)
      .map(([key, value]) => {
        const severity = severityKeys[key];
        const href = key === 'viewportExecutions' ? '#executions' : key === 'targets' || key === 'pagesCrawled' ? '#pages' : '#issues';
        const action = severity ? ` data-filter-severity="${severity}"` : key === 'totalIssues' ? ' data-reset-filters' : '';
        const hint = severity
          ? `Show ${severity.toLowerCase()} issues`
          : href === '#pages'
            ? 'Go to audited pages'
            : href === '#executions'
              ? 'Go to page executions'
              : 'Go to issues';
        return `<a class="metric${key === 'status' ? ' metric-status' : ''}" href="${href}"${action}><span class="metric-label">${severity ? `<i class="sev-mark ${severity.toLowerCase()}" aria-hidden="true"></i>` : ''}${this.escape(this.label(key))}</span><strong class="metric-value">${this.escape(value)}${key === 'healthScore' ? '<small> / 100</small>' : ''}</strong><span class="metric-hint">${hint}</span></a>`;
      })
      .join('');
    const pageRows = this.pageRows(results);
    const severityChart = this.chartBars([
      ['Critical', summary.criticalIssues ?? 0, 'critical'],
      ['High', summary.highIssues ?? 0, 'high'],
      ['Medium', summary.mediumIssues ?? 0, 'medium'],
      ['Low', summary.lowIssues ?? 0, 'low']
    ]);
    const trendChart = this.trendBars(metadata.history);
    const categories = Array.from(new Set(orderedIssues.map((issue) => issue.category)));
    const viewports = Array.from(new Set(results.map((result) => result.viewport)));
    const generated = new Date().toISOString().replace('T', ' ').slice(0, 16);

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${this.escape(title)}</title>
  ${this.styles()}
</head>
<body>
  <a class="skip-link" href="#issues">Skip to issues</a>
  <header class="report-header">
    <div class="wrap header-top">
      <div class="brand"><span class="logo" aria-hidden="true">WA</span><span>Website audit report</span></div>
      <div class="header-actions">
        <a id="downloadPdf" class="button button-light" href="#">Download PDF</a>
        <span class="theme-switch">
          <span id="themeLabel">Dark theme</span>
          <button type="button" id="themeToggle" role="switch" aria-checked="false" aria-labelledby="themeLabel"><span class="knob"></span></button>
        </span>
      </div>
    </div>
    <div class="wrap header-title">
      <h1>${this.escape(title)}</h1>
      <p>${this.escape(targetLabel)}. Run ${this.escape(metadata.runId)}, generated ${this.escape(generated)} UTC.</p>
    </div>
  </header>

  <nav class="section-nav" aria-label="Report sections">
    <div class="wrap">
      <a href="#summary">Summary</a>
      <a href="#pages">Audited pages</a>
      <a href="#issues">Issues <span class="nav-count" id="navIssueCount">${groups.length}</span></a>
      <a href="#executions">Page executions</a>
    </div>
  </nav>

  <main class="wrap">
    <section id="summary" class="section">
      <div class="section-heading"><h2>Summary</h2><p class="screen-only">Select any figure to jump to the matching part of the report.</p></div>
      <div class="summary-grid">${summaryCards}</div>
      <div class="insights-grid">
        <article class="panel">
          <h3>Issues by severity</h3>
          ${severityChart}
          <p class="chart-note">${this.chartTable(summary)}<span class="screen-only"> Select a row to see those issues.</span></p>
        </article>
        <article class="panel">
          <h3>Issues over recent runs</h3>
          ${trendChart}
          ${metadata.history.length ? `<p class="chart-note">${metadata.history.length > 1 ? 'Total issues in each recent audit run, oldest first.' : 'Run another audit to establish a historical comparison.'}</p>` : ''}
        </article>
      </div>
      <div class="status-panel ${gateEnabled ? (gateFailed ? 'failed' : 'passed') : 'off'}" role="status">
        <strong>${gateEnabled ? (gateFailed ? 'Quality gate failed' : 'Quality gate passed') : 'Quality gate disabled'}</strong>
        <span>${
          gateEnabled
            ? (gateFailed
                ? `${blockingCount} ${this.escape(qualityGateLabel(auditConfig.qualityGateSeverity))} finding(s) require attention.`
                : `No ${this.escape(qualityGateLabel(auditConfig.qualityGateSeverity))} findings were detected.`)
            : 'Set AUDIT_FAIL_ON_SEVERITY to Medium, High, or Critical to enable final audit gating.'
        }</span>
      </div>
    </section>

    <section id="pages" class="section">
      <div class="section-heading"><h2>Audited pages</h2><p class="screen-only">Select a page to see only its issues.</p></div>
      <div class="page-grid">${pageRows}</div>
    </section>

    <section id="issues" class="section">
      <div class="section-heading"><h2>Issues</h2><p>The same problem found in several viewports is listed once, with every viewport it affects.</p></div>
      <div class="toolbar panel">
        <div class="field"><label for="severityFilter">Severity</label>
          <select id="severityFilter"><option value="all">All severities</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select></div>
        <div class="field"><label for="categoryFilter">Category</label>
          <select id="categoryFilter"><option value="all">All categories</option>${categories.map((category) => `<option value="${this.escapeAttr(category)}">${this.escape(category)}</option>`).join('')}</select></div>
        <div class="field"><label for="viewportFilter">Viewport</label>
          <select id="viewportFilter"><option value="all">All viewports</option>${viewports.map((viewport) => `<option value="${this.escapeAttr(viewport)}">${this.escape(viewport)}</option>`).join('')}</select></div>
        <div class="field field-wide"><label for="searchInput">Search</label>
          <input id="searchInput" type="search" placeholder="URL, issue or selector" /></div>
        <div class="toolbar-actions">
          <button type="button" class="button" id="resetFilters">Reset filters</button>
          <button type="button" class="button" id="toggleAll">Collapse all</button>
          <button type="button" class="button" id="exportJson">Export JSON</button>
          <a class="button" href="website-audit-report.xls" download>Export Excel</a>
        </div>
      </div>
      <div class="result-bar"><p id="visibleCount" aria-live="polite"></p><div id="activeFilters" class="active-filters"></div></div>
      <div class="issue-list">${issueMarkup}</div>
    </section>

    <section id="executions" class="section">
      <div class="section-heading"><h2>Page executions</h2><p>Each row is one page checked in one viewport.<span class="screen-only"> Select a findings count to see those issues.</span></p></div>
      <div class="table-wrap panel">
        <table class="exec-table">
          <thead><tr><th scope="col">Target</th><th scope="col">Page</th><th scope="col">Viewport</th><th scope="col">Screen resolution</th><th scope="col">Findings</th><th scope="col">Load</th><th scope="col">Screenshots</th></tr></thead>
          <tbody>
            ${results
              .map(
                (result, index) => `<tr id="exec-${index}" data-viewport="${this.escapeAttr(result.viewport)}">
                  <td>${this.escape(result.targetName || result.page.targetName)}</td>
                  <td class="cell-url"><a href="${this.escapeAttr(result.page.url)}" target="_blank" rel="noopener noreferrer">${this.escape(result.page.url)}</a></td>
                  <td>${this.escape(result.viewport)}</td>
                  <td>${this.resolutionHtml(result.resolution)}</td>
                  <td><button type="button" class="link-button" data-filter-page="${this.escapeAttr(result.page.url)}" data-filter-viewport="${this.escapeAttr(result.viewport)}">${this.plural(result.issues.length, 'finding')}</button></td>
                  <td class="nowrap">${result.performance?.loadTimeMs !== undefined ? `${Math.round(result.performance.loadTimeMs)} ms` : 'Not measured'}</td>
                  <td><div class="shot-links">${result.screenshots
                    .map((shot) => `<button type="button" class="chip-button" data-evidence-src="${this.escapeAttr(this.assetHref(outputDir, shot.path))}" data-evidence-type="image" data-evidence-title="${this.escapeAttr(`${result.viewport}: ${this.screenshotLabel(shot.label)}`)}">${this.escape(this.screenshotLabel(shot.label))}</button>`)
                    .join('')}</div></td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <div id="evidenceModal" class="modal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-content">
      <div class="modal-header"><h3 id="modalTitle"></h3><button class="button modal-close" type="button">Close</button></div>
      <div id="modalBody" class="modal-media"></div>
    </div>
  </div>

  <script>
  (function () {
    var root = document.documentElement;
    var reportRunId = '${this.escapeAttr(metadata.runId)}';
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function scrollToId(id) {
      var target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }

    // Theme switch: follows the system until the reader chooses, then remembers the choice.
    var themeToggle = document.getElementById('themeToggle');
    function setTheme(theme, remember) {
      root.dataset.theme = theme;
      themeToggle.setAttribute('aria-checked', String(theme === 'dark'));
      if (remember) { try { localStorage.setItem('audit-theme', theme); } catch (error) {} }
    }
    var savedTheme = null;
    try { savedTheme = localStorage.getItem('audit-theme'); } catch (error) {}
    setTheme(savedTheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), false);
    themeToggle.addEventListener('click', function () { setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true); });

    // Download PDF: served from the dashboard, the backend renders the PDF; opened as a file, the print dialog saves one.
    var pdfLink = document.getElementById('downloadPdf');
    var apiAt = location.pathname.indexOf('/api/audits/');
    var filesAt = location.pathname.indexOf('/files/');
    if (location.protocol.indexOf('http') === 0 && apiAt !== -1 && filesAt > apiAt) {
      pdfLink.href = location.pathname.slice(0, filesAt) + '/report.pdf?path=' + encodeURIComponent(decodeURIComponent(location.pathname.slice(filesAt + 7)));
    } else {
      pdfLink.title = 'Opens the print dialog. Choose Save as PDF.';
      pdfLink.addEventListener('click', function (event) { event.preventDefault(); window.print(); });
    }

    // Filters
    var severityFilter = document.getElementById('severityFilter');
    var categoryFilter = document.getElementById('categoryFilter');
    var viewportFilter = document.getElementById('viewportFilter');
    var searchInput = document.getElementById('searchInput');
    var activeFilters = document.getElementById('activeFilters');
    var visibleCount = document.getElementById('visibleCount');
    var navIssueCount = document.getElementById('navIssueCount');
    var issueCards = Array.prototype.slice.call(document.querySelectorAll('.issue'));
    var pageFilter = '';

    function applyFilters() {
      var severity = severityFilter.value;
      var category = categoryFilter.value;
      var viewport = viewportFilter.value;
      var query = (searchInput.value || '').trim().toLowerCase();
      var shown = 0;
      issueCards.forEach(function (card) {
        var match = (severity === 'all' || card.dataset.severity === severity) &&
          (category === 'all' || card.dataset.category === category) &&
          (viewport === 'all' || (card.dataset.viewports || '').indexOf('|' + viewport + '|') !== -1) &&
          (!pageFilter || card.dataset.page === pageFilter) &&
          (!query || (card.dataset.search || '').toLowerCase().indexOf(query) !== -1);
        card.hidden = !match;
        if (match) shown += 1;
      });
      // Screenshots of other viewports are hidden too, so a viewport filter never shows another viewport's evidence.
      document.querySelectorAll('[data-viewport]').forEach(function (element) {
        element.hidden = viewport !== 'all' && element.getAttribute('data-viewport') !== viewport;
      });
      var filtered = shown !== issueCards.length;
      visibleCount.textContent = filtered
        ? 'Showing ' + shown + ' of ' + issueCards.length + ' issues.'
        : issueCards.length + (issueCards.length === 1 ? ' issue.' : ' issues.');
      navIssueCount.textContent = String(shown);
      activeFilters.textContent = '';
      if (pageFilter) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'filter-chip';
        chip.textContent = 'Page: ' + pageFilter + '  (remove)';
        chip.addEventListener('click', function () { pageFilter = ''; applyFilters(); });
        activeFilters.appendChild(chip);
      }
    }

    function resetFilters() {
      severityFilter.value = 'all'; categoryFilter.value = 'all'; viewportFilter.value = 'all'; searchInput.value = ''; pageFilter = '';
    }

    [severityFilter, categoryFilter, viewportFilter, searchInput].forEach(function (element) {
      element.addEventListener('input', applyFilters);
      element.addEventListener('change', applyFilters);
    });
    document.getElementById('resetFilters').addEventListener('click', function () { resetFilters(); applyFilters(); });

    // Connected components: figures, bars, page cards and table rows filter the issue list and jump to it.
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-filter-severity], [data-filter-page], [data-reset-filters]');
      if (!trigger) return;
      event.preventDefault();
      resetFilters();
      if (trigger.hasAttribute('data-filter-severity')) severityFilter.value = trigger.getAttribute('data-filter-severity');
      if (trigger.hasAttribute('data-filter-page')) pageFilter = trigger.getAttribute('data-filter-page');
      if (trigger.hasAttribute('data-filter-viewport')) viewportFilter.value = trigger.getAttribute('data-filter-viewport');
      applyFilters();
      scrollToId('issues');
    });

    // Expand or collapse every issue card.
    var toggleAll = document.getElementById('toggleAll');
    toggleAll.addEventListener('click', function () {
      var open = toggleAll.textContent === 'Expand all';
      document.querySelectorAll('.issue > details').forEach(function (details) { details.open = open; });
      toggleAll.textContent = open ? 'Collapse all' : 'Expand all';
    });
    window.addEventListener('beforeprint', function () {
      document.querySelectorAll('.issue > details').forEach(function (details) { details.open = true; });
    });

    // Copy buttons
    function copyText(text, button) {
      function done() {
        var original = button.textContent;
        button.textContent = 'Copied';
        window.setTimeout(function () { button.textContent = original; }, 1400);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
        return;
      }
      var area = document.createElement('textarea');
      area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select();
      if (document.execCommand('copy')) done();
      area.remove();
    }
    document.querySelectorAll('[data-copy-text]').forEach(function (button) {
      button.addEventListener('click', function () { copyText(button.getAttribute('data-copy-text') || '', button); });
    });

    // Export the issues that are currently shown.
    document.getElementById('exportJson').addEventListener('click', function () {
      var findings = issueCards.filter(function (card) { return !card.hidden; }).map(function (card) {
        return {
          ids: (card.dataset.ids || '').split(' ').filter(Boolean),
          severity: card.dataset.severity, category: card.dataset.category, page: card.dataset.page,
          viewports: (card.dataset.viewports || '').split('|').filter(Boolean),
          issue: card.dataset.title, recommendation: card.dataset.fix, runId: reportRunId
        };
      });
      var blob = new Blob([JSON.stringify({ runId: reportRunId, issues: findings }, null, 2)], { type: 'application/json' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = 'website-audit-filtered.json'; link.click();
      URL.revokeObjectURL(link.href);
    });

    // Evidence viewer. Titles are set as text so crawled content can never become markup.
    var modal = document.getElementById('evidenceModal');
    var modalTitle = document.getElementById('modalTitle');
    var modalBody = document.getElementById('modalBody');
    var lastTrigger = null;
    function openEvidence(trigger) {
      lastTrigger = trigger;
      var media = document.createElement(trigger.getAttribute('data-evidence-type') === 'video' ? 'video' : 'img');
      media.src = trigger.getAttribute('data-evidence-src') || '';
      if (media.tagName === 'VIDEO') { media.controls = true; media.muted = true; media.playsInline = true; }
      else media.alt = trigger.getAttribute('data-evidence-title') || 'Evidence';
      modalTitle.textContent = trigger.getAttribute('data-evidence-title') || 'Evidence';
      modalBody.textContent = '';
      modalBody.appendChild(media);
      modal.classList.add('visible');
      modal.setAttribute('aria-hidden', 'false');
      modal.querySelector('.modal-close').focus();
    }
    function closeEvidence() {
      if (!modal.classList.contains('visible')) return;
      modal.classList.remove('visible');
      modal.setAttribute('aria-hidden', 'true');
      modalBody.textContent = '';
      if (lastTrigger) lastTrigger.focus();
    }
    document.querySelectorAll('[data-evidence-src]').forEach(function (button) {
      button.addEventListener('click', function () { openEvidence(button); });
    });
    modal.querySelector('.modal-close').addEventListener('click', closeEvidence);
    modal.addEventListener('click', function (event) { if (event.target === modal) closeEvidence(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeEvidence(); });

    applyFilters();
  })();
  </script>
</body>
</html>`;
    fs.writeFileSync(path.join(outputDir, fileName), html, 'utf-8');
  }

  /** The engine reports each page/viewport pair separately; one card per problem keeps the report readable. */
  private groupIssues(issues: AuditIssue[]): AuditIssue[][] {
    const groups = new Map<string, AuditIssue[]>();
    for (const issue of issues) {
      const key = [issue.severity, issue.category, issue.url, issue.description].join('\u0000');
      groups.set(key, [...(groups.get(key) ?? []), issue]);
    }
    return Array.from(groups.values());
  }

  private issueGroupHtml(
    group: AuditIssue[],
    index: number,
    outputDir: string,
    results: AuditResult[],
    executionIndex: Map<string, number>
  ): string {
    const first = group[0];
    const viewports = Array.from(new Set(group.map((issue) => issue.viewport)));
    const selectors = Array.from(new Set(group.map((issue) => issue.selector).filter((value): value is string => Boolean(value))));
    const { title, summary } = this.splitTitle(first.description);
    const expected = first.expected ?? `No ${first.category.toLowerCase()} defect should be present.`;
    const actual = this.splitMeasuredDetails(first.actual ?? first.description);
    const where = viewports.length <= 2 ? viewports.join(' and ') : `${viewports.length} viewports`;
    const severityClass = first.severity.toLowerCase();
    const search = group
      .map((issue) => `${issue.category} ${issue.severity} ${issue.url} ${issue.viewport} ${issue.description} ${issue.selector ?? ''} ${issue.id}`)
      .join(' ');

    const viewportLinks = viewports
      .map((viewport) => {
        const row = executionIndex.get(`${first.url}\u0000${viewport}`);
        return row === undefined
          ? `<span class="chip">${this.escape(viewport)}</span>`
          : `<a class="chip" href="#exec-${row}" title="Go to this page execution">${this.escape(viewport)}</a>`;
      })
      .join('');

    // One evidence row per viewport; a viewport can hold several findings of this issue (one per selector).
    const evidenceByViewport = new Map<string, ReturnType<HtmlReportGenerator['issueEvidence']>>();
    for (const issue of group) {
      const items = evidenceByViewport.get(issue.viewport) ?? [];
      for (const item of this.issueEvidence(issue, outputDir, results)) {
        if (!items.some((existing) => existing.href === item.href)) items.push(item);
      }
      evidenceByViewport.set(issue.viewport, items);
    }
    const evidence = Array.from(evidenceByViewport.entries())
      .filter(([, items]) => items.length > 0)
      .map(([viewport, items]) => {
        return `<div class="evidence-group" data-viewport="${this.escapeAttr(viewport)}"><h5>${this.escape(viewport)}</h5><div class="evidence-list">${items
          .map((item) => {
            const caption = `${title}, ${viewport}`;
            const size = item.width && item.height ? `, ${item.width} × ${item.height} px` : '';
            const original = item.sourceHref
              ? `<button type="button" class="link-button" data-evidence-src="${this.escapeAttr(item.sourceHref)}" data-evidence-type="image" data-evidence-title="${this.escapeAttr(`Original screenshot: ${caption}`)}">Original</button>`
              : '';
            return item.video
              ? `<button type="button" class="thumb thumb-video" data-evidence-src="${this.escapeAttr(item.href)}" data-evidence-type="video" data-evidence-title="${this.escapeAttr(caption)}"><span class="thumb-play">Play video</span><span class="thumb-label">${this.escape(item.label)}</span></button>`
              : `<span class="thumb-wrap"><button type="button" class="thumb" data-evidence-src="${this.escapeAttr(item.href)}" data-evidence-type="image" data-evidence-title="${this.escapeAttr(caption)}"><img src="${this.escapeAttr(item.href)}" alt="${this.escapeAttr(`${item.label}: ${caption}`)}" loading="lazy"><span class="thumb-label">${this.escape(item.label + size)}</span></button>${original}</span>`;
          })
          .join('')}</div></div>`;
      })
      .join('');

    const findingRows = group
      .map(
        (issue) => `<tr><td><code>${this.escape(issue.id)}</code></td><td>${this.escape(issue.viewport)}</td><td>${this.escape(issue.browser ?? 'Chromium')}</td><td>${this.escape(issue.device ?? issue.viewport)}</td><td>${this.escape(issue.resolution?.label ?? 'Not recorded')}</td><td>${this.escape(issue.timestamp ?? 'Not recorded')}</td></tr>`
      )
      .join('');
    const technical = group
      .filter((issue) => issue.details)
      .map((issue) => `<h5>${this.escape(issue.viewport)}</h5><pre>${this.escape(JSON.stringify(issue.details, null, 2))}</pre>`)
      .join('');

    return `<article class="issue sev-${severityClass}" id="issue-${index + 1}" data-severity="${this.escapeAttr(first.severity)}" data-category="${this.escapeAttr(first.category)}" data-viewports="|${this.escapeAttr(viewports.join('|'))}|" data-page="${this.escapeAttr(first.url)}" data-ids="${this.escapeAttr(group.map((issue) => issue.id).join(' '))}" data-title="${this.escapeAttr(first.description)}" data-fix="${this.escapeAttr(first.suggestedFix)}" data-search="${this.escapeAttr(search)}">
      <details open>
        <summary>
          <span class="severity-badge ${this.escapeAttr(first.severity)}"><i class="sev-mark ${severityClass}" aria-hidden="true"></i>${this.escape(first.severity)}</span>
          <span class="issue-heading"><span class="issue-title">${this.escape(title)}</span><span class="issue-sub">${this.escape(first.category)} issue in ${this.escape(where)}</span></span>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="issue-body">
          <div class="issue-intro">
            ${summary ? `<p>${this.escape(summary)}</p>` : ''}
            <button type="button" class="copy-button" data-copy-text="${this.escapeAttr(first.description)}">Copy title</button>
          </div>
          <div class="fix"><strong>How to fix</strong><p>${this.escape(first.suggestedFix)}</p></div>
          <dl class="compare">
            <div><dt>Expected</dt><dd>${this.escape(expected)}</dd></div>
            <div><dt>Actual</dt><dd>${this.escape(actual.text)}</dd></div>
          </dl>
          ${actual.details ? `<div class="block"><h4>Measured details</h4><pre>${this.escape(actual.details)}</pre></div>` : ''}
          <div class="block">
            <h4>${selectors.length > 1 ? `Selectors (${selectors.length})` : 'Selector'}</h4>
            ${(selectors.length ? selectors : ['page'])
              .map((selector) => `<div class="code-row"><code>${this.escape(selector)}</code><button type="button" class="copy-button" data-copy-text="${this.escapeAttr(selector)}">Copy</button></div>`)
              .join('')}
          </div>
          <dl class="facts">
            <div><dt>Page</dt><dd><a href="${this.escapeAttr(first.url)}" target="_blank" rel="noopener noreferrer">${this.escape(first.url)}</a> <button type="button" class="copy-button" data-copy-text="${this.escapeAttr(first.url)}">Copy</button> <button type="button" class="link-button" data-filter-page="${this.escapeAttr(first.url)}">Only this page</button></dd></div>
            <div><dt>Target</dt><dd>${this.escape(first.targetName ?? 'N/A')}</dd></div>
            <div><dt>Viewports</dt><dd class="chips">${viewportLinks}</dd></div>
          </dl>
          ${this.buttonDiagnosticHtml(first)}
          ${evidence ? `<div class="block"><h4>Evidence</h4>${evidence}</div>` : ''}
          <details class="more">
            <summary>Browser and finding details (${this.plural(group.length, 'finding')})</summary>
            <div class="table-wrap"><table><thead><tr><th scope="col">ID</th><th scope="col">Viewport</th><th scope="col">Browser</th><th scope="col">Device</th><th scope="col">Resolution</th><th scope="col">Timestamp</th></tr></thead><tbody>${findingRows}</tbody></table></div>
            ${technical ? `<h4>Technical details</h4>${technical}` : ''}
          </details>
        </div>
      </details>
    </article>`;
  }

  private issueEvidence(
    issue: AuditIssue,
    outputDir: string,
    results: AuditResult[]
  ): Array<{ href: string; sourceHref?: string; label: string; video: boolean; width?: number; height?: number }> {
    const fallbackEvidence =
      results.find(
        (result) =>
          result.page.url === issue.url &&
          result.viewport === issue.viewport &&
          (!issue.targetName || issue.targetName === result.targetName || issue.targetName === result.page.targetName)
      )?.screenshots ?? [];
    const issueEvidence = issue.evidenceDetails ?? [];
    const evidencePaths = this.uniquePaths(
      issue.evidence?.length ? issue.evidence : issue.category === 'Buttons' ? [] : fallbackEvidence.map((item) => item.path)
    );
    return evidencePaths.map((evidencePath) => {
      const metadata = issueEvidence.find((item) => item.path === evidencePath) ?? fallbackEvidence.find((item) => item.path === evidencePath);
      const video = /\.(mp4|webm|mov|ogg)$/i.test(evidencePath);
      return {
        href: this.assetHref(outputDir, evidencePath),
        sourceHref: metadata?.sourcePath ? this.assetHref(outputDir, metadata.sourcePath) : undefined,
        label: video ? 'Video' : metadata?.annotated ? 'Annotated' : this.screenshotLabel(metadata?.label ?? path.basename(evidencePath, path.extname(evidencePath))),
        video,
        width: metadata?.width,
        height: metadata?.height
      };
    });
  }

  /** "Clipped Text: Text appears clipped…" becomes a short title plus a summary sentence. */
  private splitTitle(description: string): { title: string; summary: string | null } {
    const match = description.match(/^([^:.]{3,48}):\s+(.+)$/s);
    return match ? { title: match[1].trim(), summary: match[2].trim() } : { title: description, summary: null };
  }

  /** Separates the engine's "Measured details: {json}" suffix so it can be shown as formatted data. */
  private splitMeasuredDetails(text: string): { text: string; details: string | null } {
    const index = text.indexOf('Measured details:');
    if (index === -1) return { text, details: null };
    try {
      const parsed = JSON.parse(text.slice(index + 'Measured details:'.length).trim().replace(/\.$/, '')) as unknown;
      return { text: text.slice(0, index).trim() || text, details: JSON.stringify(parsed, null, 2) };
    } catch {
      return { text, details: null };
    }
  }

  private screenshotLabel(label: string): string {
    const known: Record<string, string> = { 'full-page': 'Full page', 'above-fold': 'Above the fold', header: 'Header', footer: 'Footer' };
    if (known[label.toLowerCase()]) return known[label.toLowerCase()];
    const text = label.replace(/^defect-\d+-/i, '').replace(/[-_]+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : label;
  }

  private plural(count: number, singular: string): string {
    return `${count} ${count === 1 ? singular : `${singular}s`}`;
  }

  private buttonDiagnosticHtml(issue: AuditIssue): string {
    if (issue.category !== 'Buttons' || !issue.details || typeof issue.details !== 'object' || Array.isArray(issue.details)) {
      return '';
    }

    const details = issue.details as Record<string, unknown>;
    const boundingBox = details.boundingBox;
    const box =
      boundingBox && typeof boundingBox === 'object' && !Array.isArray(boundingBox)
        ? (boundingBox as Record<string, unknown>)
        : undefined;
    const identifiedRows: Array<[string, unknown]> = [
      ['Element', details.tagName],
      ['Label', details.text],
      ['Role', details.role],
      ['Class', details.className],
      ['Link destination', details.href],
      ['Display', details.display],
      ['Visibility', details.visibility],
      ['Opacity', details.opacity],
      [
        'Bounding box',
        box
          ? `${String(box.width ?? '?')} x ${String(box.height ?? '?')} px at (${String(box.x ?? '?')}, ${String(box.y ?? '?')})`
          : undefined
      ]
    ];
    const rows = identifiedRows.filter(([, value]) => value !== undefined && value !== '');

    if (rows.length === 0) return '';
    return `<section class="control-diagnostic" aria-label="Button identification details">
      <strong>Button identification</strong>
      <dl>${rows.map(([label, value]) => `<div><dt>${this.escape(label)}</dt><dd>${this.escape(value)}</dd></div>`).join('')}</dl>
    </section>`;
  }

  private layoutShiftEvidenceHtml(details: unknown): string {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return '';
    const data = details as Record<string, unknown>;
    if (data.pixelMovement === undefined && data.viewportMovementPercent === undefined) return '';
    const rows = [
      ['Moved element', data.selector ?? 'See selector above'],
      ['Pixel movement', data.pixelMovement],
      ['Viewport movement', data.viewportMovementPercent === undefined ? undefined : `${data.viewportMovementPercent}%`],
      ['Importance score', data.importanceScore],
      ['CLS value', data.clsValue],
      ['Human visibility score', data.humanVisibilityScore],
      ['Decision', data.decision],
      ['Failure reason', data.failureReason]
    ].filter(([, value]) => value !== undefined && value !== '');
    return `<div class="layout-evidence">
      <strong>Layout shift evidence</strong>
      <div class="detail-grid">
        ${rows.map(([label, value]) => `<div><strong>${this.escape(label)}:</strong> ${this.escape(value)}</div>`).join('')}
      </div>
    </div>`;
  }

  private writeExcelReport(
    outputDir: string,
    fileName: string,
    results: AuditResult[],
    issues: AuditIssue[],
    summary: Record<string, number | string>,
    runId: string
  ): void {
    const rows = (values: unknown[], header = false, styleId?: string): string => `<Row>${values.map((value) => `<Cell${header ? ' ss:StyleID="Header"' : styleId ? ` ss:StyleID="${styleId}"` : ''}><Data ss:Type="String">${this.escapeXml(value)}</Data></Cell>`).join('')}</Row>`;
    const findings = [
      ['Issue ID', 'Target', 'Page URL', 'Category', 'Issue', 'Severity', 'Viewport', 'Browser', 'Device', 'Resolution', 'Expected', 'Actual', 'Business Impact', 'Recommendation', 'Selector', 'Timestamp', 'Evidence'],
      ...issues.map((issue) => [issue.id, issue.targetName ?? '', issue.url, issue.category, issue.description, issue.severity, issue.viewport, issue.browser ?? 'Chromium', issue.device ?? issue.viewport, issue.resolution?.label ?? '', issue.expected ?? '', issue.actual ?? '', issue.businessImpact ?? '', issue.suggestedFix, issue.selector ?? '', issue.timestamp ?? '', (issue.evidence ?? []).join(' | ')])
    ];
    const pageMap = new Map<string, { target: string; count: number; highest: string; viewports: Set<string> }>();
    for (const result of results) {
      const page = pageMap.get(result.page.url) ?? { target: result.targetName, count: 0, highest: 'Low', viewports: new Set<string>() };
      page.count += result.issues.length;
      page.viewports.add(result.viewport);
      for (const issue of result.issues) {
        if (this.severityRank(issue.severity) < this.severityRank(page.highest as AuditIssue['severity'])) page.highest = issue.severity;
      }
      pageMap.set(result.page.url, page);
    }
    const pageRows = [['Target', 'Page URL', 'Issues', 'Highest Severity', 'Viewports'], ...Array.from(pageMap.entries()).map(([url, page]) => [page.target, url, page.count, page.highest, Array.from(page.viewports).join(', ')])];
    const evidenceRows = [['Issue ID', 'Page URL', 'Evidence Path', 'Type'], ...issues.flatMap((issue) => (issue.evidence ?? []).map((evidence) => [issue.id, issue.url, evidence, evidence.includes('defect-') ? 'Annotated or defect evidence' : 'Page evidence']))];
    const assertionRows = [['Component', 'Check', 'Result', 'Severity', 'Page URL', 'Viewport', 'Expected', 'Actual', 'Comment', 'Recommendation'], ...results.flatMap((result) => (result.checks ?? []).map((check) => [check.component, check.checkName, check.result, check.severity, check.url, check.viewport, check.expected, check.actual, check.comment, check.recommendation ?? '']))];
    const summaryRows = [['Metric', 'Value'], ...Object.entries(summary), ['Run ID', runId], ['Generated', new Date().toISOString()]];
    const worksheet = (name: string, data: unknown[][], filter = true, rowStyles?: (row: unknown[], index: number) => string | undefined): string => `<Worksheet ss:Name="${this.escapeXml(name)}"><Table>${data.map((row, index) => rows(row, index === 0, rowStyles?.(row, index))).join('')}</Table>${filter ? `<AutoFilter x:Range="R1C1:R${Math.max(1, data.length)}C${Math.max(1, data[0]?.length ?? 1)}"/>` : ''}</Worksheet>`;
    const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1F4E78" ss:Pattern="Solid"/><Alignment ss:WrapText="1" ss:Vertical="Center"/></Style><Style ss:ID="Critical"><Interior ss:Color="#F4CCCC" ss:Pattern="Solid"/><Alignment ss:WrapText="1" ss:Vertical="Top"/></Style><Style ss:ID="High"><Interior ss:Color="#FCE4D6" ss:Pattern="Solid"/><Alignment ss:WrapText="1" ss:Vertical="Top"/></Style><Style ss:ID="Medium"><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/><Alignment ss:WrapText="1" ss:Vertical="Top"/></Style><Style ss:ID="Low"><Interior ss:Color="#E7E6E6" ss:Pattern="Solid"/><Alignment ss:WrapText="1" ss:Vertical="Top"/></Style><Style ss:ID="Pass"><Interior ss:Color="#E2F0D9" ss:Pattern="Solid"/><Alignment ss:WrapText="1" ss:Vertical="Top"/></Style><Style ss:ID="Fail"><Interior ss:Color="#F4CCCC" ss:Pattern="Solid"/><Alignment ss:WrapText="1" ss:Vertical="Top"/></Style></Styles>${worksheet('Executive Summary', summaryRows, false)}${worksheet('Findings', findings, true, (row, index) => index === 0 ? undefined : String(row[5] ?? 'Low'))}${worksheet('Page Summary', pageRows, true, (row, index) => index === 0 ? undefined : String(row[3] ?? 'Low'))}${worksheet('Evidence Register', evidenceRows)}${worksheet('Assertions', assertionRows, true, (row, index) => index === 0 ? undefined : String(row[2] ?? '') === 'PASS' ? 'Pass' : String(row[2] ?? '') === 'FAIL' ? 'Fail' : undefined)}</Workbook>`;
    fs.writeFileSync(path.join(outputDir, fileName), workbook, 'utf-8');
  }

  private uniquePaths(paths: string[]): string[] {
    return Array.from(new Set(paths.filter(Boolean)));
  }

  private styles(): string {
    return `<style>
    :root {
      color-scheme: light;
      --bg:#f3f5f8; --panel:#ffffff; --sunken:#f7f8fb; --line:#dee3ea; --line-strong:#c4ccd8;
      --text:#172033; --text-2:#454f62; --muted:#5f6a7d; --bar:#141f35;
      --accent:#2d436d; --accent-ink:#2c4a88; --accent-soft:#e8edf6;
      --critical:#d03b3b; --high:#ec835a; --medium:#fab219; --low:#3987e5;
      --success:#1e6b45; --success-soft:#e4f3ea; --warning:#804e00; --warning-soft:#fdf3db; --danger:#a12a2a; --danger-soft:#fbe9e9;
      --radius:12px; --radius-sm:8px;
    }
    [data-theme="dark"] {
      color-scheme: dark;
      --bg:#0d121c; --panel:#141b28; --sunken:#101621; --line:#273246; --line-strong:#3c4a63;
      --text:#e7ecf3; --text-2:#b8c2d1; --muted:#919cae; --bar:#111825;
      --accent:#4a689f; --accent-ink:#a0b8e4; --accent-soft:#1e2a40;
      --success:#7bd3a2; --success-soft:#12301f; --warning:#f2c66b; --warning-soft:#3a2c0e; --danger:#f29b9b; --danger-soft:#3b1717;
    }
    * { box-sizing:border-box; }
    html { scroll-padding-top:72px; }
    body { margin:0; background:var(--bg); color:var(--text); font-family:"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased; }
    a { color:var(--accent-ink); text-underline-offset:2px; }
    a:hover { text-decoration:underline; }
    h1, h2, h3, h4, h5 { color:var(--text); line-height:1.3; margin:0; }
    code, pre { font-family:ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size:13px; }
    button, input, select { font:inherit; }
    :focus-visible { outline:3px solid var(--accent-ink); outline-offset:2px; }
    .wrap { max-width:1200px; margin:0 auto; padding:0 24px; }
    .skip-link { position:absolute; left:-999px; top:8px; background:var(--panel); padding:8px 12px; border-radius:var(--radius-sm); z-index:60; }
    .skip-link:focus { left:16px; }

    .report-header { background:var(--bar); color:#fff; padding:20px 0 32px; }
    .header-top { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    .brand { display:flex; align-items:center; gap:12px; font-weight:600; }
    .logo { display:inline-grid; place-items:center; width:32px; height:32px; border-radius:var(--radius-sm); background:#fff; color:#1d2c47; font-size:12px; font-weight:700; }
    .header-actions { display:flex; align-items:center; gap:20px; margin-left:auto; }
    .header-title { margin-top:28px; }
    .header-title h1 { color:#fff; font-size:32px; letter-spacing:-0.01em; }
    .header-title p { margin:8px 0 0; color:rgba(255,255,255,.72); }
    .theme-switch { display:inline-flex; align-items:center; gap:10px; font-size:14px; color:rgba(255,255,255,.85); }
    #themeToggle { position:relative; width:46px; height:26px; padding:0; border-radius:999px; border:1px solid rgba(255,255,255,.35); background:rgba(255,255,255,.12); cursor:pointer; }
    #themeToggle .knob { position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:#fff; transition:transform .2s ease; }
    #themeToggle[aria-checked="true"] { background:#4a689f; border-color:#7d97c8; }
    #themeToggle[aria-checked="true"] .knob { transform:translateX(20px); }

    .section-nav { position:sticky; top:0; z-index:40; background:var(--panel); border-bottom:1px solid var(--line); }
    .section-nav .wrap { display:flex; gap:4px; overflow-x:auto; }
    .section-nav a { display:inline-flex; align-items:center; gap:8px; padding:14px 14px 12px; color:var(--text-2); font-weight:600; font-size:15px; white-space:nowrap; text-decoration:none; border-bottom:3px solid transparent; }
    .section-nav a:hover { color:var(--text); border-bottom-color:var(--line-strong); text-decoration:none; }
    .nav-count { padding:0 8px; border-radius:999px; background:var(--accent-soft); color:var(--accent-ink); font-size:13px; }

    .section { padding-top:48px; }
    .section-heading { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:4px 24px; margin-bottom:20px; }
    .section-heading h2 { font-size:24px; }
    .section-heading p { margin:0; color:var(--muted); font-size:15px; }
    .panel { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:24px; }
    .panel h3 { font-size:17px; }

    .button { display:inline-flex; align-items:center; justify-content:center; min-height:40px; padding:8px 16px; border:1px solid var(--line-strong); border-radius:var(--radius-sm); background:var(--panel); color:var(--text); font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; white-space:nowrap; }
    .button:hover { background:var(--sunken); text-decoration:none; }
    .button-light { background:#fff; color:#1d2c47; border-color:#fff; }
    .button-light:hover { background:#e8edf6; }
    .link-button { padding:0; border:0; background:none; color:var(--accent-ink); font-weight:600; cursor:pointer; text-align:left; }
    .link-button:hover { text-decoration:underline; }
    .copy-button { padding:2px 10px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--text-2); font-size:13px; font-weight:600; cursor:pointer; }
    .copy-button:hover { border-color:var(--line-strong); color:var(--text); }

    .summary-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; }
    .metric { display:flex; flex-direction:column; gap:4px; padding:18px 20px; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); color:var(--text); text-decoration:none; transition:border-color .15s ease; }
    .metric:hover { border-color:var(--accent-ink); text-decoration:none; }
    .metric-label { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:14px; }
    .metric-value { font-size:28px; font-weight:700; line-height:1.2; font-variant-numeric:tabular-nums; }
    .metric-value small { font-size:15px; font-weight:500; color:var(--muted); }
    .metric-status .metric-value { font-size:20px; }
    .metric-hint { color:var(--accent-ink); font-size:13px; font-weight:600; opacity:0; transition:opacity .15s ease; }
    .metric:hover .metric-hint, .metric:focus-visible .metric-hint { opacity:1; }

    .sev-mark { display:inline-block; width:12px; height:12px; border-radius:3px; flex:0 0 auto; }
    .sev-mark.critical { background:var(--critical); } .sev-mark.high { background:var(--high); } .sev-mark.medium { background:var(--medium); } .sev-mark.low { background:var(--low); }

    .insights-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin-top:16px; }
    .bar-chart { display:grid; gap:4px; margin-top:16px; }
    .bar-row { display:grid; grid-template-columns:110px 1fr 44px; align-items:center; gap:12px; padding:8px; margin:0 -8px; border:0; border-radius:var(--radius-sm); background:none; color:var(--text); text-align:left; cursor:pointer; }
    .bar-row:hover { background:var(--sunken); }
    .bar-label { display:flex; align-items:center; gap:8px; font-weight:600; font-size:15px; }
    .bar-track { height:10px; overflow:hidden; border-radius:99px; background:var(--sunken); box-shadow:inset 0 0 0 1px var(--line); }
    .bar-fill { display:block; height:100%; border-radius:99px; }
    .bar-fill.critical { background:var(--critical); } .bar-fill.high { background:var(--high); } .bar-fill.medium { background:var(--medium); } .bar-fill.low { background:var(--low); }
    .bar-row strong { text-align:right; font-variant-numeric:tabular-nums; }
    .chart-note { margin:16px 0 0; color:var(--muted); font-size:14px; }
    .trend-chart { display:flex; align-items:flex-end; gap:10px; height:150px; margin-top:16px; padding-top:8px; border-bottom:1px solid var(--line); }
    .trend-column { display:flex; flex:1; min-width:24px; height:100%; flex-direction:column; justify-content:flex-end; align-items:center; gap:6px; }
    .trend-column i { width:100%; max-width:44px; min-height:4px; border-radius:4px 4px 0 0; background:var(--accent); }
    .trend-value { color:var(--text-2); font-size:13px; font-weight:600; }
    .trend-label { color:var(--muted); font-size:11px; white-space:nowrap; padding-bottom:4px; }
    .empty-chart { min-height:150px; display:grid; place-items:center; margin:16px 0 0; color:var(--muted); text-align:center; }

    .status-panel { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px 16px; margin-top:16px; padding:14px 20px; border-radius:var(--radius); border:1px solid var(--line); font-size:15px; }
    .status-panel.failed { background:var(--danger-soft); color:var(--danger); }
    .status-panel.passed { background:var(--success-soft); color:var(--success); }
    .status-panel.off { background:var(--panel); color:var(--text-2); }

    .page-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
    .page-card { display:flex; flex-direction:column; gap:6px; padding:18px 20px; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); color:var(--text); text-align:left; cursor:pointer; }
    .page-card:hover { border-color:var(--accent-ink); }
    .page-card-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .page-count { color:var(--text-2); font-size:14px; font-weight:600; }
    .page-title { font-size:17px; font-weight:600; }
    .page-url { color:var(--accent-ink); font-size:14px; overflow-wrap:anywhere; }
    .page-meta { color:var(--muted); font-size:14px; }

    .severity-badge { display:inline-flex; align-items:center; gap:8px; font-size:14px; font-weight:700; color:var(--text); white-space:nowrap; }
    .severity-badge.Pass { color:var(--success); }

    .toolbar { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,1.4fr); gap:16px; padding:20px; }
    .field { display:flex; flex-direction:column; gap:6px; min-width:0; }
    .field label { font-size:14px; font-weight:600; color:var(--text); }
    .field select, .field input { height:44px; padding:8px 12px; border:1px solid var(--line-strong); border-radius:var(--radius-sm); background:var(--panel); color:var(--text); font-size:15px; }
    .toolbar-actions { grid-column:1 / -1; display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; padding-top:16px; border-top:1px solid var(--line); }
    .result-bar { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin:20px 0 12px; }
    .result-bar p { margin:0; color:var(--text-2); font-weight:600; }
    .filter-chip { padding:4px 12px; border:1px solid var(--accent-ink); border-radius:999px; background:var(--accent-soft); color:var(--accent-ink); font-size:14px; font-weight:600; cursor:pointer; overflow-wrap:anywhere; text-align:left; }

    .issue-list { display:grid; gap:16px; }
    .issue { background:var(--panel); border:1px solid var(--line); border-left:5px solid var(--low); border-radius:var(--radius); }
    .issue.sev-critical { border-left-color:var(--critical); } .issue.sev-high { border-left-color:var(--high); } .issue.sev-medium { border-left-color:var(--medium); }
    .issue > details > summary { display:grid; grid-template-columns:110px minmax(0,1fr) auto; align-items:start; gap:16px; padding:18px 24px; cursor:pointer; list-style:none; }
    .issue > details > summary::-webkit-details-marker { display:none; }
    .issue > details > summary:hover { background:var(--sunken); border-radius:var(--radius); }
    .issue-heading { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .issue-title { font-size:18px; font-weight:600; color:var(--text); }
    .issue-sub { color:var(--muted); font-size:14px; }
    .chevron { width:10px; height:10px; margin-top:8px; border-right:2px solid var(--muted); border-bottom:2px solid var(--muted); transform:rotate(45deg); transition:transform .15s ease; }
    .issue > details[open] > summary .chevron { transform:rotate(225deg); margin-top:12px; }
    .issue-body { display:grid; gap:20px; padding:0 24px 24px 150px; }
    .issue-intro { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
    .issue-intro p { margin:0; color:var(--text-2); max-width:72ch; }
    .issue-intro .copy-button { margin-left:auto; }
    .fix { padding:14px 18px; border-left:4px solid var(--accent); border-radius:var(--radius-sm); background:var(--accent-soft); }
    .fix strong { display:block; color:var(--accent-ink); font-size:14px; }
    .fix p { margin:2px 0 0; max-width:72ch; }
    .compare { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; margin:0; }
    dt { color:var(--muted); font-size:14px; }
    dd { margin:2px 0 0; overflow-wrap:anywhere; }
    .block h4 { font-size:14px; font-weight:600; color:var(--muted); margin-bottom:8px; }
    .block h5, .more h5 { font-size:14px; font-weight:600; margin:12px 0 8px; }
    .code-row { display:flex; align-items:flex-start; gap:8px; margin-top:6px; }
    .code-row code { flex:1; min-width:0; padding:8px 12px; border-radius:var(--radius-sm); background:var(--sunken); border:1px solid var(--line); color:var(--text-2); overflow-wrap:anywhere; }
    pre { margin:0; padding:12px 16px; max-height:280px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; border-radius:var(--radius-sm); background:var(--sunken); border:1px solid var(--line); color:var(--text-2); line-height:1.5; }
    .facts { display:grid; gap:10px; margin:0; padding:16px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
    .facts > div { display:grid; grid-template-columns:110px minmax(0,1fr); gap:12px; align-items:baseline; }
    .facts dd { margin:0; }
    .chips { display:flex; flex-wrap:wrap; gap:6px; }
    .chip, .chip-button { display:inline-flex; align-items:center; padding:2px 10px; border:1px solid var(--line); border-radius:6px; background:var(--sunken); color:var(--text-2); font-size:13px; font-weight:600; text-decoration:none; white-space:nowrap; }
    a.chip:hover, .chip-button:hover { border-color:var(--accent-ink); color:var(--accent-ink); text-decoration:none; cursor:pointer; }

    .evidence-group + .evidence-group { margin-top:8px; }
[hidden] { display:none !important; }
    .evidence-list { display:flex; flex-wrap:wrap; gap:12px; }
    .thumb-wrap { display:flex; flex-direction:column; gap:4px; align-items:flex-start; }
    .thumb { display:flex; flex-direction:column; width:168px; padding:0; overflow:hidden; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--panel); color:var(--text); text-align:left; cursor:zoom-in; }
    .thumb:hover { border-color:var(--accent-ink); }
    .thumb img { display:block; width:100%; height:100px; object-fit:cover; object-position:top; background:var(--sunken); }
    .thumb-label { padding:6px 10px; border-top:1px solid var(--line); color:var(--text-2); font-size:12px; font-weight:600; }
    .thumb-video { cursor:pointer; }
    .thumb-play { display:grid; place-items:center; height:100px; background:var(--sunken); font-weight:600; }
    .thumb-wrap .link-button, .facts .link-button { font-size:14px; }
    .facts .link-button { margin-left:8px; }

    .control-diagnostic { padding:16px; border:1px solid var(--line); border-left:4px solid var(--critical); border-radius:var(--radius-sm); background:var(--danger-soft); }
    .control-diagnostic > strong { display:block; margin-bottom:10px; color:var(--danger); }
    .control-diagnostic dl { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px 20px; margin:0; }
    .control-diagnostic dd { color:var(--text); font-size:14px; }

    .more { border-top:1px solid var(--line); padding-top:12px; }
    .more > summary { cursor:pointer; color:var(--text-2); font-size:14px; font-weight:600; }
    .more h4 { font-size:14px; color:var(--muted); margin:16px 0 0; }
    .more .table-wrap { margin-top:12px; }

    .table-wrap { overflow-x:auto; }
    .table-wrap.panel { padding:0; }
    table { width:100%; border-collapse:collapse; }
    th, td { padding:12px 16px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; font-size:14px; }
    thead th { background:var(--sunken); color:var(--text-2); font-weight:600; white-space:nowrap; }
    tbody tr:last-child td { border-bottom:0; }
    tbody tr:target { background:var(--accent-soft); }
    .cell-url { min-width:200px; overflow-wrap:anywhere; }
    .nowrap { white-space:nowrap; }
    .shot-links { display:flex; flex-wrap:wrap; gap:6px; max-width:420px; }
    td small { display:block; color:var(--muted); }

    .empty-state { padding:32px; border:1px dashed var(--line-strong); border-radius:var(--radius); color:var(--muted); text-align:center; }

    .modal { position:fixed; inset:0; display:none; align-items:center; justify-content:center; padding:16px; background:rgba(11,17,28,.82); z-index:50; }
    .modal.visible { display:flex; }
    .modal-content { width:min(1200px,100%); max-height:94vh; overflow:auto; background:var(--panel); border-radius:var(--radius); padding:20px; }
    .modal-header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; }
    .modal-header h3 { font-size:17px; overflow-wrap:anywhere; }
    .modal-media { display:flex; justify-content:center; padding:12px; border-radius:var(--radius-sm); background:var(--sunken); }
    .modal-media img, .modal-media video { display:block; max-width:100%; max-height:78vh; height:auto; object-fit:contain; }

    body > header:not(.report-header), body > main:not(.wrap) { max-width:1200px; margin:0 auto; padding:24px; }

    @media (max-width: 1000px) {
      .summary-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .toolbar { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .issue-body { padding-left:24px; }
    }
    @media (max-width: 700px) {
      .wrap { padding:0 16px; }
      .header-title h1 { font-size:26px; }
      .summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .insights-grid, .compare, .toolbar { grid-template-columns:1fr; }
      .issue > details > summary { grid-template-columns:minmax(0,1fr) auto; padding:16px; }
      .issue > details > summary .severity-badge { grid-column:1 / -1; }
      .issue-body { padding:0 16px 20px; }
      .facts > div { grid-template-columns:1fr; gap:2px; }
      .metric-hint { display:none; }
    }
    @media (prefers-reduced-motion: reduce) { * { transition:none !important; scroll-behavior:auto !important; } }
    @media print {
      :root, [data-theme="dark"] {
        color-scheme: light;
        --bg:#ffffff; --panel:#ffffff; --sunken:#f7f8fb; --line:#dee3ea; --line-strong:#c4ccd8;
        --text:#172033; --text-2:#454f62; --muted:#5f6a7d; --accent:#2d436d; --accent-ink:#2c4a88; --accent-soft:#e8edf6;
        --success:#1e6b45; --success-soft:#e4f3ea; --danger:#a12a2a; --danger-soft:#fbe9e9;
      }
      body { font-size:12pt; }
      .section-nav, .header-actions, .toolbar, .result-bar, .copy-button, .skip-link, .modal, .metric-hint, .facts .link-button, .thumb-wrap .link-button, .screen-only { display:none !important; }
      h2, h3, h4, .section-heading, .issue > details > summary { break-after:avoid; page-break-after:avoid; }
      .metric { padding:10px 12px; }
      .metric-label { font-size:9pt; line-height:1.3; }
      .report-header { padding:16px 0 20px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .section { padding-top:24px; break-before:auto; }
      #issues, #executions { break-before:page; }
      .panel, .metric, .page-card, .status-panel, .bar-row, .fix, .compare, .thumb, tr { break-inside:avoid; }
      .issue { break-inside:auto; }
      .issue > details > summary { break-after:avoid; }
      .chevron { display:none; }
      .issue-body { padding-left:24px; }
      .summary-grid { grid-template-columns:repeat(5,minmax(0,1fr)); }
      .insights-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .metric-value { font-size:18pt; }
      .metric-status .metric-value { font-size:13pt; }
      .thumb img { height:90px; }
      .table-wrap { overflow:visible; }
      table { table-layout:fixed; }
      th, td { padding:6px 8px; font-size:8.5pt; overflow-wrap:anywhere; }
      thead th { white-space:normal; }
      .shot-links { max-width:none; gap:4px; }
      .chip-button { white-space:normal; font-size:8pt; padding:1px 6px; }
      .cell-url { min-width:0; }
      .exec-table th:nth-child(1) { width:9%; } .exec-table th:nth-child(2) { width:17%; } .exec-table th:nth-child(3) { width:11%; }
      .exec-table th:nth-child(4) { width:13%; } .exec-table th:nth-child(5) { width:11%; } .exec-table th:nth-child(6) { width:8%; } .exec-table th:nth-child(7) { width:31%; }
      * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>`;
  }

  private resolutionHtml(resolution: AuditResult['resolution']): string {
    if (!resolution) return 'Not recorded';
    const layoutDiffers = resolution.layoutWidth !== undefined && resolution.layoutHeight !== undefined &&
      (resolution.layoutWidth !== resolution.width || resolution.layoutHeight !== resolution.height);
    return `${this.escape(resolution.label)}${
      layoutDiffers
        ? `<br><small>Page layout viewport: ${resolution.layoutWidth} × ${resolution.layoutHeight} (content-adapted)</small>`
        : ''
    }`;
  }

  private assetHref(outputDir: string, assetPath: string): string {
    return path.relative(outputDir, path.join(auditConfig.rootDir, assetPath)).replace(/\\/g, '/');
  }

  private severityRank(severity: AuditIssue['severity']): number {
    return { Critical: 0, High: 1, Medium: 2, Low: 3 }[severity];
  }

  /** "pagesCrawled" becomes "Pages crawled". */
  private label(key: string): string {
    return key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`).replace(/^./, (match) => match.toUpperCase());
  }

  private escape(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private escapeAttr(value: unknown): string {
    return this.escape(value).replace(/`/g, '&#096;');
  }

  private escapeXml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
