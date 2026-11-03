import path from 'path';
import fs from 'fs';
import { Locator, Page } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { ensureDir, safeFileName, toRelativePath } from './fileSystem';
import { ScreenshotEvidence } from './types';

export class EvidenceManager {
  constructor(
    private readonly page: Page,
    private readonly url: string,
    private readonly viewport: string,
    private readonly targetName = 'default'
  ) {}

  async captureFullPage(label = 'full-page'): Promise<ScreenshotEvidence> {
    return this.capturePage(label, true);
  }

  async captureAboveFold(label = 'above-fold'): Promise<ScreenshotEvidence> {
    return this.capturePage(label, false);
  }

  async captureLocator(label: string, locator: Locator): Promise<ScreenshotEvidence | null> {
    if (auditConfig.screenshotMode === 'off') {
      return null;
    }
    if ((await locator.count()) === 0) {
      return null;
    }
    const target = locator.first();
    if (!(await target.isVisible().catch(() => false))) {
      return null;
    }
    const filePath = this.makePath(label);
    await target.screenshot({ path: filePath, timeout: 10_000 }).catch(() => undefined);
    if (!this.hasUsableScreenshot(filePath)) {
      await target.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
      const box = await target.boundingBox().catch(() => null);
      if (box && box.width > 1 && box.height > 1) {
        const viewport = this.page.viewportSize();
        const clip = {
          x: Math.max(0, Math.floor(box.x)),
          y: Math.max(0, Math.floor(box.y)),
          width: Math.max(1, Math.ceil(Math.min(box.width, (viewport?.width ?? box.x + box.width) - Math.max(0, box.x)))),
          height: Math.max(1, Math.ceil(Math.min(box.height, (viewport?.height ?? box.y + box.height) - Math.max(0, box.y))))
        };
        await this.page.screenshot({ path: filePath, clip, timeout: 10_000 }).catch(() => undefined);
      }
    }
    if (!this.hasUsableScreenshot(filePath)) {
      return null;
    }
    return { label, path: toRelativePath(filePath) };
  }

  async captureElementRegion(label: string, selector: string): Promise<ScreenshotEvidence | null> {
    if (auditConfig.screenshotMode === 'off') {
      return null;
    }
    const filePath = this.makePath(label);
    const clip = await this.page.evaluate((cssSelector) => {
      const matches = document.querySelectorAll<HTMLElement>(cssSelector);
      if (matches.length !== 1) return null;
      const element = matches[0];
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const x = Math.max(0, Math.floor(rect.left));
      const y = Math.max(0, Math.floor(rect.top));
      const width = Math.max(1, Math.ceil(Math.min(rect.right, viewportWidth) - x));
      const height = Math.max(1, Math.ceil(Math.min(rect.bottom, viewportHeight) - y));
      if (width <= 1 || height <= 1) return null;
      return { x, y, width, height };
    }, selector).catch(() => null);
    if (!clip) {
      return null;
    }
    await this.page.screenshot({ path: filePath, clip, timeout: 10_000 }).catch(() => undefined);
    if (!this.hasUsableScreenshot(filePath)) {
      return null;
    }
    return { label, path: toRelativePath(filePath) };
  }

  async captureElementRegionWithHighlight(label: string, selector: string): Promise<ScreenshotEvidence | null> {
    if (auditConfig.screenshotMode === 'off') {
      return null;
    }
    const filePath = this.makePath(label);
    const sourcePath = this.makePath(`${label}-original`);
    const clip = await this.page.evaluate((cssSelector) => {
      const matches = document.querySelectorAll<HTMLElement>(cssSelector);
      if (matches.length !== 1) return null;
      const element = matches[0];
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const x = Math.max(0, Math.floor(rect.left - 12));
      const y = Math.max(0, Math.floor(rect.top - 12));
      const width = Math.max(1, Math.ceil(Math.min(rect.right + 12, viewportWidth) - x));
      const height = Math.max(1, Math.ceil(Math.min(rect.bottom + 12, viewportHeight) - y));
      if (width <= 1 || height <= 1) return null;
      const highlight = document.createElement('div');
      highlight.id = 'audit-highlight-overlay';
      highlight.style.position = 'fixed';
      highlight.style.pointerEvents = 'none';
      highlight.style.left = `${Math.max(0, rect.left - 8)}px`;
      highlight.style.top = `${Math.max(0, rect.top - 8)}px`;
      highlight.style.width = `${Math.max(1, rect.width + 16)}px`;
      highlight.style.height = `${Math.max(1, rect.height + 16)}px`;
      highlight.style.border = '4px solid rgba(255, 72, 66, 0.95)';
      highlight.style.boxShadow = '0 0 0 9999px rgba(255,72,66,0.08), 0 0 0 2px rgba(255,255,255,0.7) inset';
      highlight.style.borderRadius = '16px';
      highlight.style.zIndex = '2147483647';
      highlight.style.transition = 'none';
      document.documentElement.appendChild(highlight);
      return { x, y, width, height };
    }, selector).catch(() => null);
    if (!clip) {
      return null;
    }

    await this.page.screenshot({ path: sourcePath, clip, timeout: 10_000 }).catch(() => undefined);

    try {
      await this.page.screenshot({ path: filePath, clip, timeout: 10_000 }).catch(() => undefined);
    } finally {
      await this.page.evaluate(() => {
        const overlay = document.getElementById('audit-highlight-overlay');
        if (overlay) overlay.remove();
      }).catch(() => undefined);
    }

    if (!this.hasUsableScreenshot(filePath)) {
      return null;
    }
    return {
      label,
      path: toRelativePath(filePath),
      sourcePath: this.hasUsableScreenshot(sourcePath) ? toRelativePath(sourcePath) : undefined,
      annotated: true,
      width: clip.width,
      height: clip.height
    };
  }

  async captureElementDiagnostic(
    label: string,
    selector: string,
    description: string
  ): Promise<ScreenshotEvidence | null> {
    if (auditConfig.screenshotMode === 'off') {
      return null;
    }
    const filePath = this.makePath(label);
    const prepared = await this.page.evaluate(
      ({ cssSelector, targetDescription }) => {
        const matches = document.querySelectorAll<HTMLElement>(cssSelector);
        if (matches.length !== 1) return null;
        const target = matches[0];

        const targetStyle = window.getComputedStyle(target);
        const targetRect = target.getBoundingClientRect();
        const targetHasBox = targetRect.width > 1 && targetRect.height > 1;
        let hasHighlightBox = targetHasBox;
        let highlightTarget = target;
        if (!targetHasBox) {
          let ancestor = target.parentElement;
          while (ancestor && ancestor !== document.body) {
            const rect = ancestor.getBoundingClientRect();
            const style = window.getComputedStyle(ancestor);
            if (
              rect.width > 1 &&
              rect.height > 1 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) > 0.01
            ) {
              highlightTarget = ancestor;
              hasHighlightBox = true;
              break;
            }
            ancestor = ancestor.parentElement;
          }
        }

        if (targetHasBox) target.scrollIntoView({ block: 'center', inline: 'center' });
        else highlightTarget.scrollIntoView({ block: 'center', inline: 'center' });

        const rect = highlightTarget.getBoundingClientRect();
        const marker = document.createElement('div');
        marker.id = 'audit-element-diagnostic';
        marker.style.position = 'fixed';
        marker.style.inset = '0';
        marker.style.pointerEvents = 'none';
        marker.style.zIndex = '2147483647';

        if (hasHighlightBox) {
          const outline = document.createElement('div');
          outline.style.position = 'fixed';
          outline.style.left = `${Math.max(0, rect.left - 6)}px`;
          outline.style.top = `${Math.max(0, rect.top - 6)}px`;
          outline.style.width = `${Math.max(1, rect.width + 12)}px`;
          outline.style.height = `${Math.max(1, rect.height + 12)}px`;
          outline.style.boxSizing = 'border-box';
          outline.style.border = '4px solid #ff3028';
          outline.style.borderRadius = '8px';
          outline.style.background = 'rgba(255, 48, 40, 0.08)';
          marker.appendChild(outline);
        }

        const callout = document.createElement('div');
        callout.style.position = 'fixed';
        callout.style.top = '12px';
        callout.style.left = '12px';
        callout.style.maxWidth = 'min(620px, calc(100vw - 24px))';
        callout.style.padding = '12px 14px';
        callout.style.border = '3px solid #ff3028';
        callout.style.borderRadius = '8px';
        callout.style.background = '#fff';
        callout.style.color = '#111827';
        callout.style.font = '600 14px/1.45 Arial, sans-serif';
        callout.style.whiteSpace = 'pre-wrap';
        callout.style.overflowWrap = 'anywhere';
        callout.style.boxShadow = '0 4px 18px rgba(0,0,0,.3)';
        const outlineDescription = targetHasBox
          ? 'Red outline marks the control.'
          : hasHighlightBox
            ? 'Control has no rendered box; red outline marks the nearest visible container.'
            : 'Control and ancestors have no rendered box; no on-page location can be outlined.';
        callout.textContent = `AUDIT TARGET: ${targetDescription}\n${outlineDescription}\nSelector: ${cssSelector}\nSize: ${targetRect.width.toFixed(1)} x ${targetRect.height.toFixed(1)} px; display=${targetStyle.display}; visibility=${targetStyle.visibility}; opacity=${targetStyle.opacity}`;
        marker.appendChild(callout);
        document.documentElement.appendChild(marker);

        return { width: window.innerWidth, height: window.innerHeight };
      },
      { cssSelector: selector, targetDescription: description }
    );

    if (!prepared) {
      return null;
    }

    try {
      await this.page.screenshot({ path: filePath, fullPage: false, timeout: 10_000 });
    } finally {
      await this.page.evaluate(() => {
        document.getElementById('audit-element-diagnostic')?.remove();
      });
    }

    if (!this.hasUsableScreenshot(filePath)) {
      return null;
    }

    return {
      label,
      path: toRelativePath(filePath),
      annotated: true,
      width: prepared.width,
      height: prepared.height
    };
  }

  async captureOverlapDiagnostic(
    label: string,
    affectedSelector: string,
    occludingSelector: string
  ): Promise<ScreenshotEvidence | null> {
    if (auditConfig.screenshotMode === 'off') return null;

    const filePath = this.makePath(label);
    const prepared = await this.page.evaluate(
      ({ affectedSelector: affectedCss, occludingSelector: occludingCss }) => {
        const uniqueElement = (selector: string): HTMLElement | null => {
          try {
            const elements = document.querySelectorAll<HTMLElement>(selector);
            return elements.length === 1 ? elements[0] : null;
          } catch {
            return null;
          }
        };
        const affected = uniqueElement(affectedCss);
        const occluding = uniqueElement(occludingCss);
        if (!affected || !occluding || affected === occluding) return null;

        affected.scrollIntoView({ block: 'center', inline: 'center' });
        const affectedRect = affected.getBoundingClientRect();
        const occludingRect = occluding.getBoundingClientRect();
        const left = Math.max(0, affectedRect.left, occludingRect.left);
        const top = Math.max(0, affectedRect.top, occludingRect.top);
        const right = Math.min(window.innerWidth, affectedRect.right, occludingRect.right);
        const bottom = Math.min(window.innerHeight, affectedRect.bottom, occludingRect.bottom);
        if (right - left <= 1 || bottom - top <= 1) return null;

        const overlay = document.createElement('div');
        overlay.id = 'audit-overlap-diagnostic';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '2147483647';
        overlay.style.pointerEvents = 'none';
        const outline = (rect: DOMRect, color: string, title: string) => {
          const box = document.createElement('div');
          box.style.position = 'fixed';
          box.style.left = `${rect.left}px`;
          box.style.top = `${rect.top}px`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
          box.style.boxSizing = 'border-box';
          box.style.border = `3px solid ${color}`;
          box.title = title;
          overlay.appendChild(box);
        };
        outline(affectedRect, '#1677ff', `Affected element: ${affectedCss}`);
        outline(occludingRect, '#ff8a00', `Occluding element: ${occludingCss}`);

        const intersection = document.createElement('div');
        intersection.style.position = 'fixed';
        intersection.style.left = `${left}px`;
        intersection.style.top = `${top}px`;
        intersection.style.width = `${right - left}px`;
        intersection.style.height = `${bottom - top}px`;
        intersection.style.boxSizing = 'border-box';
        intersection.style.border = '3px solid #e11d48';
        intersection.style.background = 'rgba(225, 29, 72, 0.38)';
        overlay.appendChild(intersection);

        const callout = document.createElement('div');
        callout.style.position = 'fixed';
        callout.style.left = '12px';
        callout.style.top = '12px';
        callout.style.maxWidth = 'min(720px, calc(100vw - 24px))';
        callout.style.padding = '10px 12px';
        callout.style.border = '2px solid #e11d48';
        callout.style.borderRadius = '6px';
        callout.style.background = '#fff';
        callout.style.color = '#111827';
        callout.style.font = '600 13px/1.5 Arial, sans-serif';
        callout.style.whiteSpace = 'pre-wrap';
        callout.style.overflowWrap = 'anywhere';
        callout.style.boxShadow = '0 2px 12px rgba(0,0,0,.25)';
        callout.textContent =
          `OVERLAP EVIDENCE: red = measured intersection (${Math.round((right - left) * (bottom - top))} px²)\n` +
          `Blue outline = affected element: ${affectedCss}\n` +
          `Orange outline = element painted above it: ${occludingCss}`;
        overlay.appendChild(callout);
        document.documentElement.appendChild(overlay);
        return { width: window.innerWidth, height: window.innerHeight };
      },
      { affectedSelector, occludingSelector }
    );
    if (!prepared) return null;

    try {
      await this.page.screenshot({ path: filePath, fullPage: false, timeout: 10_000 });
    } finally {
      await this.page.evaluate(() => {
        document.getElementById('audit-overlap-diagnostic')?.remove();
      });
    }

    if (!this.hasUsableScreenshot(filePath)) return null;
    return {
      label,
      path: toRelativePath(filePath),
      annotated: true,
      width: prepared.width,
      height: prepared.height
    };
  }

  private async capturePage(label: string, fullPage: boolean): Promise<ScreenshotEvidence> {
    const filePath = this.makePath(label);
    if (auditConfig.screenshotMode !== 'off') {
      await this.preparePageForScreenshot(fullPage);
      // small pause to allow any in-flight rendering to settle
      await this.page.waitForTimeout(250).catch(() => undefined);

      // Retry a few times if the captured image looks suspiciously small/blank
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const options = fullPage
            ? { path: filePath, fullPage: true, timeout: 30_000 }
            : { path: filePath, fullPage: false, timeout: 30_000 };
          await this.page.screenshot(options);
        } catch {
          // swallow screenshot errors and retry
        }

        try {
          const stats = fs.statSync(filePath);
          // if file size is reasonable, assume it's a good capture
          if (stats.size > 2_000) break;
        } catch {
          // file may not exist yet
        }

        // small backoff before retrying
        await this.page.waitForTimeout(750).catch(() => undefined);
      }
    }
    return { label, path: toRelativePath(filePath) };
  }

  private async preparePageForScreenshot(fullPage: boolean): Promise<void> {
    await this.page.evaluate(async (captureFullPage) => {
      window.scrollTo(0, 0);
      const fonts = document.fonts;
      if (fonts?.ready) await fonts.ready;
      if (captureFullPage) {
        document.documentElement.style.scrollBehavior = 'auto';
        document.body.style.scrollBehavior = 'auto';
      }
    }, fullPage).catch(() => undefined);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
    await this.page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  }

  private makePath(label: string): string {
    const dir = path.join(
      auditConfig.screenshotDir,
      safeFileName(this.targetName),
      safeFileName(this.viewport),
      safeFileName(this.url)
    );
    ensureDir(dir);
    return path.join(dir, `${safeFileName(label)}.png`);
  }

  private hasUsableScreenshot(filePath: string): boolean {
    try {
      return fs.statSync(filePath).size > 500;
    } catch {
      return false;
    }
  }
}
