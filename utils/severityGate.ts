import type { QualityGateSeverity } from '../config/auditConfig';
import type { Severity } from './types';

const severityRank: Record<Severity, number> = {
  Critical: 3,
  High: 2,
  Medium: 1,
  Low: 0
};

export function isBlockingSeverity(severity: Severity, threshold: QualityGateSeverity): boolean {
  return threshold !== 'Off' && severityRank[severity] >= severityRank[threshold];
}

export function qualityGateLabel(threshold: QualityGateSeverity): string {
  return threshold === 'Off' ? 'disabled' : `${threshold} or higher`;
}
