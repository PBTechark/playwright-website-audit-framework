// API contract shared by the backend and the frontend (frontend/ imports this file type-only).
import type { AuditCategory, Severity } from '../../utils/types';

export type { AuditCategory, Severity };

export interface ViewportOption {
  name: string;
  width?: number;
  height?: number;
}

/** An enabled row of test-data/audit-targets.csv with engine defaults applied. */
export interface SavedWebsite {
  name: string;
  url: string;
  maxPages: number;
  maxDepth: number;
}

export interface AppConfigResponse {
  viewports: ViewportOption[];
  limits: { maxPages: number; maxDepth: number };
  defaults: { maxPages: number; maxDepth: number; screenshots: boolean };
  crawlSources: string[];
  savedWebsites: SavedWebsite[];
  activeAuditId: string | null;
}

/** Settings for one audit run. They never overwrite the saved-website CSV. */
export interface AuditSettings {
  url: string;
  name: string;
  label: string;
  maxPages: number;
  maxDepth: number;
  viewports: string[];
  screenshots: boolean;
  /** Name of the saved website the form was filled from, if any. */
  savedWebsite: string | null;
}

export type AuditStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type AuditPhase = 'crawling' | 'auditing' | 'reporting' | 'finished';

export interface AuditSummary {
  pagesTested: number;
  viewportsTested: string[];
  totalIssues: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** Health score from the engine's report, when the report was generated. */
  healthScore: number | null;
}

export interface AuditRecord {
  id: string;
  settings: AuditSettings;
  status: AuditStatus;
  phase: AuditPhase;
  createdAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  error?: string;
  /** Engine checks that failed (for example a page returning HTTP 5xx). */
  failedChecks?: number;
  summary?: AuditSummary;
  rerunOf?: string;
}

export interface AuditProgress {
  auditId: string;
  status: AuditStatus;
  phase: AuditPhase;
  elapsedMs: number;
  pagesDiscovered: number | null;
  pagesCompleted: number;
  pagesRemaining: number | null;
  checksTotal: number | null;
  checksCompleted: number;
  checksFailed: number;
  issuesFound: number;
  /** Page/viewport pairs Playwright is executing right now. */
  current: Array<{ url: string; viewport: string }>;
}

export interface AuditLogChunk {
  text: string;
  next: number;
}

export interface Finding {
  id: string;
  category: AuditCategory;
  severity: Severity;
  url: string;
  viewport: string;
  description: string;
  selector?: string;
  expected?: string;
  actual?: string;
  suggestedFix: string;
  /** Paths relative to the audit's file store, e.g. screenshots/<site>/<viewport>/... */
  evidence: string[];
}

export interface PageViewportResult {
  viewport: string;
  resolution?: string;
  issues: number;
  screenshots: Array<{ label: string; path: string }>;
  loadTimeMs?: number;
}

export interface PageResult {
  url: string;
  title?: string;
  status?: number;
  issues: number;
  viewports: PageViewportResult[];
}

export interface ReportLink {
  label: string;
  path: string;
  kind: 'html' | 'json' | 'xls';
}

export interface AuditResultsResponse {
  audit: AuditRecord;
  /** False when the run produced no page results (for example cancelled during crawling). */
  available: boolean;
  summary: AuditSummary;
  findings: Finding[];
  pages: PageResult[];
  reports: ReportLink[];
  hasScreenshots: boolean;
}

export interface DashboardResponse {
  totals: {
    audits: number;
    completed: number;
    failed: number;
    pagesTested: number;
    issuesFound: number;
    critical: number;
    high: number;
  };
  recent: AuditRecord[];
  activeAuditId: string | null;
}
