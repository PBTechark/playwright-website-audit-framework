import { HtmlReportGenerator } from './reporters/HtmlReportGenerator';
import { auditConfig } from './config/auditConfig';
import { listJsonFiles, readJsonFile } from './utils/fileSystem';
import { Logger } from './utils/logger';
import { AuditResult } from './utils/types';
import { isBlockingSeverity, qualityGateLabel } from './utils/severityGate';
import { isReportableIssue } from './utils/reportFilters';

async function globalTeardown(): Promise<void> {
  const logger = new Logger('GlobalTeardown');
  logger.info('Generating website audit reports');
  await new HtmlReportGenerator().generate();

  if (auditConfig.qualityGateSeverity !== 'Off') {
    const results = listJsonFiles(auditConfig.rawResultsDir)
      .map((file) => readJsonFile<AuditResult | null>(file, null))
      .filter((result): result is AuditResult => Boolean(result));
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
