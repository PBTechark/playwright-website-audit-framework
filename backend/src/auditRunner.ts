import { ChildProcess, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { ensureDir } from '../../utils/fileSystem';
import { Logger } from '../../utils/logger';
import { runLockHolder } from '../../utils/runLock';
import { auditConfig, backendConfig } from './config';
import { AuditProgress, AuditRecord, AuditSettings } from './apiTypes';
import { buildSummary, readRawResults, readReportHealthScore, snapshotArtifacts } from './auditResults';
import { AuditStore } from './auditStore';
import { HttpError } from './httpError';
import { writeRunTargetCsv } from './savedWebsites';

interface ActiveJob {
  record: AuditRecord;
  child: ChildProcess;
  timeout: NodeJS.Timeout;
  partialLine: string;
  stopReason?: 'cancelled' | 'timeout';
}

type ProgressEvent =
  | { type: 'begin'; total: number }
  | { type: 'testBegin' | 'testEnd'; id: string; viewport: string; url: string; status?: string; final?: boolean }
  | { type: 'end'; status: string };

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]/g;
const playwrightCli = require.resolve('@playwright/test/cli', { paths: [auditConfig.rootDir] });

/**
 * Runs the existing Playwright engine as a background child process. Every audit writes to the
 * engine's shared reports/, screenshots/ and page inventory, so one job runs at a time.
 */
export class AuditRunner {
  private readonly logger = new Logger('DashboardBackend');
  private active: ActiveJob | null = null;

  constructor(private readonly store: AuditStore) {
    this.markInterruptedAudits();
  }

  get activeAuditId(): string | null {
    return this.active?.record.id ?? null;
  }

  start(settings: AuditSettings, rerunOf?: string): AuditRecord {
    if (this.active) {
      throw new HttpError(409, 'Another audit is already running. Wait for it to finish or cancel it first.');
    }
    // Command-line runs (npm run audit) share the engine folder but are not tracked by this server.
    if (runLockHolder() !== null) {
      throw new HttpError(409, 'An audit started from the command line is running on this server. Try again when it finishes.');
    }
    const id = createAuditId();
    ensureDir(this.store.dir(id));
    writeRunTargetCsv(this.store.targetsCsvPath(id), {
      name: settings.name || new URL(settings.url).hostname.replace(/^www\./, ''),
      url: settings.url,
      maxPages: settings.maxPages,
      maxDepth: settings.maxDepth
    });

    const record: AuditRecord = {
      id,
      settings,
      status: 'running',
      phase: 'crawling',
      createdAt: new Date().toISOString(),
      ...(rerunOf ? { rerunOf } : {})
    };
    this.store.save(record);
    fs.writeFileSync(
      this.store.logPath(id),
      `Audit ${id}: ${settings.url} | ${settings.viewports.join(', ')} | max ${settings.maxPages} pages, depth ${settings.maxDepth}\n`,
      'utf-8'
    );

    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${backendConfig.engineHeapMb}`,
        playwrightCli,
        'test',
        '--config=playwright.config.ts',
        ...settings.viewports.map((viewport) => `--project=${viewport}`)
      ],
      {
        cwd: auditConfig.rootDir,
        env: {
          ...engineEnv(),
          TARGETS_CSV: this.store.targetsCsvPath(id),
          AUDIT_PROGRESS_FILE: this.store.progressPath(id),
          AUDIT_WORKERS: String(backendConfig.workers),
          SCREENSHOT_MODE: settings.screenshots ? 'on' : 'off',
          // Findings are reported in the dashboard; the CI quality gate would mark every audit with
          // issues as a failed job.
          AUDIT_FAIL_ON_SEVERITY: 'Off',
          FORCE_COLOR: '0'
        },
        // Own process group, so cancel() stops Playwright workers and browsers together.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    const job: ActiveJob = {
      record,
      child,
      partialLine: '',
      timeout: setTimeout(() => this.stop(job, 'timeout'), backendConfig.jobTimeoutMs)
    };
    this.active = job;
    child.stdout?.on('data', (chunk: Buffer) => this.handleOutput(job, chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.handleOutput(job, chunk));
    child.on('error', (error) => {
      this.appendLog(job, `\nCould not start the Playwright engine: ${error.message}\n`);
      this.finish(job, null);
    });
    child.on('close', (code) => this.finish(job, code));
    this.logger.info(`Started audit ${id} for ${settings.url}`);
    return record;
  }

  cancel(id: string): AuditRecord {
    const job = this.active;
    if (!job || job.record.id !== id) throw new HttpError(409, 'This audit is not running.');
    this.stop(job, 'cancelled');
    return job.record;
  }

  /** Called on server shutdown so no orphaned browsers keep running. */
  shutdown(): void {
    const job = this.active;
    if (!job) return;
    killTree(job.child, 'SIGKILL');
    this.store.save({
      ...job.record,
      status: 'interrupted',
      phase: 'finished',
      finishedAt: new Date().toISOString(),
      error: 'The backend stopped while this audit was running.'
    });
  }

  getRecord(id: string): AuditRecord | null {
    return this.active?.record.id === id ? this.active.record : this.store.get(id);
  }

  /** Progress from the engine's own events and result files; never estimated from time. */
  getProgress(record: AuditRecord): AuditProgress {
    const events = readProgressEvents(this.store.progressPath(record.id));
    const viewportCount = record.settings.viewports.length;
    let checksTotal: number | null = null;
    const running = new Map<string, { url: string; viewport: string }>();
    const finished = new Map<string, { url: string; viewport: string; failed: boolean }>();

    for (const event of events) {
      if (event.type === 'begin') checksTotal = event.total;
      if (event.type === 'testBegin') running.set(event.id, { url: event.url, viewport: event.viewport });
      if (event.type === 'testEnd') {
        running.delete(event.id);
        if (event.final) {
          finished.set(event.id, {
            url: event.url,
            viewport: event.viewport,
            failed: !['passed', 'skipped'].includes(event.status ?? '')
          });
        }
      }
    }

    const viewportsDone = new Map<string, number>();
    finished.forEach(({ url }) => viewportsDone.set(url, (viewportsDone.get(url) ?? 0) + 1));
    const pagesDiscovered = checksTotal === null ? null : Math.round(checksTotal / viewportCount);
    const pagesCompleted = [...viewportsDone.values()].filter((done) => done >= viewportCount).length;
    const isRunning = record.status === 'running';
    const rawResults = isRunning
      ? readRawResults(auditConfig.rawResultsDir, new Date(record.createdAt))
      : readRawResults(path.join(this.store.artifactsDir(record.id), 'raw-results'));

    return {
      auditId: record.id,
      status: record.status,
      phase: record.phase,
      elapsedMs: (record.finishedAt ? Date.parse(record.finishedAt) : Date.now()) - Date.parse(record.createdAt),
      pagesDiscovered,
      pagesCompleted,
      pagesRemaining: pagesDiscovered === null ? null : Math.max(0, pagesDiscovered - pagesCompleted),
      checksTotal,
      checksCompleted: finished.size,
      checksFailed: [...finished.values()].filter((item) => item.failed).length,
      issuesFound: rawResults.reduce((total, result) => total + result.issues.length, 0),
      current: isRunning ? [...running.values()] : []
    };
  }

  private stop(job: ActiveJob, reason: 'cancelled' | 'timeout'): void {
    if (this.active !== job || job.stopReason) return;
    job.stopReason = reason;
    this.appendLog(
      job,
      reason === 'cancelled'
        ? '\nCancellation requested from the dashboard. Stopping the audit...\n'
        : `\nThe audit exceeded the ${Math.round(backendConfig.jobTimeoutMs / 60000)} minute limit and is being stopped.\n`
    );
    killTree(job.child, 'SIGTERM');
    setTimeout(() => {
      if (this.active === job) killTree(job.child, 'SIGKILL');
    }, 10_000).unref();
  }

  private handleOutput(job: ActiveJob, chunk: Buffer): void {
    const text = chunk.toString('utf-8');
    this.appendLog(job, text);
    const lines = (job.partialLine + text).split(/\r?\n/);
    job.partialLine = lines.pop() ?? '';
    for (const line of lines) {
      const phase = line.includes('[GlobalTeardown]')
        ? 'reporting'
        : job.record.phase === 'crawling' && /Running \d+ tests? using/.test(line)
          ? 'auditing'
          : null;
      if (phase && phase !== job.record.phase) {
        job.record.phase = phase;
        this.store.save(job.record);
      }
    }
  }

  /** Strips terminal colours and the server's file-system location before anything is stored. */
  private appendLog(job: ActiveJob, text: string): void {
    const clean = text.replace(ANSI_PATTERN, '').split(auditConfig.rootDir).join('.');
    fs.appendFileSync(this.store.logPath(job.record.id), clean, 'utf-8');
  }

  private finish(job: ActiveJob, exitCode: number | null): void {
    if (this.active !== job) return;
    clearTimeout(job.timeout);
    const { record } = job;
    let results: ReturnType<typeof snapshotArtifacts> = [];
    try {
      results = snapshotArtifacts(record, this.store.artifactsDir(record.id));
    } catch (error) {
      this.logger.error(`Could not save artifacts for audit ${record.id}`, error);
    }

    const progress = this.getProgress({ ...record, status: 'completed' });
    const reportGenerated = fs.existsSync(path.join(this.store.artifactsDir(record.id), 'reports'));
    record.phase = 'finished';
    record.exitCode = exitCode;
    record.finishedAt = new Date().toISOString();
    record.durationMs = Date.parse(record.finishedAt) - Date.parse(record.createdAt);
    record.failedChecks = progress.checksFailed;
    record.summary = buildSummary(
      results,
      record.settings.viewports,
      readReportHealthScore(this.store.artifactsDir(record.id))
    );

    if (job.stopReason === 'cancelled') {
      record.status = 'cancelled';
      record.error = 'Cancelled from the dashboard. Results saved before cancellation are kept.';
    } else if (job.stopReason === 'timeout') {
      record.status = 'failed';
      record.error = 'The audit exceeded the time limit and was stopped.';
    } else if (reportGenerated) {
      // A non-zero exit with a generated report means some page checks failed (for example a
      // page returning HTTP 5xx); the audit itself completed and its findings are valid.
      record.status = 'completed';
    } else {
      record.status = 'failed';
      record.error = `The audit engine stopped before generating reports (exit code ${exitCode ?? 'unknown'}). See the log for details.`;
    }

    this.store.save(record);
    this.active = null;
    this.logger.info(`Audit ${record.id} finished with status ${record.status}`);
  }

  private markInterruptedAudits(): void {
    for (const record of this.store.list()) {
      if (record.status !== 'running') continue;
      this.store.save({
        ...record,
        status: 'interrupted',
        phase: 'finished',
        error: 'The backend stopped while this audit was running.'
      });
    }
  }
}

function createAuditId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `AUD-${stamp}-${randomBytes(2).toString('hex')}`;
}

function readProgressEvents(progressPath: string): ProgressEvent[] {
  if (!fs.existsSync(progressPath)) return [];
  return fs
    .readFileSync(progressPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ProgressEvent];
      } catch {
        return []; // A partially written last line; it is complete on the next poll.
      }
    });
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // The process group has already exited.
  }
}

/**
 * The engine never needs the dashboard sign-in. Blank values (not deleted ones) are passed because
 * the engine loads .env itself, and dotenv does not override variables that are already set.
 */
function engineEnv(): NodeJS.ProcessEnv {
  // DOTENV_CONFIG_QUIET hides dotenv's "injected env" tips, which otherwise fill the live log.
  return { ...process.env, DASHBOARD_USER_ID: '', DASHBOARD_PASSWORD: '', DOTENV_CONFIG_QUIET: 'true' };
}
