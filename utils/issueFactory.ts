import crypto from 'crypto';
import { AuditCategory, AuditIssue, Severity } from './types';
import { classifySeverity } from './severityEngine';

export function createIssue(input: {
  category: AuditCategory;
  targetName?: string;
  targetBaseUrl?: string;
  url: string;
  viewport: string;
  description: string;
  selector?: string;
  severity?: Severity;
  evidence?: string[];
  evidenceDetails?: AuditIssue['evidenceDetails'];
  expected?: string;
  actual?: string;
  businessImpact?: string;
  suggestedFix: string;
  browser?: string;
  device?: string;
  timestamp?: string;
  details?: unknown;
}): AuditIssue {
  const basis = `${input.category}|${input.url}|${input.viewport}|${input.description}|${input.selector ?? ''}`;
  const detailsForSeverity =
    input.details && typeof input.details === 'object' && !Array.isArray(input.details)
      ? (input.details as Record<string, unknown>)
      : {};
  return {
    id: crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12),
    category: input.category,
    severity: input.severity ?? classifySeverity(input.category, input.description, detailsForSeverity),
    targetName: input.targetName,
    targetBaseUrl: input.targetBaseUrl,
    url: input.url,
    viewport: input.viewport,
    description: input.description,
    selector: input.selector,
    evidence: input.evidence,
    evidenceDetails: input.evidenceDetails,
    expected: input.expected,
    actual: input.actual,
    businessImpact: input.businessImpact,
    suggestedFix: input.suggestedFix,
    browser: input.browser,
    device: input.device,
    timestamp: input.timestamp,
    details: input.details
  };
}
