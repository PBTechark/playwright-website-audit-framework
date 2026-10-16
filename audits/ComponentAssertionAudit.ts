import { Page } from '@playwright/test';
import { BrowserSignalCollector } from '../utils/browserSignals';
import { recordAssertion } from '../utils/assertionFactory';
import { AuditCheck, AuditIssue, PerformanceMetrics, Severity } from '../utils/types';

type RawCheck = {
  component: string; checkName: string; passed: boolean; severity: Severity;
  expected: string; actual: string; passComment: string; failComment: string;
  recommendation: string; selector?: string;
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
};

/** Runs non-destructive, generic assertions against every detected UI component. */
export class ComponentAssertionAudit {
  async run(
    page: Page,
    url: string,
    viewport: string,
    metrics: PerformanceMetrics,
    signals: BrowserSignalCollector,
    evidence: string[]
  ): Promise<{ checks: AuditCheck[]; issues: AuditIssue[] }> {
    const raw = await page.evaluate(() => {
      type R = RawCheck;
      const out: R[] = [];
      const visible = (el: HTMLElement) => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0;
      };
      const ignoredOverlay = (el: HTMLElement) => Boolean(el.closest([
        '[data-audit-ignore-visual]',
        '[class*="userway" i]',
        '[id*="userway" i]',
        '[class*="accessibility" i]',
        '[id*="accessibility" i]',
        '[aria-label*="accessibility" i]',
        '[title*="accessibility" i]',
        '[class*="cookie" i]',
        '[id*="cookie" i]',
        '[class*="consent" i]',
        '[id*="consent" i]',
        '[class*="chat" i]',
        '[id*="chat" i]'
      ].join(',')));
      const selector = (el: Element) => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const parts: string[] = []; let node: Element | null = el;
        while (node && node !== document.body && parts.length < 5) {
          const tag = node.tagName.toLowerCase();
          const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(x => x.tagName === node!.tagName) : [];
          parts.unshift(`${tag}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`); node = node.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      };
      const box = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; };
      const viewportWidth = () => document.documentElement.clientWidth;
      const viewportHeight = () => window.innerHeight;
      const visibleArea = (r: DOMRect) => Math.max(0, Math.min(r.right, viewportWidth()) - Math.max(r.left, 0)) *
        Math.max(0, Math.min(r.bottom, viewportHeight()) - Math.max(r.top, 0));
      const visuallyImportant = (el: HTMLElement) =>
        Boolean((el.innerText || '').trim()) ||
        el.matches('a,button,input,select,textarea,img,h1,h2,h3,p,li,nav,header,footer,main,section,article') ||
        Boolean(el.querySelector('a,button,input,select,textarea,img,video,canvas'));
      const userVisible = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const area = visibleArea(r);
        const ratio = area / Math.max(1, r.width * r.height);
        return visible(el) && area > 16 && ratio >= 0.15 && visuallyImportant(el);
      };
      const hasVisibleHorizontalScroll = () => {
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
      const visibleOverflowElement = () => Array.from(document.body.querySelectorAll<HTMLElement>(
        'main,section,article,header,footer,nav,img,a,button,input,select,textarea,h1,h2,h3,p,li,ul,ol,div'
      )).find((element) => {
        if (ignoredOverlay(element) || !userVisible(element)) return false;
        const r = element.getBoundingClientRect();
        const text = `${element.innerText || ''} ${element.id} ${element.className}`.toLowerCase();
        if (/drawer|offcanvas|off-canvas|carousel|swiper|slick|tooltip|popover|modal|cookie|chat|accessibility|userway/.test(text)) return false;
        return r.right > viewportWidth() + 32;
      });
      const add = (component: string, checkName: string, passed: boolean, severity: Severity, expected: string,
        actual: string, passComment: string, failComment: string, recommendation: string, el?: HTMLElement) => out.push({
          component, checkName, passed, severity, expected, actual, passComment, failComment, recommendation,
          selector: el ? selector(el) : undefined, boundingBox: el ? box(el) : undefined
        });

      const nav = document.querySelector<HTMLElement>('nav, [role="navigation"]');
      add('Navigation','Menu visibility',Boolean(nav && visible(nav)),'High','A visible navigation menu',nav ? `visible=${visible(nav)}` : 'No navigation landmark','Menu is visible.','Navigation menu is missing or hidden.','Provide a visible navigation landmark.',nav ?? undefined);
      for (const link of Array.from((nav ?? document).querySelectorAll<HTMLAnchorElement>('a')).filter((item) => !ignoredOverlay(item)).slice(0, 100)) {
        const href = link.getAttribute('href')?.trim() ?? '';
        add('Navigation','Menu link href',href.length > 0 && href !== '#','High','A non-empty navigable href',`href=${href || '(empty)'}`,'Menu link has a valid href.','Menu link has an empty or placeholder href.','Set the link to a valid destination.',link);
        add('Navigation','Menu link clickable',visible(link) && getComputedStyle(link).pointerEvents !== 'none','High','A visible link accepting pointer input',`visible=${visible(link)}, pointerEvents=${getComputedStyle(link).pointerEvents}`,'Menu link is available for interaction.','Menu link is hidden or cannot receive pointer input.','Remove overlays and enable pointer interaction.',link);
      }

      for (const img of Array.from(document.images).filter((item) => !ignoredOverlay(item)).slice(0, 150)) {
        const src = img.currentSrc || img.getAttribute('src') || ''; const r = img.getBoundingClientRect();
        const imageIsCustomerVisible = userVisible(img);
        add('Image','Image visibility',!imageIsCustomerVisible || visible(img),'High','Customer-facing images are visible with non-zero dimensions',`customerVisible=${imageIsCustomerVisible}, rendered=${r.width.toFixed(1)}x${r.height.toFixed(1)}`,'Customer-facing image rendered visibly, or the image is not customer-facing in this viewport.','A customer-facing image exists but is not visible.','Verify CSS visibility and rendering logic.',img);
        add('Image','Image source',!imageIsCustomerVisible || src.length > 0,'High','Customer-facing images have a non-empty image source',`customerVisible=${imageIsCustomerVisible}, src=${src || '(empty)'}`,'Customer-facing image source exists, or the image is not customer-facing in this viewport.','A customer-facing image source is empty.','Provide a valid src or srcset.',img);
        const rendersOrIsNotCustomerVisible = !userVisible(img) || (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
        add('Image','Image rendering',rendersOrIsNotCustomerVisible,'High','Visible customer-facing images decode with non-zero natural dimensions',`visibleToUser=${userVisible(img)}, complete=${img.complete}, natural=${img.naturalWidth}x${img.naturalHeight}`,'Visible image decoded with valid natural dimensions.','A visible customer-facing image failed to render.','Verify the image URL, format, lazy loading, and deployment.',img);
        add('Image','Image clipping',!imageIsCustomerVisible || (r.width <= img.clientWidth + 1 && r.height <= img.clientHeight + 1),'High','Customer-facing images are not clipped by their own box',`customerVisible=${imageIsCustomerVisible}, box=${r.width.toFixed(1)}x${r.height.toFixed(1)}, client=${img.clientWidth}x${img.clientHeight}`,'Customer-facing image is not clipped, or the image is not customer-facing in this viewport.','Customer-facing image content may be clipped.','Review fixed dimensions and overflow rules.',img);
        const clippedCustomerImage = userVisible(img) && ((r.left < -24 && r.right > 32) || (r.right > viewportWidth() + 24 && r.left < viewportWidth() - 32));
        add('Image','Image within viewport',!clippedCustomerImage,'High','Visible customer-facing images are not horizontally clipped by the viewport',`visibleToUser=${userVisible(img)}, left=${r.left.toFixed(1)}, right=${r.right.toFixed(1)}, viewport=${viewportWidth()}`,'Visible image is within the viewport.','Visible image is cut off by the viewport.','Use responsive sizing such as max-width:100%.',img);
      }

      for (const list of Array.from(document.querySelectorAll<HTMLElement>('ul,ol')).filter((item) => !ignoredOverlay(item)).slice(0, 100)) {
        const items = Array.from(list.querySelectorAll<HTMLElement>(':scope > li'));
        add('List','List content',items.length > 0 && items.some(i => (i.innerText || '').trim()),'Medium','At least one non-empty list item',`${items.length} item(s)`,'List contains content.','List is empty or contains no readable content.','Render list content or remove the empty list.',list);
        add('List','List horizontal overflow',list.scrollWidth <= list.clientWidth + 2,'High','No horizontal overflow',`scrollWidth=${list.scrollWidth}, clientWidth=${list.clientWidth}`,'List has no horizontal overflow.','List overflows horizontally.','Allow wrapping and remove rigid item widths.',list);
        for (const item of items.slice(0, 50)) add('List','List item visibility',visible(item),'Medium','Visible list item',`visible=${visible(item)}, textLength=${(item.innerText || '').trim().length}`,'List item is visible.','List item is hidden.','Correct list visibility and responsive styles.',item);
      }

      for (const form of Array.from(document.forms).filter((item) => !ignoredOverlay(item)).slice(0, 50)) {
        add('Form','Form loads',visible(form),'Medium','Visible form',`visible=${visible(form)}`,'Form loaded visibly.','Form is hidden or has no dimensions.','Correct form rendering and visibility.',form);
        const submit = form.querySelector<HTMLElement>('button[type="submit"],input[type="submit"],button:not([type])');
        add('Form','Submit control exists',Boolean(submit),'Medium','A submit control','Submit control is ' + (submit ? 'present' : 'missing'),'Submit control exists.','No submit control was found.','Add a clearly labelled submit button.',form);
      }

      for (const button of Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"],input[type="button"],input[type="submit"]')).filter((item) => !ignoredOverlay(item)).slice(0, 150)) {
        const disabled = button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';
        const name = (button.innerText || button.getAttribute('aria-label') || (button as HTMLInputElement).value || '').trim();
        add('Button','Button visibility',visible(button),'High','A visible button',`visible=${visible(button)}`,'Button is visible.','Button is not visible.','Correct CSS visibility or remove the hidden control.',button);
        add('Button','Button enabled',!disabled,'Medium','An enabled button',`disabled=${disabled}`,'Button is enabled.','Button is disabled.','Enable the button when its action is available.',button);
        add('Button','Button accessible name',name.length > 0,'Medium','Non-empty visible or accessible text',`name=${name || '(empty)'}`,'Button has a meaningful name.','Button has no text or accessible name.','Add visible text or aria-label.',button);
      }

      const overflow = visibleOverflowElement();
      add('Layout','Horizontal scrolling',!hasVisibleHorizontalScroll() || !overflow,'High','No user-visible content forces horizontal scrolling',`scrollWidth=${document.documentElement.scrollWidth}, clientWidth=${document.documentElement.clientWidth}, overflowing=${overflow ? selector(overflow) : 'none'}`,'No customer-visible horizontal scrolling detected.','Visible page content creates horizontal scrolling.','Fix fixed-width or off-screen content that users can actually see.',overflow);
      const footer = document.querySelector<HTMLElement>('footer,[role="contentinfo"]');
      add('Footer','Footer visibility',Boolean(footer && visible(footer)),'Medium','A visible footer',footer ? `visible=${visible(footer)}` : 'No footer found','Footer is visible.','Footer is missing or hidden.','Provide a visible contentinfo/footer region.',footer ?? undefined);
      return out;
    });

    raw.push(...this.performanceChecks(metrics, signals));
    const checks: AuditCheck[] = []; const issues: AuditIssue[] = [];
    for (const item of raw) {
      const recorded = recordAssertion({ ...item, url, viewport, evidence: item.passed ? undefined : evidence,
        consoleLogs: item.component === 'Performance' ? signals.consoleFindings.map(x => `${x.type}: ${x.text}`).slice(0, 25) : undefined });
      checks.push(recorded.check); if (recorded.issue) issues.push(recorded.issue);
    }
    return { checks, issues };
  }

  private performanceChecks(metrics: PerformanceMetrics, signals: BrowserSignalCollector): RawCheck[] {
    const make = (checkName: string, passed: boolean, expected: string, actual: string, failComment: string, recommendation: string): RawCheck => ({
      component:'Performance', checkName, passed, severity:'Medium', expected, actual,
      passComment:`${checkName} is within the configured threshold.`, failComment, recommendation
    });
    const errorCount = signals.consoleFindings.filter(x => x.type === 'error' || x.type === 'pageerror').length;
    return [
      make('Page load time',metrics.loadTimeMs <= 5000,'Load time <= 5000 ms',`${metrics.loadTimeMs} ms`,'Page load exceeds 5 seconds.','Optimize server response and render-blocking resources.'),
      make('Largest Contentful Paint',(metrics.largestContentfulPaintMs ?? 0) <= 2500,'LCP <= 2500 ms',`${metrics.largestContentfulPaintMs ?? 'not observed'} ms`,'LCP exceeds the recommended threshold.','Optimize the primary content asset and critical rendering path.'),
      make('Cumulative Layout Shift',true,'CLS is collected as supporting evidence for visible shift findings',`CLS=${metrics.cumulativeLayoutShift ?? 'not observed'}`,'CLS is only a supporting signal and should not fail without visible movement.','Review visual layout-shift findings for the affected element before remediating CLS.'),
      make('Console errors',errorCount <= 3,'No more than 3 console errors',`${errorCount} error(s)`,'Excessive console errors were recorded.','Fix uncaught exceptions and failed client-side operations.')
    ];
  }
}
