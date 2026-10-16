import { expect, request, test } from '@playwright/test';
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
        description: expect.stringContaining('Visible CTA link has no actionable destination')
      }),
      expect.objectContaining({
        category: 'Links',
        selector: '#email-office',
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
