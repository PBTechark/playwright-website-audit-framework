import path from 'path';
import dotenv from 'dotenv';
import { Severity, ViewportProfile } from '../utils/types';

dotenv.config();

const rootDir = path.resolve(__dirname, '..');

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFromEnv(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

export type QualityGateSeverity = Exclude<Severity, 'Low'> | 'Off';
export type LayoutShiftMode = 'strict' | 'humanVision';

function qualityGateSeverityFromEnv(): QualityGateSeverity {
  const configured = process.env.AUDIT_FAIL_ON_SEVERITY?.trim().toLowerCase();
  if (configured) {
    if (configured === 'off' || configured === 'none' || configured === 'false') return 'Off';
    if (configured === 'critical') return 'Critical';
    if (configured === 'high') return 'High';
    if (configured === 'medium') return 'Medium';
    throw new Error('AUDIT_FAIL_ON_SEVERITY must be Off, Critical, High, or Medium.');
  }
  // Backward compatibility for existing installations. The legacy name means High or higher.
  return booleanFromEnv('AUDIT_FAIL_ON_HIGH_SEVERITY') ? 'High' : 'Off';
}

function layoutShiftModeFromEnv(): LayoutShiftMode {
  const configured = process.env.LAYOUT_MODE?.trim();
  if (!configured) return 'humanVision';
  const normalized = configured.toLowerCase();
  if (normalized === 'strict') return 'strict';
  if (normalized === 'humanvision') return 'humanVision';
  throw new Error('LAYOUT_MODE must be strict or humanVision.');
}

function listFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

const qualityGateSeverity = qualityGateSeverityFromEnv();
const layoutShiftMode = layoutShiftModeFromEnv();

export const viewportProjects: ViewportProfile[] = [
  { name: 'Desktop Full HD', width: 1920, height: 1080, isMobile: false, hasTouch: false },
  { name: 'Mobile Portrait', width: 393, height: 852, isMobile: true, hasTouch: true },
  { name: 'Mobile Landscape', width: 852, height: 393, isMobile: true, hasTouch: true },
  { name: 'iPad Pro Portrait', width: 1024, height: 1366, isMobile: true, hasTouch: true },
  { name: 'iPad Pro Landscape', width: 1366, height: 1024, isMobile: true, hasTouch: true }
];

export const auditConfig = {
  rootDir,
  targetsCsvPath: path.resolve(rootDir, process.env.TARGETS_CSV ?? path.join('test-data', 'audit-targets.csv')),
  defaultMaxPages: numberFromEnv('MAX_PAGES', 75),
  defaultMaxDepth: numberFromEnv('MAX_DEPTH', 4),
  linkCheckLimitPerPage: numberFromEnv('LINK_CHECK_LIMIT_PER_PAGE', 150),
  apiValidationConcurrency: numberFromEnv('API_VALIDATION_CONCURRENCY', 8),
  imageBlurSharpnessThreshold: numberFromEnv('IMAGE_BLUR_SHARPNESS_THRESHOLD', 24),
  imageUpscaleTolerance: numberFromEnv('IMAGE_UPSCALE_TOLERANCE', 1.15),
  testTimeoutMs: numberFromEnv('TEST_TIMEOUT_MS', 120_000),
  globalTimeoutMs: numberFromEnv('GLOBAL_TIMEOUT_MS', 60 * 60 * 1000),
  actionTimeoutMs: numberFromEnv('ACTION_TIMEOUT_MS', 15_000),
  navigationTimeoutMs: numberFromEnv('NAVIGATION_TIMEOUT_MS', 45_000),
  screenshotMode: process.env.SCREENSHOT_MODE ?? 'on',
  contextMenuExpectedAlertText: process.env.CONTEXT_MENU_EXPECTED_ALERT_TEXT?.trim(),
  layoutShiftMode,
  layoutShift: {
    mode: layoutShiftMode,
    // 0-10 CSS px is effectively invisible to a normal visitor; useful as a diagnostic floor.
    ignorePx: numberFromEnv('LAYOUT_IGNORE_PX', 10),
    // 25-40 CSS px is visible enough to record as a warning, but not automatically a hard failure.
    warningPx: numberFromEnv('LAYOUT_WARNING_PX', 25),
    // 40-60 CSS px is clearly visible to users and should be treated as a failing layout shift.
    failPx: numberFromEnv('LAYOUT_FAIL_PX', 40),
    // More than 60 CSS px is disruptive, especially for navigation, hero, CTA, and form regions.
    criticalPx: numberFromEnv('LAYOUT_CRITICAL_PX', 60),
    // A movement greater than 5% of viewport width or height is severe even when pixel values vary by device.
    viewportPercent: numberFromEnv('LAYOUT_VIEWPORT_PERCENT', 5),
    // Movement must persist for at least 500 ms before it is considered user-visible instability.
    persistenceMs: numberFromEnv('LAYOUT_PERSISTENCE_MS', 500),
    // Wait after fonts are ready so font swaps, hydration, lazy rendering, and CSS settling do not false fail.
    stabilityWindowMs: numberFromEnv('LAYOUT_STABILITY_WINDOW_MS', 750),
    // Legacy in-load threshold for strict mode; keeps the old 20 px movement sensitivity.
    strictMovementPx: numberFromEnv('LAYOUT_STRICT_MOVEMENT_PX', 20),
    // Legacy element-relative threshold for strict mode; keeps the old 8% movement sensitivity.
    strictRelativeMovement: numberFromEnv('LAYOUT_STRICT_RELATIVE_MOVEMENT', 0.08),
    // Legacy reload threshold for strict mode; keeps the old 2 px reload instability sensitivity.
    strictReloadMovementPx: numberFromEnv('LAYOUT_STRICT_RELOAD_MOVEMENT_PX', 2),
    // CLS is supporting evidence only; visible movement plus CLS above 0.10 remains a warning signal.
    clsWarning: numberFromEnv('LAYOUT_CLS_WARNING', 0.1),
    // CLS is supporting evidence only; visible movement plus CLS above 0.25 escalates to a fail.
    clsFail: numberFromEnv('LAYOUT_CLS_FAIL', 0.25),
    ignoreSelectors: listFromEnv('LAYOUT_IGNORE_SELECTORS', [
      '[data-audit-ignore-layout-shift]',
      '[aria-live]',
      '[role="alert"]',
      '[role="status"]',
      '[class*="cookie" i]',
      '[id*="cookie" i]',
      '[class*="consent" i]',
      '[id*="consent" i]',
      '[class*="chat" i]',
      '[id*="chat" i]',
      '[class*="toast" i]',
      '[id*="toast" i]',
      '[class*="support" i]',
      '[class*="floating" i]',
      '[class*="ad-" i]',
      '[id*="ad-" i]',
      '[class*="advert" i]',
      '[class*="carousel" i]',
      '[class*="slider" i]',
      '[class*="swiper" i]',
      '[class*="slick" i]',
      '[aria-roledescription="carousel"]',
      '[class*="spinner" i]',
      '[class*="loader" i]',
      '[class*="progress" i]',
      'progress'
    ]),
    importanceWeights: {
      navigation: numberFromEnv('LAYOUT_IMPORTANCE_NAVIGATION', 5),
      header: numberFromEnv('LAYOUT_IMPORTANCE_HEADER', 5),
      hero: numberFromEnv('LAYOUT_IMPORTANCE_HERO', 5),
      primaryCta: numberFromEnv('LAYOUT_IMPORTANCE_PRIMARY_CTA', 5),
      loginForm: numberFromEnv('LAYOUT_IMPORTANCE_LOGIN_FORM', 5),
      checkout: numberFromEnv('LAYOUT_IMPORTANCE_CHECKOUT', 5),
      payment: numberFromEnv('LAYOUT_IMPORTANCE_PAYMENT', 5),
      search: numberFromEnv('LAYOUT_IMPORTANCE_SEARCH', 4),
      mainContent: numberFromEnv('LAYOUT_IMPORTANCE_MAIN_CONTENT', 4),
      form: numberFromEnv('LAYOUT_IMPORTANCE_FORM', 4),
      interactive: numberFromEnv('LAYOUT_IMPORTANCE_INTERACTIVE', 3),
      media: numberFromEnv('LAYOUT_IMPORTANCE_MEDIA', 2),
      decorative: numberFromEnv('LAYOUT_IMPORTANCE_DECORATIVE', 1),
      default: numberFromEnv('LAYOUT_IMPORTANCE_DEFAULT', 2)
    }
  },
  // Audits are reports by default. Set a threshold only when findings should fail CI.
  qualityGateSeverity,
  /** @deprecated Use qualityGateSeverity. Retained for callers upgrading from v1. */
  failOnHighSeverity: qualityGateSeverity !== 'Off',
  reportsDir: path.join(rootDir, 'reports'),
  historyDir: path.join(rootDir, 'reports', 'history'),
  historyRetention: numberFromEnv('REPORT_HISTORY_RETENTION', 12),
  rawResultsDir: path.join(rootDir, 'reports', 'raw-results'),
  allureResultsDir: path.join(rootDir, 'reports', 'allure-results'),
  screenshotDir: path.join(rootDir, 'screenshots'),
  traceDir: path.join(rootDir, 'traces'),
  logDir: path.join(rootDir, 'logs'),
  inventoryPath: path.join(rootDir, 'test-data', 'page-inventory.json'),
  baselineDir: path.join(rootDir, 'baseline')
};
