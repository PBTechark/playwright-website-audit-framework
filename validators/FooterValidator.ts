import { Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class FooterValidator {
  async validate(page: Page, url: string, viewport: string): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];
    const footer = page.locator('footer, [role="contentinfo"]').first();
    const visible = await footer.isVisible().catch(() => false);
    if (!visible) {
      issues.push(
        createIssue({
          category: 'Footer',
          url,
          viewport,
          description: 'Footer is not visible.',
          severity: 'Medium',
          suggestedFix: 'Add a visible footer or role="contentinfo" region with key links and company information.'
        })
      );
      return issues;
    }

    const linkCount = await footer.locator('a[href]').count();
    if (linkCount === 0) {
      issues.push(
        createIssue({
          category: 'Footer',
          url,
          viewport,
          description: 'Footer has no visible links.',
          severity: 'Low',
          suggestedFix: 'Include useful footer navigation links such as contact, privacy, terms, and social profiles.'
        })
      );
    }

    const copyrightVisible = await footer
      .locator('text=/copyright|©|all rights reserved/i')
      .first()
      .isVisible()
      .catch(() => false);
    if (!copyrightVisible) {
      issues.push(
        createIssue({
          category: 'Footer',
          url,
          viewport,
          description: 'Footer copyright notice is missing or not visible.',
          severity: 'Low',
          suggestedFix: 'Add a visible copyright or ownership notice in the footer.'
        })
      );
    }

    return issues;
  }
}
