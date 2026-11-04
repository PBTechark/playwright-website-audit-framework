import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import { auditConfig, viewportProjects } from './config/auditConfig';

dotenv.config();

export default defineConfig({
  testDir: './tests',
  // Unit specs run separately via `npm run test:unit` (playwright.unit.config.ts).
  testMatch: 'website-audit.spec.ts',
  timeout: auditConfig.testTimeoutMs,
  globalTimeout: auditConfig.globalTimeoutMs,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: auditConfig.testRetries,
  workers: process.env.CI ? 2 : Number(process.env.AUDIT_WORKERS ?? 2),
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  reporter: [
    ['list'],
    ['allure-playwright', { outputFolder: auditConfig.allureResultsDir }],
    ['./reporters/maintenance-reporter.ts'],
    // Live progress events for the dashboard backend; inactive for command-line runs.
    ...(process.env.AUDIT_PROGRESS_FILE ? [['./reporters/progress-reporter.ts'] as [string]] : [])
  ],
  use: {
    actionTimeout: auditConfig.actionTimeoutMs,
    navigationTimeout: auditConfig.navigationTimeoutMs,
    screenshot: 'only-on-failure',
    trace: auditConfig.traceMode,
    video: auditConfig.videoMode,
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
