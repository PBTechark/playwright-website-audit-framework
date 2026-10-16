import fs from 'fs';
import path from 'path';
import { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

type IssueRecord = {
  site: string;
  url: string;
  category: string;
  issue: string;
  severity: string;
  viewport: string;
  impact: string;
  difficulty: string;
  recommendation: string;
  screenshot?: string | null;
  timestamp: string;
};

function ensureDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

export default class MaintenanceReporter implements Reporter {
  private issues: IssueRecord[] = [];
  private reportsDir = path.join(process.cwd(), 'reports');

  constructor() {
    ensureDir(this.reportsDir);
  }

  private collectAttachments(result: TestResult): Array<{ name?: string; contentType?: string; path?: string; body?: Buffer | string }> {
    const all: Array<{ name?: string; contentType?: string; path?: string; body?: Buffer | string }> = [];
    if (Array.isArray(result.attachments)) {
      all.push(...result.attachments);
    }

    const visitSteps = (step: TestStep) => {
      if (Array.isArray(step.attachments)) {
        all.push(...step.attachments);
      }
      for (const child of step.steps || []) {
        visitSteps(child);
      }
    };
    for (const step of result.steps || []) {
      visitSteps(step);
    }
    return all;
  }

  private readonly debug = process.env.MAINTENANCE_REPORTER_DEBUG === 'true';

  private debugAttachmentLog(message: string) {
    if (!this.debug) return;
    try {
      const debugPath = path.join(this.reportsDir, 'maintenance-reporter-debug.txt');
      fs.appendFileSync(debugPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
    } catch {
      // ignore debug logging failures
    }
  }

  private loadAuditResultAttachment(result: TestResult): { issues?: Array<Record<string, unknown>> } | null {
    const attachments = this.collectAttachments(result);
    this.debugAttachmentLog(`onTestEnd ${result.workerIndex} attachments=${attachments.length}`);
    const candidates = attachments.filter((attachment) => {
      const name = String(attachment.name ?? '').toLowerCase();
      const pathName = String(attachment.path ?? '').toLowerCase();
      const contentType = String(attachment.contentType ?? '').toLowerCase();
      const isAuditResultName = name.includes('audit') && name.includes('result');
      const isAuditResultPath = pathName.includes('audit-result') || pathName.includes('audit_result') || pathName.includes('audit result');
      const isJson = contentType.includes('application/json') || contentType.includes('+json');
      const matches = isAuditResultName || isAuditResultPath || (isJson && (name.includes('audit') || pathName.includes('audit')));
      this.debugAttachmentLog(`attachment name='${attachment.name}' path='${attachment.path}' contentType='${attachment.contentType}' matches=${matches}`);
      return matches;
    });

    this.debugAttachmentLog(`candidate count=${candidates.length}`);
    for (const attachment of candidates) {
      try {
        if (attachment.body) {
          const raw = attachment.body instanceof Buffer ? attachment.body.toString('utf8') : String(attachment.body);
          const parsed = JSON.parse(raw);
          this.debugAttachmentLog(`parsed body ${attachment.name} success? ${Boolean(parsed && Array.isArray(parsed.issues))}`);
          if (parsed && Array.isArray(parsed.issues)) return parsed;
        }
        if (attachment.path && fs.existsSync(attachment.path)) {
          const raw = fs.readFileSync(attachment.path, 'utf8');
          const parsed = JSON.parse(raw);
          this.debugAttachmentLog(`parsed file ${attachment.path} success? ${Boolean(parsed && Array.isArray(parsed.issues))}`);
          if (parsed && Array.isArray(parsed.issues)) return parsed;
        }
      } catch (err) {
        this.debugAttachmentLog(`failed parse ${attachment.name} path=${attachment.path} err=${String(err)}`);
      }
    }
    return null;
  }

  private normalizePathForReport(filePath: string | undefined): string | null {
    if (!filePath) return null;
    try {
      const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      const relative = path.relative(this.reportsDir, abs).split(path.sep).join('/');
      return relative;
    } catch {
      return filePath.split(path.sep).join('/');
    }
  }

  private findScreenshotPath(issue: Record<string, unknown>, result: TestResult): string | null {
    const mediaRegex = /\.(png|jpe?g|webp|gif|svg|webm|mp4)$/i;
    const evidence = Array.isArray(issue.evidence) ? issue.evidence : [];
    for (const candidate of evidence) {
      if (typeof candidate !== 'string') continue;
      if (mediaRegex.test(candidate)) {
        return this.normalizePathForReport(candidate);
      }
    }

    for (const attachment of result.attachments || []) {
      const name = String(attachment.name ?? '').toLowerCase();
      if (attachment.path && mediaRegex.test(attachment.path)) {
        return this.normalizePathForReport(String(attachment.path));
      }
      if (attachment.path && /screenshot|image|video/i.test(name) && !attachment.contentType?.includes('application/json')) {
        return this.normalizePathForReport(String(attachment.path));
      }
    }

    return null;
  }

  private auditRecordsFromResult(test: TestCase, result: TestResult): IssueRecord[] {
    const audit = this.loadAuditResultAttachment(result);
    if (!audit || !Array.isArray(audit.issues) || audit.issues.length === 0) return [];

    const site = (test.parent && test.parent.title) ? test.parent.title.replace(/\s+/g, '').toLowerCase() : 'unknown';
    return audit.issues.map((issue) => {
      const url = typeof issue.url === 'string' ? issue.url : 'unknown';
      const category = typeof issue.category === 'string' ? issue.category : 'Technical';
      const severity = typeof issue.severity === 'string' ? issue.severity : 'Medium';
      const title = typeof issue.description === 'string' ? issue.description : 'Audit issue';
      const viewport = typeof issue.viewport === 'string' ? issue.viewport : `worker-${result.workerIndex ?? '0'}`;
      const impact = typeof issue.businessImpact === 'string' ? issue.businessImpact : 'See recommendation';
      const recommendation =
        typeof issue.suggestedFix === 'string'
          ? issue.suggestedFix
          : typeof issue.recommendation === 'string'
          ? issue.recommendation
          : 'See test assertion or screenshot for remediation';
      const timestamp = typeof issue.timestamp === 'string' ? issue.timestamp : new Date().toISOString();
      const screenshot = this.findScreenshotPath(issue, result);

      return {
        site: site || 'site',
        url,
        category,
        issue: title,
        severity,
        viewport,
        impact,
        difficulty: 'Intermediate',
        recommendation,
        screenshot,
        timestamp
      };
    });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    try {
      const auditRecords = this.auditRecordsFromResult(test, result);
      if (auditRecords.length > 0) {
        this.issues.push(...auditRecords);
        return;
      }

      const title = test.title || '';
      // Expect title like: Category: Visual | Severity: High | Issue: Off-screen content | Page: ${url} | Viewport: Desktop Full HD
      const parts = title.split('|').map((p) => p.trim());
      const fields: Record<string, string> = {};
      for (const p of parts) {
        const m = p.match(/^(Category|Severity|Issue|Page|Viewport):\s*(.+)$/i);
        if (m) fields[m[1].toLowerCase()] = m[2].trim();
      }

      const isAuditSuite = String(test.parent?.title ?? '').toLowerCase().includes('automated website audit') || test.location?.file?.endsWith('website-audit.spec.ts');
      const hasIssue = Boolean(fields['issue']);
      const isFailed = result.status === 'failed';
      if (!isAuditSuite) return;
      if (!isFailed && !hasIssue) return;

      const site = (test.parent && test.parent.title) ? test.parent.title.replace(/\s+/g, '').toLowerCase() : 'unknown';
      const url = fields['page'] ?? 'unknown';
      const category = fields['category'] ?? (isFailed ? 'Technical' : 'Unknown');
      const severity = fields['severity'] ?? (isFailed ? 'High' : 'Medium');
      const issue = fields['issue'] ?? (result.error?.message?.split('\n')[0] ?? 'Test failure');
      const viewport = (fields['viewport'] || (result?.workerIndex !== undefined ? `worker-${result.workerIndex}` : 'Unknown'));

      // Determine screenshot/ media attachment if present and normalize path for browser use
      let screenshotPath: string | null = null;
      const mediaRegex = /\.(png|jpe?g|webp|gif|svg|webm|mp4)$/i;
      const hintRegex = /vimeo|video|screenshot/i;
      for (const att of result.attachments || []) {
        const name = String(att.name ?? att.path ?? '');
        if (att.path && (mediaRegex.test(name) || hintRegex.test(name))) {
          try {
            screenshotPath = path.relative(this.reportsDir, String(att.path));
            // normalize windows backslashes to forward slashes for browser file:// compatibility
            if (path.sep === '\\') screenshotPath = screenshotPath.split('\\').join('/');
          } catch {
            screenshotPath = String(att.path).split(path.sep).join('/');
          }
          break;
        }
      }

      const record: IssueRecord = {
        site: site || 'site',
        url: url || 'unknown',
        category,
        issue,
        severity,
        viewport,
        impact: 'See recommendation',
        difficulty: 'Intermediate',
        recommendation: 'See test assertion or screenshot for remediation',
        screenshot: screenshotPath ?? null,
        timestamp: new Date().toISOString()
      };

      this.issues.push(record);
    } catch (err) {
      // swallow and continue
      console.error('maintenance-reporter:onTestEnd error', err);
    }
  }

  async onEnd() {
    try {
      ensureDir(this.reportsDir);
      const jsonPath = path.join(this.reportsDir, 'issues.json');
      const csvPath = path.join(this.reportsDir, 'issues.csv');
      const htmlPath = path.join(this.reportsDir, 'maintenance.html');

      // write JSON
      fs.writeFileSync(jsonPath, JSON.stringify(this.issues, null, 2), 'utf8');

      // write CSV
      const headers = ['site', 'url', 'category', 'issue', 'severity', 'viewport', 'impact', 'difficulty', 'recommendation', 'screenshot', 'timestamp'];
      const rows = [headers.join(',')];
      for (const i of this.issues) {
        const esc = (v: string | null | undefined) => {
          if (v === null || v === undefined) return '';
          const s = String(v).replace(/"/g, '""');
          return `"${s}"`;
        };
        rows.push([
          esc(i.site), esc(i.url), esc(i.category), esc(i.issue), esc(i.severity), esc(i.viewport), esc(i.impact), esc(i.difficulty), esc(i.recommendation), esc(i.screenshot), esc(i.timestamp)
        ].join(','));
      }
      fs.writeFileSync(csvPath, rows.join('\n'), 'utf8');

      // Copy UI assets from src -> reports (if present)
      const srcDir = path.join(process.cwd(), 'src');
      const cssSrc = path.join(srcDir, 'report-styles.css');
      const jsSrc = path.join(srcDir, 'report-script.js');
      try { if (fs.existsSync(cssSrc)) fs.copyFileSync(cssSrc, path.join(this.reportsDir, 'report-styles.css')); } catch {}
      try { if (fs.existsSync(jsSrc)) fs.copyFileSync(jsSrc, path.join(this.reportsDir, 'report-script.js')); } catch {}

      // Write a simple maintenance.html that will fetch issues.json and render via report-script.js
      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Maintenance Report</title>
  <link rel="stylesheet" href="./report-styles.css">
</head>
<body>
  <div id="maintenance-root"></div>
  <script>window.__ISSUES_JSON_PATH = './issues.json';</script>
  <script src="./report-script.js"></script>
</body>
</html>`;
      fs.writeFileSync(htmlPath, html, 'utf8');
    } catch (err) {
      console.error('maintenance-reporter:onEnd error', err);
    }
  }
}
