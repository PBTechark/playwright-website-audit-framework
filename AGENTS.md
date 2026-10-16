Act as a Principal QA Automation Architect, Senior SDET, and Website Audit Framework Designer with 15+ years of experience in enterprise automation.
Your task is to generate a COMPLETE production-ready Playwright + TypeScript Website Audit Framework that automatically performs visual, responsive, UI, accessibility, SEO, performance, and technical audits for any website.
The framework must mimic a highly experienced manual QA engineer performing a full website review.
========================================================= OBJECTIVE =========================================================
I will provide only:
BASE_URL=https://example.com
The framework must:
1.	Automatically crawl the entire website.
2.	Discover all internal pages.
3.	Generate tests dynamically.
4.	Audit all discovered pages.
5.	Generate detailed reports with screenshots and evidence.
6.	Require ZERO manual page object creation.
No page-specific coding should be required.
========================================================= TECH STACK =========================================================
•	Playwright Latest
•	TypeScript
•	NodeJS
•	Playwright Test Runner
•	Axe-Core Accessibility
•	Allure Reporting
•	HTML Reporting
•	Trace Viewer
•	ESLint
•	Prettier
•	GitHub Actions
•	Docker Support
========================================================= FRAMEWORK ARCHITECTURE =========================================================
Generate complete framework structure:
project-root/
├── config/ ├── fixtures/ ├── pages/ ├── tests/ ├── utils/ ├── crawlers/ ├── validators/ ├── audits/ ├── reports/ ├── screenshots/ ├── traces/ ├── logs/ ├── test-data/ ├── baseline/ ├── playwright.config.ts ├── package.json ├── tsconfig.json ├── .env ├── README.md
========================================================= AUTOMATIC WEBSITE DISCOVERY =========================================================
Framework must automatically discover pages from:
•	Header Navigation
•	Footer Navigation
•	Sitemap.xml
•	Internal Links
•	Breadcrumbs
•	XML Sitemaps
•	HTML Sitemaps
Requirements:
•	Same domain only
•	Avoid external URLs
•	Remove duplicates
•	Handle redirects
•	Skip logout links
•	Skip mailto links
•	Skip tel links
Generate page inventory automatically.
========================================================= VIEWPORT COVERAGE =========================================================
Execute audits in:
Desktop: Browser Default
Mobile Portrait: 393 x 852
Mobile Landscape: 852 x 393
iPad Pro Portrait: 1024 x 1366
iPad Pro Landscape: 1366 x 1024
Generate separate findings for every viewport.
========================================================= FULL VISUAL AUDIT =========================================================
For every discovered page:
Capture:
•	Full Page Screenshot
•	Above Fold Screenshot
•	Header Screenshot
•	Footer Screenshot
Detect:
•	Broken layout
•	Layout shifts
•	Misalignment
•	Hidden content
•	Clipped text
•	Truncated text
•	Text overlap
•	Element overlap
•	Off-screen elements
•	Cut-off buttons
•	Cut-off images
•	Excessive whitespace
•	Empty containers
•	Broken cards
•	Responsive defects
•	Grid collapse issues
•	Flexbox wrapping issues
•	Content outside viewport
•	Unexpected scrollbars
Store screenshots as evidence.
========================================================= ADVANCED AI-LIKE UI DEFECT DETECTION =========================================================
Create utility modules to automatically detect:
Overlapping Elements
•	Bounding box collision detection
•	Z-index conflicts
•	Content overlap
Viewport Issues
•	Horizontal scroll
•	Off-screen content
•	Overflowing containers
Alignment Issues
•	Misaligned buttons
•	Misaligned cards
•	Uneven spacing
•	Broken grid systems
Typography Issues
•	Clipped text
•	Hidden text
•	Text overflow
•	Font loading failures
Image Issues
•	Stretched images
•	Missing images
•	Broken images
•	Distorted aspect ratio
Component Issues
•	Empty cards
•	Empty sections
•	Empty CTA blocks
•	Missing hero content
Flag all issues automatically.
========================================================= HEADER VALIDATION =========================================================
Desktop:
Verify:
•	Logo visible
•	Navigation visible
•	Dropdown menus work
•	Mega menu works
•	Sticky header behavior
•	Search functionality visible
Mobile:
Verify:
•	Hamburger menu visible
•	Hamburger menu opens
•	Menu items accessible
•	No clipped menu items
========================================================= FOOTER VALIDATION =========================================================
Verify:
•	Footer visible
•	Footer links visible
•	Footer layout intact
•	Social icons visible
•	Copyright visible
========================================================= LINK VALIDATION =========================================================
Validate every internal link.
Capture:
•	Source Page
•	Destination URL
•	Status Code
Report:
•	404
•	500
•	Redirect Chains
•	Infinite Redirects
•	Broken Anchors
========================================================= IMAGE VALIDATION =========================================================
Validate:
•	Missing image source
•	404 image
•	Empty image
•	Broken image rendering
•	Missing alt text
Report:
•	URL
•	Image Path
•	Failure Type
========================================================= FORM VALIDATION =========================================================
Detect all forms automatically.
Validate:
•	Form visible
•	Labels visible
•	Inputs visible
•	Required indicators visible
Validate:
•	Name field
•	Email field
•	Phone field
•	Select field
•	Checkbox field
•	Radio field
DO NOT:
•	Submit forms
•	Trigger emails
•	Trigger payments
•	Create records
UI validation only.
========================================================= BUTTON VALIDATION =========================================================
Validate:
•	Visible
•	Enabled
•	Clickable
•	Proper label
•	No overlap
========================================================= RESPONSIVE TESTING =========================================================
Desktop
Validate:
•	Full layout integrity
Mobile
Validate:
•	Menu behavior
•	Readability
•	Tap targets
•	Content alignment
iPad
Validate:
•	Scaling
•	Adaptation
•	Layout preservation
Report responsive defects separately.
========================================================= CONSOLE VALIDATION =========================================================
Capture:
•	JavaScript Errors
•	Console Errors
•	Warnings
•	Uncaught Exceptions
========================================================= NETWORK VALIDATION =========================================================
Capture:
•	Failed Requests
•	Missing CSS
•	Missing JS
•	Missing Fonts
•	404 Resources
========================================================= ACCESSIBILITY AUDIT =========================================================
Integrate Axe-Core.
Validate:
•	WCAG violations
•	Missing labels
•	Missing landmarks
•	Missing alt text
•	Color contrast issues
•	Keyboard navigation issues
Generate accessibility report.
========================================================= SEO AUDIT =========================================================
Validate:
•	Page Title
•	Meta Description
•	Canonical
•	H1
•	Open Graph Tags
•	Robots Meta
Generate SEO findings.
========================================================= PERFORMANCE AUDIT =========================================================
Capture:
•	Load Time
•	DOM Ready
•	FCP
•	LCP
•	CLS
•	Total Requests
•	Resource Size
========================================================= SEVERITY ENGINE =========================================================
Classify every issue:
Critical High Medium Low
Examples:
Critical
•	Broken layout
•	Hidden content
•	Missing CSS
High
•	Broken image
•	Broken navigation
•	404 page
Medium
•	Missing alt text
•	Missing metadata
Low
•	Minor spacing issue
========================================================= REPORTING =========================================================
Generate:
website-audit-report.html
Executive Summary
Total Pages Crawled Total Issues Critical Issues High Issues Medium Issues Low Issues
Include:
•	Screenshots
•	Issue Description
•	URL
•	Severity
•	Viewport
•	Suggested Fix
Generate additional reports:
broken-links-report.html broken-images-report.html responsive-report.html accessibility-report.html seo-report.html performance-report.html
========================================================= CI/CD =========================================================
Generate GitHub Actions workflow.
Support:
npm run audit
Nightly execution.
========================================================= QUALITY REQUIREMENTS =========================================================
•	Strict TypeScript
•	Enterprise standards
•	Modular architecture
•	Reusable utilities
•	Detailed logging
•	Retry mechanism
•	Error handling
•	Parallel execution
========================================================= DELIVERABLE =========================================================
Generate COMPLETE SOURCE CODE.
Do not provide pseudocode.
Do not provide placeholders.
Generate every file required for immediate execution.
After:
npm install npx playwright install
I must be able to execute:
npm run audit
and receive a complete automated website audit report.
