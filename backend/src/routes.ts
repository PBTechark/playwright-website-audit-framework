import { createHash } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { auditConfig, backendConfig, viewportProjects } from './config';
import {
  AppConfigResponse,
  AuditLogChunk,
  AuditRecord,
  AuditResultsResponse,
  DashboardResponse
} from './apiTypes';
import { buildFindings, buildPages, buildSummary, listReports, readRawResults } from './auditResults';
import { AuditRunner } from './auditRunner';
import { AuditStore } from './auditStore';
import { Auth } from './auth';
import { HttpError } from './httpError';
import { pdfDownloadName, reportPdf } from './reportPdf';
import { readSavedWebsites } from './savedWebsites';
import { assertPublicUrl, parseAuditSettings } from './validation';

const CRAWL_SOURCES = [
  'Start page',
  'XML sitemaps',
  'HTML sitemaps',
  'Header navigation',
  'Footer navigation',
  'Breadcrumbs',
  'Internal links'
];
const LOG_CHUNK_BYTES = 256 * 1024;

type Handler = (req: Request, res: Response) => unknown;
const handle =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export function createApiRouter(store: AuditStore, runner: AuditRunner, auth: Auth): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));

  router.post(
    '/auth/login',
    handle((req, res) => res.json({ userId: auth.login(req, res) }))
  );
  router.post(
    '/auth/logout',
    handle((req, res) => {
      auth.logout(req, res);
      res.status(204).end();
    })
  );
  router.get(
    '/auth/session',
    handle((req, res) => {
      const userId = auth.currentUser(req);
      if (!userId) throw new HttpError(401, 'Please sign in.');
      res.json({ userId });
    })
  );

  router.use(auth.requireSession);

  router.get(
    '/config',
    handle((_req, res) => {
      const body: AppConfigResponse = {
        viewports: viewportProjects.map(({ name, width, height }) => ({ name, width, height })),
        limits: { maxPages: backendConfig.maxPagesLimit, maxDepth: backendConfig.maxDepthLimit },
        defaults: {
          maxPages: Math.min(auditConfig.defaultMaxPages, backendConfig.maxPagesLimit),
          maxDepth: Math.min(auditConfig.defaultMaxDepth, backendConfig.maxDepthLimit),
          screenshots: auditConfig.screenshotMode !== 'off'
        },
        crawlSources: CRAWL_SOURCES,
        savedWebsites: readSavedWebsites(),
        activeAuditId: runner.activeAuditId
      };
      res.json(body);
    })
  );

  router.get(
    '/dashboard',
    handle((_req, res) => {
      const audits = store.list().map((record) => runner.getRecord(record.id) ?? record);
      const finished = audits.filter((audit) => audit.summary);
      const sum = (pick: (audit: AuditRecord) => number) => finished.reduce((total, audit) => total + pick(audit), 0);
      const body: DashboardResponse = {
        totals: {
          audits: audits.length,
          completed: audits.filter((audit) => audit.status === 'completed').length,
          failed: audits.filter((audit) => audit.status === 'failed' || audit.status === 'interrupted').length,
          pagesTested: sum((audit) => audit.summary?.pagesTested ?? 0),
          issuesFound: sum((audit) => audit.summary?.totalIssues ?? 0),
          critical: sum((audit) => audit.summary?.critical ?? 0),
          high: sum((audit) => audit.summary?.high ?? 0)
        },
        recent: audits.slice(0, 5),
        activeAuditId: runner.activeAuditId
      };
      res.json(body);
    })
  );

  router.get(
    '/audits',
    handle((_req, res) => res.json(store.list().map((record) => runner.getRecord(record.id) ?? record)))
  );

  router.post(
    '/audits',
    handle(async (req, res) => {
      const settings = parseAuditSettings(req.body);
      await assertPublicUrl(settings.url);
      res.status(201).json(runner.start(settings));
    })
  );

  router.get(
    '/audits/:id',
    handle((req, res) => res.json(findAudit(req)))
  );

  router.get(
    '/audits/:id/progress',
    handle((req, res) => res.json(runner.getProgress(findAudit(req))))
  );

  router.get(
    '/audits/:id/log',
    handle((req, res) => {
      const audit = findAudit(req);
      const logPath = store.logPath(audit.id);
      const size = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      const requested = Number(req.query.from);
      // Default to the tail so a long log does not flood the browser on first load.
      const from = Number.isInteger(requested) && requested >= 0 ? Math.min(requested, size) : Math.max(0, size - LOG_CHUNK_BYTES);
      const length = Math.min(size - from, LOG_CHUNK_BYTES);
      const buffer = Buffer.alloc(length);
      if (length > 0) {
        const fd = fs.openSync(logPath, 'r');
        try {
          fs.readSync(fd, buffer, 0, length, from);
        } finally {
          fs.closeSync(fd);
        }
      }
      const body: AuditLogChunk = { text: buffer.toString('utf-8'), next: from + length };
      res.json(body);
    })
  );

  router.get(
    '/audits/:id/results',
    handle((req, res) => {
      const audit = findAudit(req);
      if (audit.status === 'running') throw new HttpError(409, 'Results are available when the audit finishes.');
      const artifactsDir = store.artifactsDir(audit.id);
      const results = readRawResults(path.join(artifactsDir, 'raw-results'));
      const body: AuditResultsResponse = {
        audit,
        available: results.length > 0,
        summary: audit.summary ?? buildSummary(results, audit.settings.viewports, null),
        findings: buildFindings(results),
        pages: buildPages(results, audit.settings.viewports),
        reports: listReports(artifactsDir),
        hasScreenshots: fs.existsSync(path.join(artifactsDir, 'screenshots'))
      };
      res.json(body);
    })
  );

  router.post(
    '/audits/:id/cancel',
    handle((req, res) => res.json(runner.cancel(findAudit(req).id)))
  );

  router.post(
    '/audits/:id/rerun',
    handle(async (req, res) => {
      const previous = findAudit(req);
      const settings = parseAuditSettings(previous.settings);
      await assertPublicUrl(settings.url);
      res.status(201).json(runner.start(settings, previous.id));
    })
  );

  router.get(
    '/audits/:id/screenshots.zip',
    handle(async (req, res) => {
      const audit = findAudit(req);
      const screenshotsDir = path.join(store.artifactsDir(audit.id), 'screenshots');
      if (!fs.existsSync(screenshotsDir)) throw new HttpError(404, 'This audit has no screenshots.');
      // archiver is ESM-only, so it is loaded with import() from this CommonJS package.
      const { ZipArchive } = await import('archiver');
      res.attachment(`${audit.id}-screenshots.zip`);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      archive.on('error', (error) => res.destroy(error));
      archive.pipe(res);
      archive.directory(screenshotsDir, 'screenshots');
      archive.finalize();
    })
  );

  // PDF of an engine HTML report (the full audit report by default), rendered on demand and cached.
  router.get(
    '/audits/:id/report.pdf',
    handle(async (req, res) => {
      const audit = findAudit(req);
      if (audit.status === 'running') throw new HttpError(409, 'The report is available when the audit finishes.');
      const reportsDir = path.join(store.artifactsDir(audit.id), 'reports');
      const requested = typeof req.query.path === 'string' ? req.query.path : 'reports/website-audit-report.html';
      const htmlPath = path.resolve(store.artifactsDir(audit.id), requested);
      if (!/\.html?$/i.test(htmlPath) || !htmlPath.startsWith(`${reportsDir}${path.sep}`) || !fs.existsSync(htmlPath)) {
        throw new HttpError(404, 'Report not found.');
      }
      res.download(await reportPdf(htmlPath), pdfDownloadName(websiteNameOf(audit), htmlPath));
    })
  );

  // Report and screenshot files from the audit's own snapshot. HTML reports link to
  // ../screenshots/..., which resolves inside the same folder.
  router.get(
    '/audits/:id/files/*',
    handle((req, res) => {
      const audit = findAudit(req);
      const root = store.artifactsDir(audit.id);
      const filePath = path.resolve(root, String((req.params as Record<string, string>)[0] ?? ''));
      if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new HttpError(404, 'File not found.');
      }
      if (req.query.download !== undefined) res.download(filePath);
      else if (/\.html?$/i.test(filePath)) sendReportHtml(res, filePath);
      else res.sendFile(filePath);
    })
  );

  router.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));

  return router;

  function findAudit(req: Request): AuditRecord {
    const audit = runner.getRecord(req.params.id);
    if (!audit) throw new HttpError(404, 'Audit not found.');
    return audit;
  }
}

/**
 * Engine reports contain text taken from audited websites. They are served from the dashboard's own
 * origin, so a CSP allows only the report's own scripts (by hash): markup injected from a crawled
 * page cannot run scripts or call the API with the user's session.
 */
function sendReportHtml(res: Response, filePath: string): void {
  const html = fs.readFileSync(filePath, 'utf-8');
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
    ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`
  );
  res.set(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      `script-src 'self' ${inlineScripts.join(' ')}`.trim(),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "media-src 'self'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'"
    ].join('; ')
  );
  res.type('html').send(html);
}

/** JSON error responses that never include stack traces or server paths. */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'The request body is not valid JSON.' });
    return;
  }
  // body-parser errors such as 413 (body too large) or 415 (unsupported encoding).
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: status === 413 ? 'The request is too large.' : 'The request could not be read.' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Something went wrong on the server. Check the backend log.' });
}

function websiteNameOf(audit: AuditRecord): string {
  if (audit.settings.name) return audit.settings.name;
  try {
    return new URL(audit.settings.url).hostname.replace(/^www\./, '');
  } catch {
    return 'website';
  }
}
