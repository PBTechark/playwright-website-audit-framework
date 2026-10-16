import { Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

export class FormValidator {
  async validate(page: Page, url: string, viewport: string): Promise<AuditIssue[]> {
    const forms = await page.evaluate(() =>
      Array.from(document.forms).map((form, formIndex) => ({
        selector: form.id ? `#${CSS.escape(form.id)}` : `form:nth-of-type(${formIndex + 1})`,
        visible: Boolean(form.offsetWidth || form.offsetHeight || form.getClientRects().length),
        controls: Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input,select,textarea'
        )).map((control, index) => {
          const id = control.id;
          const label =
            (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim()) ||
            control.closest('label')?.textContent?.trim() ||
            control.getAttribute('aria-label') ||
            control.getAttribute('placeholder') ||
            '';
          return {
            selector: control.id ? `#${CSS.escape(control.id)}` : `${control.tagName.toLowerCase()}:nth-of-type(${index + 1})`,
            type: control.getAttribute('type') || control.tagName.toLowerCase(),
            visible: Boolean(control.offsetWidth || control.offsetHeight || control.getClientRects().length),
            required: control.required || control.getAttribute('aria-required') === 'true',
            label
          };
        })
      }))
    );

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
