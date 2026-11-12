import { Page } from '@playwright/test';
import { EvidenceManager } from '../utils/evidence';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

type LogoInspection = {
  candidates: Array<{
    selector: string;
    kind: 'image' | 'svg' | 'background' | 'brand-element' | 'home-link';
    rendered: boolean;
    width: number;
    height: number;
    imageState?: 'loaded' | 'broken' | 'pending';
  }>;
  visibleLogo: boolean;
};

export class HeaderValidator {
  async validate(page: Page, url: string, viewport: string, isMobile: boolean): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];
    const header = page.locator('header:visible, [role="banner"]:visible').first();
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

    const logoInspection = await header.evaluate((headerElement): LogoInspection => {
      const brandPattern = /logo|brand|branding|site[-_\s]?name/i;
      const homePattern = /\b(home|homepage|logo|brand|branding)\b/i;
      const elements = Array.from(headerElement.querySelectorAll<HTMLElement | SVGElement>('*'));
      const candidates = new Map<Element, LogoInspection['candidates'][number]>();

      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const attribute = ['data-testid', 'data-test', 'aria-label', 'alt', 'title']
          .find((name) => element.hasAttribute(name));
        if (attribute) {
          const value = element.getAttribute(attribute);
          if (value) return `${element.tagName.toLowerCase()}[${attribute}="${CSS.escape(value)}"]`;
        }
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && current !== headerElement) {
          const siblings = current.parentElement
            ? Array.from(current.parentElement.children).filter((item) => item.tagName === current!.tagName)
            : [];
          parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(current) + 1)})`);
          current = current.parentElement;
        }
        return `header > ${parts.join(' > ')}`;
      };

      const hasBrandSignal = (element: Element): boolean => {
        const attributes = ['id', 'class', 'alt', 'aria-label', 'title', 'data-testid', 'data-test', 'data-logo'];
        return attributes.some((attribute) => brandPattern.test(element.getAttribute(attribute) ?? ''));
      };
      const hasBrandAncestor = (element: Element): boolean => {
        let current: Element | null = element;
        while (current && current !== headerElement) {
          if (hasBrandSignal(current)) return true;
          current = current.parentElement;
        }
        return false;
      };
      const isHomeLink = (element: Element): element is HTMLAnchorElement => {
        if (!(element instanceof HTMLAnchorElement)) return false;
        try {
          const destination = new URL(element.href, document.baseURI);
          return destination.origin === window.location.origin &&
            (destination.pathname === '/' || destination.pathname === '') &&
            !destination.hash;
        } catch {
          return false;
        }
      };
      const hasVisibleBox = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1 || element.closest('[hidden], [aria-hidden="true"]')) return false;
        let current: Element | null = element;
        while (current) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) {
            return false;
          }
          if (current === headerElement) break;
          current = current.parentElement;
        }
        return true;
      };
      const addCandidate = (
        element: Element,
        kind: LogoInspection['candidates'][number]['kind'],
        image?: HTMLImageElement
      ): void => {
        const rect = element.getBoundingClientRect();
        let imageState: LogoInspection['candidates'][number]['imageState'];
        if (image) {
          imageState = image.complete
            ? image.naturalWidth > 0 && image.naturalHeight > 0 ? 'loaded' : 'broken'
            : 'pending';
        }
        candidates.set(element, {
          selector: selectorFor(element),
          kind,
          rendered: hasVisibleBox(element) && (!image || imageState === 'loaded'),
          width: Number(rect.width.toFixed(1)),
          height: Number(rect.height.toFixed(1)),
          imageState
        });
      };

      for (const element of elements) {
        const tagName = element.tagName.toLowerCase();
        const image = tagName === 'img' ? element as HTMLImageElement : undefined;
        const homeLink = element.closest('a');
        const linkedAsBrand = Boolean(homeLink && isHomeLink(homeLink) && (
          homePattern.test(`${homeLink.getAttribute('aria-label') ?? ''} ${homeLink.title}`) ||
          Boolean(homeLink.querySelector('img, picture img, svg'))
        ));
        if (image && (hasBrandAncestor(element) || linkedAsBrand)) {
          addCandidate(image, 'image', image);
          continue;
        }
        if (tagName === 'svg' && (hasBrandAncestor(element) || linkedAsBrand)) {
          addCandidate(element, 'svg');
          continue;
        }
        if (getComputedStyle(element).backgroundImage !== 'none' && hasBrandSignal(element)) {
          addCandidate(element, 'background');
          continue;
        }
        if (hasBrandSignal(element) && !element.querySelector('img, svg')) {
          addCandidate(element, 'brand-element');
          continue;
        }
        if (
          isHomeLink(element) &&
          homePattern.test(`${element.getAttribute('aria-label') ?? ''} ${element.title} ${element.innerText}`)
        ) {
          addCandidate(element, 'home-link');
        }
      }

      const candidateList = Array.from(candidates.values());
      return {
        candidates: candidateList,
        visibleLogo: candidateList.some((candidate) => candidate.rendered)
      };
    });

    if (!logoInspection.visibleLogo) {
      const brokenImage = logoInspection.candidates.find(
        (candidate) => candidate.kind === 'image' && candidate.imageState === 'broken'
      );
      const evidence = await new EvidenceManager(page, url, viewport)
        .captureLocator('header-logo-detection', header)
        .catch(() => null);
      issues.push(
        createIssue({
          category: 'Header',
          url,
          viewport,
          description: brokenImage
            ? 'Header logo image is present but failed to load.'
            : 'Could not automatically identify a visible header logo or branded home link.',
          selector: brokenImage?.selector,
          severity: brokenImage ? 'High' : 'Low',
          evidence: evidence ? [evidence.path] : undefined,
          actual: JSON.stringify(logoInspection),
          suggestedFix: brokenImage
            ? 'Verify the header logo image URL, response, and supported image format.'
            : 'Review the header logo manually; automated detection did not find a confidently identifiable brand mark.'
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
