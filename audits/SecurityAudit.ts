import { Page, Response } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class SecurityAudit {
  async run(page: Page, url: string, viewport: string, response?: Response | null): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];
    const headers = response?.headers() ?? {};

    if (new URL(url).protocol !== 'https:') {
      issues.push(
        createIssue({
          category: 'Security',
          url,
          viewport,
          description: 'The audited page is not served over HTTPS.',
          severity: 'High',
          expected: 'Secure HTTPS transport',
          actual: `Observed protocol ${new URL(url).protocol}`,
          businessImpact: 'Non-secure delivery affects trust, privacy, and SEO.',
          suggestedFix: 'Enable HTTPS, redirect HTTP traffic, and ensure the site is properly configured for secure delivery.',
          details: { url }
        })
      );
    }

    const securityHeaders = [
      ['strict-transport-security', 'HSTS'],
      ['content-security-policy', 'CSP'],
      ['x-frame-options', 'X-Frame-Options'],
      ['referrer-policy', 'Referrer Policy'],
      ['permissions-policy', 'Permissions Policy']
    ] as const;

    for (const [headerName, label] of securityHeaders) {
      if (!headers[headerName]) {
        issues.push(
          createIssue({
            category: 'Security',
            url,
            viewport,
            description: `${label} is not present in the response headers.`,
            severity: 'Medium',
            expected: `${label} should be configured`,
            actual: 'Header missing',
            businessImpact: 'Missing security headers reduce protection against common client-side attacks and policy bypasses.',
            suggestedFix: `Configure ${label} in the web server or CDN layer for the site.`,
            details: { headerName }
          })
        );
      }
    }

    const cookies = await page.context().cookies().catch(() => [] as Array<{ secure?: boolean; httpOnly?: boolean; sameSite?: string }>);
    const insecureCookies = cookies.filter((cookie) => !cookie.secure || !cookie.httpOnly || !(cookie.sameSite && ['lax', 'strict', 'none'].includes(cookie.sameSite.toLowerCase())));
    if (insecureCookies.length > 0) {
      issues.push(
        createIssue({
          category: 'Security',
          url,
          viewport,
          description: 'One or more cookies are missing secure or HttpOnly protections.',
          severity: 'Medium',
          expected: 'Cookies should be marked Secure, HttpOnly, and SameSite where appropriate.',
          actual: `Found ${insecureCookies.length} cookie(s) with weaker security settings`,
          businessImpact: 'Weaker cookie protections increase the chance of session or token misuse.',
          suggestedFix: 'Review cookie configuration in the application or hosting layer and enforce Secure, HttpOnly, and SameSite settings.',
          details: { cookieCount: insecureCookies.length }
        })
      );
    }

    return issues;
  }
}
