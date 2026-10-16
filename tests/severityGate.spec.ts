import { expect, test } from '@playwright/test';
import { isBlockingSeverity } from '../utils/severityGate';

test('quality gate supports Medium, High, Critical, and Off thresholds', () => {
  expect(isBlockingSeverity('Medium', 'Medium')).toBe(true);
  expect(isBlockingSeverity('High', 'Medium')).toBe(true);
  expect(isBlockingSeverity('Medium', 'High')).toBe(false);
  expect(isBlockingSeverity('Critical', 'High')).toBe(true);
  expect(isBlockingSeverity('High', 'Critical')).toBe(false);
  expect(isBlockingSeverity('Critical', 'Critical')).toBe(true);
  expect(isBlockingSeverity('Critical', 'Off')).toBe(false);
});
