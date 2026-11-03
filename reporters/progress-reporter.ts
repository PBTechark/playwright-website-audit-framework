import fs from 'fs';
import path from 'path';
import { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Appends one JSON event per line to AUDIT_PROGRESS_FILE so the dashboard backend can show
 * real execution progress. playwright.config.ts enables it only when that variable is set.
 */
export default class ProgressReporter implements Reporter {
  private readonly outputFile = process.env.AUDIT_PROGRESS_FILE ?? '';

  onBegin(_config: FullConfig, suite: Suite): void {
    if (this.outputFile) fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    this.write({ type: 'begin', total: suite.allTests().length });
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    this.write({ type: 'testBegin', id: test.id, ...this.describe(test), retry: result.retry });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const final = result.status === 'passed' || result.status === 'skipped' || result.retry >= test.retries;
    this.write({ type: 'testEnd', id: test.id, ...this.describe(test), status: result.status, final });
  }

  onEnd(result: FullResult): void {
    this.write({ type: 'end', status: result.status });
  }

  private describe(test: TestCase): { viewport: string; url: string } {
    // Audit tests are titled "audit <targetName> <url>"; URLs never contain spaces.
    return { viewport: test.parent.project()?.name ?? '', url: test.title.split(' ').pop() ?? '' };
  }

  private write(event: Record<string, unknown>): void {
    if (!this.outputFile) return;
    fs.appendFileSync(this.outputFile, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, 'utf-8');
  }
}
