import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import { auditConfig, viewportProjects } from './config/auditConfig';

dotenv.config();

export default defineConfig({
  testDir: './tests',
  timeout: auditConfig.testTimeoutMs,
  globalTimeout: auditConfig.globalTimeoutMs,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: Number(process.env.TEST_RETRIES ?? 1),
  workers: process.env.CI ? 2 : Number(process.env.AUDIT_WORKERS ?? 2),
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  reporter: [
    ['list'],
    ['allure-playwright', { outputFolder: auditConfig.allureResultsDir }],
    ['./reporters/maintenance-reporter.ts']
  ],
  use: {
    actionTimeout: auditConfig.actionTimeoutMs,
    navigationTimeout: auditConfig.navigationTimeoutMs,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true
  },
  outputDir: auditConfig.traceDir,
  projects: viewportProjects.map((viewport) => ({
    name: viewport.name,
    use: {
      viewport: viewport.width && viewport.height ? { width: viewport.width, height: viewport.height } : null,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch
    }
  }))
});
