import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { EvidenceManager } from '../utils/evidence';
import { VisualAudit } from '../audits/VisualAudit';

test.describe('Evidence manager', () => {
  test('captures highlighted element region for visual defect evidence', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`
      <style>
        body { margin: 0; }
        .card { width: 360px; height: 180px; margin: 48px auto; border: 1px solid #bbb; background: #fff; }
      </style>
      <div class="card" id="defect-card">Visible defect card</div>
    `);

    const evidenceManager = new EvidenceManager(page, 'https://example.com/defect', 'Desktop Full HD', 'test-target');
    const shot = await evidenceManager.captureElementRegionWithHighlight('highlighted-defect', '#defect-card');

    expect(shot).not.toBeNull();
    expect(shot?.label).toBe('highlighted-defect');
    expect(shot?.annotated).toBe(true);
    expect(shot?.sourcePath).toBeTruthy();

    const screenshotPath = path.join(process.cwd(), shot?.path ?? '');
    expect(fs.existsSync(screenshotPath)).toBe(true);
    const stats = fs.statSync(screenshotPath);
    expect(stats.size).toBeGreaterThan(1000);
    expect(fs.existsSync(path.join(process.cwd(), shot?.sourcePath ?? ''))).toBe(true);
  });

  test('attaches highlighted visual evidence to a reported visual issue', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent(`
      <style>
        body { margin: 0; }
        section { width: 680px; height: 240px; margin: 32px auto; border: 1px solid #c0c0c0; background: #fafafa; }
      </style>
      <section id="empty-card"></section>
    `);

    const visualAudit = new VisualAudit();
    const result = await visualAudit.run(page, 'https://example.com/empty-card', 'Desktop Full HD', 'test-target');

    expect(result.issues.length).toBeGreaterThan(0);
    const visualIssue = result.issues.find((issue) => issue.category === 'Visual');
    expect(visualIssue).toBeDefined();
    expect(visualIssue?.evidence?.length).toBeGreaterThan(0);

    const evidencePath = visualIssue?.evidence?.[0] ?? '';
    const screenshotPath = path.join(process.cwd(), evidencePath);
    expect(fs.existsSync(screenshotPath)).toBe(true);
    expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000);
  });
});
