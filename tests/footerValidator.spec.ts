import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { EvidenceManager } from '../utils/evidence';
import { FooterValidator } from '../validators/FooterValidator';

test('recognizes a visible copyright block immediately outside the semantic footer', async ({ page }) => {
  await page.setContent(`
    <footer class="entry-footer">Posted in News</footer>
    <footer class="site-footer"><a href="/contact">Contact</a></footer>
    <div class="copyright">© 2026 Strelitz International Academy<br>All rights reserved.</div>
  `);

  const issues = await new FooterValidator().validate(page, 'https://example.com/', 'Desktop');

  expect(issues.filter((issue) => issue.description.includes('copyright notice'))).toHaveLength(0);
});

test('reports a copyright notice when no visible copyright text exists', async ({ page }) => {
  await page.setContent(`
    <footer class="site-footer"><a href="/contact">Contact</a></footer>
    <div class="copyright" style="display:none">© 2026 Example</div>
  `);

  const issues = await new FooterValidator().validate(page, 'https://example.com/', 'Desktop');

  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: 'Footer copyright notice is missing or not visible.'
    })
  ]));
});

test('recognizes rendered footer content when the semantic footer has a zero-size box', async ({ page }) => {
  await page.setContent(`
    <main style="height: 1200px">Page content</main>
    <footer style="height: 0">
      <div style="height: 320px">
        <a href="/contact">Contact</a>
        <p class="copyright">© 2026 Example</p>
      </div>
    </footer>
  `);

  const issues = await new FooterValidator().validate(page, 'https://example.com/', 'Desktop');

  expect(issues.some((issue) => issue.description === 'Footer is not visible.')).toBe(false);
});

test('reports a footer whose content is hidden', async ({ page }) => {
  await page.setContent(`
    <footer style="display: none"><a href="/contact">Contact</a></footer>
  `);

  const issues = await new FooterValidator().validate(page, 'https://example.com/', 'Desktop');

  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ description: 'Footer is not visible.' })
  ]));
});

test('captures a visible descendant when the requested footer wrapper has no box', async ({ page }) => {
  test.skip(auditConfig.screenshotMode === 'off', 'Screenshot evidence is disabled.');
  await page.setContent(`
    <footer style="height: 0">
      <div style="height: 320px; background: #123">Footer content</div>
    </footer>
  `);
  let screenshotPath: string | undefined;

  try {
    const evidence = await new EvidenceManager(page, 'https://example.com/', 'Desktop', 'footer-regression')
      .captureLocator('zero-box-footer', page.locator('footer'));
    screenshotPath = evidence ? path.resolve(evidence.path) : undefined;

    expect(evidence).not.toBeNull();
    expect(screenshotPath && fs.statSync(screenshotPath).size).toBeGreaterThan(500);
  } finally {
    if (screenshotPath) fs.rmSync(screenshotPath, { force: true });
  }
});
