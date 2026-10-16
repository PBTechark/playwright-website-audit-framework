import crypto from 'crypto';
import { AuditCheck, AuditIssue, Severity } from './types';
import { createIssue } from './issueFactory';

export interface AssertionInput {
  component: string;
  checkName: string;
  passed: boolean;
  severity: Severity;
  url: string;
  viewport: string;
  expected: string;
  actual: string;
  passComment: string;
  failComment: string;
  recommendation: string;
  selector?: string;
  evidence?: string[];
  boundingBox?: AuditCheck['boundingBox'];
  responseStatus?: number;
  consoleLogs?: string[];
  details?: unknown;
}

export function recordAssertion(input: AssertionInput): { check: AuditCheck; issue?: AuditIssue } {
  const result = input.passed ? 'PASS' : 'FAIL';
  const comment = input.passed ? input.passComment : input.failComment;
  const basis = `${input.component}|${input.checkName}|${input.url}|${input.viewport}|${input.selector ?? ''}`;
  const check: AuditCheck = {
    id: crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12),
    component: input.component,
    checkName: input.checkName,
    result,
    severity: input.severity,
    url: input.url,
    viewport: input.viewport,
    expected: input.expected,
    actual: input.actual,
    comment,
    recommendation: input.passed ? undefined : input.recommendation,
    selector: input.selector,
    evidence: input.evidence,
    boundingBox: input.boundingBox,
    responseStatus: input.responseStatus,
    consoleLogs: input.consoleLogs,
    timestamp: new Date().toISOString()
  };
  if (input.passed) return { check };
  return {
    check,
    issue: createIssue({
      category: componentCategory(input.component),
      url: input.url,
      viewport: input.viewport,
      selector: input.selector,
      severity: input.severity,
      description: `${input.checkName}: ${comment}`,
      expected: input.expected,
      actual: input.actual,
      suggestedFix: input.recommendation,
      evidence: input.evidence,
      timestamp: check.timestamp,
      details: { boundingBox: input.boundingBox, responseStatus: input.responseStatus, assertion: input.details }
    })
  };
}

function componentCategory(component: string): AuditIssue['category'] {
  const match: Record<string, AuditIssue['category']> = {
    Navigation: 'Header', Image: 'Images', List: 'Visual', Form: 'Forms', Button: 'Buttons',
    Link: 'Links', Heading: 'SEO', Footer: 'Footer', Layout: 'Visual', Accessibility: 'Accessibility',
    Performance: 'Performance', 'Context Menu': 'Interactions', 'Content Integrity': 'Content', Video: 'Videos'
  };
  return match[component] ?? 'Technical';
}
