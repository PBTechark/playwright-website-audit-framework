import { createServer } from 'http';
import { AddressInfo } from 'net';
import { expect, test } from '@playwright/test';
import { WebsiteCrawler } from '../crawlers/WebsiteCrawler';
import { detectAccessChallenge } from '../utils/accessChallenge';

test('detects a CAPTCHA challenge by its URL and captures its response status', async ({ page }) => {
  await page.route('https://audit.test/.well-known/sgcaptcha/**', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'text/html',
      body: '<title>Robot Challenge Screen</title><p>Please verify your browser.</p>'
    });
  });
  const response = await page.goto('https://audit.test/.well-known/sgcaptcha/?r=%2Ftarget');

  await expect
    .poll(() => detectAccessChallenge(page, response?.status()))
    .toMatchObject({
      finalUrl: 'https://audit.test/.well-known/sgcaptcha/?r=%2Ftarget',
      title: 'Robot Challenge Screen',
      status: 202,
      detectedBy: expect.arrayContaining(['challenge-url', 'challenge-title'])
    });
});

test('detects a challenge page by its title when the URL is not branded', async ({ page }) => {
  await page.route('https://audit.test/verification', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<title>Security Challenge</title><p>Access verification</p>'
    });
  });
  await page.goto('https://audit.test/verification');

  await expect
    .poll(() => detectAccessChallenge(page))
    .toMatchObject({ detectedBy: ['challenge-title'] });
});

test('does not classify a normal page as an access challenge', async ({ page }) => {
  await page.route('https://audit.test/normal', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<title>Our Services</title><main>Welcome to our website.</main>'
    });
  });
  await page.goto('https://audit.test/normal');

  expect(await detectAccessChallenge(page)).toBeNull();
});

test('crawler records the requested URL instead of inventorying CAPTCHA content', async ({ browser, request }) => {
  const server = createServer((incoming, outgoing) => {
    if (incoming.url === '/our-services/weight-loss/') {
      outgoing.writeHead(200, { 'content-type': 'text/html' });
      outgoing.end(
        '<meta http-equiv="refresh" content="0;url=/.well-known/sgcaptcha/?r=%2Four-services%2Fweight-loss">'
      );
      return;
    }
    if (incoming.url?.startsWith('/.well-known/sgcaptcha/')) {
      outgoing.writeHead(202, { 'content-type': 'text/html' });
      outgoing.end('<title>Robot Challenge Screen</title><main>Verification required</main>');
      return;
    }
    outgoing.writeHead(404);
    outgoing.end('Not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const requestedUrl = `http://127.0.0.1:${port}/our-services/weight-loss/`;

  try {
    const inventory = await new WebsiteCrawler(browser, request, {
      name: 'CAPTCHA regression',
      url: requestedUrl,
      enabled: true,
      maxPages: 5,
      maxDepth: 1
    }).crawl();

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      url: requestedUrl,
      title: 'Robot Challenge Screen',
      status: 202,
      accessBlocked: 'captcha',
      finalUrl: expect.stringContaining('/.well-known/sgcaptcha/')
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
