import { Page, Response } from '@playwright/test';
import { BrowserSignalCollector } from '../utils/browserSignals';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue } from '../utils/types';

type Candidate = {
  url: string;
  frameUrl: string;
  source: 'HTTP 421 response' | 'Cloudflare 421 error content';
  status?: number;
  frameName?: string;
};

const ERROR_TITLE = /421\s+misdirected\s+request/i;
const CLOUDFLARE = /\bcloudflare\b/i;

/** Additive detection for Cloudflare 421 pages, including errors rendered inside child frames. */
export async function detectMisdirectedRequests(
  page: Page,
  url: string,
  viewport: string,
  signals: BrowserSignalCollector,
  targetName?: string,
  targetBaseUrl?: string
): Promise<AuditIssue[]> {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: Candidate): void => {
    const key = `${candidate.source}|${candidate.url}|${candidate.frameUrl}|${candidate.status ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  for (const response of signals.responses) {
    if (response.status() !== 421) continue;
    const frame = response.request().frame();
    add({
      url: response.url(),
      frameUrl: frame.url() || response.url(),
      source: 'HTTP 421 response',
      status: 421,
      frameName: frame.name() || undefined
    });
  }

  // A proxy or wrapper may expose HTTP 200 while rendering the origin's Cloudflare 421 body.
  for (const frame of page.frames()) {
    const bodyText = await frame.locator('body').innerText().catch(() => '');
    const title = await frame.title().catch(() => '');
    const content = `${title}\n${bodyText}`;
    if (!ERROR_TITLE.test(content) || !CLOUDFLARE.test(content)) continue;
    add({
      url,
      frameUrl: frame.url() || url,
      source: 'Cloudflare 421 error content',
      frameName: frame.name() || undefined
    });
  }

  return candidates.map((candidate) =>
    createIssue({
      category: 'Deployment',
      targetName,
      targetBaseUrl,
      url,
      viewport,
      description: 'HTTP 421 Misdirected Request detected.',
      severity: 'High',
      expected: 'The main document and embedded frames should render the requested content without a 421 response or Cloudflare 421 error template.',
      actual: `${candidate.source} at ${candidate.frameUrl}${candidate.status ? ` (HTTP ${candidate.status})` : ''}.`,
      businessImpact: 'Users receive a Cloudflare error page instead of the requested content.',
      suggestedFix: 'Verify TLS/SNI, host routing, Cloudflare origin configuration, and the target hostname used by the document or frame.',
      details: candidate
    })
  );
}

/** Test seam for response-only checks without requiring a live browser frame. */
export function responseHasMisdirectedRequest(response: Response): boolean {
  return response.status() === 421;
}
