import { Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class FormValidator {
  async validate(page: Page, url: string, viewport: string): Promise<AuditIssue[]> {
    const forms = await page.evaluate(() => {
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
      return Array.from(document.forms).map((form) => ({
        selector: selectorFor(form),
        visible: Boolean(form.offsetWidth || form.offsetHeight || form.getClientRects().length),
        controls: Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input,select,textarea'
        )).map((control) => {
          const id = control.id;
          const label =
            (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim()) ||
            control.closest('label')?.textContent?.trim() ||
            control.getAttribute('aria-label') ||
            control.getAttribute('placeholder') ||
            '';
          return {
            selector: selectorFor(control),
            type: control.getAttribute('type') || control.tagName.toLowerCase(),
            visible: Boolean(control.offsetWidth || control.offsetHeight || control.getClientRects().length),
            required: control.required || control.getAttribute('aria-required') === 'true',
            label
          };
        })
      }));
    });

    const issues: AuditIssue[] = [];
    for (const form of forms) {
      if (!form.visible) {
        issues.push(
          createIssue({
            category: 'Forms',
            url,
            viewport,
            selector: form.selector,
            description: 'Detected form is not visible.',
            severity: 'Medium',
            suggestedFix: 'Ensure forms intended for users are visible and not hidden by layout or responsive rules.'
          })
        );
      }
      for (const control of form.controls) {
        if (!control.visible) {
          issues.push(
            createIssue({
              category: 'Forms',
              url,
              viewport,
              selector: control.selector,
              description: 'Form control is not visible.',
              severity: 'Medium',
              suggestedFix: 'Make the form control visible or remove it from the user-facing form.',
              details: control
            })
          );
        }
        if (!control.label) {
          issues.push(
            createIssue({
              category: 'Forms',
              url,
              viewport,
              selector: control.selector,
              description: 'Form control has no visible or accessible label.',
              severity: 'Medium',
              suggestedFix: 'Associate each form control with a label, aria-label, or clear visible text.',
              details: control
            })
          );
        }
      }
    }
    return issues;
  }
}
