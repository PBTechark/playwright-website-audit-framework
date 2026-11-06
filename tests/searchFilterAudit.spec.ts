import { expect, Page, test } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { SearchFilterAudit } from '../audits/SearchFilterAudit';

const seniorRecord = `
  <article class="community-card">
    <a href="/communities/cottage-bridge"><h2>Cottage Bridge</h2></a>
    <p><strong>Property Type:</strong> Senior/Disabled</p>
    <p><strong>Waitlist:</strong> Closed</p>
  </article>
`;

const familyRecord = `
  <article class="community-card">
    <a href="/communities/family-homes"><h2>Family Homes</h2></a>
    <p><strong>Property Type:</strong> Family</p>
    <p><strong>Waitlist:</strong> Open</p>
  </article>
`;

function documentWith(records: string, totalText: string): string {
  return `<!doctype html>
    <html><body>
      <form method="get" action="/communities">
        <fieldset>
          <label for="property-type">Property Type</label>
          <select id="property-type" name="property_type">
            <option value="">All</option>
            <option value="senior">Senior/Disabled</option>
            <option value="family">Family</option>
          </select>
          <label for="waitlist">Waitlist</label>
          <select id="waitlist" name="waitlist-status">
            <option value="">All</option>
            <option value="closed">Closed</option>
            <option value="open">Open</option>
          </select>
          <button type="submit" name="search_filter" value="Search">Search</button>
          <button type="reset">Reset</button>
        </fieldset>
      </form>
      <main>
        <p class="result-count">${totalText}</p>
        ${records}
      </main>
    </body></html>`;
}

async function installListingRoute(
  page: Page,
  filteredPage: (propertyType: string, waitlist: string) => { records: string; total: string },
  baselineTotal = '2 communities'
): Promise<void> {
  await page.context().route('https://audit.test/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const propertyType = requestUrl.searchParams.get('property_type') ?? '';
    const waitlist = requestUrl.searchParams.get('waitlist-status') ?? '';
    const response =
      propertyType && waitlist
        ? filteredPage(propertyType, waitlist)
        : { records: `${seniorRecord}${familyRecord}`, total: baselineTotal };
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: documentWith(response.records, response.total)
    });
  });
  await page.goto('https://audit.test/communities');
}

test('reports only proven missing records from an explicitly complete baseline', async ({ page }) => {
  const previousScreenshotMode = auditConfig.screenshotMode;
  auditConfig.screenshotMode = 'off';
  try {
    await installListingRoute(page, (propertyType, waitlist) => {
      if (propertyType === 'senior' && waitlist === 'closed') {
        return {
          records: '<p class="empty-state">Sorry, but nothing matched your search terms.</p>',
          total: ''
        };
      }
      return { records: familyRecord, total: '1 communities' };
    });

    const result = await new SearchFilterAudit().run(page, page.url(), 'Desktop Full HD');

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      category: 'Interactions',
      severity: 'High',
      description: 'Search/filter results omit records proven to match the selected filters.',
      details: {
        filters: ['Property Type=Senior/Disabled', 'Waitlist=Closed'],
        baselineReportedTotal: 2,
        baselineRecordCount: 2,
        expectedRecordIds: ['/communities/cottage-bridge'],
        actualRecordIds: [],
        missingRecordIds: ['/communities/cottage-bridge'],
        filteredReportedTotal: null
      }
    });
    expect(result.checks.filter((check) => check.result === 'PASS')).toHaveLength(1);
    expect(result.checks.filter((check) => check.result === 'FAIL')).toHaveLength(1);
  } finally {
    auditConfig.screenshotMode = previousScreenshotMode;
  }
});

test('can prove a missing result from visible labeled baseline records without a result-count widget', async ({
  page
}) => {
  const previousScreenshotMode = auditConfig.screenshotMode;
  auditConfig.screenshotMode = 'off';
  try {
    await installListingRoute(
      page,
      (propertyType, waitlist) => {
        if (propertyType === 'senior' && waitlist === 'closed') {
          return {
            records: '<p class="empty-state">Sorry, but nothing matched your search terms.</p>',
            total: ''
          };
        }
        return { records: familyRecord, total: '1 communities' };
      },
      ''
    );

    const result = await new SearchFilterAudit().run(page, page.url(), 'Desktop Full HD');

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].details).toMatchObject({
      baselineReportedTotal: null,
      baselineRecordCount: 2,
      expectedRecordIds: ['/communities/cottage-bridge'],
      actualRecordIds: []
    });
  } finally {
    auditConfig.screenshotMode = previousScreenshotMode;
  }
});

test('does not report a defect when expected records are present', async ({ page }) => {
  await installListingRoute(page, (propertyType, waitlist) => {
    if (propertyType === 'senior' && waitlist === 'closed') {
      return { records: seniorRecord, total: '1 communities' };
    }
    return { records: familyRecord, total: '1 communities' };
  });

  const result = await new SearchFilterAudit().run(page, page.url(), 'Desktop Full HD');

  expect(result.issues).toHaveLength(0);
  expect(result.checks).toHaveLength(2);
  expect(result.checks.every((check) => check.result === 'PASS')).toBe(true);
});

test('skips verification when the baseline total contradicts the visible record count', async ({ page }) => {
  await page.context().route('https://audit.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: documentWith(`${seniorRecord}${familyRecord}`, '1 communities')
    });
  });
  await page.goto('https://audit.test/communities');

  const result = await new SearchFilterAudit().run(page, page.url(), 'Desktop Full HD');

  expect(result.issues).toHaveLength(0);
  expect(result.checks).toHaveLength(1);
  expect(result.checks[0]).toMatchObject({
    result: 'NOT_APPLICABLE',
    actual: 'Not verified: the baseline records were ambiguous or contradicted its reported total.'
  });
});

test('skips verification when filtered results have neither an explicit count nor an empty state', async ({
  page
}) => {
  await installListingRoute(page, () => ({
    records: '',
    total: ''
  }));

  const result = await new SearchFilterAudit().run(page, page.url(), 'Desktop Full HD');

  expect(result.issues).toHaveLength(0);
  expect(result.checks).toHaveLength(2);
  expect(result.checks.every((check) => check.result === 'NOT_APPLICABLE')).toBe(true);
});
