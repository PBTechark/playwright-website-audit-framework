import { AuditCategory, Severity } from './types';

export function classifySeverity(category: AuditCategory, message: string, details: Record<string, unknown> = {}): Severity {
  const text = `${category} ${message}`.toLowerCase();
  const status = Number(details.statusCode ?? details.status);

  if (
    text.includes('missing css') ||
    text.includes('hidden content') ||
    text.includes('broken layout') ||
    text.includes('uncaught') ||
    status >= 500
  ) {
    return 'Critical';
  }
  if (
    text.includes('404') ||
    text.includes('broken image') ||
    text.includes('broken navigation') ||
    text.includes('horizontal scroll') ||
    text.includes('footer obstruction') ||
    text.includes('layout shift') ||
    text.includes('content shift') ||
    text.includes('image shift') ||
    text.includes('misalignment') ||
    text.includes('element overlap') ||
     text.includes('overlap') ||
    text.includes('clipped text') ||
    text.includes('off-screen') ||
    status >= 400
  ) {
    return 'High';
  }
  if (
    text.includes('missing alt') ||
    text.includes('missing meta') ||
    text.includes('missing label') ||
    text.includes('contrast') ||
    text.includes('slow')
  ) {
    return 'Medium';
  }
  return 'Low';
}
