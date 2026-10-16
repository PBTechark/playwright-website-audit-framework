import { test as base } from '@playwright/test';
import { BrowserSignalCollector } from '../utils/browserSignals';

export const test = base.extend<{ signals: BrowserSignalCollector }>({
  signals: async ({ page }, use) => {
    const collector = new BrowserSignalCollector();
    collector.attach(page);
    await use(collector);
  }
});

export { expect } from '@playwright/test';
