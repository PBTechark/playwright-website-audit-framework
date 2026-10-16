import { Locator, Page } from '@playwright/test';

export class GenericPage {
  constructor(readonly page: Page) {}

  header(): Locator {
    return this.page.locator('header, [role="banner"], nav').first();
  }

  footer(): Locator {
    return this.page.locator('footer, [role="contentinfo"]').first();
  }

  main(): Locator {
    return this.page.locator('main, [role="main"], body').first();
  }
}
