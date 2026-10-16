import { Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class ResponsiveAudit {
  async run(page: Page, url: string, viewport: string, isMobile: boolean): Promise<AuditIssue[]> {
    const signals = await page.evaluate((mobile) => {
      const bodyText = document.body.innerText.trim();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const visibleArea = (rect: DOMRect): number => {
        const width = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const height = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        return width * height;
      };
      const canUserScrollHorizontally = (): boolean => {
        const before = window.scrollX;
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
          document.body.scrollWidth - document.body.clientWidth
        );
        if (maxScroll <= 20) return false;
        window.scrollTo(maxScroll, window.scrollY);
        const reached = window.scrollX;
        window.scrollTo(before, window.scrollY);
        return reached > 10;
      };
      const visibleOverflowElement = Array.from(document.querySelectorAll<HTMLElement>(
        'main,section,article,header,footer,nav,img,a,button,input,select,textarea,h1,h2,h3,p,li,ul,ol,div'
      )).find((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const text = `${element.innerText || ''} ${element.id} ${element.className}`.toLowerCase();
        if (
          rect.width <= 1 ||
          rect.height <= 1 ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity) <= 0.01 ||
          /drawer|offcanvas|off-canvas|carousel|swiper|slick|tooltip|popover|modal|cookie|chat|accessibility|userway/.test(text)
        ) return false;
        const area = visibleArea(rect);
        const ratio = area / Math.max(1, rect.width * rect.height);
        return area > 600 && ratio >= 0.2 && rect.right > viewportWidth + 32;
      });
      const smallTapTargets = Array.from(document.querySelectorAll<HTMLElement>('a,button,[role="button"],input,select'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            text: element.innerText?.trim() || element.getAttribute('aria-label') || element.getAttribute('name') || '',
            width: rect.width,
            height: rect.height
          };
        })
        .filter((item) => item.width > 0 && item.height > 0 && (item.width < (mobile ? 44 : 32) || item.height < 32))
        .slice(0, 20);
      const fontSizes = Array.from(document.querySelectorAll<HTMLElement>('p,li,a,button,label,input,textarea'))
        .slice(0, 400)
        .map((element) => Number.parseFloat(window.getComputedStyle(element).fontSize))
        .filter(Number.isFinite);
      return {
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth,
        visibleHorizontalScroll: canUserScrollHorizontally() && Boolean(visibleOverflowElement),
        overflowingSelector: visibleOverflowElement
          ? visibleOverflowElement.id
            ? `#${CSS.escape(visibleOverflowElement.id)}`
            : visibleOverflowElement.tagName.toLowerCase()
          : undefined,
        textLength: bodyText.length,
        smallTapTargets,
        minFontSize: fontSizes.length ? Math.min(...fontSizes) : 0
      };
    }, isMobile);

    const issues: AuditIssue[] = [];
    if (signals.visibleHorizontalScroll) {
      issues.push(
        createIssue({
          category: 'Responsive',
          url,
          viewport,
          description: 'Responsive layout creates horizontal scrolling.',
          severity: 'High',
          suggestedFix: 'Audit fixed-width containers, grids, images, and absolute positioning at this viewport.',
          expected: 'No user-visible content forces horizontal scrolling at this viewport.',
          actual: `User-scrollable horizontal overflow was detected from ${signals.overflowingSelector ?? 'visible content'}.`,
          details: signals
        })
      );
    }
    if (isMobile && signals.smallTapTargets.length > 0) {
      issues.push(
        createIssue({
          category: 'Responsive',
          url,
          viewport,
          description: `${signals.smallTapTargets.length} mobile tap targets are smaller than recommended size.`,
          severity: 'Medium',
          suggestedFix: 'Increase touch target dimensions and spacing for mobile users.',
          details: { smallTapTargets: signals.smallTapTargets }
        })
      );
    }
    if (isMobile && signals.minFontSize > 0 && signals.minFontSize < 12) {
      issues.push(
        createIssue({
          category: 'Responsive',
          url,
          viewport,
          description: 'Mobile text is too small for comfortable readability.',
          severity: 'Medium',
          suggestedFix: 'Use readable mobile typography and avoid shrinking body text below 12px.',
          details: { minFontSize: signals.minFontSize }
        })
      );
    }
    if (signals.textLength < 20) {
      issues.push(
        createIssue({
          category: 'Responsive',
          url,
          viewport,
          description: 'Page appears to have little or no readable content at this viewport.',
          severity: 'High',
          suggestedFix: 'Check responsive hiding rules, failed content loading, and breakpoint-specific rendering.',
          details: { textLength: signals.textLength }
        })
      );
    }
    return issues;
  }
}
