import { expect, test } from '@playwright/test';
import { ContentIntegrityAudit } from '../audits/ContentIntegrityAudit';

test('reports visible markup, server diagnostics, stack traces, and template syntax', async ({ page }) => {
  await page.setContent(`
    <main id="broken-content">
      &lt;div&gt;
      &lt;script&gt;
      &lt;span&gt;
      &lt;p&gt;
      &lt;/body&gt;
      &lt;html&gt;
      &amp;lt;h1&amp;gt;
      PHP Warning: Undefined variable $title in /var/www/index.php on line 12
      Stack trace: #0 /var/www/index.php(12): render()
      {{title}} {{content}} {{author}} &lt;%= user.name %&gt;
      [contact-form-7] [gallery] [put_wpgm id=1]
    </main>
  `);

  const result = await new ContentIntegrityAudit().run(
    page,
    'https://example.test/broken-content',
    'Desktop Full HD',
    'content-integrity-test',
    []
  );

  expect(result.checks).toHaveLength(8);
  expect(result.checks.every((check) => check.result === 'FAIL')).toBe(true);
  expect(result.issues).toHaveLength(8);
  expect(result.checks.find((check) => check.checkName === 'Visible raw <div> tag')?.actual).toContain('<div>');
  expect(result.checks.find((check) => check.checkName === 'Visible raw <script> tag')?.actual).toContain('<script>');
  expect(result.checks.find((check) => check.checkName === 'Visible encoded HTML entity')?.actual).toContain('&lt;h1&gt;');
  expect(result.checks.find((check) => check.checkName === 'Visible raw structural HTML tag')?.actual).toContain('</body>');
  expect(result.checks.find((check) => check.checkName === 'Unresolved template syntax')?.actual).toContain('{{author}}');
  expect(result.checks.find((check) => check.checkName === 'Unresolved CMS shortcode')?.actual).toContain('[gallery]');
  //expect(result.checks.find((check) => check.checkName === 'Unresolved CMS shortcode')?.actual).toContain('[put_wpgm id=1]');
  expect(result.checks.find((check) => check.checkName === 'Unresolved CMS shortcode')?.actual)
  .toMatch(/\[put_wpgm\s+id\s*=\s*1\]/i);
});

test('ignores intentional examples inside code and preformatted blocks', async ({ page }) => {
  await page.setContent(`
    <pre>&lt;div&gt; PHP Warning: example Stack trace: {{title}}</pre>
    <code>&lt;script&gt; &amp;lt;h1&amp;gt;</code>
    <div class="highlight">&lt;span&gt; {{content}} [contact-form-7]</div>
    <div class="hljs">&lt;/body&gt; &lt;html&gt; [gallery]</div>
    <div>\`\`\`html
      &lt;p&gt; {{author}} [gallery]
    \`\`\`</div>
  `);

  const result = await new ContentIntegrityAudit().run(
    page,
    'https://example.test/documentation',
    'Desktop Full HD',
    undefined,
    []
  );

  expect(result.checks.every((check) => check.result === 'PASS')).toBe(true);
  expect(result.issues).toHaveLength(0);
});
