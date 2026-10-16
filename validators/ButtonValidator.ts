import { Page } from '@playwright/test';
import { EvidenceManager } from '../utils/evidence';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue, ScreenshotEvidence } from '../utils/types';

type ButtonSnapshot = {
  selector: string;
  text: string;
  visible: boolean;
  disabled: boolean;
  width: number;
  height: number;
  tagName: string;
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
  rect: { width: number; height: number };
  textRect: { width: number; height: number } | null;
  reason?: string;
};

export class ButtonValidator {
  async validate(page: Page, url: string, viewport: string, targetName = 'default'): Promise<AuditIssue[]> {
    const buttons = await page.evaluate(() => {
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const testIdAttribute = element.hasAttribute('data-testid') ? 'data-testid' : 'data-test';
        const testId = element.getAttribute(testIdAttribute);
        if (testId) return `[${testIdAttribute}="${CSS.escape(testId)}"]`;
        const parts: string[] = [];
        let node: Element | null = element;
        while (node && node !== document.body && parts.length < 6) {
          const siblings = node.parentElement
            ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName)
            : [];
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`);
          node = node.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      };
      const isVisible = (element: HTMLElement): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const visibleArea =
          Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)) *
          Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        return rect.width > 0 &&
          rect.height > 0 &&
          visibleArea > 40 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.01;
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
        .filter((button) => looksLikeCta(button))
        .slice(0, 250)
        .map((button): ButtonSnapshot => {
          const rect = button.getBoundingClientRect();
          const disabled =
            button.hasAttribute('disabled') ||
            button.getAttribute('aria-disabled') === 'true' ||
            (button instanceof HTMLInputElement && button.disabled);
          return {
            selector: selectorFor(button),
            text:
              button.innerText?.trim() ||
              button.textContent?.trim() ||
              button.getAttribute('aria-label') ||
              (button instanceof HTMLInputElement ? button.value : '') ||
              '',
            visible: isVisible(button),
            disabled,
            width: rect.width,
            height: rect.height,
            tagName: button.tagName.toLowerCase(),
            href: button instanceof HTMLAnchorElement ? button.href : undefined
          };
        });
    });
    const issues: AuditIssue[] = [];
    const evidenceManager = new EvidenceManager(page, url, viewport, targetName);
    for (const [index, button] of buttons.entries()) {
      if (!button.visible) {
        issues.push(
          createIssue({
            category: 'Buttons',
            url,
            viewport,
            selector: button.selector,
            description: 'Button is present but not visible.',
            severity: 'Medium',
            suggestedFix: 'Remove hidden interactive controls or make the button visible when users need it.',
            details: button
          })
        );
      }
      if (!button.text) {
        issues.push(
          createIssue({
            category: 'Buttons',
            url,
            viewport,
            selector: button.selector,
            description: 'Button has no visible or accessible label.',
            severity: 'Medium',
            suggestedFix: 'Add button text, aria-label, or a labelled icon name.',
            details: button
          })
        );
      }
      if (button.visible && !button.disabled && button.text) {
        const hover = await this.inspectHoverState(page, button.selector).catch(() => null);
        if (hover?.reason) {
          const shot = await evidenceManager
            .captureLocator(`button-hover-text-${index}`, page.locator(button.selector).first())
            .catch(() => null);
          issues.push(
            createIssue({
              category: 'Buttons',
              url,
              viewport,
              selector: button.selector,
              description: `Button text disappears or becomes unreadable on hover: ${button.text}.`,
              severity: 'High',
              expected: 'Human-visible button text remains visible and readable after hover.',
              actual: hover.reason,
              suggestedFix: 'Adjust hover text color, background color, opacity, visibility, or transition styles so the label remains readable.',
              evidence: this.paths(shot),
              details: { button, hover }
            })
          );
        }
      }
      if (!button.disabled && (button.width < 32 || button.height < 32)) {
        issues.push(
          createIssue({
            category: 'Buttons',
            url,
            viewport,
            selector: button.selector,
            description: 'Clickable button target is smaller than recommended touch size.',
            severity: 'Low',
            suggestedFix: 'Increase the clickable target to at least 32 by 32 CSS pixels, preferably 44 by 44 on touch UI.',
            details: button
          })
        );
      }
    }
    return issues;
  }

  private async inspectHoverState(page: Page, selector: string): Promise<HoverState> {
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
    await locator.hover({ timeout: 5_000 });
    await page.waitForTimeout(350).catch(() => undefined);
    return page.evaluate((cssSelector) => {
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
        if (!foreground || !background || foreground[3] < 0.05 || background[3] < 0.05) return null;
        const first = luminance(foreground);
        const second = luminance(background);
        return Number(((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)).toFixed(2));
      };
      const effectiveBackground = (start: HTMLElement): string => {
        let current: HTMLElement | null = start;
        while (current && current !== document.documentElement) {
          const color = getComputedStyle(current).backgroundColor;
          const parsed = parseRgb(color);
          if (parsed && parsed[3] > 0.05) return color;
          current = current.parentElement;
        }
        return 'rgb(255, 255, 255)';
      };
      const textNodeRange = (root: HTMLElement): DOMRect | null => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if ((node.textContent ?? '').trim().length > 0) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            range.detach();
            return rect;
          }
          node = walker.nextNode();
        }
        return null;
      };

      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const textRect = textNodeRange(element);
      const text = (element.innerText || element.textContent || element.getAttribute('aria-label') || '').trim();
      const backgroundColor = effectiveBackground(element);
      const contrastRatio = contrast(style.color, backgroundColor);
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
      } else if (contrastRatio !== null && contrastRatio < 3) {
        reason = `Hover state text contrast is ${contrastRatio}:1 against ${backgroundColor}; text color is ${style.color}.`;
      }
      return {
        text,
        visible,
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        color: style.color,
        backgroundColor,
        contrastRatio,
        rect: { width: Number(rect.width.toFixed(1)), height: Number(rect.height.toFixed(1)) },
        textRect: textRect ? { width: Number(textRect.width.toFixed(1)), height: Number(textRect.height.toFixed(1)) } : null,
        reason
      };
    }, selector);
  }

  private paths(shot: ScreenshotEvidence | null): string[] {
    return shot ? [shot.path] : [];
  }
}
