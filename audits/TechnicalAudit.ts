import { BrowserSignalCollector } from '../utils/browserSignals';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class TechnicalAudit {
  run(url: string, viewport: string, signals: BrowserSignalCollector): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const uniqueConsoleFindings = this.uniqueBy(
      signals.consoleFindings,
      (finding) => `${finding.type}|${finding.text}|${finding.location ?? ''}`
    );
    for (const finding of uniqueConsoleFindings.slice(0, 100)) {
      issues.push(
        createIssue({
          category: 'Technical',
          url,
          viewport,
          description: `Console ${finding.type}: ${finding.text.slice(0, 240)}`,
          severity: finding.type === 'uncaught-exception' ? 'Critical' : finding.type === 'error' ? 'High' : 'Low',
          suggestedFix: 'Investigate browser console output and fix the underlying JavaScript or runtime warning.',
          details: finding
        })
      );
    }
    const uniqueNetworkFindings = this.uniqueBy(
      signals.networkFindings,
      (finding) => `${finding.method}|${finding.url}|${finding.status ?? ''}|${finding.resourceType}|${finding.failureText ?? ''}`
    );
    for (const finding of uniqueNetworkFindings.slice(0, 150)) {
      const missingCssOrJs =
        finding.status &&
        finding.status >= 400 &&
        ['stylesheet', 'script'].includes(finding.resourceType);
      issues.push(
        createIssue({
          category: 'Technical',
          url,
          viewport,
          description: `Network failure for ${finding.resourceType}: ${finding.url}`,
          severity: missingCssOrJs ? 'Critical' : finding.status && finding.status >= 500 ? 'Critical' : 'High',
          suggestedFix: 'Restore the failed resource, fix routing/CDN configuration, or update stale asset references.',
          details: finding
        })
      );
    }
    return issues;
  }

  private uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = keyFor(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
