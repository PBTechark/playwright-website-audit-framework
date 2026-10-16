import { APIRequestContext, Browser, Page } from '@playwright/test';
import { XMLParser } from 'fast-xml-parser';
import { auditConfig } from '../config/auditConfig';
import { Logger } from '../utils/logger';
import { AuditTarget, PageInventoryItem } from '../utils/types';
import { isInternalNavigableUrl, normalizeUrl, uniqueUrls } from '../utils/urlUtils';

interface QueueItem {
  url: string;
  depth: number;
  source: string;
}

export class WebsiteCrawler {
  private readonly logger = new Logger('WebsiteCrawler');
  private readonly parser = new XMLParser({ ignoreAttributes: false });

  constructor(
    private readonly browser: Browser,
    private readonly request: APIRequestContext,
    private readonly target: AuditTarget
  ) {}

  private get baseUrl(): string {
    return this.target.url;
  }

  async crawl(): Promise<PageInventoryItem[]> {
    const discovered = new Map<string, PageInventoryItem>();
    const queued = new Set<string>();
    const queue: QueueItem[] = [{ url: this.baseUrl, depth: 0, source: 'base-url' }];
    const sitemapUrls = await this.discoverSitemapUrls();

    const context = await this.browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    while (queue.length > 0 && discovered.size < this.target.maxPages) {
      const current = queue.shift();
      if (!current || discovered.has(current.url) || current.depth > this.target.maxDepth) {
        continue;
      }

      const result = await this.visitAndExtract(page, current);
      if (!result) {
        continue;
      }
      discovered.set(result.item.url, result.item);
      for (const link of result.links) {
        if (discovered.has(link) || queued.has(link) || queue.length + discovered.size >= this.target.maxPages) {
          continue;
        }
        queue.push({ url: link, depth: current.depth + 1, source: result.item.url });
        queued.add(link);
      }

      // Prioritize links from the user-supplied landing page. A broad or malformed sitemap must
      // not consume maxPages before the directly related navigation links can be inventoried.
      if (current.source === 'base-url') {
        for (const url of sitemapUrls) {
          if (discovered.has(url) || queued.has(url) || queue.length + discovered.size >= this.target.maxPages) {
            continue;
          }
          queue.push({ url, depth: 0, source: 'sitemap' });
          queued.add(url);
        }
      }
    }

    await context.close();
    const inventory = Array.from(discovered.values()).sort((a, b) => a.url.localeCompare(b.url));
    this.logger.info(`Crawled ${inventory.length} internal pages from ${this.target.name} (${this.baseUrl})`);
    return inventory.length > 0
      ? inventory
      : [
          {
            targetName: this.target.name,
            targetBaseUrl: this.baseUrl,
            url: this.baseUrl,
            depth: 0,
            source: 'fallback-base-url'
          }
        ];
  }

  private async visitAndExtract(
    page: Page,
    item: QueueItem
  ): Promise<{ item: PageInventoryItem; links: string[] } | null> {
    try {
      const response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: auditConfig.navigationTimeoutMs });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

      const finalUrl = normalizeUrl(page.url(), this.baseUrl);
      if (!finalUrl || !isInternalNavigableUrl(finalUrl, this.baseUrl)) {
        return null;
      }

      const title = await page.title().catch(() => undefined);
      const links = await this.extractLinks(page);
      return {
        item: {
          targetName: this.target.name,
          targetBaseUrl: this.baseUrl,
          url: finalUrl,
          title,
          depth: item.depth,
          source: item.source,
          status: response?.status(),
          redirectedFrom: finalUrl !== item.url ? item.url : undefined
        },
        links
      };
    } catch (error) {
      this.logger.warn(`Skipping ${item.url}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async extractLinks(page: Page): Promise<string[]> {
    const hrefs = await page.evaluate(() => {
      const selectors = [
        'header a[href]',
        'nav a[href]',
        'footer a[href]',
        '[aria-label*="breadcrumb" i] a[href]',
        '.breadcrumb a[href]',
        'a[href]'
      ];
      return Array.from(document.querySelectorAll<HTMLAnchorElement>(selectors.join(','))).map((anchor) => anchor.href);
    });
    return uniqueUrls(hrefs, this.baseUrl).filter((url) => isInternalNavigableUrl(url, this.baseUrl));
  }

  private async discoverSitemapUrls(): Promise<string[]> {
    const sitemapCandidates = uniqueUrls(
      ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap', '/sitemap.html'].map(
        (path) => new URL(path, this.baseUrl).toString()
      ),
      this.baseUrl
    );
    const results = new Set<string>();

    for (const sitemapUrl of sitemapCandidates) {
      await this.collectSitemapUrls(sitemapUrl, results, 0);
    }

    return Array.from(results).filter((url) => isInternalNavigableUrl(url, this.baseUrl));
  }

  private async collectSitemapUrls(sitemapUrl: string, results: Set<string>, depth: number): Promise<void> {
    if (depth > 3 || results.size >= this.target.maxPages) {
      return;
    }
    try {
      const response = await this.request.get(sitemapUrl, { timeout: 15_000 });
      if (!response.ok()) {
        return;
      }
      const body = await response.text();
      const contentType = response.headers()['content-type'] ?? '';
      if (contentType.includes('xml') || body.trim().startsWith('<?xml') || body.includes('<urlset')) {
        const parsed = this.parser.parse(body) as any;
        const urls = this.arrayFrom(parsed.urlset?.url).map((entry: any) => entry.loc).filter(Boolean);
        const nested = this.arrayFrom(parsed.sitemapindex?.sitemap).map((entry: any) => entry.loc).filter(Boolean);
        for (const url of urls) {
          const normalized = normalizeUrl(String(url), this.baseUrl);
          if (normalized) results.add(normalized);
        }
        for (const url of nested) {
          const normalized = normalizeUrl(String(url), this.baseUrl);
          if (normalized) await this.collectSitemapUrls(normalized, results, depth + 1);
        }
      } else {
        const hrefs = Array.from(body.matchAll(/href=["']([^"']+)["']/gi)).map((match) => match[1]);
        for (const url of uniqueUrls(hrefs, this.baseUrl)) {
          results.add(url);
        }
      }
    } catch (error) {
      this.logger.warn(`Unable to read sitemap ${sitemapUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private arrayFrom<T>(value: T | T[] | undefined): T[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }
}
