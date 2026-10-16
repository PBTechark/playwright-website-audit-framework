import { Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class HeaderValidator {
  async validate(page: Page, url: string, viewport: string, isMobile: boolean): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];
    const header = page.locator('header, [role="banner"]').first();
    const headerVisible = await header.isVisible().catch(() => false);
    if (!headerVisible) {
      issues.push(
        createIssue({
          category: 'Header',
          url,
          viewport,
          description: 'Header or banner region is not visible.',
          severity: 'High',
          suggestedFix: 'Expose a visible site header or role="banner" region on the page.'
        })
      );
      return issues;
    }

    const logoVisible = await header
      .locator('img[alt*="logo" i], [class*="logo" i], a[aria-label*="home" i], a[href="/"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (!logoVisible) {
      issues.push(
        createIssue({
          category: 'Header',
          url,
          viewport,
          description: 'Logo or home link is not clearly visible in the header.',
          severity: 'Medium',
          suggestedFix: 'Add a visible logo or accessible home link in the header.'
        })
      );
    }

    if (isMobile) {
      const hamburger = page
        .locator(
          'button[aria-label*="menu" i], button[class*="menu" i], [role="button"][aria-label*="menu" i], .hamburger, [class*="hamburger" i]'
        )
        .first();
      const hamburgerVisible = await hamburger.isVisible().catch(() => false);
      if (!hamburgerVisible) {
        issues.push(
          createIssue({
            category: 'Header',
            url,
            viewport,
            description: 'Mobile hamburger menu control is not visible.',
            severity: 'High',
            suggestedFix: 'Provide a visible, accessible mobile navigation toggle.'
          })
        );
      } else {
        await hamburger.click({ trial: true }).catch(() => {
          issues.push(
            createIssue({
              category: 'Header',
              url,
              viewport,
              description: 'Mobile menu button is visible but not safely clickable.',
              severity: 'High',
              suggestedFix: 'Ensure the mobile menu control is enabled, unobstructed, and has an accessible hit target.'
            })
          );
        });
      }
    } else {
      const navVisible = await page.locator('header nav, nav[aria-label], [role="navigation"]').first().isVisible().catch(() => false);
      if (!navVisible) {
        issues.push(
          createIssue({
            category: 'Header',
            url,
            viewport,
            description: 'Desktop navigation is not visible.',
            severity: 'High',
            suggestedFix: 'Expose primary navigation links in a visible nav element on desktop.'
          })
        );
      }
      await this.checkStickyHeader(page, url, viewport, issues);
    }

    return issues;
  }

  private async checkStickyHeader(page: Page, url: string, viewport: string, issues: AuditIssue[]): Promise<void> {
    const result = await page.evaluate(() => {
      const header = document.querySelector('header, [role="banner"]') as HTMLElement | null;
      if (!header) return { checked: false };
      const before = header.getBoundingClientRect().top;
      window.scrollTo(0, Math.min(500, document.documentElement.scrollHeight));
      const style = window.getComputedStyle(header);
      const after = header.getBoundingClientRect().top;
      window.scrollTo(0, 0);
      return { checked: true, position: style.position, before, after, height: header.getBoundingClientRect().height };
    });
    if (result.checked && ['fixed', 'sticky'].includes(String(result.position)) && Number(result.height) > 180) {
      issues.push(
        createIssue({
          category: 'Header',
          url,
          viewport,
          description: 'Sticky header is unusually tall and may obscure page content.',
          severity: 'Medium',
          suggestedFix: 'Reduce sticky header height or collapse secondary navigation while scrolling.',
          details: result
        })
      );
    }
  }
}
