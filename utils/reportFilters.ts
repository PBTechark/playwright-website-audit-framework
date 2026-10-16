import { AuditCheck, AuditIssue, AuditResult } from './types';

const excludedCategories = new Set<AuditIssue['category']>(['Accessibility', 'SEO', 'Security', 'Performance', 'Forms']);
const excludedCheckComponents = new Set(['Accessibility', 'Heading']);
const excludedCheckNames = [
  /image alternative text/i,
  /form control label/i,
  /\bH1\b/i,
  /meta description/i,
  /canonical/i,
  /open graph/i,
  /robots meta/i
];
const excludedIssueText = [
  /missing alt text/i,
  /alternative text/i,
  /form control label/i,
  /meta description/i,
  /canonical/i,
  /open graph/i,
  /robots meta/i,
  /\bH1\b/i
];
const customerInvisibleIssueText = [
  /image visibility:\s*image exists but is not visible/i,
  /list item visibility:\s*list item is hidden/i,
  /list content:\s*list is empty or contains no readable content/i,
  /list horizontal overflow:\s*list overflows horizontally/i,
  /mobile tap targets are smaller than recommended size/i,
  /button enabled:\s*button is disabled/i,
  /submit control exists:\s*no submit control was found/i,
  /desktop navigation is not visible/i,
  /mobile hamburger menu control is not visible/i,
  /menu visibility:\s*navigation menu is missing or hidden/i,
  /menu link clickable:\s*menu link is hidden or cannot receive pointer input/i,
  /menu link href:\s*menu link has an empty or placeholder href/i
];
const excludedOverlayText = [
  /userway/i,
  /accessibility menu/i,
  /#userwayAccessibilityIcon/i
];

export function isReportableIssue(issue: AuditIssue): boolean {
  if (excludedCategories.has(issue.category)) return false;
  const searchableText = `${issue.description} ${issue.selector ?? ''} ${issue.expected ?? ''} ${issue.actual ?? ''} ${issue.suggestedFix ?? ''}`;
  if (excludedOverlayText.some((pattern) => pattern.test(searchableText))) return false;
  if (customerInvisibleIssueText.some((pattern) => pattern.test(searchableText))) return false;
  if (issue.category === 'Images' && /renderedSuccessfully[":=]\s*true/i.test(JSON.stringify(issue.details ?? ''))) return false;
  if (issue.category === 'Technical') {
    return issue.severity === 'Critical' && /uncaught|pageerror|javascript/i.test(searchableText);
  }
  return !excludedIssueText.some((pattern) => pattern.test(searchableText));
}

export function isReportableCheck(check: AuditCheck): boolean {
  if (excludedCheckComponents.has(check.component)) return false;
  const searchableText = `${check.component} ${check.checkName} ${check.selector ?? ''} ${check.expected} ${check.actual} ${check.comment} ${check.recommendation ?? ''}`;
  if (excludedOverlayText.some((pattern) => pattern.test(searchableText))) return false;
  return !excludedCheckNames.some((pattern) => pattern.test(searchableText));
}

export function sanitizeAuditResultForReporting(result: AuditResult): AuditResult {
  return {
    ...result,
    issues: result.issues.filter(isReportableIssue),
    checks: result.checks?.filter(isReportableCheck)
  };
}
