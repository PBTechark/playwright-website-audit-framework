import { createIssue } from '../utils/issueFactory';
import { AuditIssue, PerformanceMetrics } from '../utils/types';

export class PerformanceAudit {
  run(url: string, viewport: string, metrics: PerformanceMetrics): AuditIssue[] {
    const issues: AuditIssue[] = [];
    if (metrics.loadTimeMs > 5000) {
      issues.push(
        createIssue({
          category: 'Performance',
          url,
          viewport,
          description: `Slow page load time: ${metrics.loadTimeMs}ms.`,
          severity: 'Medium',
          suggestedFix: 'Optimize critical resources, server response time, caching, and render-blocking assets.',
          details: metrics
        })
      );
    }
    if ((metrics.largestContentfulPaintMs ?? 0) > 2500) {
      issues.push(
        createIssue({
          category: 'Performance',
          url,
          viewport,
          description: `Largest Contentful Paint is slower than recommended: ${metrics.largestContentfulPaintMs}ms.`,
          severity: 'Medium',
          suggestedFix: 'Optimize hero images, server response, fonts, and render-blocking CSS or JavaScript.',
          details: metrics
        })
      );
    }
    if (metrics.totalResourceBytes > 5_000_000) {
      issues.push(
        createIssue({
          category: 'Performance',
          url,
          viewport,
          description: `Page transfers more than 5 MB of resources: ${metrics.totalResourceBytes} bytes.`,
          severity: 'Medium',
          suggestedFix: 'Compress images, split JavaScript, remove unused assets, and apply cache policies.',
          details: metrics
        })
      );
    }
    return issues;
  }
}
