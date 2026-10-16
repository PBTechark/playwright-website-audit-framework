const SKIPPED_PROTOCOLS = ['mailto:', 'tel:', 'javascript:', 'sms:', 'data:', 'blob:'];
const SKIPPED_PATTERNS = [/logout/i, /log-out/i, /signout/i, /sign-out/i, /delete/i, /remove/i, /cart\/checkout/i];
const NON_HTML_EXTENSIONS = /\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|mp3|mp4|mpeg|ogg|pdf|png|pptx?|rar|svg|tar|tiff?|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;

export function normalizeUrl(rawUrl: string, baseUrl: string): string | null {
  if (!rawUrl || rawUrl.trim() === '#') {
    return null;
  }
  try {
    const url = new URL(rawUrl.trim(), baseUrl);
    if (SKIPPED_PROTOCOLS.includes(url.protocol)) {
      return null;
    }
    if (SKIPPED_PATTERNS.some((pattern) => pattern.test(url.toString()))) {
      return null;
    }
    url.hash = '';
    url.searchParams.sort();
    const normalized = url.toString();
    return normalized.endsWith('/') && url.pathname !== '/' ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

export function isSameDomain(candidate: string, baseUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    const url = new URL(candidate, baseUrl);
    return url.hostname === base.hostname && ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export function isInternalNavigableUrl(candidate: string, baseUrl: string): boolean {
  const normalized = normalizeUrl(candidate, baseUrl);
  if (!normalized || !isSameDomain(normalized, baseUrl)) {
    return false;
  }
  return !NON_HTML_EXTENSIONS.test(new URL(normalized).pathname);
}

export function uniqueUrls(urls: string[], baseUrl: string): string[] {
  return Array.from(new Set(urls.map((url) => normalizeUrl(url, baseUrl)).filter((url): url is string => Boolean(url))));
}
