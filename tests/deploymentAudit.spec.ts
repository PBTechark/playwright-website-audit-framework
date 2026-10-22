import { expect, test } from '@playwright/test';
import { DeploymentAudit } from '../audits/DeploymentAudit';

test('does not report missing page regions when the server returns an access-denied response', async ({
  page
}) => {
  await page.route('https://example.com/blocked', (route) =>
    route.fulfill({ status: 403, body: 'Access denied' })
  );
  const response = await page.goto('https://example.com/blocked');
  const issues = await new DeploymentAudit().run(page, 'https://example.com/blocked', 'Desktop', response);

  expect(issues).toHaveLength(1);
  expect(issues[0]).toEqual(
    expect.objectContaining({
      category: 'Deployment',
      description: expect.stringContaining('HTTP 403')
    })
  );
});
