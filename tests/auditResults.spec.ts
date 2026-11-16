import { expect, test } from '@playwright/test';
import { buildFindings, buildPages, buildSummary } from '../backend/src/auditResults';
import { createIssue } from '../utils/issueFactory';
import { AuditResult } from '../utils/types';

function resultWithSuggestion(viewport: string): AuditResult {
  const url = 'https://example.com/';
  const issue = createIssue({
    category: 'Buttons',
    url,
    viewport,
    description: 'Clickable button target is smaller than recommended touch size.',
    severity: 'Suggestion',
    suggestedFix: 'Increase the button target size.'
  });
  return {
    targetName: 'example',
    targetBaseUrl: url,
    page: { targetName: 'example', targetBaseUrl: url, url, depth: 0, source: 'seed' },
    viewport,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    screenshots: [],
    issues: [issue]
  };
}

test('suggestions remain separate from bug totals and severity counts', () => {
  const results = [resultWithSuggestion('Desktop'), resultWithSuggestion('Mobile')];
  const summary = buildSummary(
    results,
    ['Desktop', 'Mobile'],
    100
  );

  expect(summary).toMatchObject({
    totalIssues: 0,
    suggestions: 1,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    healthScore: 100
  });
  expect(buildFindings(results)).toHaveLength(2);
  expect(buildFindings(results).every((finding) => finding.severity === 'Suggestion')).toBe(true);
  expect(buildPages(results, ['Desktop', 'Mobile'])[0]).toMatchObject({
    issues: 0,
    suggestions: 1,
    viewports: [
      { viewport: 'Desktop', issues: 0, suggestions: 1 },
      { viewport: 'Mobile', issues: 0, suggestions: 1 }
    ]
  });
});
