import path from 'path';
import { request } from '@playwright/test';
import { test, expect } from '../fixtures/audit-fixtures';
import { DeploymentAudit } from '../audits/DeploymentAudit';
import { PerformanceAudit } from '../audits/PerformanceAudit';
import { ResponsiveAudit } from '../audits/ResponsiveAudit';
import { SecurityAudit } from '../audits/SecurityAudit';
import { TechnicalAudit } from '../audits/TechnicalAudit';
import { VisualAudit } from '../audits/VisualAudit';
import { ComponentAssertionAudit } from '../audits/ComponentAssertionAudit';
import { ContentIntegrityAudit } from '../audits/ContentIntegrityAudit';
import { auditConfig } from '../config/auditConfig';
import { ButtonValidator } from '../validators/ButtonValidator';
import { FooterValidator } from '../validators/FooterValidator';
import { FormValidator } from '../validators/FormValidator';
import { HeaderValidator } from '../validators/HeaderValidator';
import { ImageValidator } from '../validators/ImageValidator';
import { LinkValidator } from '../validators/LinkValidator';
import { PopupValidator } from '../validators/PopupValidator';
import { ContextMenuValidator } from '../validators/ContextMenuValidator';
import { VideoValidator } from '../validators/VideoValidator';
import { ensureDir, readJsonFile, safeFileName, writeJsonFile } from '../utils/fileSystem';
import { collectPerformanceMetrics } from '../utils/performanceMetrics';
import { createIssue } from '../utils/issueFactory';
import { isReportableIssue } from '../utils/reportFilters';
import { AuditCheck, AuditIssue, AuditResult, PageInventoryItem, ViewportResolution } from '../utils/types';

const inventory = readJsonFile<PageInventoryItem[]>(auditConfig.inventoryPath, []);

function isUserVisibleActionIssue(issue: AuditIssue): boolean {
  return issue.category === 'Visual' ||
    issue.category === 'Videos' ||
    /Visible CTA link has no actionable destination/i.test(issue.description);
}

function issueSummary(issues: AuditIssue[]): string {
  return issues
    .slice(0, 10)
    .map((issue, index) => `${index + 1}. [${issue.category}/${issue.severity}] ${issue.description}${issue.selector ? ` (${issue.selector})` : ''}`)
    .join('\n');
}

test.describe('Automated website audit', () => {
  for (const pageItem of inventory) {
    test(`audit ${pageItem.targetName} ${pageItem.url}`, async ({ page, signals }, testInfo) => {
      const viewport = testInfo.project.name;
      const isMobile = Boolean(testInfo.project.use.isMobile);
      const api = await request.newContext({ ignoreHTTPSErrors: true });
      const issues: AuditIssue[] = [];
      const checks: AuditCheck[] = [];
      const screenshots = [];
      const startedAt = new Date().toISOString();
      let resolution: ViewportResolution | undefined;

      try {
        const response = await page.goto(pageItem.url, {
          waitUntil: 'domcontentloaded',
          timeout: auditConfig.navigationTimeoutMs
        }).catch(() => null);
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

        const browserViewport = page.viewportSize();
        const runtimeScreen = await page.evaluate(() => ({
          layoutWidth: window.innerWidth,
          layoutHeight: window.innerHeight,
          visualWidth: window.visualViewport?.width ?? window.innerWidth,
          visualHeight: window.visualViewport?.height ?? window.innerHeight,
          devicePixelRatio: window.devicePixelRatio
        }));
        const testedWidth = browserViewport?.width ?? Math.round(runtimeScreen.visualWidth);
        const testedHeight = browserViewport?.height ?? Math.round(runtimeScreen.visualHeight);
        resolution = {
          width: testedWidth,
          height: testedHeight,
          devicePixelRatio: runtimeScreen.devicePixelRatio,
          label: `${viewport} — ${testedWidth} × ${testedHeight}`,
          layoutWidth: runtimeScreen.layoutWidth,
          layoutHeight: runtimeScreen.layoutHeight,
          visualWidth: Number(runtimeScreen.visualWidth.toFixed(2)),
          visualHeight: Number(runtimeScreen.visualHeight.toFixed(2))
        };
        testInfo.annotations.push({ type: 'screen-resolution', description: resolution.label });
        await testInfo.attach('screen-resolution', {
          body: JSON.stringify(resolution, null, 2),
          contentType: 'application/json'
        });

        if (!response) {
          issues.push(
            createIssue({
              category: 'Deployment',
              url: pageItem.url,
              viewport,
              description: `Navigation did not return a page response for ${pageItem.url}.`,
              severity: 'High',
              expected: 'A valid page response',
              actual: 'No response object returned',
              businessImpact: 'Users cannot access the page and the deployment status is unhealthy.',
              suggestedFix: 'Investigate DNS, hosting, or application routing for the target URL.',
              details: { status: 0 }
            })
          );
        } else if (response.status() >= 400) {
          issues.push(
            ...(await new DeploymentAudit().run(page, pageItem.url, viewport, response, pageItem.targetName))
          );

          const pageFailedWith404or500 = [404, 500].includes(response.status());
          if (pageFailedWith404or500) {
            await testInfo.attach('deployment-findings', {
              body: JSON.stringify({ status: response.status(), url: pageItem.url, issues }, null, 2),
              contentType: 'application/json'
            });
            expect(pageFailedWith404or500, `Page load failed with HTTP ${response.status()} on ${pageItem.url}`).toBe(false);
          }
        }

        const popupResult = await new PopupValidator().validate(page, pageItem.url, viewport);
        checks.push(...popupResult.checks);
        issues.push(...popupResult.issues);
        if (popupResult.checks.length > 0) {
          await testInfo.attach('popup-close-assertions', {
            body: JSON.stringify(popupResult, null, 2),
            contentType: 'application/json'
          });
          const popupFailures = popupResult.checks.filter((check) => check.result === 'FAIL');
          expect.soft(
            popupFailures.length,
            `Popup close validation failed with ${popupFailures.length} assertion(s) at ${resolution.label}`
          ).toBe(0);
        }

        const visual = await new VisualAudit().run(page, pageItem.url, viewport, pageItem.targetName);
        screenshots.push(...visual.screenshots);
        issues.push(...visual.issues);

        if (visual.issues.length > 0) {
          await testInfo.attach('visual-findings', {
            body: JSON.stringify({ issues: visual.issues, screenshots: visual.screenshots }, null, 2),
            contentType: 'application/json'
          });
          for (const screenshot of visual.screenshots) {
            const screenshotPath = path.join(process.cwd(), screenshot.path);
            await testInfo.attach(`visual-evidence-${screenshot.label}`, {
              path: screenshotPath
            });
          }
        }

        const contextMenuResult = await new ContextMenuValidator().validate(
          page,
          pageItem.url,
          viewport,
          pageItem.targetName
        );
        checks.push(...contextMenuResult.checks);
        issues.push(...contextMenuResult.issues);
        screenshots.push(...contextMenuResult.screenshots);
        if (contextMenuResult.checks.length > 0) {
          await testInfo.attach('context-menu-assertions', {
            body: JSON.stringify(contextMenuResult, null, 2),
            contentType: 'application/json'
          });
          const contextMenuFailures = contextMenuResult.checks.filter((check) => check.result === 'FAIL');
          expect.soft(
            contextMenuFailures.length,
            `Context-menu validation failed with ${contextMenuFailures.length} assertion(s) at ${resolution.label}`
          ).toBe(0);
        }

        const contentIntegrityResult = await new ContentIntegrityAudit().run(
          page,
          pageItem.url,
          viewport,
          pageItem.targetName,
          screenshots.map((item) => item.path)
        );
        checks.push(...contentIntegrityResult.checks);
        issues.push(...contentIntegrityResult.issues);
        screenshots.push(...contentIntegrityResult.screenshots);
        const contentIntegrityFailures = contentIntegrityResult.checks.filter((check) => check.result === 'FAIL');
        if (contentIntegrityFailures.length > 0) {
          await testInfo.attach('content-integrity-assertions', {
            body: JSON.stringify(contentIntegrityResult, null, 2),
            contentType: 'application/json'
          });
          expect.soft(
            contentIntegrityFailures.length,
            `Content-integrity validation failed with ${contentIntegrityFailures.length} assertion(s) at ${resolution.label}`
          ).toBe(0);
        }

        issues.push(...(await new HeaderValidator().validate(page, pageItem.url, viewport, isMobile)));
        issues.push(...(await new FooterValidator().validate(page, pageItem.url, viewport)));
        issues.push(...(await new ResponsiveAudit().run(page, pageItem.url, viewport, isMobile)));
        issues.push(...(await new DeploymentAudit().run(page, pageItem.url, viewport, response ?? undefined, pageItem.targetName)));
        issues.push(...(await new SecurityAudit().run(page, pageItem.url, viewport, response ?? undefined)));
        issues.push(...(await new FormValidator().validate(page, pageItem.url, viewport)));
        issues.push(...(await new ButtonValidator().validate(page, pageItem.url, viewport, pageItem.targetName)));

        const linkResult = await new LinkValidator(api, pageItem.targetBaseUrl).validate(page, pageItem.url, viewport);
        const imageResult = await new ImageValidator(api).validate(page, pageItem.url, viewport, pageItem.targetName);
        const videoResult = await new VideoValidator(api).validate(
          page,
          pageItem.url,
          viewport,
          pageItem.targetName,
          screenshots.map((item) => item.path),
          signals
        );
        checks.push(...videoResult.checks);
        screenshots.push(...videoResult.screenshots);
        issues.push(...linkResult.issues, ...imageResult.issues, ...videoResult.issues);

        const linkFailures = linkResult.findings.filter((finding) => finding.statusCode === 404 || finding.statusCode === 500);
        if (linkResult.issues.length > 0 || linkFailures.length > 0) {
          await testInfo.attach('link-findings', {
            body: JSON.stringify({ findings: linkResult.findings, issues: linkResult.issues }, null, 2),
            contentType: 'application/json'
          });
        }

        if (videoResult.findings.length > 0 || videoResult.checks.length > 0) {
          await testInfo.attach('video-findings', {
            body: JSON.stringify({
              findings: videoResult.findings,
              issues: videoResult.issues
            }, null, 2),
            contentType: 'application/json'
          });
          await testInfo.attach('video-assertions', {
            body: JSON.stringify({ checks: videoResult.checks }, null, 2),
            contentType: 'application/json'
          });
          for (const screenshot of videoResult.screenshots) {
            const screenshotPath = path.join(process.cwd(), screenshot.path);
            await testInfo.attach(`video-evidence-${screenshot.label}`, {
              path: screenshotPath
            });
          }
        }

        const userVisibleIssues = issues.filter((issue) => isReportableIssue(issue) && isUserVisibleActionIssue(issue));
        if (userVisibleIssues.length > 0) {
          await testInfo.attach('human-visible-findings', {
            body: JSON.stringify({ issues: userVisibleIssues }, null, 2),
            contentType: 'application/json'
          });
          expect.soft(
            userVisibleIssues.length,
            `Human-visible validation failed with ${userVisibleIssues.length} issue(s) at ${resolution.label}\n${issueSummary(userVisibleIssues)}`
          ).toBe(0);
        }

        if (linkFailures.length > 0) {
          expect.soft(
            linkFailures.length,
            `Link validation failed with ${linkFailures.length} 404/500 findings at ${resolution.label}`
          ).toBe(0);
        }

        // Fail the test immediately if image validation reports Critical/High issues and attach evidence
        const imageBlocking = imageResult.issues.filter((i) =>
          isReportableIssue(i) && (i.severity === 'Critical' || i.severity === 'High')
        );
        if (imageBlocking.length > 0) {
          await testInfo.attach('image-findings', {
            body: JSON.stringify({ findings: imageResult.findings, issues: imageResult.issues }, null, 2),
            contentType: 'application/json'
          });
          expect.soft(
            imageBlocking.length,
            `Image validation failed with ${imageBlocking.length} Critical/High findings at ${resolution.label}`
          ).toBe(0);
        }

        const metrics = await collectPerformanceMetrics(page, signals);
        issues.push(...new PerformanceAudit().run(pageItem.url, viewport, metrics));

        const componentAssertions = await new ComponentAssertionAudit().run(
          page,
          pageItem.url,
          viewport,
          metrics,
          signals,
          screenshots.map((item) => item.path)
        );
        checks.push(...componentAssertions.checks);
        issues.push(...componentAssertions.issues);

        if ((metrics.cumulativeLayoutShift ?? 0) > 0.25) {
          await testInfo.attach('performance-cls-supporting-signal', {
            body: JSON.stringify({
              metrics,
              note: 'CLS is retained as supporting evidence. Visible layout movement is evaluated by VisualAudit.'
            }, null, 2),
            contentType: 'application/json'
          });
        }

        const technicalIssues = new TechnicalAudit().run(pageItem.url, viewport, signals);
        issues.push(...technicalIssues);
        const criticalJavaScriptIssues = technicalIssues.filter(
          (issue) => issue.severity === 'Critical' && /console|uncaught|javascript/i.test(issue.description)
        );
        if (criticalJavaScriptIssues.length > 0) {
          await testInfo.attach('critical-javascript-errors', {
            body: JSON.stringify(criticalJavaScriptIssues, null, 2),
            contentType: 'application/json'
          });
          expect.soft(
            criticalJavaScriptIssues.length,
            `Critical JavaScript validation failed at ${resolution.label}`
          ).toBe(0);
        }
        for (const issue of issues) {
          issue.targetName = pageItem.targetName;
          issue.targetBaseUrl = pageItem.targetBaseUrl;
          issue.resolution = resolution;
        }
        for (const check of checks) {
          check.resolution = resolution;
        }

        const result: AuditResult = {
          targetName: pageItem.targetName,
          targetBaseUrl: pageItem.targetBaseUrl,
          page: pageItem,
          viewport,
          resolution,
          startedAt,
          finishedAt: new Date().toISOString(),
          screenshots,
          issues: issues.filter(isReportableIssue),
          checks,
          performance: metrics
        };
        ensureDir(auditConfig.rawResultsDir);
        writeJsonFile(
          `${auditConfig.rawResultsDir}/${safeFileName(`${pageItem.targetName}-${viewport}-${pageItem.url}`)}.json`,
          result
        );

        await testInfo.attach('audit-result', {
          body: JSON.stringify(result, null, 2),
          contentType: 'application/json'
        });

        const blockingIssues = issues.filter(
          (issue) => issue.severity === 'Critical' || issue.severity === 'High'
        );
        testInfo.annotations.push({
          type: 'audit-findings',
          description: `${blockingIssues.length} critical/high; ${issues.length} total`
        });

      } finally {
        await api.dispose();
      }
    });
  }
});
