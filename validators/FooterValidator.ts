import { Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class FooterValidator {
  async validate(page: Page, url: string, viewport: string): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];
    const footer = page.locator('footer, [role="contentinfo"]').first();
    const footerCount = await footer.count();
    const contentIndex = footerCount > 0 ? await this.lastRenderedContentIndex(footer) : -1;
    let visible = footerCount > 0 && await this.isVisibleInViewport(footer);
    if (!visible && contentIndex >= 0) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await footer.evaluate((footerElement, index) => {
          footerElement.querySelectorAll('*')[index]?.scrollIntoView({ block: 'end' });
        }, contentIndex);
        await page.waitForTimeout(attempt === 0 ? 500 : 100);
        visible = await this.isVisibleInViewport(footer);
        if (visible) break;
      }
    }

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

  private async isVisibleInViewport(footer: ReturnType<Page['locator']>): Promise<boolean> {
    return footer.evaluate((footerElement) => {
      const isRendered = (element: Element): boolean => {
        let current: Element | null = element;
        while (current) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) {
            return false;
          }
          if (current === footerElement) break;
          current = current.parentElement;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 &&
          rect.right > 0 && rect.left < document.documentElement.clientWidth &&
          rect.bottom > 0 && rect.top < window.innerHeight;
      };

      if (isRendered(footerElement)) return true;
      return Array.from(footerElement.querySelectorAll<HTMLElement>('*')).some((element) => {
        const hasText = Boolean(element.innerText?.trim());
        const hasVisualContent = element.matches('img,svg,input,button,video,canvas,[role="button"]');
        return (hasText || hasVisualContent) && isRendered(element);
      });
    });
  }

  private async lastRenderedContentIndex(footer: ReturnType<Page['locator']>): Promise<number> {
    return footer.locator('*').evaluateAll((elements) => {
      let candidateIndex = -1;
      let candidateBottom = Number.NEGATIVE_INFINITY;
      elements.forEach((element, index) => {
        if (!(element instanceof HTMLElement)) return;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return;

        let current: HTMLElement | null = element;
        while (current) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) return;
          current = current.parentElement;
        }

        if (rect.bottom > candidateBottom) {
          candidateIndex = index;
          candidateBottom = rect.bottom;
        }
      });
      return candidateIndex;
    });
  }
}
