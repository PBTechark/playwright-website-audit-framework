import { expect, test } from '@playwright/test';
import { FooterValidator } from '../validators/FooterValidator';

test('recognizes a visible copyright block immediately outside the semantic footer', async ({ page }) => {
  await page.setContent(`
    <footer class="entry-footer">Posted in News</footer>
    <footer class="site-footer"><a href="/contact">Contact</a></footer>
    <div class="copyright">© 2026 Strelitz International Academy<br>All rights reserved.</div>
  `);

  const issues = await new FooterValidator().validate(page, 'https://example.com/', 'Desktop');

  expect(issues.filter((issue) => issue.description.includes('copyright notice'))).toHaveLength(0);
});

test('reports a copyright notice when no visible copyright text exists', async ({ page }) => {
  await page.setContent(`
    <footer class="site-footer"><a href="/contact">Contact</a></footer>
    <div class="copyright" style="display:none">© 2026 Example</div>
  `);

  const issues = await new FooterValidator().validate(page, 'https://example.com/', 'Desktop');

  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: 'Footer copyright notice is missing or not visible.'
    })
  ]));
});
