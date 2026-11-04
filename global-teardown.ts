import fs from 'fs';
import { HtmlReportGenerator } from './reporters/HtmlReportGenerator';
import { auditConfig } from './config/auditConfig';
import { Logger } from './utils/logger';
import { AuditResult } from './utils/types';
import { isBlockingSeverity, qualityGateLabel } from './utils/severityGate';
import { isReportableIssue } from './utils/reportFilters';
import { releaseRunLock } from './utils/runLock';

async function globalTeardown(): Promise<void> {
  const logger = new Logger('GlobalTeardown');
  logger.info('Generating website audit reports');
  let results: AuditResult[];
  try {
    results = await new HtmlReportGenerator().generate();
  } finally {
    fs.rmSync(auditConfig.linkCacheDir, { recursive: true, force: true });
    releaseRunLock();
  }

  if (auditConfig.qualityGateSeverity !== 'Off') {
    // Reuses the results the reports were built from instead of parsing every raw file again.
    const blockingIssues = results
      .flatMap((result) => result.issues)
      .filter(isReportableIssue)
      .filter((issue) => isBlockingSeverity(issue.severity, auditConfig.qualityGateSeverity));
    if (blockingIssues.length > 0) {
      throw new Error(
        `Audit quality gate failed with ${blockingIssues.length} ${qualityGateLabel(auditConfig.qualityGateSeverity)} finding(s). ` +
        `Review ${auditConfig.reportsDir}/website-audit-report.html for evidence and suggested fixes.`
      );
    }
  }
}

export default globalTeardown;
