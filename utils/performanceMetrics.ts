import { Page } from '@playwright/test';
import { BrowserSignalCollector } from './browserSignals';
import { PerformanceMetrics } from './types';

export async function collectPerformanceMetrics(
  page: Page,
  signals: BrowserSignalCollector
): Promise<PerformanceMetrics> {
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType('paint') as PerformancePaintTiming[];
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const lcpEntry = performance.getEntriesByType('largest-contentful-paint').pop() as PerformanceEntry | undefined;
    const cls = performance
      .getEntriesByType('layout-shift')
      .filter((entry: any) => !entry.hadRecentInput)
      .reduce((sum: number, entry: any) => sum + Number(entry.value ?? 0), 0);

    return {
      loadTimeMs: nav ? Math.round(nav.loadEventEnd - nav.startTime) : 0,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : 0,
      firstContentfulPaintMs: paint.find((entry) => entry.name === 'first-contentful-paint')?.startTime,
      largestContentfulPaintMs: lcpEntry?.startTime,
      cumulativeLayoutShift: cls,
      totalResourceBytes: resources.reduce(
        (sum, entry) => sum + Number(entry.transferSize || entry.encodedBodySize || 0),
        0
      )
    };
  });

  return {
    ...timing,
    firstContentfulPaintMs: timing.firstContentfulPaintMs
      ? Math.round(timing.firstContentfulPaintMs)
      : timing.firstContentfulPaintMs,
    largestContentfulPaintMs: timing.largestContentfulPaintMs
      ? Math.round(timing.largestContentfulPaintMs)
      : timing.largestContentfulPaintMs,
    cumulativeLayoutShift:
      timing.cumulativeLayoutShift === undefined ? undefined : Number(timing.cumulativeLayoutShift.toFixed(3)),
    totalRequests: signals.requests.length
  };
}
