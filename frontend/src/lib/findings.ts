import type { Finding, Severity } from './api';

/**
 * One issue on one page, with every viewport it was found in. The engine reports each
 * page/viewport pair separately, so the same problem in five viewports arrives as five findings.
 */
export interface IssueGroup {
  key: string;
  severity: Severity;
  category: string;
  url: string;
  title: string;
  summary: string | null;
  findings: Finding[];
  viewports: string[];
}

export function groupFindings(findings: Finding[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const finding of findings) {
    const key = [finding.severity, finding.category, finding.url, finding.description].join('\u0000');
    let group = groups.get(key);
    if (!group) {
      group = { key, severity: finding.severity, category: finding.category, url: finding.url, ...splitTitle(finding.description), findings: [], viewports: [] };
      groups.set(key, group);
    }
    group.findings.push(finding);
    if (!group.viewports.includes(finding.viewport)) group.viewports.push(finding.viewport);
  }
  // Findings arrive sorted by severity, so insertion order keeps the most severe issues first.
  return [...groups.values()];
}

/** "Clipped Text: Text appears clipped…" becomes a short title plus a summary sentence. */
export function splitTitle(description: string): { title: string; summary: string | null } {
  const match = description.match(/^([^:.]{3,48}):\s+(.+)$/s);
  if (!match) return { title: description, summary: null };
  return { title: match[1].trim(), summary: match[2].trim() };
}

/** Separates the engine's "Measured details: {json}" suffix so it can be shown as formatted data. */
export function splitMeasuredDetails(text: string): { text: string; details: string | null } {
  const index = text.indexOf('Measured details:');
  if (index === -1) return { text, details: null };
  const raw = text.slice(index + 'Measured details:'.length).trim().replace(/\.$/, '');
  try {
    return { text: text.slice(0, index).trim(), details: JSON.stringify(JSON.parse(raw), null, 2) };
  } catch {
    return { text, details: null };
  }
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
