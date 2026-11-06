import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { EvidenceManager } from '../utils/evidence';
import { VisualAudit } from '../audits/VisualAudit';
import { auditConfig } from '../config/auditConfig';

test.describe('Evidence manager', () => {
  test('does not confirm an accordion heading and navigation link that do not overlap', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent(`
      <style>
        body { margin: 0; min-height: 1200px; }
        header a { position: fixed; top: 20px; right: 20px; }
        .accordion { position: absolute; top: 900px; left: 40%; width: 400px; }
      </style>
      <header><a id="navigation" href="/learn-more">LEARN MORE</a></header>
      <div class="accordion">
        <h3 role="tab" aria-expanded="false">
          <a id="accordion-heading" href="#faq">How much do your services cost?</a>
        </h3>
      </div>
    `);

    const evidence = new EvidenceManager(page, 'https://example.com/', 'Desktop');

    expect(await evidence.isOverlapCurrentlyBlocking('#accordion-heading', '#navigation')).toBe(false);
  });

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

  test('includes same-row form control misalignment in visual report findings', async ({ page }) => {
    const previousScreenshotMode = auditConfig.screenshotMode;
    auditConfig.screenshotMode = 'off';
    try {
      await page.route('https://example.com/form-row', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `
            <style>
              form { display:flex; align-items:flex-start; gap:20px; }
              .group { display:flex; align-items:center; gap:8px; }
              select, input { width:130px; height:28px; }
              button { width:90px; height:28px; }
              .search { margin-top:12px; }
            </style>
            <form id="filters">
              <div class="group"><label for="type">Property Type</label><select id="type"><option>All</option></select></div>
              <div class="group"><label for="status">Waitlist</label><select id="status"><option>All</option></select></div>
              <div class="group search"><input id="query" type="search" aria-label="Search"><button id="submit" type="submit">Search</button></div>
            </form>
          `
        })
      );
      await page.goto('https://example.com/form-row');

      const result = await new VisualAudit().run(page, page.url(), 'Desktop Full HD', 'test-target');
      const issue = result.issues.find((candidate) =>
        candidate.description.startsWith('Form Row Alignment:')
      );

      expect(issue).toMatchObject({
        category: 'Visual',
        severity: 'Medium',
        selector: '#filters',
        expected: expect.stringContaining('horizontal form row'),
        suggestedFix: expect.stringContaining('Align controls'),
        details: expect.objectContaining({
          controlSelectors: ['#type', '#status', '#query', '#submit'],
          centerSpread: 12,
          allowedCenterSpread: 8
        })
      });
    } finally {
      auditConfig.screenshotMode = previousScreenshotMode;
    }
  });

  test('highlights the affected control and the occluding image for overlap findings', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1366 });
    const markup = `
      <style>
        button { position:absolute; top:0; left:calc(100% - 250px); width:400px; height:100px; }
        img { position:fixed; right:0; top:0; width:100px; height:100px; }
      </style>
      <button id="target-button">Continue</button>
      <img id="corner-ribbon" alt="Corner ribbon" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='green'/%3E%3C/svg%3E">
    `;
    await page.route('https://example.com/overlap', (route) =>
      route.fulfill({ contentType: 'text/html', body: markup })
    );
    await page.goto('https://example.com/overlap');
    const overlapEvidence = new EvidenceManager(page, 'https://example.com/overlap', 'iPad Pro Portrait', 'test-target');
    expect(await overlapEvidence.isOverlapCurrentlyBlocking('#target-button', '#corner-ribbon')).toBe(true);
    const result = await new VisualAudit().run(page, 'https://example.com/overlap', 'iPad Pro Portrait', 'test-target');
    const issue = result.issues.find((candidate) =>
      candidate.description.startsWith('Element Overlap:') &&
      candidate.details && typeof candidate.details === 'object' &&
      'imageObstructsControl' in candidate.details &&
      candidate.details.imageObstructsControl === true
    );

    expect(issue?.selector).toBe('#target-button');
    expect(issue?.details).toMatchObject({
      occludingSelector: '#corner-ribbon',
      overlapBox: expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number)
      })
    });
    expect(issue?.evidenceDetails).toHaveLength(3);
    expect(issue?.evidenceDetails?.every((evidence) => evidence.annotated)).toBe(true);
    expect(issue?.evidenceDetails?.some((evidence) => evidence.label.includes('overlap-diagnostic'))).toBe(true);
    for (const evidence of issue?.evidenceDetails ?? []) {
      expect(fs.existsSync(path.join(process.cwd(), evidence.path))).toBe(true);
    }
  });
});
