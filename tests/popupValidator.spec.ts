import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { PopupValidator } from '../validators/PopupValidator';

test('detects and closes a visible popup using the close button', async ({ page }) => {
  await page.setContent(`
    <style>
      .newsletter-modal {
        position: fixed;
        inset: 120px auto auto 50%;
        transform: translateX(-50%);
        width: 420px;
        min-height: 280px;
        padding: 32px;
        background: white;
        z-index: 9999;
      }
      .close-button {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 40px;
        height: 40px;
      }
    </style>
    <div id="promo" class="newsletter-modal" role="dialog" aria-modal="true">
      <button id="close-promo" class="close-button" aria-label="Close">×</button>
      <h2>Save 10% on first order</h2>
      <input aria-label="Email address" />
      <button>Continue</button>
      <button>No Thanks</button>
    </div>
    <script>
      document.getElementById('close-promo').addEventListener('click', () => {
        document.getElementById('promo').style.display = 'none';
      });
    </script>
  `);

  const result = await new PopupValidator().validate(page, 'https://example.com', 'Desktop');

  expect(result.issues).toHaveLength(0);
  expect(result.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      component: 'Popup',
      checkName: 'Popup close action dismisses overlay',
      result: 'PASS'
    })
  ]));
  await expect(page.locator('#promo')).toBeHidden();
});

test('reports a visible popup with no close or dismiss control', async ({ page }) => {
  await page.setContent(`
    <div id="promo" class="popup" role="dialog" aria-modal="true" style="position:fixed;top:100px;left:100px;width:420px;height:260px;background:white;z-index:9999;">
      <h2>Subscribe and save</h2>
      <input aria-label="Email address" />
      <button>Continue</button>
    </div>
  `);

  const result = await new PopupValidator().validate(page, 'https://example.com', 'Desktop');

  expect(result.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      category: 'Interactions',
      selector: '#promo',
      description: 'Visible popup does not expose a close or dismiss control.'
    })
  ]));
  expect(result.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      checkName: 'Popup close control availability',
      result: 'FAIL'
    })
  ]));
});

test('reports a popup close control that does not dismiss the popup', async ({ page }) => {
  await page.setContent(`
    <div id="promo" class="popup" role="dialog" aria-modal="true" style="position:fixed;top:100px;left:100px;width:420px;height:260px;background:white;z-index:9999;">
      <button id="close-promo" aria-label="Close" style="width:40px;height:40px;">×</button>
      <h2>Limited time offer</h2>
      <button>No Thanks</button>
    </div>
  `);

  const previousScreenshotMode = auditConfig.screenshotMode;
  auditConfig.screenshotMode = 'on';
  let result: Awaited<ReturnType<PopupValidator['validate']>>;
  try {
    result = await new PopupValidator().validate(page, 'https://example.com/popup-failure', 'Desktop', 'popup-test');
  } finally {
    auditConfig.screenshotMode = previousScreenshotMode;
  }

  expect(result.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      category: 'Interactions',
      description: 'Popup close control does not dismiss the popup.'
    })
  ]));
  expect(result.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      checkName: 'Popup close action dismisses overlay',
      result: 'FAIL'
    })
  ]));
  expect(result.issues[0].details).toMatchObject({
    attempt: {
      attempted: true,
      dismissed: false,
      selector: '#close-promo'
    }
  });
  const evidencePath = result.issues[0].evidence?.[0];
  expect(evidencePath).toBeDefined();
  if (!evidencePath) throw new Error('Failed popup issue did not include screenshot evidence.');
  const evidenceFile = path.resolve(evidencePath);
  expect(fs.existsSync(evidenceFile)).toBe(true);
  expect(fs.statSync(evidenceFile).size).toBeGreaterThan(500);
  fs.rmSync(evidenceFile, { force: true });
});

test('excludes cookie consent dialogs and does not treat Accept as a popup close action', async ({ page }) => {
  await page.setContent(`
    <div id="bc76bf2e-5abb-4ece-8c70-ddbac079e621"
      class="osano-cm-window__dialog osano-cm-dialog osano-cm-dialog--position_bottom osano-cm-dialog--type_bar"
      role="dialog" aria-modal="true"
      style="position:fixed;bottom:0;left:0;width:100%;height:132px;background:white;">
      <p>This website utilizes technologies such as cookies to enable essential site functionality.</p>
      <button id="accept-consent">Accept</button>
      <button id="deny-consent">Deny Non-Essential</button>
    </div>
    <script>
      document.getElementById('accept-consent').addEventListener('click', (event) => {
        event.currentTarget.dataset.clicked = 'true';
      });
    </script>
  `);

  const result = await new PopupValidator().validate(page, 'https://example.com', 'Desktop');

  expect(result.issues).toHaveLength(0);
  expect(result.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      checkName: 'Visible popup detection',
      result: 'NOT_APPLICABLE'
    })
  ]));
  expect(await page.locator('#accept-consent').getAttribute('data-clicked')).toBeNull();
  await expect(page.locator('#bc76bf2e-5abb-4ece-8c70-ddbac079e621')).toBeVisible();
});

test('ignores bootstrap backdrop and closes the actual modal dialog', async ({ page }) => {
  await page.setContent(`
    <style>
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, .5);
        z-index: 1040;
      }
      .modal {
        position: fixed;
        inset: 0;
        z-index: 1050;
        display: block;
      }
      .modal-dialog {
        width: 480px;
        min-height: 260px;
        margin: 120px auto;
        background: white;
        padding: 24px;
      }
      .btn-close {
        width: 40px;
        height: 40px;
      }
    </style>
    <div class="modal-backdrop fade show"></div>
    <div id="newsletter-modal" class="modal fade show" role="dialog" aria-modal="true">
      <div class="modal-dialog">
        <button id="close-modal" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        <h2>Save 10% on first order</h2>
        <input aria-label="Email address" />
      </div>
    </div>
    <script>
      document.getElementById('close-modal').addEventListener('click', () => {
        document.getElementById('newsletter-modal').style.display = 'none';
        document.querySelector('.modal-backdrop').style.display = 'none';
      });
    </script>
  `);

  const result = await new PopupValidator().validate(page, 'https://example.com', 'Desktop');

  expect(result.issues).toHaveLength(0);
  expect(result.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      checkName: 'Popup close action dismisses overlay',
      result: 'PASS',
      selector: '#close-modal'
    })
  ]));
});
