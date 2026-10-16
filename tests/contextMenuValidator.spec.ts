import { expect, test } from '@playwright/test';
import { ContextMenuValidator } from '../validators/ContextMenuValidator';

test('passes all context-menu interaction assertions and accepts the alert', async ({ page }) => {
  await page.setContent(`
    <div id="hot-spot" style="width:300px;height:180px;border:1px solid red"></div>
    <script>
      document.querySelector('#hot-spot').addEventListener('contextmenu', event => {
        event.preventDefault();
        alert('You selected a context menu');
      });
    </script>
  `);

  const result = await new ContextMenuValidator().validate(
    page,
    'https://example.test/context_menu',
    'Desktop Full HD',
    'context-menu-test'
  );

  expect(result.checks).toHaveLength(6);
  expect(result.checks.every((check) => check.result === 'PASS')).toBe(true);
  expect(result.issues).toHaveLength(0);
  await expect(page.locator('#hot-spot')).toBeVisible();
});

test('reports every dependent context-menu assertion when the Hot Spot is missing', async ({ page }) => {
  await page.setContent('<h1>Context Menu</h1>');

  const result = await new ContextMenuValidator().validate(
    page,
    'https://example.test/context_menu',
    'Desktop Full HD'
  );

  expect(result.checks.find((check) => check.checkName === 'Hot Spot presence')?.result).toBe('FAIL');
  expect(result.checks.find((check) => check.checkName === 'Right-click interaction')?.result).toBe('FAIL');
  expect(result.checks.find((check) => check.checkName === 'Context-menu alert appearance')?.result).toBe('FAIL');
  expect(result.checks.find((check) => check.checkName === 'Context-menu alert text')?.result).toBe('FAIL');
  expect(result.checks.find((check) => check.checkName === 'Context-menu alert acceptance')?.result).toBe('FAIL');
});
