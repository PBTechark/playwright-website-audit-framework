import dns from 'dns/promises';
import net from 'net';
import { backendConfig, viewportProjects } from './config';
import { AuditSettings } from './apiTypes';
import { HttpError } from './httpError';

const MAX_REDIRECTS = 5;
const blockedHostnames = new Set(['localhost', 'metadata.google.internal', 'metadata']);

// Loopback, private, link-local (includes the 169.254.169.254 cloud metadata endpoint),
// carrier-grade NAT, benchmarking, multicast and reserved ranges.
const blockedAddresses = new net.BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
].forEach(([address, prefix]) => blockedAddresses.addSubnet(address as string, prefix as number, 'ipv4'));
[
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
].forEach(([address, prefix]) => blockedAddresses.addSubnet(address as string, prefix as number, 'ipv6'));

/** Validates the request body shape and limits. Network safety is checked by assertPublicUrl(). */
export function parseAuditSettings(body: unknown): AuditSettings {
  const input = (body ?? {}) as Record<string, unknown>;
  const viewportNames = new Set(viewportProjects.map((viewport) => viewport.name));

  const viewports = Array.isArray(input.viewports) ? [...new Set(input.viewports.map(String))] : [];
  if (viewports.length === 0) throw new HttpError(400, 'Select at least one viewport.');
  const unknown = viewports.filter((viewport) => !viewportNames.has(viewport));
  if (unknown.length) throw new HttpError(400, `Unknown viewport: ${unknown.join(', ')}`);

  return {
    url: parseHttpUrl(input.url),
    name: optionalText(input.name, 'Website name', 80),
    label: optionalText(input.label, 'Audit label', 120),
    maxPages: boundedInt(input.maxPages, 'Maximum pages', 1, backendConfig.maxPagesLimit),
    // The engine treats 0 in the targets CSV as "use the default", so depth starts at 1.
    maxDepth: boundedInt(input.maxDepth, 'Maximum depth', 1, backendConfig.maxDepthLimit),
    // Keep the engine's viewport order regardless of click order in the UI.
    viewports: viewportProjects.map((viewport) => viewport.name).filter((name) => viewports.includes(name)),
    screenshots: input.screenshots !== false,
    savedWebsite: typeof input.savedWebsite === 'string' && input.savedWebsite ? input.savedWebsite : null
  };
}

/**
 * Rejects URLs that resolve to loopback, private-network or metadata addresses, and follows the
 * start URL's redirect chain so a public URL cannot bounce the crawler onto an internal host.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  if (backendConfig.allowPrivateTargets) return;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = new URL(current);
    await assertPublicHost(url.hostname);
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      await response.body?.cancel();
    } catch {
      throw new HttpError(400, `Could not reach ${url.origin}. Check the address and try again.`);
    }
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return;
    current = parseHttpUrl(new URL(location, url).toString());
  }
  throw new HttpError(400, `The website redirects more than ${MAX_REDIRECTS} times.`);
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (blockedHostnames.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new HttpError(400, 'Local and internal hosts cannot be audited.');
  }
  let addresses: Array<{ address: string; family: number }>;
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      addresses = await dns.lookup(host, { all: true });
    } catch {
      throw new HttpError(400, `The host ${host} could not be resolved.`);
    }
  }
  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family)) {
      throw new HttpError(400, 'This address points to a private or reserved network and cannot be audited.');
    }
  }
}

function isBlockedAddress(address: string, family: number): boolean {
  const mappedV4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedV4) return blockedAddresses.check(mappedV4[1], 'ipv4');
  return blockedAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

function parseHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'Website URL is required.');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'Enter a full website address, for example https://example.com/');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(400, 'Only http:// and https:// addresses are supported.');
  }
  if (url.username || url.password) throw new HttpError(400, 'Website URLs must not contain credentials.');
  url.hash = '';
  return url.toString();
}

function optionalText(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be text.`);
  const text = value.trim();
  if (text.length > maxLength) throw new HttpError(400, `${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function boundedInt(value: unknown, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (value === '' || value === null || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`);
  }
  return parsed;
}
