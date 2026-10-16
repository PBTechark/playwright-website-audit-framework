import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class AccessibilityAudit {
  async run(page: Page, url: string, viewport: string): Promise<AuditIssue[]> {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze();

    return results.violations.flatMap((violation) =>
      violation.nodes.slice(0, 20).map((node) =>
        createIssue({
          category: 'Accessibility',
          url,
          viewport,
          selector: node.target.join(', '),
          description: `${violation.id}: ${violation.help}`,
          severity: violation.impact === 'critical' ? 'Critical' : violation.impact === 'serious' ? 'High' : 'Medium',
          suggestedFix: violation.helpUrl,
          details: {
            impact: violation.impact,
            tags: violation.tags,
            failureSummary: node.failureSummary
          }
        })
      )
    );
  }
}
