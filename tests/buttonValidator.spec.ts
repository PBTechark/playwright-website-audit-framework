import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { ButtonValidator } from '../validators/ButtonValidator';

test.describe('Button validator evidence', () => {
  test('does not report low contrast when a rendered gradient makes computed contrast indeterminate', async ({ page }) => {
    await page.setContent(`
      <style>
        body { background: white; }
        button {
          width: 180px;
          height: 48px;
          color: white;
          background-image: linear-gradient(#111, #111);
          border: 0;
        }
      </style>
      <button>Clearly visible action</button>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues.filter((issue) => issue.description.includes('Hover-state text contrast'))).toHaveLength(0);
  });

  test('does not report a hover-specific contrast regression when contrast is already low at baseline', async ({ page }) => {
    await page.setContent(`
      <style>
        button {
          width: 180px;
          height: 48px;
          color: #ff9811;
          background: white;
          border: 0;
        }
      </style>
      <button>Call now</button>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues.filter((issue) => issue.description.includes('Hover-state text contrast'))).toHaveLength(0);
  });

  test('reports button text contrast that becomes low specifically on hover', async ({ page }) => {
    await page.setContent(`
      <style>
        button {
          width: 180px;
          height: 48px;
          color: black;
          background: white;
          border: 0;
        }
        button:hover { color: #ff9811; }
      </style>
      <button>Call now</button>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');
    const issue = issues.find((candidate) => candidate.description.includes('Hover-state text contrast'));

    expect(issue).toBeDefined();
    expect(issue).toMatchObject({
      category: 'Accessibility',
      severity: 'Medium',
      description: 'Hover-state text contrast is insufficient: Call now.'
    });
    expect(issue?.details).toMatchObject({
      hover: {
        baselineContrastRatio: 21,
        baselineContrastThreshold: 4.5,
        contrastRatio: 2.15,
        contrastThreshold: 4.5,
        fontSize: 13.3,
        fontWeight: 400
      }
    });
    expect(issue?.actual).toContain('4.5:1 is required for 13.3px text');
  });

  test('discovers icon-only back-to-top controls and reports missing icon, name, and target size', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`
      <style>
        html { scroll-behavior: auto; }
        body { height: 1800px; margin: 0; }
        .back-to-top {
          position: fixed; right: 12px; bottom: 12px;
          width: 20px; height: 20px; display: block;
        }
        .fas::before { content: none; }
      </style>
      <div id="top"></div>
      <main>Long page content</main>
      <a class="back-to-top" href="javascript:void(0)"><i class="fas fa-arrow-up"></i></a>
      <script>
        document.querySelector('.back-to-top').addEventListener('click', () => window.scrollTo(0, 0));
      </script>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        description: 'Icon-only control has no rendered icon.',
        details: expect.objectContaining({ backToTop: true })
      }),
      expect.objectContaining({ description: 'Button has no visible or accessible label.' }),
      expect.objectContaining({ description: 'Clickable button target is smaller than recommended touch size.' })
    ]));
    expect(issues.some((issue) => issue.description === 'Back-to-top control does not return the page to the top.')).toBe(false);
  });

  test('accepts a rendered, labelled back-to-top icon and verifies its safe same-page action', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`
      <style>
        html { scroll-behavior: auto; }
        body { height: 1800px; margin: 0; }
        .back-to-top {
          position: fixed; right: 12px; bottom: 12px;
          width: 48px; height: 48px; display: block;
        }
        .fa-arrow-up::before { content: "↑"; font: 20px Arial, sans-serif; }
      </style>
      <div id="top"></div>
      <main>Long page content</main>
      <a class="back-to-top" aria-label="Back to top" href="#top">
        <i class="fas fa-arrow-up"></i>
      </a>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues.filter((issue) =>
      issue.description.includes('Icon-only control has no rendered icon') ||
      issue.description.includes('Icon font failed to load') ||
      issue.description.includes('Back-to-top control does not')
    )).toHaveLength(0);
    expect(issues.filter((issue) => issue.description === 'Button has no visible or accessible label.')).toHaveLength(0);
  });

  test('checks labelled icon-only links but leaves ordinary text navigation links alone', async ({ page }) => {
    await page.setContent(`
      <style>
        .fa-search::before { content: none; }
        a { display: inline-block; width: 48px; height: 48px; }
      </style>
      <nav>
        <a href="/home">Home</a>
        <a href="/search" aria-label="Search"><i class="fa fa-search"></i></a>
      </nav>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        description: 'Icon-only control has no rendered icon.',
        selector: 'a[aria-label="Search"]'
      })
    ]));
    expect(issues.filter((issue) => issue.description === 'Button has no visible or accessible label.')).toHaveLength(0);
    expect(issues.some((issue) => issue.selector?.includes('/home'))).toBe(false);
  });

  test('resolves dynamically referenced hidden navigation controls despite unrelated hrefs', async ({ page }) => {
    const ariaTargetId = `nav-${Date.now()}-primary`;
    const bootstrapTargetId = `nav-${Date.now()}-secondary`;
    await page.setContent(`
      <header>
        <div id="${ariaTargetId}"><nav><a href="/admissions">Admissions</a></nav></div>
        <nav id="${bootstrapTargetId}"><a href="/campus">Campus</a></nav>
        <button type="button" aria-label="Open primary menu" aria-controls="${ariaTargetId}"
          href="/unrelated-destination" style="display:none"></button>
        <button type="button" aria-label="Open secondary menu" data-bs-target="#${bootstrapTargetId}"
          href="/another-unrelated-destination" style="display:none"></button>
      </header>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues.filter((issue) => issue.description.includes('not visible'))).toHaveLength(0);
    expect(issues.filter((issue) => issue.description.includes('smaller than recommended'))).toHaveLength(0);
  });

  test('still reports hidden controls that target a visible non-navigation component', async ({ page }) => {
    const dialogId = `dialog-${Date.now()}-details`;
    await page.setContent(`
      <div id="${dialogId}" role="dialog">Visible dialog content</div>
      <button type="button" aria-label="Open details" aria-controls="${dialogId}" style="display:none"></button>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        description: 'Button is present but not visible.',
        selector: expect.stringContaining('button')
      })
    ]));
  });

  test('generates unique selectors for deeply nested buttons with duplicate ids', async ({ page }) => {
    await page.setContent(`
      <style>button { width: 20px; height: 20px; color: white; background: black; }</style>
      <main>
        <div><div><div><div><div><div><div><div>
          <button id="duplicate">One</button>
          <button id="duplicate">Two</button>
        </div></div></div></div></div></div></div></div>
      </main>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');
    const targetIssues = issues.filter((issue) => issue.description.includes('smaller than recommended'));

    expect(targetIssues).toHaveLength(2);
    expect(new Set(targetIssues.map((issue) => issue.selector)).size).toBe(2);
    for (const issue of targetIssues) {
      const target = page.locator(issue.selector ?? '');
      expect(await target.count()).toBe(1);
      expect(await target.textContent()).toMatch(/^(One|Two)$/);
    }
  });

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
