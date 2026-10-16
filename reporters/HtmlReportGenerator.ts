import fs from 'fs';
import path from 'path';
import { auditConfig } from '../config/auditConfig';
import { ensureDir, listJsonFiles, readJsonFile, safeFileName, writeJsonFile } from '../utils/fileSystem';
import { sanitizeAuditResultForReporting } from '../utils/reportFilters';
import { AuditCheck, AuditIssue, AuditResult, ScreenshotEvidence } from '../utils/types';
import { isBlockingSeverity, qualityGateLabel } from '../utils/severityGate';

export class HtmlReportGenerator {
  async generate(): Promise<void> {
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
    return `<div class="bar-chart">${items.map(([label, value, tone]) => `<div class="bar-row"><span>${this.escape(label)}</span><div class="bar-track"><i class="bar-fill ${tone}" style="width:${Math.max(2, (Number(value) / maximum) * 100)}%"></i></div><strong>${this.escape(value)}</strong></div>`).join('')}</div>`;
  }

  private trendBars(history: Array<Record<string, number | string>>): string {
    if (!history.length) return '<div class="empty-chart">No history available.</div>';
    const maximum = Math.max(1, ...history.map((item) => Number(item.totalIssues ?? 0)));
    return `<div class="trend-chart">${history.map((item) => `<div class="trend-column"><div class="trend-value">${this.escape(item.totalIssues ?? 0)}</div><i style="height:${Math.max(4, (Number(item.totalIssues ?? 0) / maximum) * 100)}%"></i><span>${this.escape(String(item.runId ?? '').slice(-6))}</span></div>`).join('')}</div>`;
  }

  private chartTable(summary: Record<string, number | string>): string {
    return ['criticalIssues', 'highIssues', 'mediumIssues', 'lowIssues']
      .map((key) => `<span><b>${this.escape(this.label(key))}</b> ${this.escape(summary[key] ?? 0)}</span>`)
      .join('');
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
      return `<article class="page-card" data-search="${this.escapeAttr(`${url} ${page.target}`)}"><div class="page-card-head"><span class="severity-badge ${highest === 'Pass' ? 'Low' : highest}">${this.escape(highest)}</span><strong>${page.issues.length} issue(s)</strong></div><h3>${this.escape(page.target)}</h3><a href="#" data-page-url="${this.escapeAttr(url)}">${this.escape(url)}</a><p>${page.viewports.size} viewport(s) audited</p></article>`;
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
    const issueMarkup = orderedIssues.length
      ? orderedIssues.map((issue) => {
          const matchingResult = results.find((result) =>
            result.page.url === issue.url &&
            result.viewport === issue.viewport &&
            (!issue.targetName || issue.targetName === result.targetName || issue.targetName === result.page.targetName)
          );
          return this.issueHtml(
            issue,
            outputDir,
            matchingResult?.screenshots ?? []
          );
        }).join('')
      : '<div class="empty-state">No issues matched the current report scope.</div>';

    const summaryCards = Object.entries(summary)
      .map(([key, value]) => `<div class="metric"><span>${this.escape(this.label(key))}</span><strong>${this.escape(value)}</strong></div>`)
      .join('');
    const pageRows = this.pageRows(results);
    const severityChart = this.chartBars([
      ['Critical', summary.criticalIssues ?? 0, 'critical'],
      ['High', summary.highIssues ?? 0, 'high'],
      ['Medium', summary.mediumIssues ?? 0, 'medium'],
      ['Low', summary.lowIssues ?? 0, 'low']
    ]);
    const trendChart = this.trendBars(metadata.history);

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${this.escape(title)}</title>
  ${this.styles()}
</head>
<body>
  <div class="page-shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">Website audit dashboard</div>
        <h1>${this.escape(title)}</h1>
      </div>
      <div class="topbar-meta">Run ${this.escape(metadata.runId)}<br>Generated ${new Date().toISOString()}<br>${this.escape(targetLabel)}</div>
    </header>

    <main class="dashboard-main">
      <section class="summary-grid">
        ${summaryCards}
      </section>

      <section class="insights-grid">
        <article class="insight-card"><div class="section-kicker">Severity distribution</div>${severityChart}<div class="chart-table">${this.chartTable(summary)}</div></article>
        <article class="insight-card"><div class="section-kicker">Severity trend</div>${trendChart}<p class="chart-note">${metadata.history.length > 1 ? 'Historical snapshots are retained from recent audit runs.' : 'Run another audit to establish a historical comparison.'}</p></article>
      </section>

      <section class="status-panel ${gateFailed ? 'failed' : 'passed'}">
        <div>
          <strong>${gateEnabled ? (gateFailed ? 'Quality gate failed' : 'Quality gate passed') : 'Quality gate disabled'}</strong>
        </div>
        <span>${
          gateEnabled
            ? (gateFailed
                ? `${blockingCount} ${this.escape(qualityGateLabel(auditConfig.qualityGateSeverity))} finding(s) require attention.`
                : `No ${this.escape(qualityGateLabel(auditConfig.qualityGateSeverity))} findings were detected.`)
            : 'Set AUDIT_FAIL_ON_SEVERITY to Medium, High, or Critical to enable final audit gating.'
        }</span>
      </section>

      <section class="toolbar">
        <div class="field-group">
          <label for="severityFilter">Severity</label>
          <select id="severityFilter">
            <option value="all">All</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
        <div class="field-group">
          <label for="categoryFilter">Category</label>
          <select id="categoryFilter">
            <option value="all">All</option>
            ${Array.from(new Set(orderedIssues.map((issue) => issue.category))).map((category) => `<option value="${this.escapeAttr(category)}">${this.escape(category)}</option>`).join('')}
          </select>
        </div>
        <div class="field-group">
          <label for="viewportFilter">Viewport</label>
          <select id="viewportFilter">
            <option value="all">All</option>
            ${Array.from(new Set(orderedIssues.map((issue) => issue.viewport))).map((viewport) => `<option value="${this.escapeAttr(viewport)}">${this.escape(viewport)}</option>`).join('')}
          </select>
        </div>
        <div class="field-group search-box">
          <label for="searchInput">Search</label>
          <input id="searchInput" type="text" placeholder="URL, issue, selector..." />
        </div>
        <div class="toolbar-actions">
          <button type="button" id="resetFilters">Reset</button>
          <button type="button" id="exportJson">Export JSON</button>
          <a class="toolbar-button" href="website-audit-report.xls" download>Export Excel</a>
          <button type="button" id="themeToggle" aria-label="Toggle theme">Theme</button>
        </div>
      </section>

      <section class="report-shell page-index">
        <div class="section-heading"><div><div class="section-kicker">Page drill-down</div><h2>Audited pages</h2></div><span id="visibleCount"></span></div>
        <div class="page-grid">${pageRows}</div>
      </section>

      <section class="issues-panel">
        ${issueMarkup}
      </section>
    </main>

    <section class="report-shell">
      <h2>Assertion Register</h2>
      <p>Every detected component check is recorded, including passes, so readers can see exactly what was validated.</p>
      ${this.checksHtml(results.flatMap((result) => result.checks ?? []), outputDir)}
      <h2>Page Executions</h2>
      <table>
        <thead><tr><th>Target</th><th>Page</th><th>Viewport</th><th>Screen Resolution</th><th>Issues</th><th>Load</th><th>Screenshots</th></tr></thead>
        <tbody>
          ${results
            .map(
              (result) => `<tr>
                <td>${this.escape(result.targetName || result.page.targetName)}</td>
                <td><a href="${this.escapeAttr(result.page.url)}">${this.escape(result.page.url)}</a></td>
                <td>${this.escape(result.viewport)}</td>
                <td>${this.resolutionHtml(result.resolution)}</td>
                <td>${result.issues.length}</td>
                <td>${result.performance?.loadTimeMs ?? 'n/a'}ms</td>
                <td>${result.screenshots.map((shot) => `<a href="${this.escapeAttr(this.assetHref(outputDir, shot.path))}">${this.escape(shot.label)}</a>`).join(' ')}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </section>
  </div>

  <div id="evidenceModal" class="modal" aria-hidden="true">
    <div class="modal-content">
      <button class="modal-close" type="button" aria-label="Close evidence">×</button>
      <div id="modalBody"></div>
    </div>
  </div>

  <script>
    const severityFilter = document.getElementById('severityFilter');
    const categoryFilter = document.getElementById('categoryFilter');
    const viewportFilter = document.getElementById('viewportFilter');
    const searchInput = document.getElementById('searchInput');
    const modal = document.getElementById('evidenceModal');
    const modalBody = document.getElementById('modalBody');
    const modalClose = document.querySelector('.modal-close');
    const issueCards = Array.from(document.querySelectorAll('.issue-card'));
    const pageCards = Array.from(document.querySelectorAll('.page-card'));
    const visibleCount = document.getElementById('visibleCount');
    const reportRunId = '${this.escapeAttr(metadata.runId)}';

    function applyFilters() {
      const severity = severityFilter.value;
      const category = categoryFilter.value;
      const viewport = viewportFilter.value;
      const query = (searchInput.value || '').trim().toLowerCase();

      issueCards.forEach((card) => {
        const matchesSeverity = severity === 'all' || card.dataset.severity === severity;
        const matchesCategory = category === 'all' || card.dataset.category === category;
        const matchesViewport = viewport === 'all' || card.dataset.viewport === viewport;
        const searchText = (card.dataset.search || '').toLowerCase();
        const matchesSearch = !query || searchText.includes(query);
        const shouldShow = matchesSeverity && matchesCategory && matchesViewport && matchesSearch;
        card.style.display = shouldShow ? '' : 'none';
      });
      pageCards.forEach((card) => {
        const pageText = (card.dataset.search || '').toLowerCase();
        card.style.display = !query || pageText.includes(query) ? '' : 'none';
      });
      if (visibleCount) visibleCount.textContent = issueCards.filter((card) => card.style.display !== 'none').length + ' findings shown';
    }

    [severityFilter, categoryFilter, viewportFilter, searchInput].forEach((element) => {
      element.addEventListener('input', applyFilters);
      element.addEventListener('change', applyFilters);
    });

    document.getElementById('resetFilters').addEventListener('click', () => {
      severityFilter.value = 'all'; categoryFilter.value = 'all'; viewportFilter.value = 'all'; searchInput.value = ''; applyFilters();
    });

    async function copyText(text, button) {
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch {}
      if (!copied) {
        const area = document.createElement('textarea');
        area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area); area.select(); copied = document.execCommand('copy'); area.remove();
      }
      if (copied) {
        const original = button.textContent;
        button.textContent = 'Copied'; button.classList.add('copied');
        window.setTimeout(() => { button.textContent = original; button.classList.remove('copied'); }, 1400);
      }
    }

    document.querySelectorAll('[data-copy-text]').forEach((button) => button.addEventListener('click', () => {
      copyText(button.getAttribute('data-copy-text') || '', button);
    }));

    function visibleIssues() {
      return issueCards.filter((card) => card.style.display !== 'none').map((card) => ({
        id: card.querySelector('.issue-id')?.textContent || '',
        severity: card.dataset.severity || '', category: card.dataset.category || '', viewport: card.dataset.viewport || '',
        issue: card.querySelector('h3')?.textContent || '', search: card.dataset.search || '',
        target: card.querySelector('.issue-meta-grid div:nth-child(3) span')?.textContent || '',
        selector: card.querySelector('.issue-meta-grid div:nth-child(4) span')?.textContent || '',
        url: card.querySelector('.issue-meta-grid div:first-child span')?.textContent || '',
        recommendation: card.querySelector('.recommendation-box')?.textContent || '', runId: reportRunId
      }));
    }

    function downloadFile(name, content, type) {
      const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
    }

    document.getElementById('exportJson').addEventListener('click', () => downloadFile('website-audit-filtered.json', JSON.stringify({ runId: reportRunId, findings: visibleIssues() }, null, 2), 'application/json'));

    document.querySelectorAll('[data-page-url]').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault(); searchInput.value = link.getAttribute('data-page-url') || ''; applyFilters();
      document.querySelector('.issues-panel')?.scrollIntoView({ behavior: 'smooth' });
    }));

    document.querySelectorAll('.field-toggle').forEach((button) => button.addEventListener('click', () => {
      const value = button.previousElementSibling;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      if (value) value.classList.toggle('expanded', !expanded);
      button.setAttribute('aria-expanded', String(!expanded));
      button.textContent = expanded ? 'View more' : 'View less';
    }));

    const savedTheme = localStorage.getItem('audit-theme');
    if (savedTheme) document.documentElement.dataset.theme = savedTheme;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
    document.getElementById('themeToggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next; localStorage.setItem('audit-theme', next);
    });

    function openEvidence(src, type, title) {
      const safeSrc = src;
      const media = type === 'video'
        ? '<video controls autoplay muted playsinline><source src="' + safeSrc + '" /></video>'
        : '<img src="' + safeSrc + '" alt="' + title + '" />';
      modalBody.innerHTML = '<div class="modal-header"><h3>' + title + '</h3></div><div class="modal-media">' + media + '</div>';
      modal.classList.add('visible');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeEvidence() {
      modal.classList.remove('visible');
      modal.setAttribute('aria-hidden', 'true');
      modalBody.innerHTML = '';
    }

    document.querySelectorAll('[data-evidence-src]').forEach((button) => {
      button.addEventListener('click', () => {
        const src = button.getAttribute('data-evidence-src');
        const type = button.getAttribute('data-evidence-type');
        const title = button.getAttribute('data-evidence-title');
        openEvidence(src, type, title);
      });
    });

    modalClose.addEventListener('click', closeEvidence);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeEvidence();
    });
    applyFilters();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeEvidence();
    });
  </script>
</body>
</html>`;
    fs.writeFileSync(path.join(outputDir, fileName), html, 'utf-8');
  }

  private issueHtml(issue: AuditIssue, outputDir: string, fallbackEvidence: ScreenshotEvidence[]): string {
    const evidencePaths = this.uniquePaths(issue.evidence?.length ? issue.evidence : fallbackEvidence.map((item) => item.path));
    const evidence = evidencePaths.map((evidencePath) => {
      const metadata = fallbackEvidence.find((item) => item.path === evidencePath);
      return { path: evidencePath, sourcePath: metadata?.sourcePath, annotated: metadata?.annotated ?? false, width: metadata?.width, height: metadata?.height };
    });
    const expected = issue.expected ?? `The page satisfies the ${issue.category.toLowerCase()} check without this defect.`;
    const actual = issue.actual ?? issue.description;
    const evidenceButtons = evidence.length
      ? evidence
          .map((shot) => {
            const href = this.assetHref(outputDir, shot.path);
            const isVideo = /\.(mp4|webm|mov|ogg)$/i.test(shot.path);
            const originalButton = shot.sourcePath
              ? `<button type="button" class="evidence-button secondary" data-evidence-src="${this.escapeAttr(this.assetHref(outputDir, shot.sourcePath))}" data-evidence-type="image" data-evidence-title="Original evidence for ${this.escapeAttr(issue.description)}" aria-label="Open original evidence">&#128269; Original</button>`
              : '';
            return `<div class="evidence-item"><button type="button" class="evidence-button" data-evidence-src="${this.escapeAttr(href)}" data-evidence-type="${isVideo ? 'video' : 'image'}" data-evidence-title="${this.escapeAttr(issue.description)}" aria-label="View ${isVideo ? 'video' : 'annotated'} evidence">&#128269; ${isVideo ? 'View video' : (shot.annotated ? 'View annotated' : 'View evidence')}</button>${originalButton}${shot.width && shot.height ? `<span class="evidence-dimensions">${shot.width} x ${shot.height}px</span>` : ''}</div>`;
          })
          .join('')
      : '';

    const issueSearch = `${issue.category} ${issue.severity} ${issue.url} ${issue.viewport} ${issue.description} ${issue.selector ?? ''}`;
    return `<article class="issue-card ${issue.severity}" data-severity="${this.escapeAttr(issue.severity)}" data-category="${this.escapeAttr(issue.category)}" data-viewport="${this.escapeAttr(issue.viewport)}" data-search="${this.escapeAttr(issueSearch)}">
      <div class="issue-header">
        <div>
          <span class="severity-badge ${this.escapeAttr(issue.severity)}">${this.escape(issue.severity)}</span>
          <span class="category-tag">${this.escape(issue.category)}</span>
        </div>
        <span class="issue-id">${this.escape(issue.id)}</span>
      </div>
      <div class="issue-title-row"><h3 class="issue-title" title="${this.escapeAttr(issue.description)}">${this.escape(issue.description)}</h3><button type="button" class="copy-button heading-copy" data-copy-text="${this.escapeAttr(issue.description)}" aria-label="Copy issue title" title="Copy issue title">&#128203;</button></div>
      <div class="issue-meta-grid">
        ${this.fieldHtml('URL', issue.url, false, true)}
        ${this.fieldHtml('Viewport', issue.viewport)}
        ${this.fieldHtml('Target', issue.targetName ?? 'N/A')}
        ${this.fieldHtml('Selector', issue.selector ?? 'page')}
      </div>
      <div class="issue-detail-grid">
        ${this.fieldHtml('Expected', expected, true)}
        ${this.fieldHtml('Actual', actual, true)}
      </div>
      <div class="issue-actions" aria-label="Evidence actions">
        ${evidenceButtons}
      </div>
      <details class="browser-details"><summary>Browser details</summary><div class="browser-details-grid">
        ${this.fieldHtml('Browser', issue.browser ?? 'Chromium')}
        ${this.fieldHtml('Device', issue.device ?? issue.viewport)}
        ${this.fieldHtml('Timestamp', issue.timestamp ?? 'Timestamp unavailable')}
        ${issue.resolution ? this.fieldHtml('Resolution', issue.resolution.label) : ''}
      </div></details>
      <div class="recommendation-box"><strong>Recommendation:</strong> ${this.escape(issue.suggestedFix)}</div>
      ${issue.details ? `<details class="issue-details"><summary>Technical details</summary><pre>${this.escape(JSON.stringify(issue.details, null, 2))}</pre></details>` : ''}
    </article>`;
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

  private fieldHtml(label: string, value: unknown, expandable = false, copyable = false): string {
    const text = String(value ?? '');
    const shouldExpand = text.length > 180 || (expandable && text.length > 120);
    const copyButton = copyable ? `<button type="button" class="copy-button" data-copy-text="${this.escapeAttr(text)}" aria-label="Copy ${this.escapeAttr(label)}" title="Copy ${this.escapeAttr(label)}">&#128203;</button>` : '';
    return `<div class="parameter-field"><div class="parameter-label"><strong>${this.escape(label)}</strong>${copyButton}</div><p class="parameter-value ${shouldExpand ? 'is-collapsible' : ''}">${this.escape(text)}</p>${shouldExpand ? `<button type="button" class="field-toggle" aria-expanded="false">View more</button>` : ''}</div>`;
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

  private checksHtml(checks: AuditCheck[], outputDir: string): string {
    if (!checks.length) return '<p>No assertion records were produced by this execution.</p>';
    return `<div class="check-summary"><strong>${checks.filter((item) => item.result === 'PASS').length} PASS</strong><strong>${checks.filter((item) => item.result === 'FAIL').length} FAIL</strong></div>
      ${checks.map((check) => `<details class="check ${check.result}" ${check.result === 'FAIL' ? 'open' : ''}>
        <summary><span class="result">${this.escape(check.result)}</span> ${this.escape(check.component)} — ${this.escape(check.checkName)}</summary>
        <div class="detail-grid">
          <div><strong>Severity:</strong> ${this.escape(check.severity)}</div>
          <div><strong>Timestamp:</strong> ${this.escape(check.timestamp)}</div>
          <div><strong>Expected:</strong> ${this.escape(check.expected)}</div>
          <div><strong>Actual:</strong> ${this.escape(check.actual)}</div>
          <div><strong>Comment:</strong> ${this.escape(check.comment)}</div>
          ${check.recommendation ? `<div><strong>Recommendation:</strong> ${this.escape(check.recommendation)}</div>` : ''}
          ${check.selector ? `<div><strong>Element locator:</strong> <code>${this.escape(check.selector)}</code></div>` : ''}
          ${check.boundingBox ? `<div><strong>Bounding box:</strong> ${this.escape(JSON.stringify(check.boundingBox))}</div>` : ''}
          ${check.responseStatus !== undefined ? `<div><strong>Response status:</strong> ${check.responseStatus}</div>` : ''}
          <div><strong>Page:</strong> <a href="${this.escapeAttr(check.url)}">${this.escape(check.url)}</a></div>
          <div><strong>Viewport:</strong> ${this.escape(check.viewport)}</div>
          ${check.resolution ? `<div><strong>Test viewport:</strong> ${this.resolutionHtml(check.resolution)}</div>` : ''}
        </div>
        ${check.evidence?.length ? `<div class="shots">${this.uniquePaths(check.evidence).map((shot) => { const href = this.assetHref(outputDir, shot); return `<a href="${this.escapeAttr(href)}"><img src="${this.escapeAttr(href)}" alt="Evidence for ${this.escapeAttr(check.checkName)}" loading="lazy"></a>`; }).join('')}</div>` : ''}
        ${check.consoleLogs?.length ? `<pre>${this.escape(check.consoleLogs.join('\n'))}</pre>` : ''}
      </details>`).join('')}`;
  }

  private uniquePaths(paths: string[]): string[] {
    return Array.from(new Set(paths.filter(Boolean)));
  }

  private styles(): string {
    return `<style>
    :root {
      color-scheme: light;
      --critical:#b91c1c; --high:#d97706; --medium:#2563eb; --low:#475569;
      --bg:#f3f6fb; --panel:#ffffff; --line:#dfe7f1; --text:#0f172a; --muted:#475569; --shadow:0 18px 44px rgba(15, 23, 42, 0.08);
    }
    * { box-sizing:border-box; }
    body { margin:0; font-family: Inter, Arial, sans-serif; background:linear-gradient(180deg,#edf4ff,#f8fafc); color:var(--text); }
    a { color:#0f4c81; text-decoration:none; }
    a:hover { text-decoration:underline; }
    .page-shell { max-width:1500px; margin:0 auto; padding:24px; }
    .topbar { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; background:rgba(15,23,42,0.96); color:#fff; border-radius:16px; padding:22px 24px; box-shadow:var(--shadow); }
    .eyebrow { font-size:12px; text-transform:uppercase; letter-spacing:1.8px; opacity:0.75; margin-bottom:10px; }
    h1 { margin:0; font-size:32px; }
    .topbar-meta { text-align:right; font-size:12px; color:#dfe7f1; }
    .dashboard-main { margin-top:22px; }
    .insights-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; margin-bottom:22px; }
    .insight-card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px; box-shadow:var(--shadow); }
    .section-kicker { color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
    .bar-chart { display:grid; gap:11px; margin-top:18px; }
    .bar-row { display:grid; grid-template-columns:72px 1fr 36px; align-items:center; gap:10px; font-size:12px; }
    .bar-track { height:10px; overflow:hidden; border-radius:99px; background:color-mix(in srgb, var(--line) 70%, transparent); }
    .bar-fill { display:block; height:100%; min-width:4px; border-radius:99px; }
    .bar-fill.critical { background:#ef4444; } .bar-fill.high { background:#f59e0b; } .bar-fill.medium { background:#3b82f6; } .bar-fill.low { background:#64748b; }
    .chart-table { display:flex; flex-wrap:wrap; gap:8px 16px; margin-top:16px; color:var(--muted); font-size:12px; }
    .trend-chart { display:flex; align-items:end; gap:12px; height:130px; margin-top:16px; padding:10px 4px 0; border-bottom:1px solid var(--line); }
    .trend-column { display:flex; flex:1; min-width:20px; height:100%; flex-direction:column; justify-content:end; align-items:center; gap:5px; }
    .trend-column i { width:100%; min-height:4px; border-radius:6px 6px 0 0; background:linear-gradient(180deg,#38bdf8,#2563eb); }
    .trend-column span, .trend-value { color:var(--muted); font-size:10px; }
    .chart-note { color:var(--muted); font-size:12px; margin:14px 0 0; }
    .empty-chart { min-height:130px; display:grid; place-items:center; color:var(--muted); font-size:13px; }
    .summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; margin-bottom:22px; }
    .metric { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px 16px; box-shadow:var(--shadow); }
    .metric span { display:block; font-size:12px; color:var(--muted); text-transform:capitalize; margin-bottom:8px; }
    .metric strong { font-size:28px; line-height:1.2; }
    .status-panel { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:16px 18px; margin:0 0 24px; border-radius:12px; border:1px solid var(--line); box-shadow:var(--shadow); }
    .status-panel.failed { background:#fff1f2; color:#7f1d1d; border-color:#fecdd3; }
    .status-panel.passed { background:#ecfdf5; color:#166534; border-color:#bbf7d0; }
    .toolbar { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; background:var(--panel); padding:16px; border-radius:14px; border:1px solid var(--line); box-shadow:var(--shadow); margin-bottom:18px; }
    .field-group { display:flex; flex-direction:column; gap:8px; }
    .field-group label { font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em; }
    .field-group select, .field-group input { background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:14px; color:var(--text); }
    .toolbar-actions { grid-column:1 / -1; display:flex; align-items:center; justify-content:flex-end; flex-wrap:nowrap; gap:8px; width:100%; min-width:0; max-width:100%; overflow-x:auto; padding-bottom:2px; }
    .toolbar-actions > * { flex:0 0 auto; white-space:nowrap; }
    .toolbar-actions button { border:1px solid var(--line); border-radius:10px; padding:10px 12px; background:var(--text); color:var(--panel); cursor:pointer; font-weight:700; min-height:40px; }
    .toolbar-button { display:inline-flex; align-items:center; border:1px solid var(--line); border-radius:10px; padding:10px 12px; background:#1d4ed8; color:#fff; cursor:pointer; font-weight:700; text-decoration:none; min-height:40px; }
    .toolbar-actions button:hover { opacity:.86; }
    .issues-panel { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:18px; }
    .issue-card { background:var(--panel); border:1px solid var(--line); border-left:6px solid var(--low); border-radius:16px; padding:18px; box-shadow:var(--shadow); }
    .issue-card.Critical { border-left-color:var(--critical); }
    .issue-card.High { border-left-color:var(--high); }
    .issue-card.Medium { border-left-color:var(--medium); }
    .issue-card.Low { border-left-color:var(--low); }
    .issue-header { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; }
    .severity-badge { display:inline-block; padding:5px 10px; border-radius:999px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; }
    .severity-badge.Critical { background:#fee2e2; color:var(--critical); }
    .severity-badge.High { background:#ffedd5; color:var(--high); }
    .severity-badge.Medium { background:#dbeafe; color:var(--medium); }
    .severity-badge.Low { background:#e2e8f0; color:var(--low); }
    .category-tag { display:inline-block; margin-left:8px; font-size:11px; background:#f8fafc; border:1px solid var(--line); border-radius:999px; padding:5px 8px; color:var(--muted); }
    .issue-id { font-size:11px; color:var(--muted); }
    .issue-title-row { display:flex; align-items:flex-start; gap:8px; min-width:0; margin-bottom:12px; }
    .issue-card h3 { flex:1; min-width:0; margin:0; font-size:20px; line-height:1.35; min-height:54px; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
    .page-index { margin:0 0 22px; }
    .section-heading { display:flex; justify-content:space-between; align-items:end; gap:12px; }
    .section-heading h2 { margin:5px 0 0; }
    .section-heading > span { color:var(--muted); font-size:12px; }
    .page-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; margin-top:16px; }
    .page-card { border:1px solid var(--line); border-radius:12px; padding:14px; background:var(--soft); }
    .page-card-head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:12px; }
    .page-card h3 { margin:12px 0 7px; font-size:15px; }
    .page-card a { display:block; overflow-wrap:anywhere; font-size:12px; }
    .page-card p { color:var(--muted); font-size:12px; margin-bottom:0; }
    .issue-meta-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-bottom:12px; }
    .issue-meta-grid div, .issue-detail-grid div { min-width:0; background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:10px; }
    .issue-meta-grid strong, .issue-detail-grid strong { display:block; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:6px; }
    .issue-meta-grid span, .issue-detail-grid p, .issue-footer span, .recommendation-box { display:block; max-width:100%; overflow-wrap:anywhere; word-break:break-word; }
    .parameter-field { min-width:0; }
    .parameter-label { display:flex; align-items:center; justify-content:space-between; gap:6px; min-width:0; }
    .parameter-value { max-height:72px; overflow:hidden; }
    .parameter-value.is-collapsible { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
    .parameter-value.is-collapsible.expanded { display:block; max-height:none; overflow:visible; }
    .field-toggle { margin-top:7px; padding:0; border:0; background:transparent; color:#1d4ed8; cursor:pointer; font-size:12px; font-weight:700; }
    .copy-button { flex:0 0 auto; width:30px; height:30px; display:inline-grid; place-items:center; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--text); cursor:pointer; font-size:14px; line-height:1; }
    .copy-button:hover, .copy-button:focus-visible { border-color:#38bdf8; color:#0369a1; }
    .copy-button.copied { background:#dcfce7; border-color:#86efac; color:#166534; }
    .heading-copy { margin-top:1px; }
    .browser-details { margin-top:12px; border-top:1px solid var(--line); padding-top:10px; }
    .browser-details summary { cursor:pointer; color:var(--muted); font-size:12px; font-weight:800; }
    .browser-details-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:10px; }
    .issue-detail-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-bottom:12px; }
    .issue-detail-grid p { margin:0; font-size:14px; line-height:1.6; color:var(--text); }
    .issue-actions { display:flex; flex-wrap:wrap; align-items:flex-start; gap:8px; min-width:0; }
    .evidence-item { display:flex; flex-wrap:wrap; align-items:center; gap:6px; max-width:100%; }
    .evidence-button { background:#0f172a; color:#fff; border:1px solid #0f172a; border-radius:10px; padding:10px 12px; font-weight:700; cursor:pointer; white-space:nowrap; }
    .evidence-button.secondary { background:transparent; color:var(--text); border-color:var(--line); }
    .evidence-button:focus-visible, .modal-close:focus-visible { outline:3px solid #38bdf8; outline-offset:2px; }
    .evidence-dimensions { color:var(--muted); font-size:11px; }
    .recommendation-box { margin-top:12px; background:#fef3c7; border:1px solid #fcd34d; border-radius:10px; padding:10px 12px; color:#7c4701; font-size:13px; }
    .issue-details { margin-top:12px; min-width:0; }
    .issue-details summary { cursor:pointer; color:var(--muted); font-size:12px; font-weight:700; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:10px; max-height:260px; max-width:100%; overflow:auto; margin-top:12px; line-height:1.5; }
    .empty-state { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:24px; color:var(--muted); box-shadow:var(--shadow); }
    .report-shell { margin-top:30px; background:var(--panel); border-radius:14px; border:1px solid var(--line); box-shadow:var(--shadow); padding:20px; }
    .shots { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; max-width:100%; margin-top:12px; }
    .shots a { display:block; min-width:0; overflow:hidden; border:1px solid var(--line); border-radius:10px; background:var(--soft); }
    .shots img { display:block; width:100%; height:140px; object-fit:contain; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    th, td { padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; font-size:13px; }
    th { background:#eef2f7; }
    .modal { position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(15,23,42,0.7); z-index:50; }
    .modal.visible { display:flex; }
    .modal-content { position:relative; width:min(1200px, calc(100vw - 32px)); max-height:92vh; overflow:auto; background:var(--panel); color:var(--text); border-radius:18px; box-shadow:var(--shadow); padding:22px; }
    .modal-close { position:absolute; top:10px; right:12px; border:none; background:#0f172a; color:#fff; border-radius:50%; width:32px; height:32px; cursor:pointer; }
    .modal-header { margin-bottom:16px; }
    .modal-media { display:flex; justify-content:center; align-items:center; min-height:120px; overflow:auto; background:var(--soft); border:1px solid var(--line); border-radius:12px; padding:12px; }
    .modal-media img, .modal-media video { display:block; max-width:100%; width:auto; height:auto; max-height:78vh; object-fit:contain; border-radius:8px; background:#f8fafc; }
    [data-theme="dark"] { color-scheme:dark; --bg:#0b1120; --panel:#111827; --soft:#172033; --line:#293548; --text:#e5e7eb; --muted:#9ca3af; --shadow:0 18px 44px rgba(0,0,0,.24); }
    [data-theme="dark"] body { background:linear-gradient(180deg,#0b1120,#111827); }
    [data-theme="dark"] .topbar { background:#020617; }
    [data-theme="dark"] .field-group select, [data-theme="dark"] .field-group input, [data-theme="dark"] pre { background:#0b1120; color:var(--text); }
    [data-theme="dark"] .status-panel.failed { background:#2a1118; color:#fecdd3; border-color:#7f1d1d; }
    [data-theme="dark"] .status-panel.passed { background:#0d281c; color:#bbf7d0; border-color:#166534; }
    [data-theme="dark"] .recommendation-box { background:#33270d; border-color:#8a6415; color:#fde68a; }
    [data-theme="dark"] .issue-meta-grid div, [data-theme="dark"] .issue-detail-grid div { background:#172033; }
    @media (max-width: 768px) {
      .page-shell { padding:14px; }
      .topbar { flex-direction:column; }
      .issue-meta-grid, .issue-detail-grid { grid-template-columns:1fr; }
      .browser-details-grid { grid-template-columns:1fr; }
      .topbar-meta { text-align:left; }
      .status-panel { flex-direction:column; align-items:flex-start; }
      .insights-grid { grid-template-columns:1fr; }
      .toolbar-actions { align-items:center; justify-content:flex-start; width:100%; }
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

  private label(key: string): string {
    return key.replace(/[A-Z]/g, (match) => ` ${match}`).replace(/^./, (match) => match.toUpperCase());
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
