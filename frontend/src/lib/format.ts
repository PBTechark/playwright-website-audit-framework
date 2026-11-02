import type { AuditRecord } from './api';

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString();
}

/** "1 page", "3 pages". */
export function plural(count: number | null | undefined, singular: string, pluralForm = `${singular}s`): string {
  const value = count ?? 0;
  return `${value.toLocaleString()} ${value === 1 ? singular : pluralForm}`;
}

export function websiteName(audit: AuditRecord): string {
  if (audit.settings.name) return audit.settings.name;
  try {
    return new URL(audit.settings.url).hostname.replace(/^www\./, '');
  } catch {
    return audit.settings.url;
  }
}

/** Shows a URL without the protocol, for compact tables. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '') || url;
}

/** The path part of a page URL ("/contact-us"), which is what tells pages of one site apart. */
export function pagePath(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return `${pathname}${search}` || '/';
  } catch {
    return url;
  }
}

/** Crawled URLs are shown as links only when they are http(s); anything else is not clickable. */
export function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

const screenshotLabels: Record<string, string> = {
  'full-page': 'Full page',
  'above-fold': 'Above the fold',
  header: 'Header',
  footer: 'Footer'
};

/** Engine screenshot names ("defect-2-Form Label…", "above-fold") as readable captions. */
export function screenshotLabel(label: string): string {
  const known = screenshotLabels[label.toLowerCase()];
  if (known) return known;
  const text = label.replace(/^defect-\d+-/i, '').replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : label;
}
