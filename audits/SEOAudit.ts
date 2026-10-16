import { Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class SEOAudit {
  async run(page: Page, url: string, viewport: string): Promise<AuditIssue[]> {
    const seo = await page.evaluate(() => {
      const meta = (name: string) =>
        document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() ?? '';
      return {
        title: document.title.trim(),
        description: meta('description'),
        canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? '',
        h1Count: document.querySelectorAll('h1').length,
        h1Text: Array.from(document.querySelectorAll('h1')).map((item) => item.textContent?.trim()).filter(Boolean),
        ogTitle: meta('og:title'),
        ogDescription: meta('og:description'),
        robots: meta('robots')
      };
    });
    const issues: AuditIssue[] = [];

    if (!seo.title || seo.title.length < 8 || seo.title.length > 70) {
      issues.push(
        createIssue({
          category: 'SEO',
          url,
          viewport,
          description: 'Page title is missing, too short, or too long.',
          severity: 'Medium',
          suggestedFix: 'Provide a unique title between roughly 8 and 70 characters.',
          details: seo
        })
      );
    }
    if (!seo.description || seo.description.length < 50 || seo.description.length > 170) {
      issues.push(
        createIssue({
          category: 'SEO',
          url,
          viewport,
          description: 'Meta description is missing or outside recommended length.',
          severity: 'Medium',
          suggestedFix: 'Add a unique meta description around 50 to 170 characters.',
          details: seo
        })
      );
    }
    if (!seo.canonical) {
      issues.push(
        createIssue({
          category: 'SEO',
          url,
          viewport,
          description: 'Canonical link is missing.',
          severity: 'Low',
          suggestedFix: 'Add a canonical link element to clarify the preferred URL.',
          details: seo
        })
      );
    }
    if (seo.h1Count !== 1) {
      issues.push(
        createIssue({
          category: 'SEO',
          url,
          viewport,
          description: `Page has ${seo.h1Count} H1 elements.`,
          severity: 'Medium',
          suggestedFix: 'Use exactly one clear H1 that describes the page topic.',
          details: seo
        })
      );
    }
    if (!seo.ogTitle || !seo.ogDescription) {
      issues.push(
        createIssue({
          category: 'SEO',
          url,
          viewport,
          description: 'Open Graph title or description is missing.',
          severity: 'Low',
          suggestedFix: 'Add og:title and og:description tags for richer social sharing.',
          details: seo
        })
      );
    }
    return issues;
  }
}
