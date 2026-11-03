import fs from 'fs';
import { chromium, request } from '@playwright/test';
import { auditConfig } from './config/auditConfig';
import { WebsiteCrawler } from './crawlers/WebsiteCrawler';
import { ensureDir, writeJsonFile } from './utils/fileSystem';
import { Logger } from './utils/logger';
import { acquireRunLock } from './utils/runLock';
import { mapWithConcurrency } from './utils/concurrency';
import { readAuditTargets } from './utils/targetCsvReader';
import { PageInventoryItem } from './utils/types';

async function globalSetup(): Promise<void> {
  const logger = new Logger('GlobalSetup');
  // Taken before anything shared is cleared; released by global-teardown.
  acquireRunLock();
  fs.rmSync(auditConfig.rawResultsDir, { recursive: true, force: true });
  // Evidence only belongs to the latest reports (the dashboard copies its own); without this the
  // folder grows with every run.
  fs.rmSync(auditConfig.screenshotDir, { recursive: true, force: true });
  fs.rmSync(auditConfig.linkCacheDir, { recursive: true, force: true });
  ensureDir(auditConfig.linkCacheDir);
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
    // Sites are independent (each crawler has its own browser context), so crawl one per core.
    const perTarget = await mapWithConcurrency(targets, auditConfig.crawlConcurrency, (target) => {
      logger.info(`Crawling ${target.name}: ${target.url}`);
      return new WebsiteCrawler(browser, api, target).crawl();
    });
    const inventory: PageInventoryItem[] = perTarget.flat();
    writeJsonFile(auditConfig.inventoryPath, inventory);
    logger.info(`Page inventory written to ${auditConfig.inventoryPath} with ${inventory.length} page(s)`);
  } finally {
    await api.dispose();
    await browser.close();
  }
}

export default globalSetup;
