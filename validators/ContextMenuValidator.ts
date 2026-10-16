import { Dialog, Page } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { recordAssertion } from '../utils/assertionFactory';
import { EvidenceManager } from '../utils/evidence';
import { AuditCheck, AuditIssue, ScreenshotEvidence, Severity } from '../utils/types';

type DialogResult = { type: string; message: string; accepted: boolean; acceptanceError?: string };

/** Validates a context-menu hotspot without submitting data or leaving the audited page. */
export class ContextMenuValidator {
  async validate(
    page: Page,
    url: string,
    viewport: string,
    targetName?: string
  ): Promise<{ checks: AuditCheck[]; issues: AuditIssue[]; screenshots: ScreenshotEvidence[] }> {
    const selector = '#hot-spot, [data-context-menu], [oncontextmenu], [class*="context-menu"]';
    const hotspot = page.locator(selector).first();
    const count = await hotspot.count();
    const shouldAudit = count > 0 || /context[-_]?menu/i.test(new URL(url).pathname);
    if (!shouldAudit) return { checks: [], issues: [], screenshots: [] };

    const checks: AuditCheck[] = [];
    const issues: AuditIssue[] = [];
    const screenshots: ScreenshotEvidence[] = [];
    const visible = count > 0 && await hotspot.isVisible().catch(() => false);
    const box = count > 0 ? await hotspot.boundingBox().catch(() => null) : null;
    const evidenceManager = new EvidenceManager(page, url, viewport, targetName);
    if (visible) {
      const shot = await evidenceManager.captureLocator('context-menu-hot-spot', hotspot).catch(() => null);
      if (shot) screenshots.push(shot);
    }
    const evidence = screenshots.map((item) => item.path);

    const add = (input: {
      checkName: string; passed: boolean; severity: Severity; expected: string; actual: string;
      passComment: string; failComment: string; recommendation: string;
    }) => {
      const recorded = recordAssertion({
        component: 'Context Menu',
        ...input,
        url,
        viewport,
        selector: count > 0 ? selector : undefined,
        boundingBox: box,
        evidence
      });
      checks.push(recorded.check);
      if (recorded.issue) issues.push(recorded.issue);
    };

    add({
      checkName: 'Hot Spot presence', passed: count > 0, severity: 'High',
      expected: 'A context-menu Hot Spot element exists', actual: count > 0 ? `${count} candidate(s) found` : 'No candidate found',
      passComment: 'The context-menu Hot Spot is present.', failComment: 'The context-menu Hot Spot is missing.',
      recommendation: 'Render a stable context-menu target such as #hot-spot.'
    });
    add({
      checkName: 'Hot Spot visibility', passed: visible, severity: 'High',
      expected: 'The Hot Spot is visible with non-zero dimensions', actual: `visible=${visible}, boundingBox=${JSON.stringify(box)}`,
      passComment: 'The Hot Spot is visible and available to users.', failComment: 'The Hot Spot exists but is not visibly rendered.',
      recommendation: 'Correct the Hot Spot dimensions, display, visibility, or responsive styling.'
    });

    let rightClickPerformed = false;
    let rightClickError = '';
    let dialogResult: DialogResult | null = null;
    if (visible) {
      const dialogWait = this.captureAndAcceptDialog(page, 5_000);
      try {
        await hotspot.click({ button: 'right', timeout: 5_000 });
        rightClickPerformed = true;
      } catch (error) {
        rightClickError = error instanceof Error ? error.message : String(error);
        dialogWait.cancel();
      }
      dialogResult = rightClickPerformed ? await dialogWait.promise : null;
    }

    add({
      checkName: 'Right-click interaction', passed: rightClickPerformed, severity: 'High',
      expected: 'A right-click can be dispatched to the visible Hot Spot',
      actual: rightClickPerformed ? 'Right-click completed' : `Right-click failed${rightClickError ? `: ${rightClickError}` : ''}`,
      passComment: 'The framework successfully performed a right-click on the Hot Spot.',
      failComment: 'The right-click action could not be performed on the Hot Spot.',
      recommendation: 'Remove overlays, enable pointer events, and bind the contextmenu handler to the target.'
    });

    const alertAppeared = dialogResult?.type === 'alert';
    add({
      checkName: 'Context-menu alert appearance', passed: alertAppeared, severity: 'High',
      expected: 'A JavaScript alert appears after right-click',
      actual: dialogResult ? `Dialog type=${dialogResult.type}, message=${dialogResult.message}` : 'No dialog appeared within 5000 ms',
      passComment: 'Right-click triggered the expected JavaScript alert.',
      failComment: dialogResult ? `Right-click triggered a ${dialogResult.type}, not an alert.` : 'No alert appeared after right-click.',
      recommendation: 'Verify the contextmenu listener invokes the alert and is not prevented by another handler.'
    });

    const expectedText = auditConfig.contextMenuExpectedAlertText;
    const textMatches = Boolean(dialogResult) && (expectedText
      ? dialogResult!.message.trim() === expectedText
      : dialogResult!.message.trim().length > 0);
    add({
      checkName: 'Context-menu alert text', passed: textMatches, severity: 'High',
      expected: expectedText ? `Alert text exactly equals "${expectedText}"` : 'Alert text is non-empty',
      actual: dialogResult ? `"${dialogResult.message}"` : 'No alert text available',
      passComment: 'The context-menu alert text matches the expected value.',
      failComment: 'The context-menu alert text does not match the expected value.',
      recommendation: 'Update the context-menu alert message or CONTEXT_MENU_EXPECTED_ALERT_TEXT contract.'
    });

    add({
      checkName: 'Context-menu alert acceptance', passed: dialogResult?.accepted === true, severity: 'High',
      expected: 'The alert can be accepted without error',
      actual: dialogResult ? `accepted=${dialogResult.accepted}${dialogResult.acceptanceError ? `, error=${dialogResult.acceptanceError}` : ''}` : 'No alert available to accept',
      passComment: 'The alert was accepted successfully.', failComment: 'The alert could not be accepted.',
      recommendation: 'Ensure the dialog is a standard browser alert and does not leave the page blocked.'
    });

    return { checks, issues, screenshots };
  }

  private captureAndAcceptDialog(page: Page, timeoutMs: number): { promise: Promise<DialogResult | null>; cancel: () => void } {
    let timer: NodeJS.Timeout;
    let settled = false;
    let resolvePromise: (value: DialogResult | null) => void = () => undefined;
    const handler = async (dialog: Dialog): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      page.off('dialog', handler);
      let accepted = false;
      let acceptanceError: string | undefined;
      try {
        await dialog.accept();
        accepted = true;
      } catch (error) {
        acceptanceError = error instanceof Error ? error.message : String(error);
      }
      resolvePromise({ type: dialog.type(), message: dialog.message(), accepted, acceptanceError });
    };
    const promise = new Promise<DialogResult | null>((resolve) => {
      resolvePromise = resolve;
      page.on('dialog', handler);
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        page.off('dialog', handler);
        resolve(null);
      }, timeoutMs);
    });
    return {
      promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        page.off('dialog', handler);
        resolvePromise(null);
      }
    };
  }
}
