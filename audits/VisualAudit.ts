import { Page } from '@playwright/test';
import { EvidenceManager } from '../utils/evidence';
import { createIssue } from '../utils/issueFactory';
import { detectDomDefects, detectReloadShiftDefects, detectShiftDefects } from '../utils/domDetectors';
import { AuditIssue, ScreenshotEvidence, Severity } from '../utils/types';

export class VisualAudit {
  async run(
    page: Page,
    url: string,
    viewport: string,
    targetName?: string
  ): Promise<{ issues: AuditIssue[]; screenshots: ScreenshotEvidence[] }> {
    const evidence = new EvidenceManager(page, url, viewport, targetName);
    const screenshots: ScreenshotEvidence[] = [];
    const originalScrollY = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const topVisualDefects = await detectDomDefects(page);
    const shiftDefects = await detectShiftDefects(page);
    const reloadShiftDefects = await detectReloadShiftDefects(page);

    // Fixed controls only collide with the footer when the user reaches the page bottom.
    // Evaluate static DOM defects in that real user state, then restore the original scroll position.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const bottomVisualDefects = await detectDomDefects(page);
    if (shiftDefects.length > 0 || reloadShiftDefects.length > 0) {
      screenshots.push(await evidence.captureFullPage('layout-shift-after'));
    }
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), originalScrollY);
    screenshots.unshift(await evidence.captureAboveFold());
    screenshots.unshift(await evidence.captureFullPage());
    const headerShot = await evidence.captureLocator('header', page.locator('header, [role="banner"], nav').first());
    const footerShot = await evidence.captureLocator('footer', page.locator('footer, [role="contentinfo"]').first());
    if (headerShot) screenshots.push(headerShot);
    if (footerShot) screenshots.push(footerShot);
    const defectsByKey = new Map(
      [...topVisualDefects, ...bottomVisualDefects, ...shiftDefects, ...reloadShiftDefects].map((defect) => [
        `${defect.type}|${defect.selector}|${defect.description}`,
        defect
      ])
    );
    const defects = Array.from(defectsByKey.values());
    const issues: AuditIssue[] = [];
    const pageEvidence = screenshots.map((item) => item.path);
    for (const [index, defect] of defects.entries()) {
      const issueEvidence = [...pageEvidence];
      // Element-level evidence makes the finding actionable without forcing readers to inspect a full page.
      const evidenceSelectors = defect.selector
        .split(' / ')
        .map((selector) => selector.trim())
        .filter((selector) => selector && selector !== 'layout-row');
      if (evidenceSelectors.length > 0) {
        const defectLabel = `defect-${index}-${defect.type}`;
        for (const [selectorIndex, evidenceSelector] of evidenceSelectors.entries()) {
          const selectorLabel = evidenceSelectors.length > 1 ? `${defectLabel}-${selectorIndex + 1}` : defectLabel;
          const elementShot = await evidence.captureElementRegionWithHighlight(selectorLabel, evidenceSelector).catch(() => null) ??
            await evidence.captureLocator(
              selectorLabel,
              page.locator(evidenceSelector).first()
            ).catch(() => null) ??
            await evidence.captureElementRegion(selectorLabel, evidenceSelector).catch(() => null) ??
            await page.locator(evidenceSelector).first().scrollIntoViewIfNeeded({ timeout: 5_000 })
              .then(() => evidence.captureAboveFold(selectorLabel))
              .catch(() => null) ??
            await evidence.captureFullPage(selectorLabel).catch(() => null);
          if (elementShot) {
            screenshots.push(elementShot);
            issueEvidence.push(elementShot.path);
          }
        }
      }
      issues.push(createIssue({
        category: 'Visual',
        targetName,
        url,
        viewport,
        selector: defect.selector,
        description: `${defect.type}: ${defect.description}`,
        severity: defect.severity ?? this.severityFor(defect.type),
        evidence: issueEvidence,
        expected: this.expectedFor(defect.type),
        actual: `${defect.description} Measured details: ${JSON.stringify(defect.details)}.`,
        businessImpact: this.businessImpactFor(defect.type),
        timestamp: new Date().toISOString(),
        suggestedFix: this.suggestFix(defect.type),
        details: defect.details
      }));
    }

    return { issues, screenshots };
  }

  private suggestFix(type: string): string {
    if (type.includes('Shift')) return 'Reserve stable dimensions for late content, preload critical fonts, and avoid moving important navigation, CTA, or form regions after render.';
    if (type.includes('Overlap')) return 'Review stacking context, spacing, z-index, and responsive breakpoints.';
    if (type.includes('Off-screen') || type.includes('Horizontal')) return 'Constrain element width and remove viewport overflow.';
    if (type.includes('Clipped')) return 'Allow text wrapping, increase container size, or reduce rigid height constraints.';
    if (type.includes('Image')) return 'Set consistent image dimensions and preserve aspect ratio with object-fit.';
    if (type.includes('Empty')) return 'Remove empty containers or ensure async content renders before the section is displayed.';
    if (type === 'Grid/Card Alignment') return 'Use a shared grid template and consistent column tracks, widths, and container padding at this breakpoint.';
    if (type === 'Repeated Row Height Mismatch') return 'Apply consistent card sizing or stretch row items, and reserve equal space for repeated content regions.';
    if (type === 'Spacing Inconsistency') return 'Replace one-off margins with a shared gap or spacing token on the repeated-item container.';
    if (type === 'Form Label/Input Alignment') return 'Align each label/input pair with a consistent form grid, label width, gap, and cross-axis alignment.';
    if (type === 'Icon/Text Alignment') return 'Align the icon and adjacent text on a shared row baseline or center line using flex/grid alignment.';
    return 'Review layout rules, spacing tokens, and responsive behavior for this element.';
  }

  private expectedFor(type: string): string {
    if (type.includes('Shift')) return 'Element position remains stable after page load and across equivalent reloads.';
    if (type === 'Grid/Card Alignment') return 'Repeated card rows align to the same column edges within 10 CSS pixels.';
    if (type === 'Repeated Row Height Mismatch') return 'Repeated items in a visual row use consistent heights within the measured tolerance.';
    if (type === 'Spacing Inconsistency') return 'Repeated layout gaps use a consistent spacing value within the measured tolerance.';
    if (type === 'Form Label/Input Alignment') return 'Horizontal label/input pairs share a visual center; stacked pairs share a left edge.';
    if (type === 'Icon/Text Alignment') return 'Icons and their adjacent text align cleanly in the same visible row.';
    if (type.includes('Overlap') || type.includes('Obstruction')) return 'Visible controls and content do not obscure or collide with one another.';
    if (type.includes('Off-screen') || type.includes('Horizontal')) return 'All visible content remains within the layout viewport without unintended horizontal scrolling.';
    if (type.includes('Clipped')) return 'Text remains fully visible and readable inside its container.';
    if (type.includes('Image')) return 'Images preserve their intended aspect ratio and remain visually stable.';
    if (type.includes('Empty')) return 'Visible structural containers contain meaningful rendered content.';
    return 'The component follows a consistent, usable layout at the audited viewport.';
  }

  private businessImpactFor(type: string): string {
    if (type.includes('Shift')) return 'Unexpected movement harms readability, interaction accuracy, and user confidence.';
    if (type.includes('Form')) return 'Misaligned form controls reduce scanability and can make data entry harder.';
    if (type === 'Icon/Text Alignment') return 'Misaligned icon/text rows look broken and reduce scanability of contact or feature information.';
    if (type.includes('Grid') || type.includes('Row') || type.includes('Spacing')) return 'Inconsistent repeated layouts look broken and make related content harder to compare.';
    if (type.includes('Overlap') || type.includes('Obstruction') || type.includes('Off-screen')) return 'Users may be unable to read content or activate an obscured control.';
    return 'The defect reduces visual quality, readability, or confidence in the page.';
  }

  private severityFor(type: string): Severity | undefined {
    if (['Grid/Card Alignment', 'Repeated Row Height Mismatch', 'Spacing Inconsistency', 'Form Label/Input Alignment', 'Icon/Text Alignment'].includes(type)) {
      return 'Medium';
    }
    return undefined;
  }
}
