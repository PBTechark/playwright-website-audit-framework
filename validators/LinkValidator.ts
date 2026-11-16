import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { APIRequestContext, Page } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { readJsonFile } from '../utils/fileSystem';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue, LinkFinding } from '../utils/types';
import { isInternalNavigableUrl, normalizeUrl, uniqueUrls } from '../utils/urlUtils';
import { mapWithConcurrency } from '../utils/concurrency';
import { EvidenceManager } from '../utils/evidence';

const SERVER_ERROR_ATTEMPTS = 3;
const SERVER_ERROR_RETRY_DELAY_MS = 500;
const FRAGMENT_CHECK_TIMEOUT_MS = 2_000;
const FRAGMENT_SETTLE_MS = 100;

type BrokenAnchorCandidate = {
  hash: string;
  href: string;
  selector: string;
  text: string;
  isBackToTop: boolean;
};

type AnchorVerification = {
  resolved: boolean;
  clicked: boolean;
  defaultPrevented: boolean;
  targetAppeared: boolean;
  targetVisible: boolean;
  scrollBefore: number;
  scrollAfter: number;
  error?: string;
};

export class LinkValidator {
  constructor(
    private readonly request: APIRequestContext,
    private readonly baseUrl: string,
    private readonly targetName = 'default'
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
    const evidence = new EvidenceManager(page, url, viewport, this.targetName);

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

    const originalPageUrl = page.url();
    const originalScrollY = await page.evaluate(() => window.scrollY);
    const anchors = await this.findBrokenAnchors(page, url);
    for (const [index, anchor] of anchors.entries()) {
      const verification = await this.verifySamePageAnchor(
        page,
        anchor,
        originalPageUrl,
        originalScrollY,
        index
      );
      if (verification.resolved) continue;
      const screenshot = await evidence.captureElementDiagnostic(
        `broken-anchor-${index}`,
        anchor.selector,
        `Missing anchor target ${anchor.hash}`
      );
      issues.push(
        createIssue({
          category: 'Links',
          url,
          viewport,
          selector: anchor.selector,
          description: `Anchor target is missing: ${anchor.hash}`,
          severity: 'Medium',
          suggestedFix: 'Create the target element id or update the anchor link.',
          details: { ...anchor, verification },
          evidence: screenshot ? [screenshot.path] : [],
          evidenceDetails: screenshot ? [screenshot] : []
        })
      );
      await this.restorePageState(page, originalPageUrl, originalScrollY);
    }

    const placeholderCtas = await this.findPlaceholderCtaLinks(page);
    for (const [index, cta] of placeholderCtas.entries()) {
      const screenshot = await evidence.captureElementDiagnostic(
        `link-cta-issue-${index}`,
        cta.selector,
        `a "${cta.text}"`
      );
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
          details: cta,
          evidence: screenshot ? [screenshot.path] : [],
          evidenceDetails: screenshot ? [screenshot] : []
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

  /**
   * A link's status depends only on its destination, so one check per run serves every page,
   * viewport and worker. The cache is on disk because Playwright replaces the worker process after
   * every failed test. Network errors and timeouts may be transient, so only HTTP answers are shared.
   */
  private async checkLink(sourceUrl: string, destinationUrl: string, isLogo = false): Promise<LinkFinding> {
    if (!fs.existsSync(auditConfig.linkCacheDir)) return this.fetchLink(sourceUrl, destinationUrl, isLogo);
    const cachePath = path.join(
      auditConfig.linkCacheDir,
      `${crypto.createHash('sha1').update(destinationUrl).digest('hex')}.json`
    );
    const cached = readJsonFile<LinkFinding | null>(cachePath, null);
    if (cached && (cached.statusCode === undefined || cached.statusCode < 500)) {
      const reused: LinkFinding = { ...cached, sourceUrl };
      if (isLogo) reused.linkType = 'logo';
      else delete reused.linkType;
      return reused;
    }
    const finding = await this.fetchLink(sourceUrl, destinationUrl, isLogo);
    if (finding.statusCode !== undefined && finding.statusCode < 500) {
      // Write then rename, so a worker reading at the same moment never sees a partial file.
      fs.writeFileSync(`${cachePath}.${process.pid}`, JSON.stringify(finding), 'utf-8');
      fs.renameSync(`${cachePath}.${process.pid}`, cachePath);
    }
    return finding;
  }

  private async fetchLink(sourceUrl: string, destinationUrl: string, isLogo = false): Promise<LinkFinding> {
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

        let response = await this.request.get(currentUrl, {
          maxRedirects: 0,
          timeout: 15_000,
          failOnStatusCode: false
        });
        for (let attempt = 1; response.status() >= 500 && attempt < SERVER_ERROR_ATTEMPTS; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, SERVER_ERROR_RETRY_DELAY_MS * attempt));
          response = await this.request.get(currentUrl, {
            maxRedirects: 0,
            timeout: 15_000,
            failOnStatusCode: false
          });
        }
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

  private async findBrokenAnchors(page: Page, url: string): Promise<BrokenAnchorCandidate[]> {
    await page.waitForTimeout(100);
    return page.evaluate((pageUrl) => {
      const selectorFor = (element: Element): string => {
        const uniquelySelectsElement = (selector: string): boolean => {
          try {
            const matches = document.querySelectorAll(selector);
            return matches.length === 1 && matches[0] === element;
          } catch {
            return false;
          }
        };
        if (element.id) {
          const candidate = `#${CSS.escape(element.id)}`;
          if (uniquelySelectsElement(candidate)) return candidate;
        }
        const parts: string[] = [];
        let node: Element | null = element;
        while (node && node !== document.body) {
          const siblings = node.parentElement
            ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName)
            : [];
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`);
          node = node.parentElement;
          const candidate = `body > ${parts.join(' > ')}`;
          if (node === document.body && uniquelySelectsElement(candidate)) return candidate;
        }
        return `body > ${parts.join(' > ')}`;
      };
      const exists = (id: string): boolean =>
        Boolean(
          document.getElementById(id) ||
            Array.from(document.getElementsByName(id)).some((element) => element instanceof HTMLAnchorElement)
        );
      return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"], a[href*="#"]'))
        .flatMap((anchor) => {
          try {
            const target = new URL(anchor.href, pageUrl);
            if (target.origin !== new URL(pageUrl).origin ||
              target.pathname !== new URL(pageUrl).pathname ||
              target.search !== new URL(pageUrl).search ||
              !target.hash
            ) {
              return [];
            }
            const id = decodeURIComponent(target.hash.slice(1));
            if (!id || exists(id)) return [];

            const accordionTrigger = anchor.closest<HTMLElement>('[role="tab"], .ui-accordion-header');
            const controlledPanelId = accordionTrigger?.getAttribute('aria-controls');
            const hasControlledPanel =
              Boolean(accordionTrigger?.hasAttribute('aria-expanded')) &&
              Boolean(controlledPanelId && document.getElementById(controlledPanelId));
            if (hasControlledPanel) return [];

            const identity = [
              anchor.id,
              anchor.className,
              anchor.getAttribute('aria-label') ?? '',
              anchor.getAttribute('title') ?? '',
              anchor.textContent ?? ''
            ].join(' ');
            return [{
              hash: target.hash,
              href: target.href,
              selector: selectorFor(anchor),
              text: (anchor.innerText || anchor.textContent || anchor.getAttribute('aria-label') || '').trim(),
              isBackToTop: /^(?:top|page-top|top-of-page)$/i.test(id) ||
                /back[-_ ]?to[-_ ]?top|scroll[-_ ]?to[-_ ]?top|return[-_ ]?to[-_ ]?top/i.test(identity)
            }];
          } catch {
            return [];
          }
        });
    }, url);
  }

  private async verifySamePageAnchor(
    page: Page,
    anchor: BrokenAnchorCandidate,
    originalUrl: string,
    originalScrollY: number,
    index: number
  ): Promise<AnchorVerification> {
    const marker = `__auditFragmentDefaultPrevented${index}`;
    let verification: AnchorVerification = {
      resolved: false,
      clicked: false,
      defaultPrevented: false,
      targetAppeared: false,
      targetVisible: false,
      scrollBefore: originalScrollY,
      scrollAfter: originalScrollY
    };

    try {
      if (anchor.isBackToTop) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(FRAGMENT_SETTLE_MS);
      }

      const locator = page.locator(anchor.selector).first();
      await locator.scrollIntoViewIfNeeded({ timeout: FRAGMENT_CHECK_TIMEOUT_MS });
      if (!(await locator.isVisible())) {
        return { ...verification, error: 'The same-document link remained hidden after scrolling it into view.' };
      }
      const beforeAction = await page.evaluate(() => ({ scrollY: window.scrollY, hash: window.location.hash }));
      verification.scrollBefore = beforeAction.scrollY;
      await page.evaluate(
        ({ selector, markerName }) => {
          const target = document.querySelector(selector);
          if (!(target instanceof HTMLAnchorElement)) return;
          const listener = (event: Event) => {
            if (!(event.target instanceof Element) || event.target.closest('a') !== target) return;
            window.setTimeout(() => {
              document.documentElement.setAttribute(markerName, String(event.defaultPrevented));
            }, 0);
          };
          window.addEventListener('click', listener, true);
          Reflect.set(document.documentElement, markerName, listener);
        },
        { selector: anchor.selector, markerName: marker }
      );
      await locator.click({ timeout: FRAGMENT_CHECK_TIMEOUT_MS });
      verification.clicked = true;
      await page.waitForTimeout(FRAGMENT_SETTLE_MS);
      const readOutcome = () => page.evaluate(
        ({ hash, markerName }) => {
          const id = decodeURIComponent(hash.replace(/^#/, ''));
          const target =
            document.getElementById(id) ||
            Array.from(document.getElementsByName(id)).find((element) => element instanceof HTMLAnchorElement) ||
            null;
          const targetAppeared = Boolean(target);
          const targetVisible = target
            ? (() => {
                const rect = target.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0 ||
                  rect.right <= 0 || rect.left >= window.innerWidth ||
                  rect.bottom <= 0 || rect.top >= window.innerHeight
                ) {
                  return false;
                }
                let current: Element | null = target;
                while (current) {
                  const style = window.getComputedStyle(current);
                  if (
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.visibility === 'collapse' ||
                    Number(style.opacity) <= 0.01
                  ) {
                    return false;
                  }
                  current = current.parentElement;
                }
                return true;
              })()
            : false;
          return {
            defaultPrevented: document.documentElement.getAttribute(markerName) === 'true',
            targetAppeared,
            targetVisible,
            scrollAfter: window.scrollY,
            hashAfter: window.location.hash
          };
        },
        { hash: anchor.hash, markerName: marker }
      );
      const isResolved = (outcome: Awaited<ReturnType<typeof readOutcome>>): boolean =>
        (outcome.targetAppeared &&
          (outcome.targetVisible ||
            Math.abs(outcome.scrollAfter - verification.scrollBefore) > 16 ||
            outcome.hashAfter === anchor.hash)) ||
        (anchor.isBackToTop && verification.scrollBefore > 4 && outcome.scrollAfter <= 4);
      let outcome = await readOutcome();
      const deadline = Date.now() + FRAGMENT_CHECK_TIMEOUT_MS;
      while (!isResolved(outcome) && Date.now() < deadline) {
        await page.waitForTimeout(Math.min(50, deadline - Date.now()));
        outcome = await readOutcome();
      }
      verification = {
        ...verification,
        defaultPrevented: outcome.defaultPrevented,
        targetAppeared: outcome.targetAppeared,
        targetVisible: outcome.targetVisible,
        scrollAfter: outcome.scrollAfter,
        resolved: isResolved(outcome)
      };
    } catch (error) {
      verification.error = error instanceof Error ? error.message : String(error);
    } finally {
      await page.evaluate((markerName) => {
        const listener = Reflect.get(document.documentElement, markerName);
        if (typeof listener === 'function') window.removeEventListener('click', listener, true);
        Reflect.deleteProperty(document.documentElement, markerName);
        document.documentElement.removeAttribute(markerName);
      }, marker);
      await this.restorePageState(page, originalUrl, originalScrollY);
    }

    return verification;
  }

  private async restorePageState(page: Page, originalUrl: string, originalScrollY: number): Promise<void> {
    await page.evaluate(
      ({ url, scrollY }) => {
        const original = new URL(url, window.location.href);
        if (original.origin === window.location.origin && original.href !== window.location.href) {
          window.history.replaceState(window.history.state, '', original.href);
        }
        window.scrollTo(0, scrollY);
      },
      { url: originalUrl, scrollY: originalScrollY }
    );
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
        const uniquelySelectsElement = (selector: string): boolean => {
          try {
            const matches = document.querySelectorAll(selector);
            return matches.length === 1 && matches[0] === element;
          } catch {
            return false;
          }
        };
        if (element.id) {
          const candidate = `#${CSS.escape(element.id)}`;
          if (uniquelySelectsElement(candidate)) return candidate;
        }
        const parts: string[] = [];
        let node: Element | null = element;
        while (node && node !== document.body) {
          const siblings = node.parentElement
            ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName)
            : [];
          parts.unshift(
            `${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`
          );
          node = node.parentElement;
          const candidate = `body > ${parts.join(' > ')}`;
          if (node === document.body && uniquelySelectsElement(candidate)) return candidate;
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
