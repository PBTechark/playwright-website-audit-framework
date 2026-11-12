import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { HeaderValidator } from '../validators/HeaderValidator';

async function openTestPage(page: Page): Promise<void> {
  await page.route('https://example.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
  );
  await page.goto('https://example.test/');
}

function removeEvidence(paths: string[] | undefined): void {
  for (const evidencePath of paths ?? []) {
    fs.rmSync(path.resolve(evidencePath), { force: true });
  }
}

test('recognizes a visible SVG brand mark in a home link when an earlier logo variant is hidden', async ({ page }) => {
  await openTestPage(page);
  await page.setContent(`
    <header>
      <a class="logo" href="/" style="display:none"><img alt="Logo" src="/hidden.svg"></a>
      <a href="/" aria-label="Home">
        <svg viewBox="0 0 100 30" width="100" height="30" aria-hidden="true">
          <rect width="100" height="30" fill="navy"></rect>
        </svg>
      </a>
      <nav><a href="/about">About</a></nav>
    </header>
  `);

  const issues = await new HeaderValidator().validate(page, 'https://example.test/', 'Desktop', false);

  expect(issues.filter((issue) => issue.description.includes('header logo'))).toHaveLength(0);
});

test('recognizes a visible image logo through its branded ancestor', async ({ page }) => {
  await page.setContent(`
    <header>
      <div class="site-brand">
        <img alt="Example" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='24'%3E%3Crect width='80' height='24' fill='navy'/%3E%3C/svg%3E">
      </div>
      <nav><a href="/about">About</a></nav>
    </header>
  `);

  const issues = await new HeaderValidator().validate(page, 'https://example.test/', 'Desktop', false);

  expect(issues.filter((issue) => issue.description.includes('header logo'))).toHaveLength(0);
});

test('reports a confidently identified logo image that failed to load', async ({ page }) => {
  await page.setContent(`
    <header>
      <a class="site-logo" href="/">
        <img alt="Logo" src="data:image/png;base64,not-a-valid-image" width="120" height="40">
      </a>
      <nav><a href="/about">About</a></nav>
    </header>
  `);

  const issues = await new HeaderValidator().validate(page, 'https://example.test/', 'Desktop', false);

  try {
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Header logo image is present but failed to load.',
          severity: 'High',
          selector: 'img[alt="Logo"]'
        })
      ])
    );
  } finally {
    removeEvidence(issues.flatMap((issue) => issue.evidence ?? []));
  }
});

test('reports an inconclusive low-severity finding instead of claiming the logo is missing', async ({ page }) => {
  await page.setContent(`
    <header>
      <a href="/">Welcome</a>
      <nav><a href="/about">About</a></nav>
    </header>
  `);

  const issues = await new HeaderValidator().validate(page, 'https://example.test/', 'Desktop', false);

  try {
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Could not automatically identify a visible header logo or branded home link.',
          severity: 'Low'
        })
      ])
    );
  } finally {
    removeEvidence(issues.flatMap((issue) => issue.evidence ?? []));
  }
});
