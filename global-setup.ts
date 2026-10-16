import fs from 'fs';
import { chromium, request } from '@playwright/test';
import { auditConfig } from './config/auditConfig';
import { WebsiteCrawler } from './crawlers/WebsiteCrawler';
import { ensureDir, writeJsonFile } from './utils/fileSystem';
import { Logger } from './utils/logger';
import { readAuditTargets } from './utils/targetCsvReader';
import { PageInventoryItem } from './utils/types';

async function globalSetup(): Promise<void> {
  const logger = new Logger('GlobalSetup');
  fs.rmSync(auditConfig.rawResultsDir, { recursive: true, force: true });
  [
    auditConfig.reportsDir,
    auditConfig.rawResultsDir,
    auditConfig.screenshotDir,
    auditConfig.traceDir,
    auditConfig.logDir,
    auditConfig.baselineDir
  ].forEach(ensureDir);

  const targets = readAuditTargets();
  logger.info(`Starting website discovery for ${targets.length} enabled CSV target(s)`);
  const browser = await chromium.launch();
  const api = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const inventory: PageInventoryItem[] = [];
    for (const target of targets) {
      logger.info(`Crawling ${target.name}: ${target.url}`);
      const crawler = new WebsiteCrawler(browser, api, target);
      inventory.push(...(await crawler.crawl()));
    }
    writeJsonFile(auditConfig.inventoryPath, inventory);
    logger.info(`Page inventory written to ${auditConfig.inventoryPath} with ${inventory.length} page(s)`);
  } finally {
    await api.dispose();
    await browser.close();
  }
}

export default globalSetup;
