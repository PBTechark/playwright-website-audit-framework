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

type RawCacheEntry = { mtimeMs: number; result: AuditResult | null };

/**
 * Parsed results per directory. Only the two most recently read directories are kept (the
 * running audit and the one being viewed), so a long-running server's memory stays bounded.
 */
const rawCache = new Map<string, Map<string, RawCacheEntry>>();
const RAW_CACHE_DIRECTORIES = 2;

function directoryCache(dir: string): Map<string, RawCacheEntry> {
  const cache = rawCache.get(dir) ?? new Map<string, RawCacheEntry>();
  rawCache.delete(dir);
  rawCache.set(dir, cache);
  while (rawCache.size > RAW_CACHE_DIRECTORIES) rawCache.delete(rawCache.keys().next().value as string);
  return cache;
}

/** Page/viewport results written by the engine, filtered exactly as its HTML report filters them. */
export function readRawResults(rawResultsDir: string, since?: Date): AuditResult[] {
  if (!fs.existsSync(rawResultsDir)) return [];
  const cache = directoryCache(rawResultsDir);
  const files = fs.readdirSync(rawResultsDir).filter((file) => file.endsWith('.json'));
  const present = new Set(files);
  // Each engine run clears raw-results/; forget files that no longer exist.
  for (const cachedFile of cache.keys()) if (!present.has(cachedFile)) cache.delete(cachedFile);
  return files
    .map((file) => {
      const filePath = path.join(rawResultsDir, file);
      const { mtimeMs } = fs.statSync(filePath);
      if (since && mtimeMs < since.getTime()) return null;
      const cached = cache.get(file);
      if (cached?.mtimeMs === mtimeMs) return cached.result;
      let result: AuditResult | null = null;
      try {
        const parsed = readJsonFile<AuditResult | null>(filePath, null);
        // The assertion register is about three quarters of each file and the dashboard never reads it.
        result = parsed ? { ...sanitizeAuditResultForReporting(parsed), checks: undefined } : null;
      } catch {
        // The engine may still be writing this file; it is picked up on the next poll.
      }
      cache.set(file, { mtimeMs, result });
      return result;
    })
    .filter((result): result is AuditResult => Boolean(result));
}

/**
 * Same key as the dashboard's issue list and the HTML report: findings of one problem on one page
 * (one per element and viewport) count as one issue, so every count a reader sees agrees.
 */
function issueKey(issue: AuditIssue, result: AuditResult): string {
  return [issue.severity, issue.category, issue.url || result.page.url, issue.description].join('\u0000');
}

function countIssues(result: AuditResult): number {
  return new Set(result.issues.map((issue) => issueKey(issue, result))).size;
}

export function buildSummary(results: AuditResult[], viewports: string[], healthScore: number | null): AuditSummary {
  const issues = new Map<string, AuditIssue['severity']>();
  for (const result of results) for (const issue of result.issues) issues.set(issueKey(issue, result), issue.severity);
  const severities = [...issues.values()];
  const count = (severity: AuditIssue['severity']) => severities.filter((value) => value === severity).length;
  return {
    pagesTested: new Set(results.map((result) => result.page.url)).size,
    viewportsTested: viewports.filter((viewport) => results.some((result) => result.viewport === viewport)),
    totalIssues: issues.size,
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
  const pageIssues = new Map<string, Set<string>>();
  for (const result of results) {
    const page = pages.get(result.page.url) ?? {
      url: result.page.url,
      title: result.page.title,
      status: result.page.status,
      issues: 0,
      viewports: []
    };
    const keys = pageIssues.get(page.url) ?? new Set<string>();
    result.issues.forEach((issue) => keys.add(issueKey(issue, result)));
    pageIssues.set(page.url, keys);
    page.issues = keys.size;
    page.viewports.push({
      viewport: result.viewport,
      resolution: result.resolution?.label,
      issues: countIssues(result),
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
