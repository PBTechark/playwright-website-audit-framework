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
      const element = document.querySelector<HTMLElement>(cssSelector);
      if (!element) return null;
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
      const element = document.querySelector<HTMLElement>(cssSelector);
      if (!element) return null;
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
