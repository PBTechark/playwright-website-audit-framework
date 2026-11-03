import fs from 'fs';
import path from 'path';
import { ensureDir, readJsonFile, safeFileName } from '../../utils/fileSystem';
import { sanitizeAuditResultForReporting } from '../../utils/reportFilters';
import { AuditIssue, AuditResult } from '../../utils/types';
import { auditConfig } from './config';
import { AuditRecord, AuditSummary, Finding, PageResult, ReportLink } from './apiTypes';

const reportLabels: Record<string, string> = {
  'website-audit-report.html': 'Full audit report',
  'broken-links-report.html': 'Broken links',
  'broken-images-report.html': 'Broken images',
  'responsive-report.html': 'Responsive',
  'accessibility-report.html': 'Accessibility',
  'seo-report.html': 'SEO',
  'performance-report.html': 'Performance',
  'video-report.html': 'Video',
  'website-audit-report.json': 'Report data (JSON)',
  'website-audit-report.xls': 'Spreadsheet (XLS)'
};

const rawCache = new Map<string, { mtimeMs: number; result: AuditResult | null }>();

/** Page/viewport results written by the engine, filtered exactly as its HTML report filters them. */
export function readRawResults(rawResultsDir: string, since?: Date): AuditResult[] {
  if (!fs.existsSync(rawResultsDir)) return [];
  return fs
    .readdirSync(rawResultsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const filePath = path.join(rawResultsDir, file);
      const { mtimeMs } = fs.statSync(filePath);
      if (since && mtimeMs < since.getTime()) return null;
      const cached = rawCache.get(filePath);
      if (cached?.mtimeMs === mtimeMs) return cached.result;
      let result: AuditResult | null = null;
      try {
        const parsed = readJsonFile<AuditResult | null>(filePath, null);
        result = parsed ? sanitizeAuditResultForReporting(parsed) : null;
      } catch {
        // The engine may still be writing this file; it is picked up on the next poll.
      }
      rawCache.set(filePath, { mtimeMs, result });
      return result;
    })
    .filter((result): result is AuditResult => Boolean(result));
}

export function buildSummary(results: AuditResult[], viewports: string[], healthScore: number | null): AuditSummary {
  const issues = results.flatMap((result) => result.issues);
  const count = (severity: AuditIssue['severity']) => issues.filter((issue) => issue.severity === severity).length;
  return {
    pagesTested: new Set(results.map((result) => result.page.url)).size,
    viewportsTested: viewports.filter((viewport) => results.some((result) => result.viewport === viewport)),
    totalIssues: issues.length,
    critical: count('Critical'),
    high: count('High'),
    medium: count('Medium'),
    low: count('Low'),
    healthScore
  };
}

export function buildFindings(results: AuditResult[]): Finding[] {
  const severityRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  return results
    .flatMap((result) =>
      result.issues.map((issue) => ({
        id: `${issue.id}-${result.viewport}`,
        category: issue.category,
        severity: issue.severity,
        url: issue.url || result.page.url,
        viewport: issue.viewport || result.viewport,
        description: issue.description,
        selector: issue.selector,
        expected: issue.expected,
        actual: issue.actual,
        suggestedFix: issue.suggestedFix,
        evidence: unique(
          [...(issue.evidenceDetails?.map((item) => item.path) ?? []), ...(issue.evidence ?? [])]
            .map(toEvidencePath)
            .filter((item): item is string => Boolean(item))
        )
      }))
    )
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

export function buildPages(results: AuditResult[], viewportOrder: string[]): PageResult[] {
  const pages = new Map<string, PageResult>();
  for (const result of results) {
    const page = pages.get(result.page.url) ?? {
      url: result.page.url,
      title: result.page.title,
      status: result.page.status,
      issues: 0,
      viewports: []
    };
    page.issues += result.issues.length;
    page.viewports.push({
      viewport: result.viewport,
      resolution: result.resolution?.label,
      issues: result.issues.length,
      screenshots: result.screenshots
        .map((shot) => ({ label: shot.label, path: toEvidencePath(shot.path) }))
        .filter((shot): shot is { label: string; path: string } => Boolean(shot.path)),
      loadTimeMs: result.performance?.loadTimeMs
    });
    pages.set(page.url, page);
  }
  const pageList = [...pages.values()];
  pageList.forEach((page) =>
    page.viewports.sort((a, b) => viewportOrder.indexOf(a.viewport) - viewportOrder.indexOf(b.viewport))
  );
  return pageList.sort((a, b) => b.issues - a.issues || a.url.localeCompare(b.url));
}

export function listReports(artifactsDir: string): ReportLink[] {
  const reportsDir = path.join(artifactsDir, 'reports');
  return Object.entries(reportLabels)
    .filter(([file]) => fs.existsSync(path.join(reportsDir, file)))
    .map(([file, label]) => ({
      label,
      path: `reports/${file}`,
      kind: file.endsWith('.json') ? 'json' : file.endsWith('.xls') ? 'xls' : 'html'
    }));
}

/**
 * Copies this run's engine output into the audit's own folder so history survives later runs,
 * which overwrite reports/ and add to screenshots/. Only files produced since the run started
 * are copied, preserving the reports/ + screenshots/ layout so the HTML reports' links work.
 */
export function snapshotArtifacts(record: AuditRecord, artifactsDir: string): AuditResult[] {
  const since = new Date(record.createdAt);
  const rawFiles = listFilesSince(auditConfig.rawResultsDir, since);
  const results = readRawResults(auditConfig.rawResultsDir, since);
  rawFiles.forEach((file) => copyInto(file, path.join(artifactsDir, 'raw-results', path.basename(file))));

  const reportJson = path.join(auditConfig.reportsDir, 'website-audit-report.json');
  if (fs.existsSync(reportJson) && fs.statSync(reportJson).mtimeMs >= since.getTime()) {
    listFilesSince(auditConfig.reportsDir, new Date(0)).forEach((file) =>
      copyInto(file, path.join(artifactsDir, 'reports', path.basename(file)))
    );
    for (const targetName of new Set(results.map((result) => result.targetName))) {
      const dirName = safeFileName(targetName);
      listFilesSince(path.join(auditConfig.reportsDir, dirName), new Date(0)).forEach((file) =>
        copyInto(file, path.join(artifactsDir, 'reports', dirName, path.basename(file)))
      );
    }
  }

  const screenshots = new Set<string>();
  collectEvidencePaths(results, screenshots);
  screenshots.forEach((relative) =>
    copyInto(path.join(auditConfig.rootDir, relative), path.join(artifactsDir, relative))
  );
  return results;
}

export function readReportHealthScore(artifactsDir: string): number | null {
  const report = readJsonFile<{ summary?: { healthScore?: number } } | null>(
    path.join(artifactsDir, 'reports', 'website-audit-report.json'),
    null
  );
  return typeof report?.summary?.healthScore === 'number' ? report.summary.healthScore : null;
}

/** Normalizes an engine evidence path to "screenshots/..." relative to the engine root. */
function toEvidencePath(filePath: string | undefined): string | null {
  if (!filePath) return null;
  let normalized = filePath.replace(/\\/g, '/');
  const root = auditConfig.rootDir.replace(/\\/g, '/');
  if (normalized.startsWith(`${root}/`)) normalized = normalized.slice(root.length + 1);
  normalized = normalized.replace(/^(\.\.\/)+/, '');
  return normalized.startsWith('screenshots/') && !normalized.includes('../') ? normalized : null;
}

function collectEvidencePaths(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    const evidence = toEvidencePath(value);
    if (evidence) into.add(evidence);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectEvidencePaths(item, into));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectEvidencePaths(item, into));
  }
}

function listFilesSince(dir: string, since: Date): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((file) => fs.statSync(file).mtimeMs >= since.getTime());
}

function copyInto(source: string, destination: string): void {
  if (!fs.existsSync(source)) return;
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
