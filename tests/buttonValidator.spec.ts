import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { ButtonValidator } from '../validators/ButtonValidator';

test.describe('Button validator evidence', () => {
  test('attaches annotated evidence and control details for a hidden control', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`
      <style>
        body { margin: 0; font: 16px Arial, sans-serif; }
        section { width: 420px; height: 160px; margin: 80px auto; padding: 20px; background: #eee; }
        .hidden { display: none; }
      </style>
      <section id="navigation-area">
        <div id="hidden-control" class="button hidden" role="button" aria-label="Hidden search action" aria-hidden="true">
          Hidden search action
        </div>
      </section>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD', 'test-target');
    const issue = issues.find((candidate) => candidate.description === 'Button is present but not visible.');

    expect(issue).toBeDefined();
    expect(issue?.selector).toBe('div[aria-label="Hidden\\ search\\ action"]');
    expect(await page.locator(issue?.selector ?? '').count()).toBe(1);
    expect(issue?.actual).toContain('0 x 0px');
    expect(issue?.evidence).toHaveLength(1);
    expect(issue?.evidenceDetails?.[0]).toMatchObject({ annotated: true, label: 'button-issue-0' });
    expect(issue?.details).toMatchObject({
      tagName: 'div',
      role: 'button',
      text: 'Hidden search action',
      boundingBox: { width: 0, height: 0 }
    });

    const screenshotPath = path.join(process.cwd(), issue?.evidence?.[0] ?? '');
    expect(fs.existsSync(screenshotPath)).toBe(true);
    expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1_000);
  });
});
