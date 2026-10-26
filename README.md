# Playwright Website Audit Framework

This framework automatically reads website targets from CSV, crawls every discovered internal page, and audits each page across desktop, mobile, and iPad viewports. It generates visual evidence, raw JSON results, Allure results, custom per-site reports, and a batch summary.

## Quick Start

1. Add target websites to `test-data/audit-targets.csv` and enable the rows you want included in scheduled/manual runs. Pull requests use `test-data/audit-targets-pr.csv` for a smaller smoke audit; enable at least one approved target there before the first PR run.

```csv
name,url,enabled,maxPages,maxDepth
bgcseva,https://bgcseva.org/,true,75,4
example,https://example.com,true,10,2
```

2. Install dependencies and browsers.

```bash
npm install
npx playwright install
```

3. Run the full audit.

```bash
npm run audit
```

## What Runs

The audit flow is automatic:

1. `global-setup.ts` reads enabled rows from `test-data/audit-targets.csv`.
2. Each target is crawled from its base URL, XML sitemaps, HTML sitemaps, header links, footer links, breadcrumbs, and internal links.
   Links found directly on the configured base page are prioritized before sitemap-only URLs when `maxPages` is reached.
3. `tests/website-audit.spec.ts` creates an audit test for each discovered URL.
4. Playwright projects execute the same test across:
   - Desktop Full HD `1920 x 1080`
   - Mobile Portrait `393 x 852`
   - Mobile Landscape `852 x 393`
   - iPad Pro Portrait `1024 x 1366`
   - iPad Pro Landscape `1366 x 1024`
5. Each test captures screenshots, issues, console/network findings, SEO data, accessibility violations, image/link/video problems, forms, buttons, and performance metrics.
6. `global-teardown.ts` aggregates all raw results into per-site HTML reports and a batch summary.

Button visibility findings include a dedicated annotated screenshot, copied CSS selector, and element identification details (label, tag, computed visibility, and rendered size). If a hidden control has no rendered box, the evidence marks its nearest visible container and explains that the control itself has no visible location to outline. Button findings do not reuse unrelated page screenshots.

When a navigation returns HTTP 4xx/5xx, the audit reports the deployment response and skips page-content checks for that viewport. This prevents access-denied or server-error pages from being misreported as missing headers, footers, or content. The header-logo link is checked separately, including off-site destinations and its complete HTTP redirect chain; an off-site final destination is reported as a high-severity link issue.

## Reports

After `npm run audit`, open the custom audit results with:

```bash
npm run show-report
```

This opens the default custom audit report at `reports/website-audit-report.html` in the system browser.

Available report files include:

- `reports/website-audit-report.html`
- `reports/batch-summary.html`
- `reports/<target-name>/website-audit-report.html`
- `reports/<target-name>/broken-links-report.html`
- `reports/<target-name>/broken-images-report.html`
- `reports/<target-name>/video-report.html`
- `reports/<target-name>/responsive-report.html`
- `reports/<target-name>/performance-report.html`
- `reports/accessibility-report.html` and `reports/seo-report.html`
- `reports/<target-name>/accessibility-report.html` and `reports/<target-name>/seo-report.html`

The custom dashboard is the canonical report opened by `npm run show-report`. Each generated
dashboard includes current severity charts, a historical severity trend stored under
`reports/history/severity-history.json`, page-level drill-down links, screenshot/video evidence,
filtered CSV and JSON export buttons, and a system-aware light/dark theme toggle. Exports contain
the currently visible findings after applying the dashboard filters. Set `REPORT_HISTORY_RETENTION`
in `.env` to control how many run snapshots are retained.

Visual issue evidence includes an annotated defect-region derivative and, when available, the
unmodified original capture. Use the `View annotated` action to locate the defect quickly and
`Original` to inspect the source image at its preserved quality. Long selectors, URLs, diagnostics,
and JSON details wrap or scroll inside their own report regions so they cannot overlap neighboring
cards or push screenshots outside the page layout.

Issue titles and page URLs include copy icons with accessible labels and clipboard fallback support.
The dashboard keeps Excel as the primary spreadsheet export, alongside JSON export. Toolbar actions
remain aligned in one controlled row. The audit viewport matrix is Desktop Full HD `1920 x 1080`,
Mobile Portrait `393 x 852`, Mobile Landscape `852 x 393`, iPad Pro Portrait `1024 x 1366`, and
iPad Pro Landscape `1366 x 1024`.

Screenshots are stored in `screenshots/`. Raw results are stored in `reports/raw-results/`.

### Assertion register

Every website report contains an **Assertion Register**. Unlike the Findings section, it includes
both PASS and FAIL records. Each record identifies the component and check name and includes the
expected result, actual result, plain-language comment, severity, recommendation, page, viewport,
timestamp, stable element locator, bounding box, available response/console data, and screenshot
evidence. This makes the same report useful to QA, engineering, product, and business readers.
The configured Playwright test viewport (for example, `Desktop Full HD — 1920 × 1080`) is recorded
on findings, assertion records, page executions, and Playwright test annotations. The report also
shows a separate content-adapted layout viewport when a mobile page expands `window.innerWidth` due
to viewport metadata, shrink-to-fit behavior, or minimum-width content. Screenshot dimensions and
the primary test viewport label always reflect the Playwright project configuration.

Example rendered record:

```text
Component: Image
Check: Image rendering
Result: FAIL
Severity: High
Expected: Complete image with natural dimensions greater than zero
Actual: complete=true, natural=0x0
Comment: Image failed to render.
Recommendation: Verify the image URL, format, and deployment.
```

`utils/assertionFactory.ts` is the shared typed assertion-to-report adapter.
`audits/ComponentAssertionAudit.ts` applies reusable, non-submitting component assertions.

### Layout-shift detection

The framework uses `LAYOUT_MODE=humanVision` by default. In this mode, layout movement is treated
like a senior QA reviewer would treat it: browser CLS is collected, but it is supporting evidence
only. CLS alone does not create a failing finding when no visible element movement is detected.

The framework uses three complementary signals:

1. Browser CLS from `performance.getEntriesByType('layout-shift')` is retained in metrics and evidence.
2. In-load snapshots detect persistent movement after fonts are ready and a visual stability window passes.
3. Equivalent-load snapshots detect server-rendered/random instability that occurs only after reload.

The second rule is required for `/shifting_content/menu`: that page chooses a position during each
request and remains stable afterward, so its browser CLS can correctly be `0` even though users see
the menu jump between visits. Shift evidence records the unique DOM locator plus before/after boxes
and delta. Element, before-state, and post-shift screenshots are attached to the finding.

Human-vision thresholds are configurable in `config/auditConfig.ts` and through `.env`:

- `LAYOUT_MODE=humanVision` or `strict`
- `LAYOUT_WARNING_PX=25`
- `LAYOUT_FAIL_PX=40`
- `LAYOUT_CRITICAL_PX=60`
- `LAYOUT_VIEWPORT_PERCENT=5`
- `LAYOUT_PERSISTENCE_MS=500`
- `LAYOUT_STABILITY_WINDOW_MS=750`
- `LAYOUT_IGNORE_SELECTORS` as a pipe-separated selector list

The default ignore list excludes common dynamic UI such as cookie banners, chat widgets, toast
notifications, advertisements, carousels, spinners, progress bars, and fixed or sticky layers.
Strict mode keeps the legacy detector sensitivity for teams that intentionally want very small
movements reported.

### Visual quality detection

Raster images are compared at their natural and displayed dimensions; enlargement beyond the configured tolerance creates an `Upscaled Image` finding. A luminance-based canvas Laplacian score detects low-sharpness raster assets, with downloaded-byte fallback for cross-origin CDN images that taint a DOM canvas. SVG and animated GIF assets are excluded from blur scoring. Every image-quality finding includes its selector, dimensions or score, expected and actual values, remediation, and screenshot evidence.

Repeated layouts are evaluated for grid/card column alignment, same-row height mismatch, inconsistent horizontal or vertical gaps, and label/input alignment. These checks augment the existing overlap, clipping, overflow, obstruction, empty-container, distortion, and layout-shift detectors.

### Video validation

Native video players and embedded YouTube/Vimeo iframes are validated as user-facing media components. The framework reports realistic playback defects such as missing sources, HTTP failures, incorrect MIME types, unsupported codecs, hidden or clipped players, disabled or unresponsive play controls, blocked autoplay without a manual fallback, stuck loading indicators, black frames, frozen frames, stalled playback, stuck poster overlays, CORS playback failures, and blocked embedded players. Video findings are written to the main website report and `video-report.html` with selector, expected and actual behavior, severity, recommendation, technical details, and available screenshot evidence.

## Configuration

Use `.env` for runtime configuration:

```env
TARGETS_CSV=test-data/audit-targets.csv
MAX_PAGES=75
MAX_DEPTH=4
AUDIT_WORKERS=2
API_VALIDATION_CONCURRENCY=8
IMAGE_BLUR_SHARPNESS_THRESHOLD=24
IMAGE_UPSCALE_TOLERANCE=1.15
CONTEXT_MENU_EXPECTED_ALERT_TEXT=You selected a context menu
AUDIT_FAIL_ON_SEVERITY=Medium
GLOBAL_TIMEOUT_MS=10800000
LINK_CHECK_LIMIT_PER_PAGE=150
SCREENSHOT_MODE=on
LAYOUT_MODE=humanVision
LAYOUT_WARNING_PX=25
LAYOUT_FAIL_PX=40
LAYOUT_CRITICAL_PX=60
LAYOUT_VIEWPORT_PERCENT=5
LAYOUT_PERSISTENCE_MS=500
LAYOUT_STABILITY_WINDOW_MS=750
```

The CSV supports `name,url,enabled,maxPages,maxDepth`. Blank `name` values are generated from the hostname. Blank `maxPages` and `maxDepth` values fall back to `.env`. Rows with `enabled=false` are skipped.

For every target, the framework stays on the same domain, removes duplicate URLs, handles redirects, and skips unsafe or irrelevant URLs such as logout, mailto, tel, JavaScript, checkout, delete, and remove links.

## Architecture

- `crawlers/WebsiteCrawler.ts` discovers the page inventory.
- `audits/` contains visual, responsive, accessibility, SEO, performance, technical, and generic component assertion engines.
- `audits/ContentIntegrityAudit.ts` detects visible raw structural/script tags, encoded HTML, PHP diagnostics, stack traces, unresolved template expressions, and CMS shortcodes while excluding pre/code elements, Markdown fences, syntax-highlighted blocks, and explicit audit opt-outs.
- `validators/` contains header, footer, link, image, video, form, and button validators.
- `validators/ContextMenuValidator.ts` non-destructively verifies context-menu hotspots, right-click dispatch, alert appearance, exact alert text, and alert acceptance.
- `utils/` contains logging, evidence capture, DOM defect detection, severity classification, URL normalization, and file helpers.
- `reporters/HtmlReportGenerator.ts` creates executive and topic-specific HTML reports.
- `fixtures/audit-fixtures.ts` collects browser console and network signals.

## CI/CD

The GitHub Actions workflow runs on pull requests, manual dispatch, and a nightly schedule. Pull requests read `test-data/audit-targets-pr.csv`; scheduled and manual runs read `test-data/audit-targets.csv`. Both CSVs must contain at least one enabled, approved target or setup fails with a clear error.

Every run uploads a `website-audit-reports` artifact containing the custom combined and per-site HTML reports, JSON/XLS summaries, raw results, history, screenshots, traces, and logs. Manual and scheduled runs also publish the interactive `reports/website-audit-report.html` dashboard to GitHub Pages. The **Publish audit dashboard** job summary links to the published dashboard. Pull-request runs remain artifact-only and do not deploy Pages.

The Pages bundle preserves the `reports/` and `screenshots/` layout so relative evidence links in the dashboard work. It includes generated HTML/XLS reports and screenshots, but excludes raw result JSON, logs, and traces. Each deployment replaces the previous Pages dashboard; use the downloadable workflow artifact for a run-specific copy.

To enable deployment, a repository administrator must set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once. The report and screenshots published to Pages are publicly accessible; do not publish audit targets or evidence containing private information.

CI defaults to `AUDIT_FAIL_ON_SEVERITY=Medium` and a three-hour audit timeout. Override these through GitHub Actions repository variables `AUDIT_FAIL_ON_SEVERITY` and `GLOBAL_TIMEOUT_MS`. The job runs the TypeScript build and ESLint before the audit. A generated report is still published when the audit fails its quality gate, and the workflow preserves the audit failure status after deployment.

## Docker

Build and run:

```bash
docker build -t website-audit .
docker run --rm -v "%cd%/test-data:/app/test-data" -v "%cd%/reports:/app/reports" -v "%cd%/screenshots:/app/screenshots" website-audit
```

## Quality Gates

The framework records findings rather than failing the entire audit on every issue. A page returning a server error fails its Playwright test because it prevents meaningful auditing. All other findings are reported with severity and suggested fixes.

Set `AUDIT_FAIL_ON_SEVERITY` to `Medium`, `High`, or `Critical` to fail the final audit when a finding at that severity or higher is present. Set it to `Off` to report findings without failing teardown. The legacy `AUDIT_FAIL_ON_HIGH_SEVERITY=true` setting remains supported and is treated as a `High` threshold when the new setting is absent.
