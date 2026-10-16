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
    severity: 'Critical',
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
});
