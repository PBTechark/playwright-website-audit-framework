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

    const copyrightVisible = await page.evaluate(() => {
      const copyrightPattern = /copyright|©|all rights reserved/i;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(
        'footer, [role="contentinfo"], .copyright, [class*="copyright" i], [id*="copyright" i]'
      ));
      return candidates.some((element) => {
        const text = element.innerText || element.textContent || '';
        if (!copyrightPattern.test(text)) return false;

        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        let current: HTMLElement | null = element;
        while (current && current !== document.documentElement) {
          const style = window.getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      });
    });
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
