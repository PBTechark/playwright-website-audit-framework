import { expect, test } from '@playwright/test';
import { TechnicalAudit } from '../audits/TechnicalAudit';
import { BrowserSignalCollector } from '../utils/browserSignals';

test('deduplicates identical console runtime errors in one viewport', () => {
  const signals = {
    consoleFindings: [
      { type: 'uncaught-exception', text: "Cannot read properties of null (reading 'querySelectorAll')" },
      { type: 'uncaught-exception', text: "Cannot read properties of null (reading 'querySelectorAll')" }
    ],
    networkFindings: []
  } as unknown as BrowserSignalCollector;

  const issues = new TechnicalAudit().run('https://leesfriends.org/about-us', 'Desktop Full HD', signals);

  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({
    category: 'Technical',
    severity: 'Low',
    description: "Console uncaught-exception: Cannot read properties of null (reading 'querySelectorAll')"
  });
});

test('preserves distinct console runtime errors', () => {
  const signals = {
    consoleFindings: [
      { type: 'uncaught-exception', text: "Cannot read properties of null (reading 'querySelectorAll')" },
      { type: 'uncaught-exception', text: "Cannot read properties of null (reading 'classList')" }
    ],
    networkFindings: []
  } as unknown as BrowserSignalCollector;

  const issues = new TechnicalAudit().run('https://leesfriends.org/about-us', 'Desktop Full HD', signals);

  expect(issues).toHaveLength(2);
  expect(new Set(issues.map((issue) => issue.id)).size).toBe(2);
  expect(issues.every((issue) => issue.severity === 'Low')).toBe(true);
});

test('assigns Low severity to all technical network issue types', () => {
  const signals = {
    consoleFindings: [],
    networkFindings: [
      { method: 'GET', url: 'https://example.com/app.js', status: 500, resourceType: 'script' },
      { method: 'GET', url: 'https://example.com/font.woff2', status: 404, resourceType: 'font' }
    ]
  } as unknown as BrowserSignalCollector;

  const issues = new TechnicalAudit().run('https://example.com', 'Desktop', signals);

  expect(issues).toHaveLength(2);
  expect(issues.every((issue) => issue.category === 'Technical' && issue.severity === 'Low')).toBe(true);
});
