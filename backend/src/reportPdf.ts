import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { auditConfig } from './config';

// Minimal shape of the Playwright API used here; the engine's own @playwright/test install provides it.
interface PdfPage {
  route(url: string, handler: (route: { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => void): Promise<void>;
  goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>;
  evaluate(fn: () => Promise<void>): Promise<void>;
  pdf(options: Record<string, unknown>): Promise<unknown>;
}
interface PdfBrowser {
  newPage(options: { colorScheme: 'light' }): Promise<PdfPage>;
  close(): Promise<void>;
}

const playwrightModule = require.resolve('@playwright/test', { paths: [auditConfig.rootDir] });
const inFlight = new Map<string, Promise<void>>();

/**
 * Returns a PDF of an engine HTML report, rendered with Playwright's Chromium and cached next to
 * the report. The page may only load local files: every network request is blocked.
 */
export async function reportPdf(htmlPath: string): Promise<string> {
  const pdfPath = htmlPath.replace(/\.html?$/i, '.pdf');
  const fresh = fs.existsSync(pdfPath) && fs.statSync(pdfPath).mtimeMs >= fs.statSync(htmlPath).mtimeMs;
  if (fresh) return pdfPath;

  let job = inFlight.get(pdfPath);
  if (!job) {
    job = render(htmlPath, pdfPath).finally(() => inFlight.delete(pdfPath));
    inFlight.set(pdfPath, job);
  }
  await job;
  return pdfPath;
}

async function render(htmlPath: string, pdfPath: string): Promise<void> {
  const { chromium } = require(playwrightModule) as { chromium: { launch(): Promise<PdfBrowser> } };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ colorScheme: 'light' });
    await page.route('**/*', (route) => void (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 60_000 });
    // Print everything: open every issue card and load every lazy screenshot before rendering.
    await page.evaluate(async () => {
      document.documentElement.dataset.theme = 'light';
      document.querySelectorAll('.issue > details').forEach((element) => ((element as HTMLDetailsElement).open = true));
      const images = Array.from(document.images);
      images.forEach((image) => (image.loading = 'eager'));
      await Promise.all(
        images.map((image) =>
          image.complete
            ? undefined
            : new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
              })
        )
      );
    });
    const tempPath = `${pdfPath}.${process.pid}.tmp`;
    await page.pdf({
      path: tempPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '16mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:9px;color:#5f6a7d;text-align:center;font-family:sans-serif">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
    });
    fs.renameSync(tempPath, pdfPath);
  } finally {
    await browser.close();
  }
}

/** Download name such as "cvcng-website-audit-report.pdf". */
export function pdfDownloadName(websiteName: string, htmlPath: string): string {
  const site = websiteName.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'website';
  return `${site}-${path.basename(htmlPath).replace(/\.html?$/i, '')}.pdf`;
}
