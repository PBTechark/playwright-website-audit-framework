import { Page } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { Severity } from './types';

export interface DomDefect {
  type: string;
  selector: string;
  description: string;
  severity?: Severity;
  details: Record<string, unknown>;
}

type LayoutRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

type LayoutSnapshotItem = {
  key: string;
  selector: string;
  tag: string;
  rect: LayoutRect;
  hasImage: boolean;
  isAnimated: boolean;
  ignored: boolean;
  ignoreReason?: string;
  importanceScore: number;
  importanceCategory: string;
  viewportCoveragePercent: number;
  interactionAffected: boolean;
  viewportWidth: number;
  viewportHeight: number;
};

type LayoutShiftRuntimeConfig = typeof auditConfig.layoutShift;

async function waitForHumanVisualStability(page: Page, config: LayoutShiftRuntimeConfig): Promise<void> {
  await page
    .evaluate(async () => {
      const fonts = document.fonts;
      if (fonts?.ready) await fonts.ready;
    })
    .catch(() => undefined);
  await page.waitForTimeout(config.stabilityWindowMs).catch(() => undefined);
}

async function collectCumulativeLayoutShift(page: Page): Promise<number> {
  return page
    .evaluate(() =>
      performance
        .getEntriesByType('layout-shift')
        .filter((entry: any) => !entry.hadRecentInput)
        .reduce((sum: number, entry: any) => sum + Number(entry.value ?? 0), 0)
    )
    .then((value) => Number(value.toFixed(3)))
    .catch(() => 0);
}

async function collectLayoutShiftSnapshot(
  page: Page,
  config: LayoutShiftRuntimeConfig
): Promise<LayoutSnapshotItem[]> {
  return page.evaluate((runtimeConfig) => {
    type SnapshotItem = {
      key: string;
      selector: string;
      tag: string;
      rect: {
        left: number;
        top: number;
        width: number;
        height: number;
        right: number;
        bottom: number;
      };
      hasImage: boolean;
      isAnimated: boolean;
      ignored: boolean;
      ignoreReason?: string;
      importanceScore: number;
      importanceCategory: string;
      viewportCoveragePercent: number;
      interactionAffected: boolean;
      viewportWidth: number;
      viewportHeight: number;
    };

    const viewportWidth = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight);
    const viewportArea = Math.max(1, viewportWidth * viewportHeight);

    const selectorFor = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testIdAttribute = element.hasAttribute('data-testid') ? 'data-testid' : 'data-test';
      const testId = element.getAttribute(testIdAttribute);
      if (testId) return `[${testIdAttribute}="${CSS.escape(testId)}"]`;
      const parts: string[] = [];
      let node: Element | null = element;
      while (node && node !== document.body && parts.length < 6) {
        const siblings = node.parentElement
          ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName)
          : [];
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`);
        node = node.parentElement;
      }
      return `body > ${parts.join(' > ')}`;
    };

    const safeMatches = (element: HTMLElement, selector: string): boolean => {
      try {
        return element.matches(selector) || Boolean(element.closest(selector));
      } catch {
        return false;
      }
    };

    const cssTimeToMs = (value: string): number => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === '0s' || trimmed === '0ms') return 0;
      if (trimmed.endsWith('ms')) return Number(trimmed.slice(0, -2)) || 0;
      if (trimmed.endsWith('s')) return (Number(trimmed.slice(0, -1)) || 0) * 1000;
      return Number(trimmed) || 0;
    };

    const motionTextFor = (element: HTMLElement): string =>
      `${element.id} ${element.className} ${element.getAttribute('data-aos') ?? ''} ${element.getAttribute('data-animation') ?? ''}`.toLowerCase();

    const hasMotion = (element: HTMLElement, style = getComputedStyle(element)): boolean => {
      const durations = `${style.animationDuration},${style.transitionDuration}`
        .split(',')
        .map((item) => cssTimeToMs(item));
      const names = style.animationName.split(',').map((item) => item.trim()).filter(Boolean);
      const transitionProperties = style.transitionProperty.split(',').map((item) => item.trim()).filter(Boolean);
      const cssMotion = durations.some((duration) => duration > 0) &&
        (names.some((name) => name !== 'none') || transitionProperties.some((property) => property !== 'none'));
      const hintedMotion = /animate|animation|motion|reveal|fade|slide|aos|wow|gsap|lottie|parallax|marquee|swiper|splide|slick|carousel/.test(motionTextFor(element));
      const compositorMotion = /transform|opacity|filter|left|right|top|bottom|height|width/.test(style.willChange) ||
        style.transform !== 'none';
      if (cssMotion || hintedMotion || compositorMotion) return true;
      return Array.from(element.children)
        .slice(0, 20)
        .some((child) => child instanceof HTMLElement && hasMotion(child));
    };

    const fixedOrStickyAncestor = (element: HTMLElement): { selector: string; position: string } | null => {
      let node: HTMLElement | null = element;
      while (node && node !== document.body) {
        const position = getComputedStyle(node).position;
        if (position === 'fixed' || position === 'sticky') {
          return { selector: selectorFor(node), position };
        }
        node = node.parentElement;
      }
      return null;
    };

    const textFor = (element: HTMLElement): string =>
      `${element.innerText || ''} ${element.getAttribute('aria-label') || ''} ${element.id} ${element.className}`
        .toLowerCase()
        .slice(0, 500);

    const importanceFor = (
      element: HTMLElement,
      rect: DOMRect
    ): { importanceScore: number; importanceCategory: string } => {
      const text = textFor(element);
      const weights = runtimeConfig.importanceWeights;
      if (element.matches('nav,[role="navigation"]') || element.closest('nav,[role="navigation"]')) {
        return { importanceScore: weights.navigation, importanceCategory: 'navigation' };
      }
      if (element.matches('header,[role="banner"]') || element.closest('header,[role="banner"]')) {
        return { importanceScore: weights.header, importanceCategory: 'header' };
      }
      if (
        element.matches('main,[role="main"]') ||
        element.closest('[class*="hero" i],[id*="hero" i],[class*="banner" i],[class*="jumbotron" i]')
      ) {
        return { importanceScore: weights.hero, importanceCategory: 'hero' };
      }
      if (/checkout|cart|order|purchase|buy now/.test(text)) {
        return { importanceScore: weights.checkout, importanceCategory: 'checkout' };
      }
      if (/payment|card number|billing|cvv|pay\b/.test(text)) {
        return { importanceScore: weights.payment, importanceCategory: 'payment' };
      }
      if (/login|log in|sign in|password/.test(text)) {
        return { importanceScore: weights.loginForm, importanceCategory: 'loginForm' };
      }
      if (element.matches('[role="search"],input[type="search"]') || /search/.test(text)) {
        return { importanceScore: weights.search, importanceCategory: 'search' };
      }
      if (
        element.matches('button,a,[role="button"],input[type="submit"]') &&
        /get started|start|submit|continue|contact|book|subscribe|learn more|download|try|demo/.test(text)
      ) {
        return { importanceScore: weights.primaryCta, importanceCategory: 'primaryCta' };
      }
      if (element.matches('form,input,select,textarea') || element.closest('form,[role="form"]')) {
        return { importanceScore: weights.form, importanceCategory: 'form' };
      }
      if (element.closest('main,[role="main"]') || element.matches('section,article,h1,h2,h3,p,li')) {
        return { importanceScore: weights.mainContent, importanceCategory: 'mainContent' };
      }
      if (element.matches('button,a,[role="button"],input,select,textarea')) {
        return { importanceScore: weights.interactive, importanceCategory: 'interactive' };
      }
      if (element instanceof HTMLImageElement) {
        const decorativeImage = element.alt === '' || (rect.width <= 40 && rect.height <= 40);
        return decorativeImage
          ? { importanceScore: weights.decorative, importanceCategory: 'decorative' }
          : { importanceScore: weights.media, importanceCategory: 'media' };
      }
      if (/icon|badge|decor|ornament|background/.test(text) || (rect.width <= 40 && rect.height <= 40)) {
        return { importanceScore: weights.decorative, importanceCategory: 'decorative' };
      }
      return { importanceScore: weights.default, importanceCategory: 'default' };
    };

    const selectorCounts = new Map<string, number>();
    return Array.from(document.body.querySelectorAll<HTMLElement>(
      'img,li,ul,ol,nav,header,footer,main,section,article,div,button,a,p,span,form,input,select,textarea,h1,h2,h3,[role="button"],[role="navigation"],[role="main"],[role="search"]'
    ))
      .map((element): SnapshotItem | null => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (
          rect.width <= 1 ||
          rect.height <= 1 ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity) <= 0.01
        ) {
          return null;
        }

        const fixedLayer = fixedOrStickyAncestor(element);
        const ignoredSelector = runtimeConfig.ignoreSelectors.find((selector) => safeMatches(element, selector));
        const ignoreReason = ignoredSelector
          ? `selector:${ignoredSelector}`
          : fixedLayer
            ? `${fixedLayer.position}:${fixedLayer.selector}`
            : undefined;
        const importance = importanceFor(element, rect);
        const area = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)) *
          Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        const selector = selectorFor(element);
        const selectorIndex = selectorCounts.get(selector) ?? 0;
        selectorCounts.set(selector, selectorIndex + 1);
        return {
          key: `${selector}::${selectorIndex}`,
          selector,
          tag: element.tagName.toLowerCase(),
          rect: {
            left: Number(rect.left.toFixed(2)),
            top: Number(rect.top.toFixed(2)),
            width: Number(rect.width.toFixed(2)),
            height: Number(rect.height.toFixed(2)),
            right: Number(rect.right.toFixed(2)),
            bottom: Number(rect.bottom.toFixed(2))
          },
          hasImage: element instanceof HTMLImageElement || Boolean(element.querySelector('img')),
          isAnimated: hasMotion(element, style),
          ignored: Boolean(ignoreReason),
          ignoreReason,
          importanceScore: importance.importanceScore,
          importanceCategory: importance.importanceCategory,
          viewportCoveragePercent: Number(((area / viewportArea) * 100).toFixed(2)),
          interactionAffected: Boolean(
            element.matches('button,a,[role="button"],input,select,textarea') ||
            element.closest('button,a,[role="button"],form,[role="form"]')
          ),
          viewportWidth,
          viewportHeight
        };
      })
      .filter((item): item is SnapshotItem => Boolean(item))
      .slice(0, 700);
  }, config);
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function movementDirection(dx: number, dy: number): string {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return 'none';
  const horizontal = dx > 0 ? 'right' : dx < 0 ? 'left' : '';
  const vertical = dy > 0 ? 'down' : dy < 0 ? 'up' : '';
  return [vertical, horizontal].filter(Boolean).join('-') || 'none';
}

function typeForShift(item: LayoutSnapshotItem): string {
  if (item.hasImage) return 'Image Shift';
  if (item.tag === 'li' || item.tag === 'ul' || item.tag === 'ol' || item.selector.includes('li:nth-of-type')) {
    return 'Content Shift';
  }
  return 'Layout Shift';
}

function buildShiftDefect(
  previous: LayoutSnapshotItem,
  current: LayoutSnapshotItem,
  config: LayoutShiftRuntimeConfig,
  clsValue: number,
  source: 'postLoad' | 'reload'
): DomDefect | null {
  const signedDx = current.rect.left - previous.rect.left;
  const signedDy = current.rect.top - previous.rect.top;
  const dx = Math.abs(signedDx);
  const dy = Math.abs(signedDy);
  const movement = Math.max(dx, dy);
  const relativeMovement = Math.max(
    dx / Math.max(1, previous.rect.width),
    dy / Math.max(1, previous.rect.height)
  );
  const viewportMovementPercent = Math.max(
    dx / Math.max(1, previous.viewportWidth, current.viewportWidth),
    dy / Math.max(1, previous.viewportHeight, current.viewportHeight)
  ) * 100;
  const importanceScore = Math.max(previous.importanceScore, current.importanceScore);
  const importanceCategory = previous.importanceScore >= current.importanceScore
    ? previous.importanceCategory
    : current.importanceCategory;
  const viewportCoveragePercent = Math.max(previous.viewportCoveragePercent, current.viewportCoveragePercent);
  const interactionAffected = previous.interactionAffected || current.interactionAffected;
  const direction = movementDirection(signedDx, signedDy);
  const isReload = source === 'reload';

  if (config.mode === 'strict') {
    const strictPass = isReload
      ? movement > config.strictReloadMovementPx
      : movement > config.strictMovementPx && relativeMovement > config.strictRelativeMovement;
    if (!strictPass || previous.isAnimated || current.isAnimated) return null;
    return {
      type: typeForShift(current),
      selector: current.selector,
      description: isReload
        ? `Element position changed by ${movement.toFixed(1)}px between two equivalent page loads.`
        : `Element moved by ${Math.round(movement)}px after initial render, indicating a layout shift.`,
      severity: 'High',
      details: {
        assertion: isReload ? 'reload position stability' : 'post-load position stability',
        layoutShiftMode: config.mode,
        selector: current.selector,
        before: previous.rect,
        after: current.rect,
        delta: { dx: round(dx), dy: round(dy), signedDx: round(signedDx), signedDy: round(signedDy) },
        pixelMovement: round(movement),
        relativeMovement: round(relativeMovement, 3),
        movementDirection: direction,
        clsValue,
        severity: 'High',
        decision: 'FAIL',
        failureReason: isReload
          ? `Strict reload mode reports movement above ${config.strictReloadMovementPx}px.`
          : `Strict mode reports movement above ${config.strictMovementPx}px and ${round(config.strictRelativeMovement * 100, 1)}% of the element.`
      }
    };
  }

  if (previous.isAnimated || current.isAnimated) return null;
  if (previous.ignored || current.ignored) return null;
  if (viewportCoveragePercent <= 0) return null;

  const severeViewportMovement = viewportMovementPercent >= config.viewportPercent;
  if (isReload && movement < config.failPx && !severeViewportMovement) return null;
  if (!isReload && movement < config.warningPx && !severeViewportMovement) return null;

  let severity: Severity = 'Medium';
  let decision: 'WARNING' | 'FAIL' | 'CRITICAL' = 'WARNING';
  let failureReason = `Movement is noticeable (${round(movement)}px) but below the ${config.failPx}px fail threshold.`;

  if (movement >= config.criticalPx) {
    severity = 'Critical';
    decision = 'CRITICAL';
    failureReason = `Movement exceeds the ${config.criticalPx}px critical threshold.`;
  } else if (movement >= config.failPx || severeViewportMovement) {
    severity = 'High';
    decision = 'FAIL';
    failureReason = severeViewportMovement
      ? `Movement is ${round(viewportMovementPercent)}% of the viewport, meeting the ${config.viewportPercent}% severe threshold.`
      : `Movement exceeds the ${config.failPx}px fail threshold.`;
  }

  const criticalImportance = ['navigation', 'header', 'hero', 'primaryCta', 'loginForm', 'checkout', 'payment', 'form'];
  if (decision === 'FAIL' && (criticalImportance.includes(importanceCategory) || interactionAffected)) {
    severity = 'Critical';
    decision = 'CRITICAL';
    failureReason = `${failureReason} The affected element is ${importanceCategory} content.`;
  } else if (decision === 'WARNING' && clsValue > config.clsFail) {
    severity = 'High';
    decision = 'FAIL';
    failureReason = `${failureReason} CLS ${clsValue} is above ${config.clsFail}, so visible movement is escalated.`;
  }

  const humanVisibilityScore = Math.min(100, Math.round(
    movement * 0.9 +
    viewportMovementPercent * 6 +
    viewportCoveragePercent * 0.25 +
    importanceScore * 8 +
    (interactionAffected ? 12 : 0) +
    (clsValue > config.clsFail ? 10 : clsValue > config.clsWarning ? 5 : 0)
  ));

  return {
    type: typeForShift(current),
    selector: current.selector,
    description: isReload
      ? `Element position changed by ${movement.toFixed(1)}px (${round(viewportMovementPercent)}% viewport movement) between equivalent page loads. ${decision}: ${failureReason}`
      : `Element moved by ${Math.round(movement)}px (${round(viewportMovementPercent)}% viewport movement) after the visual stability window. ${decision}: ${failureReason}`,
    severity,
      details: {
        assertion: isReload ? 'human-visible reload position stability' : 'human-visible post-load layout stability',
        layoutShiftMode: config.mode,
        selector: current.selector,
        before: previous.rect,
        after: current.rect,
      delta: { dx: round(dx), dy: round(dy), signedDx: round(signedDx), signedDy: round(signedDy) },
      pixelMovement: round(movement),
      relativeMovement: round(relativeMovement, 3),
      viewportMovementPercent: round(viewportMovementPercent),
      viewportCoveragePercent,
      movementDirection: direction,
      persistenceWindowMs: isReload ? 'equivalent-load comparison' : config.persistenceMs,
      importanceScore,
      importanceCategory,
      interactionAffected,
      clsValue,
      humanVisibilityScore,
      failureReason,
      decision,
      severity,
      thresholds: {
        ignorePx: config.ignorePx,
        warningPx: config.warningPx,
        failPx: config.failPx,
        criticalPx: config.criticalPx,
        viewportPercent: config.viewportPercent,
        persistenceMs: config.persistenceMs
      }
    }
  };
}

function compareLayoutSnapshots(
  before: LayoutSnapshotItem[],
  after: LayoutSnapshotItem[],
  config: LayoutShiftRuntimeConfig,
  clsValue: number,
  source: 'postLoad' | 'reload'
): DomDefect[] {
  const beforeByKey = new Map(before.map((item) => [item.key, item]));
  const defects: DomDefect[] = [];
  for (const current of after) {
    const previous = beforeByKey.get(current.key);
    if (!previous) continue;
    const defect = buildShiftDefect(previous, current, config, clsValue, source);
    if (defect) defects.push(defect);
  }
  return (config.mode === 'humanVision' ? groupHumanVisionShiftDefects(defects) : defects).slice(0, 120);
}

function groupHumanVisionShiftDefects(defects: DomDefect[]): DomDefect[] {
  const groups = new Map<string, DomDefect[]>();
  for (const defect of defects) {
    const details = defect.details;
    const assertion = typeof details.assertion === 'string' ? details.assertion : 'layout shift';
    groups.set(assertion, [...(groups.get(assertion) ?? []), defect]);
  }

  return Array.from(groups.values()).map((group) => {
    const ranked = [...group].sort((left, right) => {
      const leftDetails = left.details as Record<string, unknown>;
      const rightDetails = right.details as Record<string, unknown>;
      const severityRank = (severity?: string) => ({ Critical: 0, High: 1, Medium: 2, Low: 3 }[severity ?? 'Low'] ?? 3);
      return severityRank(left.severity) - severityRank(right.severity) ||
        Number(rightDetails.pixelMovement ?? 0) - Number(leftDetails.pixelMovement ?? 0) ||
        Number(rightDetails.viewportCoveragePercent ?? 0) - Number(leftDetails.viewportCoveragePercent ?? 0) ||
        Number(rightDetails.importanceScore ?? 0) - Number(leftDetails.importanceScore ?? 0) ||
        Number(rightDetails.humanVisibilityScore ?? 0) - Number(leftDetails.humanVisibilityScore ?? 0);
    });
    const representative = ranked[0];
    if (ranked.length === 1) return representative;

    return {
      ...representative,
      description: `${representative.description} ${ranked.length - 1} related moved element(s) were grouped into this human-visible layout shift finding.`,
      details: {
        ...(representative.details as Record<string, unknown>),
        groupedMovedElementCount: ranked.length,
        groupedMovedElements: ranked.slice(0, 12).map((item) => ({
          selector: item.selector,
          type: item.type,
          severity: item.severity,
          pixelMovement: (item.details as Record<string, unknown>).pixelMovement,
          viewportMovementPercent: (item.details as Record<string, unknown>).viewportMovementPercent,
          importanceCategory: (item.details as Record<string, unknown>).importanceCategory
        }))
      }
    };
  });
}

export async function detectDomDefects(page: Page): Promise<DomDefect[]> {
  return page.evaluate(async () => {
    type Defect = {
      type: string;
      selector: string;
      description: string;
      details: Record<string, unknown>;
    };

    const defects: DomDefect[] = [];
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const selectorFor = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testIdAttribute = element.hasAttribute('data-testid') ? 'data-testid' : 'data-test';
      const testId = element.getAttribute(testIdAttribute);
      if (testId) return `[${testIdAttribute}="${CSS.escape(testId)}"]`;
      const parts: string[] = [];
      let node: Element | null = element;
      while (node && node !== document.body && parts.length < 6) {
        const siblings = node.parentElement
          ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName)
          : [];
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`);
        node = node.parentElement;
      }
      return `body > ${parts.join(' > ')}`;
    };

    const visibleAreaInViewport = (rect: DOMRect): number => {
      const width = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
      return width * height;
    };

    const intersectsViewport = (rect: DOMRect, minimumArea = 4): boolean =>
      visibleAreaInViewport(rect) >= minimumArea;

    const isAccessibilityOnly = (element: HTMLElement, style: CSSStyleDeclaration, rect: DOMRect): boolean =>
      element.getAttribute('aria-hidden') === 'true' ||
      Boolean(element.closest('[aria-hidden="true"],[hidden],template,script,style')) ||
      /(?:screen-reader|sr-only|visually-hidden|assistive-text)/i.test(String(element.className)) ||
      (rect.width <= 1 && rect.height <= 1) ||
      style.clip === 'rect(0px, 0px, 0px, 0px)' ||
      style.clipPath === 'inset(50%)';

    const isDynamicUi = (element: HTMLElement): boolean => Boolean(element.closest(
      [
        '[data-audit-ignore-visual]',
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
        '[class*="userway" i]',
        '[id*="userway" i]',
        '[class*="accessibility" i]',
        '[id*="accessibility" i]',
        '[aria-label*="accessibility" i]',
        '[title*="accessibility" i]',
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
      ].join(',')
    ));

    const cssTimeToMs = (value: string): number => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === '0s' || trimmed === '0ms') return 0;
      if (trimmed.endsWith('ms')) return Number(trimmed.slice(0, -2)) || 0;
      if (trimmed.endsWith('s')) return (Number(trimmed.slice(0, -1)) || 0) * 1000;
      return Number(trimmed) || 0;
    };

    const motionTextFor = (element: HTMLElement): string =>
      `${element.id} ${element.className} ${element.getAttribute('data-aos') ?? ''} ${element.getAttribute('data-animation') ?? ''}`.toLowerCase();

    const hasMotionOrReveal = (element: HTMLElement): boolean => {
      const style = getComputedStyle(element);
      const durations = `${style.animationDuration},${style.transitionDuration}`
        .split(',')
        .map((item) => cssTimeToMs(item));
      const animationNames = style.animationName.split(',').map((item) => item.trim()).filter(Boolean);
      const transitionProperties = style.transitionProperty.split(',').map((item) => item.trim()).filter(Boolean);
      const cssMotion = durations.some((duration) => duration > 0) &&
        (animationNames.some((name) => name !== 'none') || transitionProperties.some((property) => property !== 'none'));
      const hintedMotion = /animate|animation|motion|reveal|fade|slide|aos|wow|gsap|lottie|parallax|marquee|swiper|splide|slick|carousel/.test(motionTextFor(element));
      const compositorMotion = /transform|opacity|filter|left|right|top|bottom|height|width/.test(style.willChange) ||
        style.transform !== 'none';
      if (cssMotion || hintedMotion || compositorMotion) return true;
      return Array.from(element.children)
        .slice(0, 30)
        .some((child) => child instanceof HTMLElement && hasMotionOrReveal(child));
    };

    const textFor = (element: HTMLElement): string => {
      const descendantHints = Array.from(element.querySelectorAll<HTMLElement>('[id],[class],[aria-label],[title]'))
        .slice(0, 8)
        .map((child) => `${child.id} ${child.className} ${child.getAttribute('aria-label') ?? ''} ${child.getAttribute('title') ?? ''}`)
        .join(' ');
      return `${element.innerText || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.id} ${element.className} ${descendantHints}`.toLowerCase();
    };

    const isFloatingUtility = (element: HTMLElement): boolean => {
      const text = textFor(element);
      const style = getComputedStyle(element);
      return ['fixed', 'sticky'].includes(style.position) && /contact|chat|support|scroll|back to top|top/.test(text);
    };

    const hasVisibleHorizontalOverflow = (elements: HTMLElement[]): HTMLElement | null => {
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (isAccessibilityOnly(element, style, rect) || isDynamicUi(element) || isFloatingUtility(element)) continue;
        if (style.position === 'absolute' || style.position === 'fixed') {
          const text = textFor(element);
          if (/menu|drawer|panel|modal|tooltip|popover|dropdown|mega|flyout|offcanvas|off-canvas|slide|carousel|swiper|slick/.test(text)) continue;
        }
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const visibleRatio = visibleWidth / Math.max(1, rect.width);
        const userFacing =
          element.matches('main,section,article,header,footer,nav,img,a,button,input,select,textarea,h1,h2,h3,p,li') ||
          Boolean((element.innerText || '').trim()) ||
          Boolean(element.querySelector('img,svg,canvas,video,a,button,input,select,textarea'));
        const scrollOverflow = element.scrollWidth > element.clientWidth + 2 || element.scrollWidth > viewportWidth + 24;
        const hasOverflowBeyondViewport = rect.right > viewportWidth + 24 || rect.width > viewportWidth + 24;
        if (visibleHeight > 16 && visibleWidth > 24 && visibleRatio >= 0.2 && userFacing && (scrollOverflow || hasOverflowBeyondViewport)) {
          return element;
        }
      }
      return null;
    };

    const isReportableOffscreenElement = (element: HTMLElement, rect: DOMRect, style: CSSStyleDeclaration): boolean => {
      if (style.transform !== 'none' || isDynamicUi(element) || isFloatingUtility(element)) return false;
      if (['absolute', 'fixed'].includes(style.position)) {
        const text = textFor(element);
        if (/menu|drawer|panel|modal|tooltip|popover|dropdown|mega|flyout|offcanvas|off-canvas|slide|carousel|swiper|slick|background|decor/.test(text)) {
          return false;
        }
      }
      const visibleArea = visibleAreaInViewport(rect);
      if (visibleArea < 600) return false;
      const totalArea = Math.max(1, rect.width * rect.height);
      const visibleRatio = visibleArea / totalArea;
      const clippedLeft = rect.left < -24 && rect.right > 32;
      const clippedRight = rect.right > viewportWidth + 24 && rect.left < viewportWidth - 32;
      const important =
        element.matches('a,button,input,select,textarea,img,h1,h2,h3,p,li,nav,header,footer,main,section,article') ||
        Boolean(element.querySelector('a,button,input,select,textarea,img,video,canvas')) ||
        Boolean((element.innerText || '').trim());
      const directlyActionable = element.matches('a,button,input,select,textarea,[role="button"]');
      if (!directlyActionable && visibleArea < 12_000) return false;
      return important && visibleRatio >= 0.15 && visibleRatio <= 0.92 && (clippedLeft || clippedRight);
    };

    const visibleElements = Array.from(document.body.querySelectorAll<HTMLElement>(
      'a,button,input,select,textarea,img,header,footer,nav,main,section,article,div,li,ul,ol,h1,h2,h3,p,span'
    ))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 1 &&
          rect.height > 1 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.01 &&
          !isAccessibilityOnly(element, style, rect)
        );
      })
      .slice(0, 900);

    const overflowElement = hasVisibleHorizontalOverflow(visibleElements);
    if (overflowElement) {
      defects.push({
        type: 'Horizontal Scroll',
        selector: selectorFor(overflowElement),
        description: 'Page creates visible horizontal scrolling from user-facing content outside the viewport.',
        details: {
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth,
          overflowingElement: selectorFor(overflowElement)
        }
      });
    }

    for (const element of visibleElements) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const selector = selectorFor(element);
      const text = element.innerText?.trim();

      if (isReportableOffscreenElement(element, rect, style)) {
        defects.push({
          type: 'Off-screen Content',
          selector,
          description: 'A user-visible element is partially cut off by the horizontal viewport.',
          details: {
            left: Number(rect.left.toFixed(1)),
            right: Number(rect.right.toFixed(1)),
            viewportWidth,
            visibleArea: Math.round(visibleAreaInViewport(rect))
          }
        });
      }

      const clipsOverflow = ['hidden', 'clip'].includes(style.overflow) ||
        ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY);
      const hasOwnText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
      );
      if (text && hasOwnText && clipsOverflow && intersectsViewport(rect, 25) &&
          (element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2)) {
        defects.push({
          type: 'Clipped Text',
          selector,
          description: 'Text appears clipped or overflowing inside its container.',
          details: {
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight
          }
        });
      }

      if ((element.matches('section,article,div') || element.getAttribute('role') === 'region') && rect.height > 120 && intersectsViewport(rect, 240)) {
        const visibleContentSelector = 'img,svg,video,canvas,iframe,button,a,input,select,textarea';
        const hasVisibleMediaOrControl = Array.from(element.querySelectorAll<HTMLElement>(visibleContentSelector))
          .some((child) => {
            const childRect = child.getBoundingClientRect();
            const childStyle = getComputedStyle(child);
            return childRect.width > 2 &&
              childRect.height > 2 &&
              childStyle.display !== 'none' &&
              childStyle.visibility !== 'hidden' &&
              Number(childStyle.opacity) > 0.01;
          });
        const hasVisibleContent = text.length > 0 || hasVisibleMediaOrControl;
        const classAndId = `${element.id} ${element.className}`.toLowerCase();
        const hasNamedContentIntent =
          Boolean(element.getAttribute('aria-label')?.trim()) ||
          Boolean(element.getAttribute('title')?.trim()) ||
          /card|tile|panel|module|content|cta|hero|feature|service|product|story|testimonial|pricing|logo|client|partner|resource|case|work|workflow|memo/.test(classAndId);
        const hasContainerChrome = style.borderStyle !== 'none' ||
          style.outlineStyle !== 'none' ||
          style.boxShadow !== 'none';
        const hasVisibleBackground = style.backgroundImage !== 'none' &&
          !/linear-gradient\(rgba\(0,\s*0,\s*0,\s*0\),\s*rgba\(0,\s*0,\s*0,\s*0\)\)/i.test(style.backgroundImage) ||
          !['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor);
        const isLikelyLayoutSpacer =
          rect.width >= viewportWidth * 0.75 &&
          !hasContainerChrome &&
          style.backgroundImage === 'none' &&
          (style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent');
        const isInteractiveContainer =
          element.hasAttribute('oncontextmenu') ||
          element.hasAttribute('onclick') ||
          element.hasAttribute('tabindex') ||
          Boolean(element.getAttribute('role')) ||
          element.id === 'hot-spot' ||
          element.matches('[data-context-menu], [class*="context-menu"]');
        if (
          !hasVisibleContent &&
          hasNamedContentIntent &&
          !isInteractiveContainer &&
          !isDynamicUi(element) &&
          !hasMotionOrReveal(element) &&
          !isLikelyLayoutSpacer
        ) {
          defects.push({
            type: 'Empty Container',
            selector,
            description: 'A large visible container has no meaningful visible content.',
            severity: rect.width * rect.height > viewportWidth * viewportHeight * 0.08 || hasVisibleBackground ? 'Medium' : 'Low',
            details: {
              left: Number(rect.left.toFixed(1)),
              top: Number(rect.top.toFixed(1)),
              width: Number(rect.width.toFixed(1)),
              height: Number(rect.height.toFixed(1)),
              contentIntent: hasNamedContentIntent,
              containerChrome: hasContainerChrome,
              visibleBackground: hasVisibleBackground
            }
          });
        }
      }

      if (element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0 && intersectsViewport(rect, 25)) {
        const naturalRatio = element.naturalWidth / element.naturalHeight;
        const renderedRatio = rect.width / rect.height;
        if (Number.isFinite(naturalRatio) && Math.abs(naturalRatio - renderedRatio) > 0.35) {
          defects.push({
            type: 'Distorted Image',
            selector,
            description: 'Image rendered aspect ratio differs significantly from its natural aspect ratio.',
            details: { naturalRatio, renderedRatio }
          });
        }
      }

      if (['fixed', 'sticky'].includes(style.position) && !isFloatingUtility(element) && rect.top < 0 && rect.bottom > 0 && rect.height > viewportHeight * 0.45) {
        defects.push({
          type: 'Sticky Obstruction',
          selector,
          description: 'Sticky or fixed element consumes excessive viewport space.',
          details: { height: rect.height, viewportHeight }
        });
      }
    }

    const overlapCandidates = visibleElements
      .filter((element) => {
        const tag = element.tagName.toLowerCase();
        return intersectsViewport(element.getBoundingClientRect(), 25) &&
          (['a', 'button', 'input', 'select', 'textarea', 'img'].includes(tag) || element.getAttribute('role') === 'button');
      })
      .slice(0, 250);

    const footer = document.querySelector<HTMLElement>(
      'footer, [role="contentinfo"], #footer, .site-footer, .page-footer'
    );
    if (footer) {
      const footerRect = footer.getBoundingClientRect();
      const documentHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight
      );
      const footerDocumentBottom = footerRect.bottom + window.scrollY;
      const trailingWhitespace = Math.max(0, documentHeight - footerDocumentBottom);
      const footerVisibleWidth = Math.max(0, Math.min(footerRect.right, viewportWidth) - Math.max(footerRect.left, 0));
      if (
        trailingWhitespace > Math.max(120, viewportHeight * 0.12) &&
        footerVisibleWidth > viewportWidth * 0.5 &&
        footerRect.height > 40
      ) {
        defects.push({
          type: 'Excessive Page-End Whitespace',
          selector: selectorFor(footer),
          description: 'Large blank whitespace appears after the footer before the end of the page.',
          severity: trailingWhitespace > viewportHeight * 0.25 ? 'High' : 'Medium',
          details: {
            trailingWhitespace: Math.round(trailingWhitespace),
            documentHeight: Math.round(documentHeight),
            footerBottom: Math.round(footerDocumentBottom),
            viewportHeight
          }
        });
      }
      const controls = Array.from(document.querySelectorAll<HTMLElement>(
        'a,button,[role="button"],input[type="button"],input[type="submit"]'
      ));
      for (const control of controls) {
        const controlRect = control.getBoundingClientRect();
        if (controlRect.width <= 1 || controlRect.height <= 1) continue;
        if (isFloatingUtility(control) || isDynamicUi(control)) continue;

        let positionedLayer: HTMLElement | null = control;
        while (positionedLayer && !['fixed', 'sticky'].includes(getComputedStyle(positionedLayer).position)) {
          positionedLayer = positionedLayer.parentElement;
        }
        if (!positionedLayer) continue;
        if (positionedLayer.matches('header,nav,[role="banner"],[role="navigation"]') ||
          Boolean(positionedLayer.closest('header,nav,[role="banner"],[role="navigation"]'))) {
          continue;
        }

        const xOverlap = Math.max(0, Math.min(controlRect.right, footerRect.right) - Math.max(controlRect.left, footerRect.left));
        const yOverlap = Math.max(0, Math.min(controlRect.bottom, footerRect.bottom) - Math.max(controlRect.top, footerRect.top));
        const overlapArea = xOverlap * yOverlap;
        const controlArea = controlRect.width * controlRect.height;
        const overlapRatio = controlArea > 0 ? overlapArea / controlArea : 0;
        if (overlapArea > 100 && overlapRatio > 0.1) {
          defects.push({
            type: 'Footer Obstruction',
            selector: selectorFor(control),
            description: 'A fixed or sticky control overlaps the footer and can obscure footer content.',
            details: {
              overlapArea: Math.round(overlapArea),
              overlapRatio: Number(overlapRatio.toFixed(2)),
              positionedLayer: selectorFor(positionedLayer),
              footer: selectorFor(footer)
            }
          });
        }
      }
    }

    type Box = { x: number; y: number; width: number; height: number };
    type OverlapMeasurement = {
      first: HTMLElement;
      second: HTMLElement;
      occluded: HTMLElement;
      occluding: HTMLElement;
      area: number;
      overlapRatio: number;
      firstCoverage: number;
      secondCoverage: number;
      occludedCoverage: number;
      blockedSampleRatio: number;
      centerBlocked: boolean;
      criticalEdgeBlocked: boolean;
      firstBox: Box;
      secondBox: Box;
    };
    const interactiveSelector = 'a,button,input,select,textarea,[role="button"]';
    const toBox = (rect: DOMRect): Box => ({
      x: Number(rect.x.toFixed(2)),
      y: Number(rect.y.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2))
    });
    const elementIndexInStack = (stack: Element[], element: HTMLElement): number =>
      stack.findIndex((candidate) => candidate === element || element.contains(candidate));
    const isPaintedAbove = (
      occluding: HTMLElement,
      occluded: HTMLElement,
      point: { x: number; y: number }
    ): boolean => {
      const stack = document.elementsFromPoint(point.x, point.y);
      const occludingIndex = elementIndexInStack(stack, occluding);
      const occludedIndex = elementIndexInStack(stack, occluded);
      return occludingIndex >= 0 && (occludedIndex < 0 || occludingIndex < occludedIndex);
    };
    const measurePair = (first: HTMLElement, second: HTMLElement): OverlapMeasurement | null => {
      if (!first.isConnected || !second.isConnected || first.contains(second) || second.contains(first)) return null;
      const sameLink = first.closest('a') && first.closest('a') === second.closest('a');
      if (sameLink) return null;

      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      const left = Math.max(0, firstRect.left, secondRect.left);
      const right = Math.min(viewportWidth, firstRect.right, secondRect.right);
      const top = Math.max(0, firstRect.top, secondRect.top);
      const bottom = Math.min(viewportHeight, firstRect.bottom, secondRect.bottom);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      const area = width * height;
      if (area <= 100) return null;

      const firstArea = firstRect.width * firstRect.height;
      const secondArea = secondRect.width * secondRect.height;
      const firstIsInteractive = first.matches(interactiveSelector);
      const secondIsInteractive = second.matches(interactiveSelector);
      if (!firstIsInteractive && !secondIsInteractive) return null;

      const insetX = Math.min(2, width / 4);
      const insetY = Math.min(2, height / 4);
      const samplePoints = [
        { x: left + width / 2, y: top + height / 2 },
        { x: left + insetX, y: top + insetY },
        { x: right - insetX, y: top + insetY },
        { x: left + insetX, y: bottom - insetY },
        { x: right - insetX, y: bottom - insetY }
      ];

      const measureVictim = (occluded: HTMLElement, occluding: HTMLElement, rect: DOMRect) => {
        const blockedSamples = samplePoints.filter((point) => isPaintedAbove(occluding, occluded, point)).length;
        if (blockedSamples === 0) return null;
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const centerInsideIntersection =
          center.x >= left && center.x <= right && center.y >= top && center.y <= bottom;
        const centerBlocked = centerInsideIntersection && isPaintedAbove(occluding, occluded, center);
        const trailingControl = occluded.matches(
          'select,input[type="date"],input[type="time"],input[type="datetime-local"],input[type="month"],input[type="week"],input[type="number"],input[type="search"],input[type="color"]'
        );
        const trailingZoneLeft = rect.right - Math.min(32, rect.width * 0.25);
        const criticalEdgeIntersects = trailingControl && right > trailingZoneLeft && left < rect.right;
        const criticalPoint = {
          x: Math.max(left, trailingZoneLeft) + Math.max(0, right - Math.max(left, trailingZoneLeft)) / 2,
          y: top + height / 2
        };
        const criticalEdgeBlocked = Boolean(
          criticalEdgeIntersects && isPaintedAbove(occluding, occluded, criticalPoint)
        );
        const coverage = area / Math.max(1, rect.width * rect.height);
        const hasActionableImpact = centerBlocked || coverage >= 0.15 || criticalEdgeBlocked;
        if (!hasActionableImpact) return null;
        return {
          occluded,
          occluding,
          coverage,
          blockedSampleRatio: blockedSamples / samplePoints.length,
          centerBlocked,
          criticalEdgeBlocked
        };
      };

      const impacts = [
        firstIsInteractive ? measureVictim(first, second, firstRect) : null,
        secondIsInteractive ? measureVictim(second, first, secondRect) : null
      ].filter((impact): impact is NonNullable<typeof impact> => Boolean(impact));
      if (impacts.length === 0) return null;
      const impact = impacts.sort((leftImpact, rightImpact) =>
        Number(rightImpact.centerBlocked) - Number(leftImpact.centerBlocked) ||
        Number(rightImpact.criticalEdgeBlocked) - Number(leftImpact.criticalEdgeBlocked) ||
        rightImpact.coverage - leftImpact.coverage
      )[0];
      const smallerArea = Math.min(firstArea, secondArea);
      return {
        first,
        second,
        occluded: impact.occluded,
        occluding: impact.occluding,
        area,
        overlapRatio: smallerArea > 0 ? area / smallerArea : 0,
        firstCoverage: area / Math.max(1, firstArea),
        secondCoverage: area / Math.max(1, secondArea),
        occludedCoverage: impact.coverage,
        blockedSampleRatio: impact.blockedSampleRatio,
        centerBlocked: impact.centerBlocked,
        criticalEdgeBlocked: impact.criticalEdgeBlocked,
        firstBox: toBox(firstRect),
        secondBox: toBox(secondRect)
      };
    };
    const boxDelta = (first: Box, second: Box): number => Math.max(
      Math.abs(first.x - second.x),
      Math.abs(first.y - second.y),
      Math.abs(first.width - second.width),
      Math.abs(first.height - second.height)
    );

    let persistentOverlaps: OverlapMeasurement[] = [];
    for (let i = 0; i < overlapCandidates.length; i += 1) {
      for (let j = i + 1; j < overlapCandidates.length; j += 1) {
        const measurement = measurePair(overlapCandidates[i], overlapCandidates[j]);
        if (measurement) persistentOverlaps.push(measurement);
      }
    }
    for (let sample = 1; sample < 3 && persistentOverlaps.length > 0; sample += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      persistentOverlaps = persistentOverlaps.flatMap((previous) => {
        const current = measurePair(previous.first, previous.second);
        if (!current) return [];
        const stable = boxDelta(previous.firstBox, current.firstBox) <= 2 &&
          boxDelta(previous.secondBox, current.secondBox) <= 2 &&
          previous.occluded === current.occluded && previous.occluding === current.occluding;
        return stable ? [current] : [];
      });
    }

    for (const overlap of persistentOverlaps) {
      const firstIsImage = overlap.first instanceof HTMLImageElement;
      const secondIsImage = overlap.second instanceof HTMLImageElement;
      const imageObstructsControl =
        (firstIsImage || secondIsImage) && overlap.occluded.matches(interactiveSelector);
      defects.push({
        type: 'Element Overlap',
        selector: `${selectorFor(overlap.first)} / ${selectorFor(overlap.second)}`,
        description: 'An element is painted above an interactive control and blocks its actionable area.',
        details: {
          overlapArea: Math.round(overlap.area),
          overlapRatio: Number(overlap.overlapRatio.toFixed(3)),
          firstCoverage: Number(overlap.firstCoverage.toFixed(3)),
          secondCoverage: Number(overlap.secondCoverage.toFixed(3)),
          occludedCoverage: Number(overlap.occludedCoverage.toFixed(3)),
          blockedSampleRatio: Number(overlap.blockedSampleRatio.toFixed(2)),
          centerBlocked: overlap.centerBlocked,
          criticalEdgeBlocked: overlap.criticalEdgeBlocked,
          persistenceSamples: 3,
          occludedSelector: selectorFor(overlap.occluded),
          occludingSelector: selectorFor(overlap.occluding),
          firstBox: overlap.firstBox,
          secondBox: overlap.secondBox,
          imageObstructsControl
        }
      });
    }

    const reportedIconTextAlignment = new Set<string>();
    const iconTextContainers = Array.from(document.body.querySelectorAll<HTMLElement>(
      'li,div,p,a,section,article'
    )).slice(0, 500);
    for (const container of iconTextContainers) {
      const containerRect = container.getBoundingClientRect();
      const containerStyle = getComputedStyle(container);
      if (
        !intersectsViewport(containerRect, 40) ||
        isAccessibilityOnly(container, containerStyle, containerRect) ||
        isDynamicUi(container)
      ) {
        continue;
      }

      const children = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      if (children.length < 2 || children.length > 8) continue;

      const visibleChildren = children
        .map((child) => {
          const rect = child.getBoundingClientRect();
          const style = getComputedStyle(child);
          return {
            element: child,
            rect,
            style,
            text: (child.innerText || child.textContent || '').trim()
          };
        })
        .filter((item) =>
          item.rect.width > 2 &&
          item.rect.height > 2 &&
          item.style.display !== 'none' &&
          item.style.visibility !== 'hidden' &&
          Number(item.style.opacity) > 0.01 &&
          intersectsViewport(item.rect, 8) &&
          visibleAreaInViewport(item.rect) / Math.max(1, item.rect.width * item.rect.height) >= 0.15 &&
          !isFloatingUtility(item.element) &&
          !isDynamicUi(item.element)
        );
      if (visibleChildren.length < 2) continue;

      const iconCandidates = visibleChildren.filter(({ element, rect, text }) => {
        const iconLike =
          element.matches('img,svg,i,[class*="icon" i],[class*="fa-" i],[class*="fa " i]') ||
          Boolean(element.querySelector(':scope > img,:scope > svg,:scope > i,[class*="icon" i],[class*="fa-" i]')) ||
          /^[\uE000-\uF8FF\s]+$/.test(text);
        return iconLike && rect.width <= 96 && rect.height <= 96;
      });
      const textCandidates = visibleChildren.filter(({ element, rect, text }) => {
        const hasReadableText = /[A-Za-z0-9]/.test(text);
        const iconOnly = element.matches('img,svg,i') || /^[\uE000-\uF8FF\s]+$/.test(text);
        return hasReadableText && !iconOnly && rect.width > 20 && rect.height > 8;
      });

      for (const icon of iconCandidates) {
        const text = textCandidates.find((candidate) => {
          const horizontalGap = Math.min(
            Math.abs(candidate.rect.left - icon.rect.right),
            Math.abs(icon.rect.left - candidate.rect.right)
          );
          const yOverlap = Math.max(0, Math.min(icon.rect.bottom, candidate.rect.bottom) - Math.max(icon.rect.top, candidate.rect.top));
          const horizontalPair =
            (icon.rect.right <= candidate.rect.left + 24 || candidate.rect.right <= icon.rect.left + 24) &&
            horizontalGap <= Math.max(80, containerRect.width * 0.35);
          return horizontalPair && yOverlap > 0;
        });
        if (!text) continue;

        const iconCenter = (icon.rect.top + icon.rect.bottom) / 2;
        const textCenter = (text.rect.top + text.rect.bottom) / 2;
        const centerDelta = Math.abs(iconCenter - textCenter);
        const allowedDelta = Math.max(8, Math.min(icon.rect.height, text.rect.height) * 0.35);
        if (centerDelta <= allowedDelta) continue;

        const key = `${selectorFor(container)}|${selectorFor(icon.element)}|${selectorFor(text.element)}`;
        if (reportedIconTextAlignment.has(key)) continue;
        reportedIconTextAlignment.add(key);
        defects.push({
          type: 'Icon/Text Alignment',
          selector: selectorFor(container),
          description: 'A visible icon and its adjacent text are not vertically aligned in the same row.',
          details: {
            icon: selectorFor(icon.element),
            text: selectorFor(text.element),
            iconBox: toBox(icon.rect),
            textBox: toBox(text.rect),
            centerDelta: Number(centerDelta.toFixed(1)),
            allowedDelta: Number(allowedDelta.toFixed(1))
          }
        });
      }
    }

    type LayoutItem = {
      element: HTMLElement;
      selector: string;
      box: { left: number; right: number; top: number; bottom: number; width: number; height: number };
    };
    const median = (values: number[]): number => {
      const ordered = [...values].sort((left, right) => left - right);
      const middle = Math.floor(ordered.length / 2);
      return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
    };
    const groupRows = (items: LayoutItem[]): LayoutItem[][] => {
      const rows: LayoutItem[][] = [];
      for (const item of [...items].sort((left, right) => left.box.top - right.box.top || left.box.left - right.box.left)) {
        const row = rows.find((candidate) => Math.abs(median(candidate.map((member) => member.box.top)) - item.box.top) <= 8);
        if (row) row.push(item);
        else rows.push([item]);
      }
      return rows.map((row) => row.sort((left, right) => left.box.left - right.box.left));
    };
    const layoutContainers = Array.from(document.body.querySelectorAll<HTMLElement>(
      'main,section,ul,ol,[role="list"],[class*="grid"],[class*="cards"],[class*="tiles"],[class*="products"]'
    )).slice(0, 200);
    const reportedLayoutDefects = new Set<string>();

    for (const container of layoutContainers) {
      const containerStyle = getComputedStyle(container);
      const hasLayoutIntent =
        containerStyle.display.includes('grid') ||
        containerStyle.display.includes('flex') ||
        /(?:grid|cards?|tiles?|products?|features?)/i.test(container.className);
      if (!hasLayoutIntent) continue;
      const children: LayoutItem[] = Array.from(container.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .map((child) => {
          const rect = child.getBoundingClientRect();
          const style = getComputedStyle(child);
          return {
            element: child,
            selector: selectorFor(child),
            box: {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height
            },
            visible: rect.width > 20 && rect.height > 20 && style.display !== 'none' && style.visibility !== 'hidden'
          };
        })
        .filter((item) => item.visible)
        .map(({ element, selector, box }) => ({ element, selector, box }))
        .slice(0, 80);
      if (children.length < 3) continue;

      const rows = groupRows(children).filter((row) => row.length >= 2);
      if (!rows.length) continue;
      const containerSelector = selectorFor(container);

      for (const row of rows) {
        if (row.length < 3) continue;
        const heights = row.map((item) => item.box.height);
        const heightSpread = Math.max(...heights) - Math.min(...heights);
        const heightTolerance = Math.max(12, median(heights) * 0.15);
        if (heightSpread > heightTolerance) {
          const key = `height|${containerSelector}|${Math.round(row[0].box.top)}`;
          if (!reportedLayoutDefects.has(key)) {
            reportedLayoutDefects.add(key);
            defects.push({
              type: 'Repeated Row Height Mismatch',
              selector: containerSelector,
              description: 'Repeated cards or grid items in the same row have visibly inconsistent heights.',
              details: {
                rowTop: Math.round(row[0].box.top),
                itemSelectors: row.map((item) => item.selector),
                heights: heights.map((height) => Number(height.toFixed(1))),
                heightSpread: Number(heightSpread.toFixed(1)),
                allowedVariance: Number(heightTolerance.toFixed(1))
              }
            });
          }
        }

        const horizontalGaps = row.slice(1).map((item, itemIndex) => item.box.left - row[itemIndex].box.right);
        if (horizontalGaps.length >= 2) {
          const gapSpread = Math.max(...horizontalGaps) - Math.min(...horizontalGaps);
          const typicalGap = Math.max(1, median(horizontalGaps));
          if (Math.min(...horizontalGaps) >= 0 && gapSpread > Math.max(8, typicalGap * 0.35)) {
            const key = `spacing|${containerSelector}|${Math.round(row[0].box.top)}`;
            if (!reportedLayoutDefects.has(key)) {
              reportedLayoutDefects.add(key);
              defects.push({
                type: 'Spacing Inconsistency',
                selector: containerSelector,
                description: 'Spacing between repeated cards or grid items is inconsistent within the row.',
                details: {
                  rowTop: Math.round(row[0].box.top),
                  itemSelectors: row.map((item) => item.selector),
                  horizontalGaps: horizontalGaps.map((gap) => Number(gap.toFixed(1))),
                  gapSpread: Number(gapSpread.toFixed(1))
                }
              });
            }
          }
        }
      }

      const comparableRows = rows.filter((row) => row.length === rows[0]?.length && row.length >= 2);
      if (comparableRows.length >= 2) {
        const expectedColumns = comparableRows[0].map((item) => item.box.left);
        const deviations = comparableRows.slice(1).flatMap((row) =>
          row.map((item, column) => Math.abs(item.box.left - expectedColumns[column]))
        );
        const maximumDeviation = Math.max(0, ...deviations);
        if (maximumDeviation > 10) {
          const key = `alignment|${containerSelector}`;
          if (!reportedLayoutDefects.has(key)) {
            reportedLayoutDefects.add(key);
            defects.push({
              type: 'Grid/Card Alignment',
              selector: containerSelector,
              description: 'Repeated grid or card rows do not align to consistent column edges.',
              details: {
                rowItemSelectors: comparableRows.map((row) => row.map((item) => item.selector)),
                columnLeftEdges: comparableRows.map((row) => row.map((item) => Number(item.box.left.toFixed(1)))),
                maximumDeviation: Number(maximumDeviation.toFixed(1)),
                allowedDeviation: 10
              }
            });
          }
        }
      }

      if (rows.length >= 3) {
        const verticalGaps = rows.slice(1).map((row, rowIndex) => {
          const previousBottom = Math.max(...rows[rowIndex].map((item) => item.box.bottom));
          return Math.min(...row.map((item) => item.box.top)) - previousBottom;
        });
        const gapSpread = Math.max(...verticalGaps) - Math.min(...verticalGaps);
        if (Math.min(...verticalGaps) >= 0 && gapSpread > Math.max(8, Math.max(1, median(verticalGaps)) * 0.35)) {
          const key = `vertical-spacing|${containerSelector}`;
          if (!reportedLayoutDefects.has(key)) {
            reportedLayoutDefects.add(key);
            defects.push({
              type: 'Spacing Inconsistency',
              selector: containerSelector,
              description: 'Vertical spacing between repeated card or grid rows is inconsistent.',
              details: {
                verticalGaps: verticalGaps.map((gap) => Number(gap.toFixed(1))),
                gapSpread: Number(gapSpread.toFixed(1))
              }
            });
          }
        }
      }
    }

    const forms = Array.from(document.querySelectorAll<HTMLElement>('form, [role="form"]')).slice(0, 50);
    for (const form of forms) {
      const controls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]),select,textarea'
      )).slice(0, 100);
      for (const control of controls) {
        if (control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type)) continue;
        const controlRect = control.getBoundingClientRect();
        if (controlRect.width <= 1 || controlRect.height <= 1) continue;
        const explicitLabel = control.id
          ? form.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(control.id)}"]`)
          : null;
        const label = explicitLabel ?? control.closest<HTMLLabelElement>('label');
        if (!label) continue;
        const labelRect = label.getBoundingClientRect();
        if (labelRect.width <= 1 || labelRect.height <= 1) continue;
        const isFloatingPattern = Boolean(label.closest('[class*="floating"], [class*="float-label"], [class*="form-floating"]'));
        if (isFloatingPattern) continue;

        const sharedParentStyle = label.parentElement === control.parentElement && label.parentElement
          ? getComputedStyle(label.parentElement)
          : null;
        const horizontalLayoutIntent = Boolean(
          sharedParentStyle?.display.includes('flex') &&
          !sharedParentStyle.flexDirection.startsWith('column')
        );
        const horizontalPair = horizontalLayoutIntent || (
          labelRect.right <= controlRect.left + 4 &&
          Math.min(labelRect.bottom, controlRect.bottom) - Math.max(labelRect.top, controlRect.top) > 0
        );
        const verticalPair = !horizontalPair && labelRect.bottom <= controlRect.top + 4;
        const centerDelta = Math.abs((labelRect.top + labelRect.bottom) / 2 - (controlRect.top + controlRect.bottom) / 2);
        const leftDelta = Math.abs(labelRect.left - controlRect.left);
        const horizontalTolerance = Math.max(8, Math.min(labelRect.height, controlRect.height) * 0.3);
        const misaligned =
          (horizontalPair && centerDelta > horizontalTolerance) ||
          (verticalPair && leftDelta > 12);
        if (!misaligned) continue;

        defects.push({
          type: 'Form Label/Input Alignment',
          selector: selectorFor(control),
          description: 'A form label and its input do not share the expected vertical center or left edge.',
          details: {
            form: selectorFor(form),
            label: selectorFor(label),
            control: selectorFor(control),
            orientation: horizontalPair ? 'horizontal' : 'vertical',
            labelBox: {
              left: Number(labelRect.left.toFixed(1)),
              top: Number(labelRect.top.toFixed(1)),
              width: Number(labelRect.width.toFixed(1)),
              height: Number(labelRect.height.toFixed(1))
            },
            inputBox: {
              left: Number(controlRect.left.toFixed(1)),
              top: Number(controlRect.top.toFixed(1)),
              width: Number(controlRect.width.toFixed(1)),
              height: Number(controlRect.height.toFixed(1))
            },
            centerDelta: Number(centerDelta.toFixed(1)),
            leftEdgeDelta: Number(leftDelta.toFixed(1))
          }
        });
      }
    }

    const uniqueDefects = new Map<string, Defect>();
    for (const defect of defects) uniqueDefects.set(`${defect.type}|${defect.selector}|${defect.description}`, defect);
    return Array.from(uniqueDefects.values()).slice(0, 120);
  });
}

export async function detectShiftDefects(page: Page): Promise<DomDefect[]> {
  const config = auditConfig.layoutShift;
  const firstSnapshot = await collectLayoutShiftSnapshot(page, config);
  if (config.mode === 'humanVision') {
    await waitForHumanVisualStability(page, config);
  }
  await page.waitForTimeout(config.mode === 'strict' ? 850 : config.persistenceMs);
  const secondSnapshot = await collectLayoutShiftSnapshot(page, config);
  const clsValue = await collectCumulativeLayoutShift(page);
  return compareLayoutSnapshots(firstSnapshot, secondSnapshot, config, clsValue, 'postLoad');
}

/**
 * Finds server-rendered instability that only appears between navigations. This is intentionally
 * separate from CLS: a page can have CLS=0 on every load while placing content differently on
 * each reload (the Herokuapp shifting-content examples behave exactly this way).
 */
export async function detectReloadShiftDefects(page: Page): Promise<DomDefect[]> {
  const config = auditConfig.layoutShift;
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  if (config.mode === 'humanVision') {
    await waitForHumanVisualStability(page, config);
  }
  const before = await collectLayoutShiftSnapshot(page, config);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  if (config.mode === 'humanVision') {
    await waitForHumanVisualStability(page, config);
  } else {
    await page.waitForTimeout(250);
  }
  const after = await collectLayoutShiftSnapshot(page, config);
  const clsValue = await collectCumulativeLayoutShift(page);
  return compareLayoutSnapshots(before, after, config, clsValue, 'reload');
}
