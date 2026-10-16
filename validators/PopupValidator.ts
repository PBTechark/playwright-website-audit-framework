import { Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditCheck, AuditIssue } from '../utils/types';

type PopupCandidate = {
  selector: string;
  text: string;
  role: string | null;
  areaRatio: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  closeControls: Array<{
    selector: string;
    text: string;
    ariaLabel: string;
    title: string;
    boundingBox: { x: number; y: number; width: number; height: number };
  }>;
};

type CloseAttempt = {
  attempted: boolean;
  dismissed: boolean;
  selector?: string;
  error?: string;
};

export class PopupValidator {
  async validate(page: Page, url: string, viewport: string): Promise<{ issues: AuditIssue[]; checks: AuditCheck[] }> {
    const issues: AuditIssue[] = [];
    const checks: AuditCheck[] = [];
    const popup = await this.findVisiblePopup(page);

    if (!popup) {
      checks.push(this.createCheck({
        url,
        viewport,
        checkName: 'Visible popup detection',
        result: 'NOT_APPLICABLE',
        severity: 'Low',
        expected: 'If a popup appears, it provides a visible close or dismiss action.',
        actual: 'No visible modal, popup, or blocking overlay was detected.',
        comment: 'No popup close validation was required on this page.'
      }));
      return { issues, checks };
    }

    checks.push(this.createCheck({
      url,
      viewport,
      checkName: 'Visible popup detection',
      result: 'PASS',
      severity: 'Medium',
      selector: popup.selector,
      boundingBox: popup.boundingBox,
      expected: 'Visible popups are detected for close validation.',
      actual: `Detected popup ${popup.selector} with ${popup.closeControls.length} close candidate(s).`,
      comment: 'A visible popup or modal overlay was found and will be validated.'
    }));

    if (popup.closeControls.length === 0) {
      issues.push(createIssue({
        category: 'Interactions',
        url,
        viewport,
        selector: popup.selector,
        description: 'Visible popup does not expose a close or dismiss control.',
        severity: 'High',
        expected: 'Promotional, newsletter, consent, or modal popups provide a visible close, dismiss, or no-thanks action.',
        actual: 'No visible close control was found inside the popup.',
        businessImpact: 'Users may be blocked from viewing or interacting with the page content.',
        suggestedFix: 'Add a visible and accessible close button, dismiss button, or no-thanks action to the popup.',
        details: popup
      }));
      checks.push(this.createCheck({
        url,
        viewport,
        checkName: 'Popup close control availability',
        result: 'FAIL',
        severity: 'High',
        selector: popup.selector,
        boundingBox: popup.boundingBox,
        expected: 'Popup has a visible close or dismiss control.',
        actual: 'No close or dismiss control found.',
        comment: 'Popup close validation failed before click because no close path was available.',
        recommendation: 'Provide a visible close button, dismiss link, or no-thanks button.'
      }));
      return { issues, checks };
    }

    checks.push(this.createCheck({
      url,
      viewport,
      checkName: 'Popup close control availability',
      result: 'PASS',
      severity: 'High',
      selector: popup.closeControls[0].selector,
      boundingBox: popup.closeControls[0].boundingBox,
      expected: 'Popup has a visible close or dismiss control.',
      actual: `Found close candidate ${popup.closeControls[0].selector}.`,
      comment: 'A close or dismiss control is available for the popup.'
    }));

    const attempt = await this.tryClosePopup(page, popup);
    checks.push(this.createCheck({
      url,
      viewport,
      checkName: 'Popup close action dismisses overlay',
      result: attempt.dismissed ? 'PASS' : 'FAIL',
      severity: 'High',
      selector: attempt.selector ?? popup.selector,
      expected: 'Clicking the popup close or dismiss control removes the popup from view.',
      actual: attempt.dismissed
        ? `Popup dismissed after clicking ${attempt.selector}.`
        : `Popup remained visible after close attempt${attempt.error ? `: ${attempt.error}` : '.'}`,
      comment: attempt.dismissed
        ? 'Popup close functionality worked.'
        : 'Popup close functionality is missing, blocked, or not wired correctly.',
      recommendation: attempt.dismissed
        ? undefined
        : 'Bind the close/dismiss control to hide the popup and restore interaction with the page.'
    }));

    if (!attempt.dismissed) {
      issues.push(createIssue({
        category: 'Interactions',
        url,
        viewport,
        selector: attempt.selector ?? popup.selector,
        description: 'Popup close control does not dismiss the popup.',
        severity: 'High',
        expected: 'Clicking the popup close, dismiss, or no-thanks control closes the popup.',
        actual: attempt.error ? `Close attempt failed: ${attempt.error}` : 'Popup remained visible after clicking the close control.',
        businessImpact: 'Users can become stuck behind a blocking popup and may abandon the page.',
        suggestedFix: 'Fix the close button handler, overlay state, z-index blocking layer, or popup script so the popup disappears after dismissal.',
        details: { popup, attempt }
      }));
    }

    return { issues, checks };
  }

  private async findVisiblePopup(page: Page): Promise<PopupCandidate | null> {
    const candidates = await page.evaluate(() => {
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const named = ['data-testid', 'data-test', 'aria-label'].find((attribute) => element.hasAttribute(attribute));
        if (named) return `[${named}="${CSS.escape(element.getAttribute(named) ?? '')}"]`;
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
        const style = getComputedStyle(element);
        const visibleArea =
          Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)) *
          Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        return rect.width >= 24 &&
          rect.height >= 24 &&
          visibleArea >= 120 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.01 &&
          style.pointerEvents !== 'none';
      };

      const boxFor = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return {
          x: Number(rect.x.toFixed(1)),
          y: Number(rect.y.toFixed(1)),
          width: Number(rect.width.toFixed(1)),
          height: Number(rect.height.toFixed(1))
        };
      };

      const textFor = (element: HTMLElement): string =>
        `${element.innerText || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.id} ${element.className}`
          .replace(/\s+/g, ' ')
          .trim();

      const closeText = /^(?:x|×|close|dismiss|no thanks|no,? thanks|not now|maybe later|skip|continue shopping|accept|agree|got it)$/i;
      const closeHint = /close|dismiss|no-thanks|no_thanks|modal-close|popup-close|newsletter-close|klaviyo-close|needsclick|closeButton|btn-close/i;

      const closeControlsFor = (container: HTMLElement) =>
        Array.from(container.querySelectorAll<HTMLElement>('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-label],[title],[data-dismiss],[data-bs-dismiss]'))
          .filter(isVisible)
          .filter((control) => {
            const text = (control.innerText || control.textContent || '').trim();
            const ariaLabel = control.getAttribute('aria-label') || '';
            const title = control.getAttribute('title') || '';
            const value = control instanceof HTMLInputElement ? control.value : '';
            const classText = `${control.id} ${control.className}`;
            return closeText.test(text) ||
              closeText.test(ariaLabel) ||
              closeText.test(title) ||
              closeText.test(value) ||
              closeHint.test(classText) ||
              closeHint.test(ariaLabel) ||
              closeHint.test(title) ||
              /modal|popup/i.test(control.getAttribute('data-dismiss') || '') ||
              /modal|popup/i.test(control.getAttribute('data-bs-dismiss') || '');
          })
          .map((control) => ({
            selector: selectorFor(control),
            text: (control.innerText || control.textContent || (control instanceof HTMLInputElement ? control.value : '') || '').trim(),
            ariaLabel: control.getAttribute('aria-label') || '',
            title: control.getAttribute('title') || '',
            boundingBox: boxFor(control)
          }))
          .slice(0, 8);

      const popupSelector = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        'dialog[open]',
        '[class*="modal" i]',
        '[id*="modal" i]',
        '[class*="popup" i]',
        '[id*="popup" i]',
        '[class*="newsletter" i]',
        '[id*="newsletter" i]',
        '[class*="klaviyo" i]',
        '[id*="klaviyo" i]',
        '[class*="privy" i]',
        '[id*="privy" i]',
        '[class*="omnisend" i]',
        '[id*="omnisend" i]'
      ].join(',');

      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const isBackdropOnly = (element: HTMLElement): boolean => {
        const text = (element.innerText || '').trim();
        const classText = `${element.id} ${element.className}`;
        return /(?:^|\s)(?:modal-backdrop|backdrop|overlay)(?:\s|$)/i.test(classText) &&
          !text &&
          closeControlsFor(element).length === 0;
      };

      return Array.from(document.querySelectorAll<HTMLElement>(popupSelector))
        .filter(isVisible)
        .filter((element) => !isBackdropOnly(element))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const fixedLike = ['fixed', 'sticky'].includes(style.position) || element.getAttribute('role') === 'dialog' || element.getAttribute('aria-modal') === 'true';
          const areaRatio = Number(((rect.width * rect.height) / viewportArea).toFixed(3));
          const text = textFor(element);
          const popupLike = fixedLike ||
            areaRatio >= 0.08 ||
            /newsletter|subscribe|save|discount|offer|popup|modal|dialog|no thanks|email address/i.test(text);
          if (!popupLike) return null;
          return {
            selector: selectorFor(element),
            text: text.slice(0, 500),
            role: element.getAttribute('role'),
            areaRatio,
            boundingBox: boxFor(element),
            closeControls: closeControlsFor(element)
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((left, right) =>
          right.closeControls.length - left.closeControls.length ||
          Number(right.role === 'dialog') - Number(left.role === 'dialog') ||
          right.areaRatio - left.areaRatio
        )
        .slice(0, 3);
    });

    return candidates[0] ?? null;
  }

  private async tryClosePopup(page: Page, popup: PopupCandidate): Promise<CloseAttempt> {
    for (const control of popup.closeControls) {
      try {
        await page.locator(control.selector).first().click({ timeout: 3_000 });
        await page.waitForTimeout(500);
        const dismissed = await page.locator(popup.selector).first().isHidden({ timeout: 2_000 }).catch(() => false);
        if (dismissed) return { attempted: true, dismissed: true, selector: control.selector };
      } catch (error) {
        return {
          attempted: true,
          dismissed: false,
          selector: control.selector,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
    return { attempted: false, dismissed: false };
  }

  private createCheck(input: Omit<AuditCheck, 'id' | 'component' | 'timestamp'>): AuditCheck {
    return {
      id: `CHK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      component: 'Popup',
      timestamp: new Date().toISOString(),
      ...input
    };
  }
}
