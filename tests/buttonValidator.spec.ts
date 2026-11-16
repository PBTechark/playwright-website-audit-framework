import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { ComponentAssertionAudit } from '../audits/ComponentAssertionAudit';
import { BrowserSignalCollector } from '../utils/browserSignals';
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

  test('classifies button text hidden on hover as a suggestion', async ({ page }) => {
    await page.setContent(`
      <style>
        button { width: 180px; height: 48px; color: black; background: white; }
        button:hover { opacity: 0; }
      </style>
      <button>Call now</button>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        description: 'Button text becomes unavailable on hover: Call now.',
        severity: 'Suggestion'
      })
    ]));
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
      expect.objectContaining({
        description: 'Clickable button target is smaller than recommended touch size.',
        severity: 'Suggestion'
      })
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

  test('does not classify a lazy content thumbnail or its alternative text as a missing or hidden icon label', async ({
    page
  }) => {
    await page.setContent(`
      <a class="cta-image-link" href="/articles/featured" aria-label="Read the featured article">
        <img
          class="post-thumbnail"
          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E"
          data-src="/images/featured-article.jpg"
          width="650"
          height="570"
          alt="Featured article preview"
        >
      </a>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues.filter((issue) =>
      issue.description === 'Icon-only control has no rendered icon.' ||
      issue.description.startsWith('Button text becomes unavailable on hover:')
    )).toHaveLength(0);
    expect(issues.some((issue) => issue.description === 'Button has no visible or accessible label.')).toBe(false);
  });

  test('does not report a pending lazy icon image as confirmed missing', async ({ page }) => {
    await page.setContent(`
      <a id="search" href="/search" aria-label="Search">
        <img
          class="icon-search"
          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E"
          data-src="/images/search.svg"
          width="24"
          height="24"
          alt=""
        >
      </a>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues.filter((issue) =>
      issue.description === 'Icon-only control has no rendered icon.' ||
      issue.description === 'Button has no visible or accessible label.'
    )).toHaveLength(0);
  });

  test('does not accept an SVG icon hidden inside an otherwise visible control', async ({ page }) => {
    await page.setContent(`
      <style>
        a { display: inline-flex; width: 48px; height: 48px; }
      </style>
      <a href="/search" aria-label="Search">
        <svg style="display:none" width="24" height="24" viewBox="0 0 24 24">
          <path d="M2 2h20v20H2z"></path>
        </svg>
      </a>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: 'Icon-only control has no rendered icon.' })
    ]));
  });

  test('uses the accessible-name rule for visible search and social icons', async ({ page }) => {
    await page.setContent(`
      <style>
        .search-submit { width: 40px; height: 50px; }
        .fa-search { display: inline-block; width: 16px; height: 16px; }
        .fa-search::before { content: "⌕"; font: 20px Arial, sans-serif; }
        .link-twitter { display: inline-block; width: 24px; height: 24px; }
        .link-twitter::before { content: "X"; font: 20px Arial, sans-serif; }
      </style>
      <form role="search">
        <input type="search" placeholder="To search, type and enter.">
        <button class="search-submit" type="submit" role="button"><i class="fa fa-search"></i></button>
      </form>
      <a class="link-twitter" href="/social"><i class="fab fa-twitter"></i></a>
    `);

    const url = 'https://example.com/';
    const issues = await new ButtonValidator().validate(page, url, 'Desktop Full HD');

    expect(issues.filter((issue) => issue.description === 'Icon-only control has no rendered icon.')).toHaveLength(0);
    expect(issues.some((issue) => issue.description === 'Button has no visible or accessible label.')).toBe(false);

    const componentAudit = await new ComponentAssertionAudit().run(
      page,
      url,
      'Desktop Full HD',
      { loadTimeMs: 0, domContentLoadedMs: 0, totalRequests: 0, totalResourceBytes: 0 },
      new BrowserSignalCollector(),
      ['screenshots/unrelated-footer.png'],
      'component-audit-test'
    );
    const searchNameIssue = componentAudit.issues.find((issue) =>
      issue.description.startsWith('Button accessible name:')
    );
    expect(searchNameIssue).toBeDefined();
    expect(searchNameIssue?.description).toBe('Button accessible name: Button does not expose a usable accessible name.');
    expect(searchNameIssue?.actual).toContain('axe-core button-name rule failed');
    expect(searchNameIssue?.evidence).toHaveLength(1);
    expect(searchNameIssue?.evidence?.[0]).toContain(
      'component-audit-test/Desktop Full HD/example.com-/component-'
    );
    expect(searchNameIssue?.evidence).not.toContain('screenshots/unrelated-footer.png');
    expect(searchNameIssue?.evidenceDetails).toEqual([
      expect.objectContaining({ annotated: true, width: 1280, height: 720 })
    ]);
    expect(componentAudit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkName: 'Button visibility', result: 'PASS' }),
        expect.objectContaining({ checkName: 'Button enabled', result: 'PASS' })
      ])
    );

    await page.setContent('<button type="button"></button>');
    const unlabeledButtonAudit = await new ComponentAssertionAudit().run(
      page,
      url,
      'Desktop Full HD',
      { loadTimeMs: 0, domContentLoadedMs: 0, totalRequests: 0, totalResourceBytes: 0 },
      new BrowserSignalCollector(),
      []
    );
    expect(unlabeledButtonAudit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Button accessible name: Button does not expose a usable accessible name.' })
      ])
    );
  });

  test('accepts valid accessible names from ARIA and title attributes', async ({ page }) => {
    await page.setContent(`
      <span id="labelled-button-name" hidden>Search</span>
      <button aria-label="Open menu"></button>
      <button aria-labelledby="labelled-button-name"></button>
      <button title="Close dialog"></button>
    `);

    const result = await new ComponentAssertionAudit().run(
      page,
      'https://example.com/named-buttons',
      'Mobile Portrait',
      { loadTimeMs: 0, domContentLoadedMs: 0, totalRequests: 0, totalResourceBytes: 0 },
      new BrowserSignalCollector(),
      []
    );
    const nameChecks = result.checks.filter((check) => check.checkName === 'Button accessible name');

    expect(nameChecks).toHaveLength(3);
    expect(nameChecks.every((check) => check.result === 'PASS')).toBe(true);
    expect(result.issues.some((issue) => issue.description.startsWith('Button accessible name:'))).toBe(false);
  });

  test('captures accessible-name evidence in the active mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.setContent('<button type="button"></button>');

    const result = await new ComponentAssertionAudit().run(
      page,
      'https://example.com/mobile',
      'Mobile Portrait',
      { loadTimeMs: 0, domContentLoadedMs: 0, totalRequests: 0, totalResourceBytes: 0 },
      new BrowserSignalCollector(),
      ['screenshots/desktop-footer.png'],
      'component-audit-mobile'
    );
    const issue = result.issues.find((candidate) =>
      candidate.description.startsWith('Button accessible name:')
    );

    expect(issue?.viewport).toBe('Mobile Portrait');
    expect(issue?.evidence).toHaveLength(1);
    expect(issue?.evidence?.[0]).toContain('component-audit-mobile/Mobile Portrait/example.com-mobile/component-');
    expect(issue?.evidence?.[0]).not.toContain('desktop-footer.png');
    expect(issue?.evidenceDetails).toEqual([
      expect.objectContaining({ annotated: true, width: 393, height: 852 })
    ]);
  });

  test('continues to report a visible textless control when no icon is rendered', async ({ page }) => {
    await page.setContent(`
      <style>
        .fa-search::before { content: none; }
        button { width: 40px; height: 40px; }
      </style>
      <button type="button" class="fa fa-search"></button>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Button has no visible or accessible label.' })
      ])
    );
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

  test('accepts a desktop-hidden menu toggle when its containing navigation is visible and usable', async ({
    page
  }) => {
    await page.setContent(`
      <header>
        <nav id="site-navigation" aria-label="Primary">
          <button id="menu-toggle" type="button" aria-label="Open menu" style="display:none"></button>
          <a href="/home">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>
    `);

    const url = 'https://example.com/';
    const buttonIssues = await new ButtonValidator().validate(page, url, 'Desktop Full HD');
    const componentAudit = await new ComponentAssertionAudit().run(
      page,
      url,
      'Desktop Full HD',
      { loadTimeMs: 0, domContentLoadedMs: 0, totalRequests: 0, totalResourceBytes: 0 },
      new BrowserSignalCollector(),
      []
    );

    expect(buttonIssues.filter((issue) => issue.description === 'Button is present but not visible.')).toHaveLength(0);
    expect(componentAudit.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ checkName: 'Button visibility', result: 'PASS' })])
    );
    expect(
      componentAudit.issues.filter((issue) => issue.description === 'Button visibility: Button is not visible.')
    ).toHaveLength(0);
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

  test('does not exempt unrelated hidden controls merely because they share visible navigation', async ({ page }) => {
    await page.setContent(`
      <nav aria-label="Primary">
        <button id="hidden-filter" type="button" aria-label="Open filters" style="display:none"></button>
        <a href="/home">Home</a>
      </nav>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Button is present but not visible.',
          selector: expect.stringContaining('Open')
        })
      ])
    );
  });

  test('does not exempt a hidden non-navigation control that references a dialog inside a nav', async ({ page }) => {
    await page.setContent(`
      <header>
        <nav aria-label="Primary">
          <button type="button" aria-label="Open account panel" aria-controls="account-panel" style="display:none"></button>
          <a href="/home">Home</a>
        </nav>
        <div id="account-panel" role="dialog">Account details</div>
      </header>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');
    const componentAudit = await new ComponentAssertionAudit().run(
      page,
      'https://example.com/',
      'Desktop Full HD',
      { loadTimeMs: 0, domContentLoadedMs: 0, totalRequests: 0, totalResourceBytes: 0 },
      new BrowserSignalCollector(),
      []
    );

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        description: 'Button is present but not visible.',
        selector: expect.stringContaining('Open')
      })
    ]));
    const componentVisibilityIssue = componentAudit.issues.find(
      (issue) => issue.description === 'Button visibility: Button is not visible.'
    );
    expect(componentVisibilityIssue?.selector).toContain('button');
  });

  test('accepts a hidden social link in a collapsed header list when a visible menu toggle is available', async ({
    page
  }) => {
    await page.setContent(`
      <header>
        <nav aria-label="Primary">
          <a href="/home">Home</a>
          <ul class="social-media-links" style="display:none">
            <li><a href="/facebook" class="fa-facebook-f" aria-label="Facebook"></a></li>
          </ul>
        </nav>
        <button type="button" class="mobile-menu" aria-label="Open menu">Menu</button>
      </header>
    `);

    const url = 'https://example.com/';
    const buttonIssues = await new ButtonValidator().validate(page, url, 'Mobile Portrait');
    const componentAudit = await new ComponentAssertionAudit().run(
      page,
      url,
      'Mobile Portrait',
      { loadTimeMs: 0, domContentLoadedMs: 0, totalRequests: 0, totalResourceBytes: 0 },
      new BrowserSignalCollector(),
      []
    );

    expect(buttonIssues.filter((issue) => issue.description === 'Button is present but not visible.')).toHaveLength(0);
    expect(componentAudit.issues.filter((issue) =>
      issue.description === 'Menu link clickable: Menu link is hidden or cannot receive pointer interaction.'
    )).toHaveLength(0);
  });

  test('does not call off-viewport logo and home links hidden and keeps each selector distinct', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent(`
      <style>
        html { scroll-behavior: auto; }
        body { margin: 0; }
        header { height: 80px; }
        header a { display: inline-flex; width: 24px; height: 24px; }
        main { height: 1600px; }
      </style>
      <header>
        <a class="header-logo" href="/" aria-label="Website logo">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <rect width="20" height="20" fill="black" />
          </svg>
        </a>
        <a class="nav-button" href="/">Home</a>
      </header>
      <main>Page content</main>
      <footer>End of page</footer>
    `);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    const targetName = 'button-visibility-scroll-test';
    try {
      const issues = await new ButtonValidator().validate(
        page,
        'https://example.com/event-calendar',
        'Desktop Full HD',
        targetName
      );
      const visibilityIssues = issues.filter((issue) => issue.description === 'Button is present but not visible.');
      const targetSizeIssues = issues.filter((issue) =>
        issue.description === 'Clickable button target is smaller than recommended touch size.'
      );
      const selectors = targetSizeIssues.map((issue) => issue.selector);

      expect(visibilityIssues).toHaveLength(0);
      expect(targetSizeIssues).toHaveLength(2);
      expect(new Set(selectors).size).toBe(2);
      for (const selector of selectors) {
        const control = page.locator(selector ?? '');
        expect(await control.count()).toBe(1);
        expect(await control.evaluate((element) => element.tagName.toLowerCase())).toBe('a');
      }
    } finally {
      fs.rmSync(path.join(process.cwd(), 'screenshots', targetName), { recursive: true, force: true });
    }
  });

  test('continues to report CSS-hidden links and buttons', async ({ page }) => {
    await page.setContent(`
      <a class="nav-button" href="/" style="display:none">Hidden home link</a>
      <button style="visibility:hidden">Hidden action</button>
    `);

    const issues = await new ButtonValidator().validate(page, 'https://example.com/', 'Desktop Full HD');
    const hiddenIssues = issues.filter((issue) => issue.description === 'Button is present but not visible.');

    expect(hiddenIssues).toHaveLength(2);
    expect(new Set(hiddenIssues.map((issue) => issue.selector)).size).toBe(2);
    expect(hiddenIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ details: expect.objectContaining({ tagName: 'a' }) }),
        expect.objectContaining({ details: expect.objectContaining({ tagName: 'button' }) })
      ])
    );
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
    expect(targetIssues.every((issue) => issue.severity === 'Suggestion')).toBe(true);
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
