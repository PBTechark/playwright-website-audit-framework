import { expect, test } from '@playwright/test';
import { BrowserSignalCollector } from '../utils/browserSignals';
import { detectMisdirectedRequests } from '../audits/MisdirectedRequestAudit';

const cloudflare421 = '<!doctype html><title>421 Misdirected Request</title><p>cloudflare</p>';

test('reports a High main-document HTTP 421 with evidence metadata', async ({ page }) => {
  await page.route('https://audit.test/main', (route) =>
    route.fulfill({ status: 421, contentType: 'text/html', body: cloudflare421 })
  );
  const signals = new BrowserSignalCollector();
  signals.attach(page);
  await page.goto('https://audit.test/main');

  const issues = await detectMisdirectedRequests(page, 'https://audit.test/main', 'Desktop', signals, 'test', 'https://audit.test');
  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: 'HTTP 421 Misdirected Request detected.',
      severity: 'High',
      details: expect.objectContaining({ source: 'HTTP 421 response', status: 421 })
    })
  ]));
});

test('reports a Cloudflare 421 rendered inside an iframe even when the wrapper response is 200', async ({ page }) => {
  await page.route('https://audit.test/wrapper', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<iframe src="https://audit.test/frame"></iframe>' })
  );
  await page.route('https://audit.test/frame', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: cloudflare421 })
  );
  const signals = new BrowserSignalCollector();
  signals.attach(page);
  await page.goto('https://audit.test/wrapper');
  await page.waitForLoadState('networkidle');

  const issues = await detectMisdirectedRequests(page, 'https://audit.test/wrapper', 'Mobile Portrait', signals);
  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: 'HTTP 421 Misdirected Request detected.',
      severity: 'High',
      details: expect.objectContaining({ source: 'Cloudflare 421 error content', frameUrl: 'https://audit.test/frame' })
    })
  ]));
});
