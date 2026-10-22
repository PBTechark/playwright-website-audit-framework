import { APIRequestContext, Page } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue, LinkFinding } from '../utils/types';
import { isInternalNavigableUrl, normalizeUrl, uniqueUrls } from '../utils/urlUtils';
import { mapWithConcurrency } from '../utils/concurrency';

export class LinkValidator {
  constructor(
    private readonly request: APIRequestContext,
    private readonly baseUrl: string
  ) {}

  async validate(
    page: Page,
    url: string,
    viewport: string
  ): Promise<{ issues: AuditIssue[]; findings: LinkFinding[] }> {
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((anchor) => anchor.href)
    );
    const rawLogoHref = await this.findLogoHref(page);
    const logoHref = rawLogoHref ? (normalizeUrl(rawLogoHref, url) ?? rawLogoHref) : undefined;
    const links = uniqueUrls(hrefs, url)
      .filter((link) => isInternalNavigableUrl(link, this.baseUrl))
      .slice(0, auditConfig.linkCheckLimitPerPage);
    if (logoHref && !links.includes(logoHref)) links.unshift(logoHref);
    const findings: LinkFinding[] = [];
    const issues: AuditIssue[] = [];

    const checkedLinks = await mapWithConcurrency(links, auditConfig.apiValidationConcurrency, (link) =>
      this.checkLink(url, link, link === logoHref)
    );
    for (const finding of checkedLinks) {
      findings.push(finding);
      if ((finding.statusCode && finding.statusCode >= 400) || finding.failureType) {
        issues.push(
          createIssue({
            category: 'Links',
            url,
            viewport,
            description:
              finding.linkType === 'logo'
                ? `Header logo link has a failure: ${finding.destinationUrl}`
                : `Internal link has a failure: ${finding.destinationUrl}`,
            severity: finding.statusCode && finding.statusCode >= 500 ? 'Critical' : 'High',
            expected: 'The link should reach an available destination.',
            actual: finding.failureType ?? `Received HTTP ${finding.statusCode}.`,
            suggestedFix: 'Update the link target, restore the destination page, or remove the broken link.',
            details: finding
          })
        );
      }
      if (finding.redirectChain.length > 4) {
        issues.push(
          createIssue({
            category: 'Links',
            url,
            viewport,
            description: `${finding.linkType === 'logo' ? 'Header logo' : 'Internal link'} has a long redirect chain: ${finding.destinationUrl}`,
            severity: 'Medium',
            expected: 'The link should reach its destination in no more than three redirects.',
            actual: `Observed redirect chain: ${finding.redirectChain.join(' -> ')}`,
            suggestedFix: 'Point the link directly to the final canonical destination.',
            details: finding
          })
        );
      }
      if (finding.linkType === 'logo' && finding.finalUrl && this.isOutsideSite(finding.finalUrl)) {
        issues.push(
          createIssue({
            category: 'Links',
            url,
            viewport,
            description: `Header logo navigates outside the audited website: ${finding.finalUrl}`,
            severity: 'High',
            expected: 'The header logo should navigate to the audited website homepage.',
            actual: `The logo link ${finding.destinationUrl} resolved to ${finding.finalUrl}.`,
            businessImpact:
              'Visitors who expect the logo to return to this website are sent to another site.',
            suggestedFix:
              'Correct the logo href or the website redirect so it resolves to this website homepage.',
            details: finding
          })
        );
      }
    }

    const anchors = await this.findBrokenAnchors(page, url);
    for (const anchor of anchors) {
      issues.push(
        createIssue({
          category: 'Links',
          url,
          viewport,
          description: `Anchor target is missing: ${anchor}`,
          severity: 'Medium',
          suggestedFix: 'Create the target element id or update the anchor link.',
          details: { anchor }
        })
      );
    }

    const placeholderCtas = await this.findPlaceholderCtaLinks(page);
    for (const cta of placeholderCtas) {
      issues.push(
        createIssue({
          category: 'Links',
          url,
          viewport,
          selector: cta.selector,
          description: `Visible CTA link has no actionable destination: ${cta.text}.`,
          severity: 'High',
          expected: 'Visible CTA buttons navigate, call, email, or open a meaningful user action.',
          actual: `CTA renders as a clickable button but href is ${cta.href || '(empty)'}.`,
          businessImpact:
            'Users can see and click the CTA, but the action does not take them anywhere useful.',
          suggestedFix:
            'Replace the placeholder href with the correct URL, tel: link, mailto: link, or remove the CTA until the destination is ready.',
          details: cta
        })
      );
      findings.push({
        sourceUrl: url,
        destinationUrl: cta.href || '(empty)',
        failureType: 'Visible CTA has placeholder or non-actionable href',
        redirectChain: []
      });
    }

    return { issues, findings };
  }

  private async checkLink(sourceUrl: string, destinationUrl: string, isLogo = false): Promise<LinkFinding> {
    const redirectChain: string[] = [];
    const visited = new Set<string>();
    let currentUrl = destinationUrl;
    try {
      for (let redirects = 0; redirects <= 10; redirects += 1) {
        if (visited.has(currentUrl)) {
          return {
            sourceUrl,
            destinationUrl,
            failureType: 'Infinite redirect loop detected.',
            redirectChain,
            finalUrl: currentUrl,
            ...(isLogo ? { linkType: 'logo' as const } : {})
          };
        }
        visited.add(currentUrl);

        const response = await this.request.get(currentUrl, {
          maxRedirects: 0,
          timeout: 15_000,
          failOnStatusCode: false
        });
        const location = response.headers()['location'];
        if (response.status() >= 300 && response.status() < 400 && location) {
          const nextUrl = new URL(location, currentUrl).toString();
          if (redirectChain.length === 0) redirectChain.push(currentUrl);
          redirectChain.push(nextUrl);
          if (visited.has(nextUrl)) {
            return {
              sourceUrl,
              destinationUrl,
              statusCode: response.status(),
              failureType: 'Infinite redirect loop detected.',
              redirectChain,
              finalUrl: nextUrl,
              ...(isLogo ? { linkType: 'logo' as const } : {})
            };
          }
          if (redirects === 10) {
            return {
              sourceUrl,
              destinationUrl,
              statusCode: response.status(),
              failureType: 'Redirect limit exceeded (10 redirects).',
              redirectChain,
              finalUrl: nextUrl,
              ...(isLogo ? { linkType: 'logo' as const } : {})
            };
          }
          currentUrl = nextUrl;
          continue;
        }
        return {
          sourceUrl,
          destinationUrl,
          statusCode: response.status(),
          redirectChain,
          finalUrl: currentUrl,
          ...(isLogo ? { linkType: 'logo' as const } : {})
        };
      }
      return {
        sourceUrl,
        destinationUrl,
        failureType: 'Redirect limit exceeded (10 redirects).',
        redirectChain,
        finalUrl: currentUrl,
        ...(isLogo ? { linkType: 'logo' as const } : {})
      };
    } catch (error) {
      return {
        sourceUrl,
        destinationUrl,
        failureType: error instanceof Error ? error.message : String(error),
        redirectChain,
        finalUrl: currentUrl,
        ...(isLogo ? { linkType: 'logo' as const } : {})
      };
    }
  }

  private async findLogoHref(page: Page): Promise<string | undefined> {
    return page.evaluate(() => {
      const header = document.querySelector('header, [role="banner"]');
      if (!header) return undefined;
      const anchors = Array.from(header.querySelectorAll<HTMLAnchorElement>('a[href]'));
      const logo = anchors.find((anchor) =>
        anchor.matches(
          'a[class*="logo" i], a[aria-label*="logo" i], a[aria-label*="home" i], a[href="/"], a:has(img[alt*="logo" i])'
        )
      );
      return logo?.href;
    });
  }

  private isOutsideSite(destination: string): boolean {
    try {
      const destinationHost = new URL(destination).hostname.replace(/^www\./i, '');
      const siteHost = new URL(this.baseUrl).hostname.replace(/^www\./i, '');
      return destinationHost !== siteHost;
    } catch {
      return true;
    }
  }

  private async findBrokenAnchors(page: Page, url: string): Promise<string[]> {
    return page.evaluate((pageUrl) => {
      return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"], a[href*="#"]'))
        .map((anchor) => {
          try {
            const target = new URL(anchor.href, pageUrl);
            if (target.href.split('#')[0] !== pageUrl.split('#')[0] || !target.hash) return null;
            const id = decodeURIComponent(target.hash.slice(1));
            return document.getElementById(id) ? null : target.hash;
          } catch {
            return null;
          }
        })
        .filter((item): item is string => Boolean(item));
    }, url);
  }

  private async findPlaceholderCtaLinks(page: Page): Promise<
    Array<{
      selector: string;
      text: string;
      href: string;
      boundingBox: { x: number; y: number; width: number; height: number };
    }>
  > {
    return page.evaluate(() => {
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const parts: string[] = [];
        let node: Element | null = element;
        while (node && node !== document.body && parts.length < 5) {
          const siblings = node.parentElement
            ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName)
            : [];
          parts.unshift(
            `${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`
          );
          node = node.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      };

      const isVisible = (element: HTMLElement): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const visibleArea =
          Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)) *
          Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        return (
          rect.width >= 32 &&
          rect.height >= 24 &&
          visibleArea > 40 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.01
        );
      };

      const isDynamicUtility = (element: HTMLElement): boolean =>
        Boolean(
          element.closest(
            [
              '[aria-live]',
              '[role="alert"]',
              '[role="status"]',
              '[class*="chat" i]',
              '[id*="chat" i]',
              '[class*="toast" i]',
              '[id*="toast" i]',
              '[class*="floating" i]',
              '[class*="close" i]'
            ].join(',')
          )
        );

      const looksLikeCta = (anchor: HTMLAnchorElement): boolean => {
        const text = (
          anchor.innerText ||
          anchor.textContent ||
          anchor.getAttribute('aria-label') ||
          ''
        ).trim();
        const rect = anchor.getBoundingClientRect();
        const style = getComputedStyle(anchor);
        const classText = `${anchor.className} ${anchor.parentElement?.className ?? ''}`;
        const hasButtonSemantics =
          anchor.getAttribute('role') === 'button' ||
          /btn|button|cta|call|quote|contact|apply/i.test(classText);
        const hasButtonShape =
          rect.width >= 80 &&
          rect.height >= 28 &&
          (style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
            style.borderTopWidth !== '0px' ||
            style.textTransform === 'uppercase');
        return text.length > 2 && !/^(x|×|close)$/i.test(text) && (hasButtonSemantics || hasButtonShape);
      };

      return Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
        .map((anchor) => {
          const rawHref = anchor.getAttribute('href')?.trim() ?? '';
          const hrefIsPlaceholder =
            rawHref === '' || rawHref === '#' || /^javascript:\s*(?:void\s*\(?\s*0\s*\)?|;)$/i.test(rawHref);
          if (!hrefIsPlaceholder || !isVisible(anchor) || isDynamicUtility(anchor) || !looksLikeCta(anchor)) {
            return null;
          }
          const rect = anchor.getBoundingClientRect();
          return {
            selector: selectorFor(anchor),
            text: (anchor.innerText || anchor.textContent || anchor.getAttribute('aria-label') || '').trim(),
            href: rawHref,
            boundingBox: {
              x: Number(rect.x.toFixed(1)),
              y: Number(rect.y.toFixed(1)),
              width: Number(rect.width.toFixed(1)),
              height: Number(rect.height.toFixed(1))
            }
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 50);
    });
  }
}
