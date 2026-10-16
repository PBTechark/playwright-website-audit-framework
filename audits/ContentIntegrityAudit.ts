import { Page } from '@playwright/test';
import { recordAssertion } from '../utils/assertionFactory';
import { EvidenceManager } from '../utils/evidence';
import { AuditCheck, AuditIssue, ScreenshotEvidence, Severity } from '../utils/types';

type ContentPattern = {
  id: string;
  checkName: string;
  severity: Severity;
  expected: string;
  failComment: string;
  recommendation: string;
  source: string;
  flags: string;
};

type ContentMatch = {
  patternId: string;
  match: string;
  snippet: string;
  selector: string;
  boundingBox: { x: number; y: number; width: number; height: number };
};

const CONTENT_PATTERNS: ContentPattern[] = [
  {
    id: 'visible-div', checkName: 'Visible raw <div> tag', severity: 'High',
    expected: 'Raw <div> markup is never displayed as page text',
    failComment: 'Raw <div> markup is visible to users.',
    recommendation: 'Correct CMS escaping or template output so the div is rendered as markup instead of text.',
    source: '<\\s*\\/?\\s*div(?:\\s[^<>]*?)?\\s*>', flags: 'gi'
  },
  {
    id: 'visible-script', checkName: 'Visible raw <script> tag', severity: 'Critical',
    expected: 'Raw <script> markup is never displayed as page text',
    failComment: 'Raw <script> markup is visible to users.',
    recommendation: 'Fix template escaping and review the affected content for unsafe script injection.',
    source: '<\\s*\\/?\\s*script(?:\\s[^<>]*?)?\\s*>', flags: 'gi'
  },
  {
    id: 'visible-structural-html', checkName: 'Visible raw structural HTML tag', severity: 'High',
    expected: 'Raw structural HTML markup is never displayed as page text',
    failComment: 'Raw structural HTML markup is visible to users.',
    recommendation: 'Correct CMS escaping or template output so structural tags are rendered rather than displayed.',
    source: '<\\s*\\/?\\s*(?:span|p|body|html|h[1-6]|br|section|article|ul|ol|li)(?:\\s[^<>]*?)?\\s*>', flags: 'gi'
  },
  {
    id: 'encoded-html', checkName: 'Visible encoded HTML entity', severity: 'High',
    expected: 'Encoded structural HTML such as &lt;h1&gt; is not displayed literally',
    failComment: 'Encoded HTML markup is displayed instead of rendered content.',
    recommendation: 'Correct double escaping or CMS field rendering for the affected content.',
    source: '&lt;\\s*\\/?\\s*(?:h[1-6]|div|p|br|script|section|article|span|ul|ol|li)(?:\\s[^&]*?)?&gt;', flags: 'gi'
  },
  {
    id: 'php-warning', checkName: 'PHP warning exposure', severity: 'Critical',
    expected: 'No PHP warning, notice, parse error, or fatal error is exposed to users',
    failComment: 'A PHP runtime warning or error is visible on the page.',
    recommendation: 'Disable production error display, fix the PHP error, and send diagnostics to protected server logs.',
    source: '(?:PHP\\s+)?(?:Warning|Notice|Parse error|Fatal error|Deprecated)\\s*:', flags: 'gi'
  },
  {
    id: 'stack-trace', checkName: 'Stack trace exposure', severity: 'Critical',
    expected: 'Application stack traces are not exposed to users',
    failComment: 'An application stack trace is visible on the page.',
    recommendation: 'Replace diagnostic output with a safe error page and retain stack traces only in protected logs.',
    source: '(?:Stack trace\\s*:|Traceback \\(most recent call last\\)|(?:^|\\s)#0\\s+[^\\n]+|at\\s+[\\w.$<>]+\\s*\\([^\\n]+:\\d+:\\d+\\))', flags: 'gim'
  },
  {
    id: 'template-syntax', checkName: 'Unresolved template syntax', severity: 'High',
    expected: 'Template expressions are resolved before content reaches the user',
    failComment: 'Unresolved template syntax is visible on the page.',
    recommendation: 'Verify template compilation, variable binding, CMS caching, and deployment artifacts.',
    source: '(?:\\{\\{[^{}\\n]+\\}\\}|\\$\\{[^{}\\n]+\\}|<%[=-]?[\\s\\S]*?%>)', flags: 'g'
  },
  {
    id: 'cms-shortcode', checkName: 'Unresolved CMS shortcode', severity: 'High',
    expected: 'CMS shortcodes are expanded into their intended components',
    failComment: 'An unresolved CMS shortcode is visible on the page.',
    recommendation: 'Verify the shortcode plugin, CMS rendering pipeline, caching, and content migration.',
    source: '\\[[a-z][\\w-]*(?:\\s+[^\\]\\n]*)?\\]', flags: 'gi'
  }
];

/** Detects server/CMS/template corruption in visible user-facing text. */
export class ContentIntegrityAudit {
  async run(
    page: Page,
    url: string,
    viewport: string,
    targetName: string | undefined,
    pageEvidence: string[]
  ): Promise<{ checks: AuditCheck[]; issues: AuditIssue[]; screenshots: ScreenshotEvidence[] }> {
    const matches = await page.evaluate((patterns) => {
      const excluded = [
        'script', 'style', 'noscript', 'template', 'code', 'pre', 'kbd', 'samp', 'textarea', 'input',
        '[contenteditable="true"]', '[data-audit-allow-raw-content]',
        '.hljs', '.highlight', '.codehilite', '.syntaxhighlighter',
        '[class*="language-"]', '[class*="syntax-highlight"]', '[data-highlighted="yes"]', '[data-language]'
      ].join(',');
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const parts: string[] = [];
        let node: Element | null = element;
        while (node && node !== document.body && parts.length < 6) {
          const siblings = node.parentElement
            ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName)
            : [];
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`);
          node = node.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      };
      const visible = (element: HTMLElement): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number(style.opacity) > 0;
      };
      const results: ContentMatch[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode()) && results.length < 100) {
        const parent = node.parentElement;
        const text = node.textContent ?? '';
        if (!parent || !text.trim() || parent.closest(excluded) || !visible(parent)) continue;
        // Preserve character offsets while masking Markdown fenced examples. This lets snippets
        // still refer to the original text without treating documentation samples as corruption.
        const scanText = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, (fence) => ' '.repeat(fence.length));
        for (const pattern of patterns) {
          const regex = new RegExp(pattern.source, pattern.flags);
          for (const found of scanText.matchAll(regex)) {
            const value = found[0];
            const index = found.index ?? 0;
            const rect = parent.getBoundingClientRect();
            results.push({
              patternId: pattern.id,
              match: value.slice(0, 300),
              snippet: text.slice(Math.max(0, index - 80), Math.min(text.length, index + value.length + 80)).trim(),
              selector: selectorFor(parent),
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            });
            if (results.length >= 100) break;
          }
          if (results.length >= 100) break;
        }
      }
      return results;
    }, CONTENT_PATTERNS.map(({ id, source, flags }) => ({ id, source, flags })));

    const checks: AuditCheck[] = [];
    const issues: AuditIssue[] = [];
    const screenshots: ScreenshotEvidence[] = [];
    const evidenceManager = new EvidenceManager(page, url, viewport, targetName);
    const elementEvidence = new Map<string, string>();
    for (const match of matches.slice(0, 12)) {
      if (elementEvidence.has(match.selector)) continue;
      const shot = await evidenceManager.captureLocator(
        `content-integrity-${match.patternId}-${elementEvidence.size + 1}`,
        page.locator(match.selector).first()
      ).catch(() => null);
      if (shot) {
        screenshots.push(shot);
        elementEvidence.set(match.selector, shot.path);
      }
    }

    for (const pattern of CONTENT_PATTERNS) {
      const patternMatches = matches.filter((item) => item.patternId === pattern.id);
      const first = patternMatches[0];
      const evidence = [
        ...pageEvidence,
        ...Array.from(new Set(patternMatches.map((item) => elementEvidence.get(item.selector)).filter((item): item is string => Boolean(item))))
      ];
      const recorded = recordAssertion({
        component: 'Content Integrity',
        checkName: pattern.checkName,
        passed: patternMatches.length === 0,
        severity: pattern.severity,
        url,
        viewport,
        expected: pattern.expected,
        actual: patternMatches.length === 0
          ? 'No visible matches found'
          : `${patternMatches.length} match(es): ${patternMatches.map((item) => `"${item.match}"`).join(', ')}`,
        passComment: `${pattern.checkName} check passed.`,
        failComment: pattern.failComment,
        recommendation: pattern.recommendation,
        selector: first?.selector,
        boundingBox: first?.boundingBox,
        evidence: patternMatches.length > 0 ? evidence : undefined,
        details: { matches: patternMatches }
      });
      checks.push(recorded.check);
      if (recorded.issue) issues.push(recorded.issue);
    }

    return { checks, issues, screenshots };
  }
}
