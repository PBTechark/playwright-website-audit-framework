import { expect, request, test } from '@playwright/test';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { LinkValidator } from '../validators/LinkValidator';

test('reports visible CTA anchors that use placeholder href values', async ({ page }) => {
  await page.setContent(`
    <style>
      .cta {
        display:inline-block;
        min-width:180px;
        padding:14px 20px;
        background:#b91c1c;
        color:white;
        text-transform:uppercase;
      }
    </style>
    <a id="call-office" class="cta" href="#">Call NexGen Office</a>
    <a id="email-office" class="cta" href="#">Contact Via Email</a>
  `);
  const api = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const result = await new LinkValidator(api, 'https://example.com').validate(page, 'https://example.com/careers', 'Desktop');

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'Links',
        selector: '#call-office',
        evidenceDetails: [expect.objectContaining({ label: 'link-cta-issue-0', annotated: true })],
        description: expect.stringContaining('Visible CTA link has no actionable destination')
      }),
      expect.objectContaining({
        category: 'Links',
        selector: '#email-office',
        evidenceDetails: [expect.objectContaining({ label: 'link-cta-issue-1', annotated: true })],
        description: expect.stringContaining('Visible CTA link has no actionable destination')
      })
    ]));
  } finally {
    await api.dispose();
  }
});

test('does not report close controls as missing CTA destinations', async ({ page }) => {
  await page.setContent(`
    <a id="close-drawer" class="close" href="javascript:void(0);" style="display:block;width:40px;height:40px;">X</a>
  `);
  const api = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const result = await new LinkValidator(api, 'https://example.com').validate(page, 'https://example.com/careers', 'Desktop');

    expect(result.issues.filter((issue) => issue.description.includes('Visible CTA link has no actionable destination'))).toHaveLength(0);
  } finally {
    await api.dispose();
  }
});

test('does not report accordion fragment links with a valid controlled panel as missing anchors', async ({ page }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`
      <h3 id="accordion-trigger" role="tab" aria-controls="accordion-panel" aria-expanded="false">
        <a href="#how-do-your-receptionists-know-what-to-say">How do your receptionists know what to say?</a>
      </h3>
      <div id="accordion-panel" role="tabpanel" hidden>Accordion answer</div>
      <a href="#missing-target">Broken in-page link</a>
    `);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}/`;
  const api = await request.newContext({ ignoreHTTPSErrors: true });

  try {
    await page.goto(origin);
    const result = await new LinkValidator(api, origin).validate(page, origin, 'Desktop');
    const missingAnchorIssues = result.issues.filter((issue) =>
      issue.description.startsWith('Anchor target is missing:')
    );

    expect(missingAnchorIssues).toEqual([
      expect.objectContaining({
        description: 'Anchor target is missing: #missing-target'
      })
    ]);
  } finally {
    await api.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('reports a header logo that resolves to another hostname and includes its redirect chain', async ({
  page
}) => {
  const server = createServer((request, response) => {
    if (request.url === '/logo') {
      response.writeHead(302, { location: '/destination' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<main>Homepage</main>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const api = await request.newContext({ ignoreHTTPSErrors: true });

  try {
    await page.setContent(`
      <header>
        <a class="site-logo" href="${origin}/logo">
          <img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt="Site logo">
        </a>
      </header>
    `);
    const result = await new LinkValidator(api, `http://localhost:${address.port}/`).validate(
      page,
      `http://localhost:${address.port}/`,
      'Desktop'
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Links',
          description: expect.stringContaining('Header logo navigates outside the audited website')
        })
      ])
    );
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linkType: 'logo',
          finalUrl: `${origin}/destination`,
          redirectChain: [`${origin}/logo`, `${origin}/destination`]
        })
      ])
    );
  } finally {
    await api.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
