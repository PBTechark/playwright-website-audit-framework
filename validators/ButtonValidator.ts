import { Page } from '@playwright/test';
import { EvidenceManager } from '../utils/evidence';
import { createIssue } from '../utils/issueFactory';
import { hasUsableVisibleNavigation } from '../utils/responsiveNavigation';
import { AuditIssue, ScreenshotEvidence } from '../utils/types';

type ButtonSnapshot = {
  selector: string;
  text: string;
  visibleText: string;
  visible: boolean;
  expectedResponsiveHidden: boolean;
  backToTop: boolean;
  iconControl: boolean;
  iconState: 'rendered' | 'missing' | 'font-failed' | 'unknown' | null;
  iconDetails?: Record<string, unknown>;
  disabled: boolean;
  tagName: string;
  role?: string;
  className: string;
  display: string;
  visibility: string;
  opacity: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  href?: string;
};

type HoverState = {
  text: string;
  visible: boolean;
  display: string;
  visibility: string;
  opacity: number;
  color: string;
  backgroundColor: string;
  contrastRatio: number | null;
  contrastThreshold: number | null;
  fontSize: number;
  fontWeight: number;
  baselineContrastRatio?: number | null;
  baselineContrastThreshold?: number | null;
  rect: { width: number; height: number };
  textRect: { width: number; height: number } | null;
  reason?: string;
};

type BackToTopResult = {
  visibleAfterScroll: boolean;
  actionTested: boolean;
  returnedToTop: boolean;
  boundingBox: ButtonSnapshot['boundingBox'];
  error?: string;
};

export class ButtonValidator {
  async validate(page: Page, url: string, viewport: string, targetName = 'default'): Promise<AuditIssue[]> {
    await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
    const buttons = await page.evaluate(() => {
      const attributeSelector = (element: Element, attribute: string, value: string): string =>
        `${element.tagName.toLowerCase()}[${attribute}="${CSS.escape(value)}"]`;
      const selectorFor = (element: Element): string => {
        const uniquelySelectsElement = (selector: string): boolean => {
          try {
            const matches = document.querySelectorAll(selector);
            return matches.length === 1 && matches[0] === element;
          } catch {
            return false;
          }
        };
        for (const attribute of ['data-testid', 'data-test', 'aria-label', 'name', 'href']) {
          const value = element.getAttribute(attribute);
          if (!value) continue;
          const candidate = attributeSelector(element, attribute, value);
          if (uniquelySelectsElement(candidate)) return candidate;
        }
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
      const isVisible = (element: HTMLElement): boolean => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;

        let current: HTMLElement | null = element;
        while (current) {
          const style = window.getComputedStyle(current);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.visibility === 'collapse' ||
            style.contentVisibility === 'hidden' ||
            Number(style.opacity) <= 0.01
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      const looksLikeCta = (element: HTMLElement): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const classText = `${element.className} ${element.parentElement?.className ?? ''}`;
        const text = (element.innerText || element.textContent || element.getAttribute('aria-label') || '').trim();
        const hasButtonShape = rect.width >= 60 && rect.height >= 24 && (
          style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
          style.borderStyle !== 'none' ||
          style.textTransform === 'uppercase'
        );
        return text.length > 1 && (
          element.tagName.toLowerCase() !== 'a' ||
          element.getAttribute('role') === 'button' ||
          /btn|button|cta|shop|buy|learn|contact|quote|submit/i.test(classText) ||
          hasButtonShape
        );
      };
      const getAccessibleName = (element: HTMLElement): string => {
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        if (ariaLabel) return ariaLabel;
        const labelledBy = element.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? [];
        const labelledText = labelledBy
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' ');
        if (labelledText) return labelledText;
        if (element instanceof HTMLInputElement && element.value.trim()) return element.value.trim();
        const imageText = Array.from(element.querySelectorAll<HTMLImageElement>('img[alt]'))
          .map((image) => image.alt.trim())
          .filter(Boolean)
          .join(' ');
        const svgText = Array.from(element.querySelectorAll<SVGTitleElement>('svg title'))
          .map((title) => title.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' ');
        return [
          element.innerText?.trim() || element.textContent?.trim() || '',
          imageText,
          svgText,
          element.getAttribute('title')?.trim() ?? ''
        ].filter(Boolean).join(' ').trim();
      };
      const inspectIcon = (
        element: HTMLElement,
        iconElements: HTMLElement[]
      ): Pick<ButtonSnapshot, 'iconState' | 'iconDetails'> => {
        const inspectedElements = Array.from(new Set([element, ...iconElements]));
        const observations = inspectedElements.map((icon) => {
          const rect = icon.getBoundingClientRect();
          const style = window.getComputedStyle(icon);
          const before = window.getComputedStyle(icon, '::before');
          const after = window.getComputedStyle(icon, '::after');
          const pseudoStyles = [before, after];
          const pseudoContent = [before.content, after.content].find(
            (content) => content !== 'none' && content !== 'normal' && content !== '""' && content !== "''"
          );
          const fontFamily = (before.content !== 'none' && before.content !== 'normal'
            ? before.fontFamily
            : style.fontFamily).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
          const fontFaces = Array.from(document.fonts).filter(
            (fontFace) => fontFace.family.replace(/^['"]|['"]$/g, '').toLowerCase() === fontFamily.toLowerCase()
          );
          const failedFont = fontFaces.length > 0 && fontFaces.every((fontFace) => fontFace.status === 'error');
          const image = icon instanceof HTMLImageElement ? icon : undefined;
          const lazySource = image
            ? image.getAttribute('data-src') ||
              image.getAttribute('data-lazy-src') ||
              image.getAttribute('data-original') ||
              image.getAttribute('data-srcset')
            : undefined;
          const imagePending = Boolean(
            image &&
              lazySource &&
              image.getAttribute('src') !== lazySource &&
              image.currentSrc !== lazySource
          );
          const imageLoaded = image ? !imagePending && image.complete && image.naturalWidth > 0 : undefined;
          const svg = icon instanceof SVGElement ? icon : undefined;
          const svgGraphics = svg
            ? Array.from(svg.querySelectorAll<SVGGraphicsElement>('path,use,circle,rect,polygon,line,polyline,text,image'))
            : [];
          const svgHasGraphic = svg
            ? (() => {
                const svgRect = svg.getBoundingClientRect();
                let current: Element | null = svg;
                while (current) {
                  const currentStyle = window.getComputedStyle(current);
                  if (
                    currentStyle.display === 'none' ||
                    currentStyle.visibility === 'hidden' ||
                    currentStyle.visibility === 'collapse' ||
                    Number(currentStyle.opacity) <= 0.01
                  ) {
                    return false;
                  }
                  current = current.parentElement;
                }
                if (svgRect.width <= 0 || svgRect.height <= 0) return false;
                return svgGraphics.some((graphic) => {
                  const graphicStyle = window.getComputedStyle(graphic);
                  if (
                    graphicStyle.display === 'none' ||
                    graphicStyle.visibility === 'hidden' ||
                    graphicStyle.visibility === 'collapse' ||
                    Number(graphicStyle.opacity) <= 0.01
                  ) {
                    return false;
                  }
                  try {
                    const bounds = graphic.getBBox();
                    return bounds.width > 0 || bounds.height > 0;
                  } catch {
                    return false;
                  }
                });
              })()
            : undefined;
          const hasBackground =
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) > 0.01 &&
            [style, ...pseudoStyles].some(
              (computedStyle) =>
                computedStyle.display !== 'none' &&
                computedStyle.visibility !== 'hidden' &&
                Number(computedStyle.opacity) > 0.01 &&
                (computedStyle.backgroundImage !== 'none' ||
                  computedStyle.maskImage !== 'none' ||
                  computedStyle.webkitMaskImage !== 'none')
            );
          const hasVisibleGlyph = pseudoStyles.some((computedStyle) => {
            const content = computedStyle.content;
            return Boolean(
              content &&
                content !== 'none' &&
                content !== 'normal' &&
                content !== '""' &&
                content !== "''" &&
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity) > 0.01 &&
                computedStyle.display !== 'none' &&
                computedStyle.visibility !== 'hidden' &&
                Number(computedStyle.opacity) > 0.01 &&
                Number.parseFloat(computedStyle.fontSize) > 0
            );
          });
          return {
            className: typeof icon.className === 'string' ? icon.className : icon.getAttribute('class') ?? '',
            width: Number(rect.width.toFixed(1)),
            height: Number(rect.height.toFixed(1)),
            pseudoContent,
            fontFamily,
            fontStatus: fontFaces.map((fontFace) => fontFace.status),
            failedFont,
            imageLoaded,
            imagePending,
            svgGraphicPresent: svgGraphics.length > 0,
            svgHasGraphic,
            hasBackground,
            hasVisibleGlyph
          };
        });
        const hasFontIconClass = inspectedElements.some((icon) =>
          /(^|\s)fa-[\w-]+/.test(typeof icon.className === 'string' ? icon.className : icon.getAttribute('class') ?? '')
        ) || /(^|\s)fa-[\w-]+/.test(typeof element.className === 'string' ? element.className : '');
        const failedFont = observations.some((observation) => observation.failedFont);
        const hiddenSvgGraphic = observations.some(
          (observation) => observation.svgGraphicPresent && !observation.svgHasGraphic
        );
        const rendered = observations.some((observation) =>
          observation.hasVisibleGlyph ||
          observation.imageLoaded === true ||
          observation.svgHasGraphic === true ||
          observation.hasBackground
        );
        const hasBrokenImage = observations.some(
          (observation) => observation.imageLoaded === false && !observation.imagePending
        );
        const state: ButtonSnapshot['iconState'] = rendered
          ? 'rendered'
          : failedFont
            ? 'font-failed'
            : hasBrokenImage || hasFontIconClass || hiddenSvgGraphic
              ? 'missing'
              : 'unknown';
        return {
          iconState: state,
          iconDetails: {
            hasFontIconClass,
            observations
          }
        };
      };
      const isBackToTop = (element: HTMLElement): boolean => {
        const identity = [
          element.id,
          typeof element.className === 'string' ? element.className : '',
          element.getAttribute('aria-label') ?? '',
          element.getAttribute('title') ?? ''
        ].join(' ');
        return /back[-_ ]?to[-_ ]?top|scroll[-_ ]?to[-_ ]?top|return[-_ ]?to[-_ ]?top/i.test(identity);
      };
      const iconElementsFor = (button: HTMLElement): HTMLElement[] => {
        const imageIcons = Array.from(button.querySelectorAll<HTMLImageElement>('img')).filter((image) => {
          const rect = image.getBoundingClientRect();
          const classText = `${image.className} ${image.id} ${image.parentElement?.className ?? ''}`;
          if (/thumbnail|featured|product|gallery|card-image|post-image/i.test(classText)) return false;
          if (/(^|[\s_-])(?:icon|logo)(?:$|[\s_-])|fa-[\w-]+/i.test(classText)) return true;
          return (
            rect.width <= 96 &&
            rect.height <= 96 &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.width / rect.height >= 0.5 &&
            rect.width / rect.height <= 2
          );
        });
        const elements = Array.from(
          button.querySelectorAll<HTMLElement>('i,svg,[class*="icon" i],[class*="fa-" i]')
        );
        return Array.from(new Set([...elements, ...imageIcons]));
      };
      return Array.from(document.querySelectorAll<HTMLElement>([
        'button',
        '[role="button"]',
        'input[type="button"]',
        'input[type="submit"]',
        'a[href]'
      ].join(',')))
        .filter((button) => !button.closest([
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
        ].join(',')))
        .filter((button) => !(button instanceof HTMLAnchorElement) || button.getAttribute('role') === 'button' ||
          (!button.textContent?.trim() && (iconElementsFor(button).length > 0 || /(^|\s)(fa-[\w-]+|icon[\w-]*)/i.test(button.className))))
        .filter((button) => {
          const backToTop = isBackToTop(button);
          const iconElements = iconElementsFor(button);
          const selfIsIcon = /(^|\s)(fa-[\w-]+|icon[\w-]*)/i.test(
            typeof button.className === 'string' ? button.className : ''
          );
          const iconOnly = !(button.innerText?.trim() || button.textContent?.trim());
          const isIconControl = (iconElements.length > 0 || selfIsIcon) && iconOnly;
          return looksLikeCta(button) || backToTop || isIconControl;
        })
        .slice(0, 250)
        .map((button): ButtonSnapshot => {
          const rect = button.getBoundingClientRect();
          const style = window.getComputedStyle(button);
          const backToTop = isBackToTop(button);
          const iconElements = iconElementsFor(button);
          if (/(\bfa-[\w-]+|\bicon[\w-]*)/i.test(typeof button.className === 'string' ? button.className : '')) {
            iconElements.unshift(button);
          }
          const iconControl = iconElements.length > 0 || backToTop;
          const iconInspection = iconControl ? inspectIcon(button, iconElements) : { iconState: null, iconDetails: undefined };
          const disabled =
            button.hasAttribute('disabled') ||
            button.getAttribute('aria-disabled') === 'true' ||
            (button instanceof HTMLInputElement && button.disabled);
          return {
            selector: selectorFor(button),
            text: getAccessibleName(button),
            visibleText: (button.innerText || '').trim(),
            visible: isVisible(button),
            expectedResponsiveHidden: false,
            backToTop,
            iconControl,
            ...iconInspection,
            disabled,
            tagName: button.tagName.toLowerCase(),
            role: button.getAttribute('role') ?? undefined,
            className: typeof button.className === 'string' ? button.className : '',
            display: style.display,
            visibility: style.visibility,
            opacity: Number(style.opacity),
            boundingBox: {
              x: Number(rect.x.toFixed(1)),
              y: Number(rect.y.toFixed(1)),
              width: Number(rect.width.toFixed(1)),
              height: Number(rect.height.toFixed(1))
            },
            href: button instanceof HTMLAnchorElement ? button.href : undefined
          };
        });
    });
    await Promise.all(
      buttons
        .filter((button) => !button.visible)
        .map(async (button) => {
          button.expectedResponsiveHidden = await page.evaluate(hasUsableVisibleNavigation, button.selector);
        })
    );
    const issues: AuditIssue[] = [];
    const evidenceManager = new EvidenceManager(page, url, viewport, targetName);
    for (const [index, button] of buttons.entries()) {
      let issueEvidence: ScreenshotEvidence | null | undefined;
      const captureIssueEvidence = async (): Promise<ScreenshotEvidence | null> => {
        if (issueEvidence === undefined) {
          issueEvidence = await evidenceManager.captureElementDiagnostic(
            `button-issue-${index}`,
            button.selector,
            `${button.tagName}${button.text ? ` "${button.text}"` : ''}`
          );
        }
        return issueEvidence;
      };
      const evidenceFields = (shot: ScreenshotEvidence | null) => ({
        evidence: shot ? [shot.path] : [],
        evidenceDetails: shot ? [shot] : []
      });

      let backToTopResult: BackToTopResult | undefined;
      if (button.backToTop) {
        backToTopResult = await this.validateBackToTop(page, button);
        button.visible = backToTopResult.visibleAfterScroll;
        button.boundingBox = backToTopResult.boundingBox;
        if (!backToTopResult.visibleAfterScroll ||
          (backToTopResult.actionTested && !backToTopResult.returnedToTop)) {
          const shot = await captureIssueEvidence();
          issues.push(
            createIssue({
              category: 'Buttons',
              url,
              viewport,
              selector: button.selector,
              description: !backToTopResult.visibleAfterScroll
                ? 'Back-to-top control does not become visible after scrolling.'
                : 'Back-to-top control does not return the page to the top.',
              severity: 'Medium',
              expected: 'The back-to-top control becomes visible while scrolling and returns the page to the top when activated.',
              actual: backToTopResult.error ??
                `Visible after scroll: ${backToTopResult.visibleAfterScroll}; returned to top: ${backToTopResult.returnedToTop}.`,
              suggestedFix: 'Ensure the control is visible after scrolling and its activation smoothly scrolls the current page to the top.',
              details: { ...button, backToTopResult },
              ...evidenceFields(shot)
            })
          );
        }
      }

      if (button.visible && button.iconControl && button.iconState === 'missing') {
        const shot = await captureIssueEvidence();
        issues.push(
          createIssue({
            category: 'Buttons',
            url,
            viewport,
            selector: button.selector,
            description: 'Icon-only control has no rendered icon.',
            severity: 'Low',
            expected: 'The control displays its intended icon.',
            actual: `An icon control was identified, but no visible icon glyph, loaded image, graphic SVG, or CSS background/mask was found.`,
            suggestedFix: 'Check the icon markup, CSS pseudo-element, and required icon font or image resource.',
            details: { ...button, backToTopResult },
            ...evidenceFields(shot)
          })
        );
      } else if (button.visible && button.iconControl && button.iconState === 'font-failed') {
        const shot = await captureIssueEvidence();
        issues.push(
          createIssue({
            category: 'Buttons',
            url,
            viewport,
            selector: button.selector,
            description: 'Icon font failed to load for an icon-only control.',
            severity: 'Medium',
            expected: 'The font used by the control icon loads successfully.',
            actual: 'The icon font face is present in the document font set but has an error status.',
            suggestedFix: 'Verify the icon font URL, response status, CORS policy, and font-face declaration.',
            details: { ...button, backToTopResult },
            ...evidenceFields(shot)
          })
        );
      }

      if (!button.visible && !button.expectedResponsiveHidden && !button.backToTop) {
        const shot = await captureIssueEvidence();
        issues.push(
          createIssue({
            category: 'Buttons',
            url,
            viewport,
            selector: button.selector,
            description: 'Button is present but not visible.',
            severity: 'Low',
            expected: 'A visible, operable control',
            actual: `No visible control box (${button.boundingBox.width} x ${button.boundingBox.height}px; display=${button.display}, visibility=${button.visibility}, opacity=${button.opacity}).`,
            suggestedFix: 'Remove hidden interactive controls or make the button visible when users need it.',
            details: button,
            ...evidenceFields(shot)
          })
        );
      }

      if (button.visible && !button.text && !(button.iconControl && button.iconState === 'rendered')) {
        const shot = await captureIssueEvidence();
        issues.push(
          createIssue({
            category: 'Buttons',
            url,
            viewport,
            selector: button.selector,
            description: 'Button has no visible or accessible label.',
            severity: 'Low',
            suggestedFix: 'Add button text, aria-label, or a labelled icon name.',
            details: button,
            ...evidenceFields(shot)
          })
        );
      }

      if (button.visible && !button.disabled && button.visibleText) {
        const hover = await this.inspectHoverState(page, button.selector).catch(() => null);
        if (hover?.reason) {
          const shot = await captureIssueEvidence();
          issues.push(
            createIssue({
              category: hover.reason.startsWith('Hover-state text contrast')
                ? 'Accessibility'
                : 'Buttons',
              url,
              viewport,
              selector: button.selector,
              description: hover.reason.startsWith('Hover-state text contrast')
                ? `Hover-state text contrast is insufficient: ${button.visibleText}.`
                : `Button text becomes unavailable on hover: ${button.visibleText}.`,
              severity: hover.reason.startsWith('Hover-state text contrast') ? 'Medium' : 'Suggestion',
              expected: 'Hover-state text meets the WCAG AA contrast requirement and remains visible.',
              actual: hover.reason,
              suggestedFix: hover.reason.startsWith('Hover-state text contrast')
                ? 'Adjust the hover text or background color to meet the WCAG AA contrast ratio for its text size.'
                : 'Adjust hover styles so the label remains visible and available.',
              details: { ...button, hover },
              ...evidenceFields(shot)
            })
          );
        }
      }
      if (button.visible && !button.disabled && (button.boundingBox.width < 32 || button.boundingBox.height < 32)) {
        const shot = await captureIssueEvidence();
        issues.push(
          createIssue({
            category: 'Buttons',
            url,
            viewport,
            selector: button.selector,
            description: 'Clickable button target is smaller than recommended touch size.',
            severity: 'Suggestion',
            suggestedFix: 'Increase the clickable target to at least 32 by 32 CSS pixels, preferably 44 by 44 on touch UI.',
            details: button,
            ...evidenceFields(shot)
          })
        );
      }
    }
    return issues;
  }

  private async validateBackToTop(page: Page, button: ButtonSnapshot): Promise<BackToTopResult> {
    const initialScrollY = await page.evaluate(() => window.scrollY);
    let result: BackToTopResult = {
      visibleAfterScroll: false,
      actionTested: false,
      returnedToTop: false,
      boundingBox: button.boundingBox
    };

    try {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);
      const locator = page.locator(button.selector).first();
      const state = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const visibleArea =
          Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)) *
          Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        return {
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            visibleArea > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) > 0.01,
          boundingBox: {
            x: Number(rect.x.toFixed(1)),
            y: Number(rect.y.toFixed(1)),
            width: Number(rect.width.toFixed(1)),
            height: Number(rect.height.toFixed(1))
          },
          safeToActivate: (() => {
            if (element instanceof HTMLAnchorElement) {
              const href = element.getAttribute('href')?.trim() ?? '';
              if (/^javascript:\s*void\s*\(\s*0\s*\)\s*;?$/i.test(href)) return true;
              try {
                const destination = new URL(element.href, document.baseURI);
                return destination.origin === window.location.origin &&
                  destination.pathname === window.location.pathname &&
                  destination.search === window.location.search &&
                  /^#(?:top|page-top|top-of-page)?$/i.test(destination.hash);
              } catch {
                return false;
              }
            }
            return element instanceof HTMLButtonElement &&
              element.type === 'button' &&
              !element.form;
          })()
        };
      });

      result = {
        ...result,
        visibleAfterScroll: state.visible,
        actionTested: state.safeToActivate,
        boundingBox: state.boundingBox,
        returnedToTop: false
      };
      if (!state.visible) return result;
      if (!state.safeToActivate) {
        return { ...result, error: 'Activation was not attempted because the control is not a safe same-page top action.' };
      }

      await locator.click({ timeout: 2_000 });
      await page.waitForFunction(() => window.scrollY <= 4, undefined, { timeout: 2_000 });
      result.returnedToTop = true;
      return result;
    } catch (error) {
      return {
        ...result,
        actionTested: true,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), initialScrollY).catch(() => undefined);
    }
  }

  private async inspectHoverState(page: Page, selector: string): Promise<HoverState> {
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
    const readState = () => page.evaluate((cssSelector) => {
      const element = document.querySelector<HTMLElement>(cssSelector);
      if (!element) {
        return {
          text: '',
          visible: false,
          display: 'missing',
          visibility: 'missing',
          opacity: 0,
          color: '',
          backgroundColor: '',
          contrastRatio: null,
          contrastThreshold: null,
          fontSize: 0,
          fontWeight: 0,
          rect: { width: 0, height: 0 },
          textRect: null,
          reason: 'The hovered button could not be found in the DOM.'
        };
      }

      const parseRgb = (value: string): [number, number, number, number] | null => {
        const match = value.match(/rgba?\(([^)]+)\)/i);
        if (!match) return null;
        const parts = match[1].split(',').map((part) => Number(part.trim()));
        if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
        return [parts[0], parts[1], parts[2], parts[3] ?? 1];
      };
      const luminance = ([r, g, b]: [number, number, number, number]): number => {
        const channel = [r, g, b].map((value) => {
          const normalized = value / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2];
      };
      const contrast = (fg: string, bg: string): number | null => {
        const foreground = parseRgb(fg);
        const background = parseRgb(bg);
        if (!foreground || !background || foreground[3] < 0.99 || background[3] < 0.99) return null;
        const first = luminance(foreground);
        const second = luminance(background);
        return Number(((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)).toFixed(2));
      };
      const effectiveBackground = (start: HTMLElement): string | null => {
        let current: HTMLElement | null = start;
        while (current && current !== document.documentElement) {
          const currentStyle = getComputedStyle(current);
          if (currentStyle.backgroundImage !== 'none') return null;
          if (Number(currentStyle.opacity) < 0.99) return null;
          const color = currentStyle.backgroundColor;
          const parsed = parseRgb(color);
          if (parsed && parsed[3] > 0.05) return color;
          current = current.parentElement;
        }
        return 'rgb(255, 255, 255)';
      };
      const textNodeRange = (root: HTMLElement): { rect: DOMRect; element: HTMLElement } | null => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if ((node.textContent ?? '').trim().length > 0) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            range.detach();
            const parent = node.parentElement;
            if (parent) {
              const style = getComputedStyle(parent);
              if (
                rect.width > 1 &&
                rect.height > 1 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity) > 0.01
              ) {
                return { rect, element: parent };
              }
            }
          }
          node = walker.nextNode();
        }
        return null;
      };

      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const textNode = textNodeRange(element);
      const textRect = textNode?.rect ?? null;
      const textStyle = textNode ? getComputedStyle(textNode.element) : style;
      const fontSize = Number.parseFloat(textStyle.fontSize) || Number.parseFloat(style.fontSize) || 16;
      const parsedFontWeight = Number.parseFloat(textStyle.fontWeight);
      const fontWeight = Number.isFinite(parsedFontWeight)
        ? parsedFontWeight
        : textStyle.fontWeight === 'bold'
          ? 700
          : 400;
      const contrastThreshold = fontSize >= 24 || (fontSize >= 18.67 && fontWeight >= 700) ? 3 : 4.5;
      const text = (element.innerText || element.textContent || element.getAttribute('aria-label') || '').trim();
      const backgroundColor = textNode ? effectiveBackground(textNode.element) : null;
      const contrastRatio = backgroundColor ? contrast(textStyle.color, backgroundColor) : null;
      const visible = rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0.01;
      let reason: string | undefined;
      if (!visible) {
        reason = `Hover state hides the control: display=${style.display}, visibility=${style.visibility}, opacity=${style.opacity}, size=${rect.width.toFixed(1)}x${rect.height.toFixed(1)}.`;
      } else if (!text) {
        reason = 'Hover state leaves the button with no visible or accessible text.';
      } else if (textRect && (textRect.width <= 1 || textRect.height <= 1)) {
        reason = `Hover state collapses the text box to ${textRect.width.toFixed(1)}x${textRect.height.toFixed(1)}.`;
      } else if (contrastRatio !== null && contrastRatio < contrastThreshold) {
        reason = `Hover-state text contrast is ${contrastRatio}:1; ${contrastThreshold}:1 is required for ${fontSize.toFixed(1)}px text against ${backgroundColor} (text color ${textStyle.color}).`;
      }
      return {
        text,
        visible,
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        color: textStyle.color,
        backgroundColor: backgroundColor ?? 'unmeasurable',
        contrastRatio,
        contrastThreshold: backgroundColor ? contrastThreshold : null,
        fontSize: Number(fontSize.toFixed(1)),
        fontWeight,
        rect: { width: Number(rect.width.toFixed(1)), height: Number(rect.height.toFixed(1)) },
        textRect: textRect ? { width: Number(textRect.width.toFixed(1)), height: Number(textRect.height.toFixed(1)) } : null,
        reason
      };
    }, selector);
    const baseline = await readState();
    await locator.hover({ timeout: 5_000 });
    await page.waitForTimeout(350).catch(() => undefined);
    const hovered = await readState();
    const contrastBecameLow =
      baseline.contrastRatio !== null &&
      baseline.contrastThreshold !== null &&
      baseline.contrastRatio >= baseline.contrastThreshold &&
      hovered.contrastRatio !== null &&
      hovered.contrastThreshold !== null &&
      hovered.contrastRatio < hovered.contrastThreshold;
    return {
      ...hovered,
      baselineContrastRatio: baseline.contrastRatio,
      baselineContrastThreshold: baseline.contrastThreshold,
      reason:
        hovered.reason?.startsWith('Hover-state text contrast') && !contrastBecameLow
          ? undefined
          : hovered.reason
    };
  }
}
