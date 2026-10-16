import { Page, Response } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class DeploymentAudit {
  async run(
    page: Page,
    url: string,
    viewport: string,
    response?: Response | null,
    targetName?: string
  ): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];
    const status = response?.status();
    const finalUrl = page.url();

    if (response && status && status >= 500) {
      issues.push(
        createIssue({
          category: 'Deployment',
          targetName,
          url,
          viewport,
          description: `Server returned HTTP ${status} for ${url}.`,
          severity: 'Critical',
          expected: 'The page should be available to end users.',
          actual: `Received HTTP ${status}`,
          businessImpact: 'Critical deployment or server-side failure prevents access to the page.',
          suggestedFix: 'Inspect server logs, application errors, hosting configuration, and recent deployments for the failing route.',
          browser: 'Chromium',
          device: viewport,
          timestamp: new Date().toISOString(),
          details: { status, finalUrl }
        })
      );
    } else if (response && status && status >= 400) {
      issues.push(
        createIssue({
          category: 'Deployment',
          targetName,
          url,
          viewport,
          description: `Page returned HTTP ${status} for ${url}.`,
          severity: 'High',
          expected: 'The page should be reachable without client or server errors.',
          actual: `Received HTTP ${status}`,
          businessImpact: 'Users may hit a broken page or missing content.',
          suggestedFix: 'Verify the route, content availability, and error handling for the affected page.',
          browser: 'Chromium',
          device: viewport,
          timestamp: new Date().toISOString(),
          details: { status, finalUrl }
        })
      );
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (!bodyText.trim()) {
      issues.push(
        createIssue({
          category: 'Deployment',
          targetName,
          url,
          viewport,
          description: 'The page rendered without meaningful visible body content.',
          severity: 'High',
          expected: 'Visible page content should render in the main body.',
          actual: 'Body content is empty or unavailable.',
          businessImpact: 'A blank page creates a broken user experience and may indicate a deployment or rendering problem.',
          suggestedFix: 'Check for failed template rendering, missing content, or JavaScript errors that prevent hydration.',
          browser: 'Chromium',
          device: viewport,
          timestamp: new Date().toISOString(),
          details: { finalUrl }
        })
      );
    }

    const header = await page.locator('header, [role="banner"], nav').first().count().catch(() => 0);
    const footer = await page.locator('footer, [role="contentinfo"]').first().count().catch(() => 0);
    const main = await page.locator('main').first().count().catch(() => 0);
    if (header === 0 || footer === 0 || main === 0) {
      issues.push(
        createIssue({
          category: 'Deployment',
          targetName,
          url,
          viewport,
          description: 'The page is missing a key structural region such as header, footer, or main content.',
          severity: 'Medium',
          expected: 'Header, footer, and main content regions should be present.',
          actual: `Header=${header}; Footer=${footer}; Main=${main}`,
          businessImpact: 'Navigation and page structure may be broken, impacting usability and trust.',
          suggestedFix: 'Inspect the theme or template markup to ensure the header, main region, and footer render consistently.',
          browser: 'Chromium',
          device: viewport,
          timestamp: new Date().toISOString(),
          details: { finalUrl, header, footer, main }
        })
      );
    }

    return issues;
  }
}
